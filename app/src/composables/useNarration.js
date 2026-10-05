/* global AbortController */
/**
 * @module composables/useNarration
 * @description A project read aloud, one document at a time.
 *
 * Over the stores and the `tts` module: the project's voices and hints, read
 * off the story and written back to it; a document's speakers, read off the
 * document and written back; and the readings themselves, which live here
 * and nowhere else — a reading is a session's worth of audio, cheap to make
 * again and too big to keep.
 *
 * One instance per story, so the panel and anything else that asks share
 * the readings in progress rather than starting their own.
 *
 * A reading keeps its audio by what was said and in whose voice (see
 * `tts/reading.js`), so it can be made a piece at a time: the whole
 * document, some blocks, one block again. Asked for the document, it
 * reads only what has no audio yet. Whatever there is audio for is joined
 * into one track, in document order, when a run ends and whenever the
 * document stops agreeing with the track it has; stopping halfway leaves
 * something to hear.
 */

import { computed, ref, shallowReactive } from 'vue'
import { nanoid } from 'nanoid'
import { useStoriesStore } from '@/stores/storiesStore'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useDocuments } from '@/composables/useDocuments'
import { useApplicationState } from '@/composables/useApplicationState'
import { assignSpeaker, blocksOf as readBlocks, resolveSpeakers } from '@/tts/script.js'
import { applyHints, parseHints } from '@/tts/hints.js'
import { BLOCK_GAP, targetsOf, trackKeyOf, utterancesOf as plan } from '@/tts/reading.js'
import { joinClips } from '@/tts/wav.js'
import { describeFailure, listVoices, synthesize } from '@/tts/client.js'
import { objectUrl, playClip, release } from '@/tts/player.js'
import { SAMPLE_TEXT, defaultVoiceOf, nextColor, voiceFor, voicesOf } from '@/tts/voices.js'
import { useSpeech } from '@/composables/useSpeech.js'

/** @typedef {import('@/types/models.js').TtsVoice} TtsVoice */
/** @typedef {import('@/types/models.js').StoryNarration} StoryNarration */
/** @typedef {import('@/tts/script.js').Block} Block */
/** @typedef {import('@/tts/reading.js').Utterance} Utterance */

/**
 * The audio a document has, joined: where each block plays.
 *
 * @typedef {Object} ReadingTrack
 * @property {Array<{start: number, end: number, index: number}>} segments - In seconds, with the block each is
 * @property {number} duration - Seconds
 * @property {string} key - What it was joined from; see `trackKeyOf`
 */

/**
 * A document's reading: the audio it has, and how the last run went.
 *
 * @typedef {Object} Reading
 * @property {'idle'|'running'|'done'|'stopped'|'failed'} status - The last run, or the one under way
 * @property {number} done - How many utterances this run has read
 * @property {number} total - How many it set out to
 * @property {string|null} current - The signature being asked for now
 * @property {string|null} failed - The signature the last run failed on
 * @property {string|null} error - Why it failed, when it did
 * @property {Map<string, ArrayBuffer>} clips - The audio, by signature. Reactive.
 * @property {ReadingTrack|null} track - The audio joined, in document order
 * @property {string|null} url - The track as an object URL, for a player
 */

/** @type {Map<string, NarrationApi>} */
const instances = new Map()

/** Drop every instance, letting go of their audio. For tests. */
export const clearNarrationInstances = () => {
  for (const instance of instances.values()) instance.dispose()
  instances.clear()
}

/**
 * @typedef {Object} NarrationApi
 * @property {import('vue').ComputedRef<import('./useApplicationState.js').NarrationConnection>} connection
 * @property {import('vue').ComputedRef<boolean>} configured - Whether there is a server to ask
 * @property {import('vue').ComputedRef<TtsVoice[]>} voices
 * @property {import('vue').ComputedRef<string>} defaultVoiceId
 * @property {import('vue').ComputedRef<string>} hints
 * @property {(id: string) => TtsVoice|null} voiceById
 * @property {(fields?: Partial<TtsVoice>) => TtsVoice} addVoice
 * @property {(id: string, updates: Partial<TtsVoice>) => void} updateVoice
 * @property {(id: string) => void} removeVoice
 * @property {(id: string) => void} setDefaultVoice
 * @property {(text: string) => void} setHints
 * @property {import('vue').Ref<string[]>} serverVoices - What the server offers, once asked
 * @property {() => Promise<string[]>} loadServerVoices
 * @property {import('vue').Ref<number>} watching - How many narration panels are showing, which is when the editor colours speakers' lines
 * @property {(documentId: string) => Block[]} blocksOf - The document's blocks as they stand
 * @property {(documentId: string, blocks?: Block[]) => (string|null)[]} speakersOf
 * @property {(documentId: string, indices: number[], voiceId: string|null) => void} setSpeaker
 * @property {(documentId: string, blocks?: Block[], speakers?: (string|null)[]) => Utterance[]} utterancesOf - What the server would be asked for now
 * @property {(documentId: string) => Reading|null} readingOf
 * @property {(documentId: string, utterances?: Utterance[]) => boolean} inStep - Whether the track is what the document's audio would join to now
 * @property {(documentId: string, options?: {blocks?: number[]}) => Promise<void>} narrate
 * @property {(documentId: string, options?: {fresh?: boolean}) => void} refreshTrack
 * @property {(documentId: string) => void} stop
 * @property {(documentId: string) => void} download
 * @property {(voice: TtsVoice) => Promise<void>} preview
 * @property {(key: string, markdown: string, voiceId?: string|null) => Promise<void>} readAloud
 * @property {() => void} dispose
 */

/**
 * @param {string} storyId
 * @returns {NarrationApi}
 */
export const useNarration = storyId => {
  if (instances.has(storyId)) return /** @type {NarrationApi} */ (instances.get(storyId))

  const storiesStore = useStoriesStore()
  const documentsStore = useDocumentsStore()
  const documents = useDocuments(storyId)
  const appState = useApplicationState()

  // --- The server ---------------------------------------------------------

  const connection = appState.narration
  const configured = computed(() => !!connection.value.endpoint)

  /** @type {import('vue').Ref<string[]>} */
  const serverVoices = ref([])
  /** The endpoint the list was fetched from, so a changed one is asked again. */
  let serverVoicesFrom = ''

  /**
   * What the server offers, fetched once per endpoint. A server that cannot
   * be reached, or lists nothing, offers nothing; the writer can still type
   * a voice.
   */
  const loadServerVoices = async () => {
    const endpoint = connection.value.endpoint
    if (!endpoint) return []
    if (serverVoicesFrom === endpoint && serverVoices.value.length) return serverVoices.value
    try {
      serverVoices.value = await listVoices(connection.value)
      serverVoicesFrom = endpoint
    } catch (error) {
      console.warn('Could not list the speech server voices:', error)
      serverVoices.value = []
    }
    return serverVoices.value
  }

  // --- The project's voices and hints ------------------------------------

  /** @type {import('vue').ComputedRef<StoryNarration>} */
  const settings = computed(() => storiesStore.getStory(storyId)?.narration ?? {})
  const voices = computed(() => voicesOf(settings.value))
  const defaultVoiceId = computed(() => defaultVoiceOf(settings.value, voices.value))
  const hints = computed(() => settings.value.hints ?? '')
  const parsedHints = computed(() => parseHints(hints.value))

  /**
   * Written whole, under the names in use now: a default voice chosen while
   * it was called the narrator is carried over and the old name let go.
   * @param {Partial<StoryNarration>} patch
   */
  const write = patch => {
    const { narratorId: legacy, ...current } = settings.value
    const carried = legacy && !current.defaultVoiceId ? { defaultVoiceId: legacy } : {}
    storiesStore.updateStory(storyId, { narration: { ...current, ...carried, ...patch } })
  }

  /** @param {string} id */
  const voiceById = id => voices.value.find(voice => voice.id === id) ?? null

  /**
   * A new voice, named and speaking as the fields say, or blank to fill in.
   * @param {Partial<TtsVoice>} [fields]
   */
  const addVoice = (fields = {}) => {
    /** @type {TtsVoice} */
    const voice = {
      id: `voice_${nanoid()}`,
      name: fields.name ?? 'New voice',
      voice: fields.voice ?? '',
      speed: fields.speed ?? 1,
      color: fields.color ?? nextColor(voices.value),
    }
    write({ voices: [...voices.value, voice] })
    return voice
  }

  /**
   * @param {string} id
   * @param {Partial<TtsVoice>} updates
   */
  const updateVoice = (id, updates) => {
    write({
      voices: voices.value.map(voice => (voice.id === id ? { ...voice, ...updates, id } : voice)),
    })
  }

  /**
   * Remove a voice. The last one stays: a project cannot be read in no
   * voice. Blocks it spoke read in the default voice from here.
   * @param {string} id
   */
  const removeVoice = id => {
    if (voices.value.length < 2) return
    const remaining = voices.value.filter(voice => voice.id !== id)
    write({
      voices: remaining,
      defaultVoiceId: defaultVoiceId.value === id ? remaining[0].id : defaultVoiceId.value,
    })
  }

  /** @param {string} id */
  const setDefaultVoice = id => {
    if (voiceById(id)) write({ defaultVoiceId: id })
  }

  /** @param {string} text */
  const setHints = text => write({ hints: text })

  // --- A document's speakers ---------------------------------------------

  /**
   * The document's blocks as they stand, the editor's copy where the
   * document is open.
   * @param {string} documentId
   */
  const blocksOf = documentId => readBlocks(documents.currentContent(documentId))

  /** @param {Block[]} blocks */
  const textsOf = blocks => blocks.map(block => block.text)

  /**
   * Who speaks each block, as the document's assignments resolve against
   * its blocks now.
   * @param {string} documentId
   * @param {Block[]} [blocks] - The blocks, when the caller has them
   */
  const speakersOf = (documentId, blocks = blocksOf(documentId)) =>
    resolveSpeakers(textsOf(blocks), documentsStore.getDocument(documentId)?.speakers)

  /**
   * Give blocks a speaker, or give them back to the default voice. One write
   * however many there are.
   * @param {string} documentId
   * @param {number[]} indices
   * @param {string|null} voiceId
   */
  const setSpeaker = (documentId, indices, voiceId) => {
    const blocks = blocksOf(documentId)
    const speakers = assignSpeaker(
      textsOf(blocks),
      speakersOf(documentId, blocks),
      indices,
      voiceId
    )
    documentsStore.updateDocument(documentId, { speakers })
  }

  /**
   * What the server would be asked to say for the document as it stands:
   * its blocks, in their speakers' voices, hints applied.
   * @param {string} documentId
   * @param {Block[]} [blocks]
   * @param {(string|null)[]} [speakers]
   */
  const utterancesOf = (
    documentId,
    blocks = blocksOf(documentId),
    speakers = speakersOf(documentId, blocks)
  ) => plan(blocks, speakers, voices.value, defaultVoiceId.value, parsedHints.value)

  // --- Readings -----------------------------------------------------------

  /** How many narration panels are showing. */
  const watching = ref(0)

  /** @type {Map<string, Reading>} */
  const readings = shallowReactive(new Map())
  /** @type {Map<string, AbortController>} */
  const controllers = new Map()

  /** @param {string} documentId */
  const readingOf = documentId => readings.get(documentId) ?? null

  /**
   * @param {string} documentId
   * @returns {Reading}
   */
  const ensureReading = documentId => {
    const existing = readings.get(documentId)
    if (existing) return existing
    /** @type {Reading} */
    const reading = shallowReactive({
      status: 'idle',
      done: 0,
      total: 0,
      current: null,
      failed: null,
      error: null,
      clips: shallowReactive(new Map()),
      track: null,
      url: null,
    })
    readings.set(documentId, reading)
    return reading
  }

  /**
   * The utterances there is audio for, which is what a track is joined from.
   * @param {Reading} reading
   * @param {Utterance[]} utterances
   */
  const audible = (reading, utterances) =>
    utterances.filter(utterance => reading.clips.has(utterance.signature))

  /**
   * @param {string} documentId
   * @param {Utterance[]} [utterances] - As they stand, when the caller has them
   */
  const inStep = (documentId, utterances = utterancesOf(documentId)) => {
    const reading = readings.get(documentId)
    if (!reading?.track) return false
    return reading.track.key === trackKeyOf(audible(reading, utterances))
  }

  /**
   * Join the audio the document has into a track, in document order. A
   * document with no audio has none.
   *
   * A track already joined from the same utterances in the same places is
   * left alone, unless the audio itself is new: a block read again is the
   * same utterance with a different take, which no key can tell apart.
   *
   * @param {string} documentId
   * @param {{fresh?: boolean}} [options] - Whether any of the audio is new
   */
  const refreshTrack = (documentId, { fresh = false } = {}) => {
    const reading = readings.get(documentId)
    if (!reading) return
    const included = audible(reading, utterancesOf(documentId))
    const key = trackKeyOf(included)
    if (!fresh && reading.track?.key === key) return

    release(reading.url)
    reading.track = null
    reading.url = null
    if (included.length === 0) return

    try {
      const clips = included.map(
        utterance => /** @type {ArrayBuffer} */ (reading.clips.get(utterance.signature))
      )
      const joined = joinClips(clips, { gap: BLOCK_GAP })
      reading.track = {
        segments: joined.segments.map((segment, i) => ({
          ...segment,
          index: included[i].index,
        })),
        duration: joined.duration,
        key,
      }
      reading.url = objectUrl(/** @type {BlobPart[]} */ (joined.parts))
    } catch (error) {
      reading.status = 'failed'
      reading.error = describeFailure(error, connection.value)
    }
  }

  /**
   * Stop a run. What was read stays.
   * @param {string} documentId
   */
  const stop = documentId => {
    controllers.get(documentId)?.abort()
  }

  /**
   * Read a document aloud, or some of it.
   *
   * With no blocks named, whatever has no audio is read — everything, the
   * first time; after an edit, only what changed — and when nothing lacks
   * audio, all of it again. With blocks named, those are read, again if
   * they have been. One run at a time for a document: asked again while one
   * is under way, this does nothing.
   *
   * @param {string} documentId
   * @param {{blocks?: number[]}} [options]
   */
  const narrate = async (documentId, { blocks } = {}) => {
    if (controllers.has(documentId)) return

    const reading = ensureReading(documentId)
    const utterances = utterancesOf(documentId)
    const server = connection.value

    // Audio nothing in the document asks for any more has had its chance
    // to be wanted again; a run is when it goes.
    const wanted = new Set(utterances.map(utterance => utterance.signature))
    for (const signature of [...reading.clips.keys()]) {
      if (!wanted.has(signature)) reading.clips.delete(signature)
    }

    const targets = targetsOf(utterances, signature => reading.clips.has(signature), blocks)
    Object.assign(reading, {
      status: 'running',
      done: 0,
      total: targets.length,
      current: null,
      failed: null,
      error: null,
    })

    const controller = new AbortController()
    controllers.set(documentId, controller)

    try {
      for (const utterance of targets) {
        reading.current = utterance.signature
        const clip = await synthesize(
          server,
          {
            input: utterance.text,
            voice: utterance.voice.voice,
            speed: utterance.voice.speed ?? 1,
          },
          controller.signal
        )
        reading.clips.set(utterance.signature, clip)
        reading.done += 1
      }
      reading.status = 'done'
    } catch (error) {
      if (controller.signal.aborted) {
        reading.status = 'stopped'
      } else {
        reading.status = 'failed'
        reading.failed = reading.current
        reading.error = describeFailure(error, server)
      }
    } finally {
      reading.current = null
      controllers.delete(documentId)
    }

    if (readings.get(documentId) === reading) refreshTrack(documentId, { fresh: reading.done > 0 })
  }

  /** @param {string} documentId */
  const forget = documentId => {
    const reading = readings.get(documentId)
    if (!reading) return
    release(reading.url)
    readings.delete(documentId)
  }

  /**
   * Hand the writer the track as a file, named for the document.
   * @param {string} documentId
   */
  const download = documentId => {
    const reading = readings.get(documentId)
    if (!reading?.url) return
    const title = documents.displayTitle(documents.get(documentId)) || 'narration'
    const link = document.createElement('a')
    link.href = reading.url
    link.download = `${title.replace(/[\\/:*?"<>|]+/g, '-')}.wav`
    link.click()
  }

  /**
   * Hear a voice say a line, without touching any document's reading.
   * Resolves once the line is back and playing, not when it ends.
   * @param {TtsVoice} voice
   */
  const preview = async voice => {
    const clip = await synthesize(connection.value, {
      input: SAMPLE_TEXT,
      voice: voice.voice,
      speed: voice.speed ?? 1,
    })
    playClip(clip).catch(error => console.warn('Could not play the preview:', error))
  }

  /**
   * Read some markdown aloud then and there, in one voice: a chat message.
   * A block at a time, markdown taken off and the hints applied, as a
   * document would be; but in one voice, and nothing is kept. See
   * `useSpeech`.
   *
   * @param {string} key - Names what is read, for `useSpeech().current`
   * @param {string} markdown
   * @param {string|null} [voiceId] - The voice; the default when absent or gone
   * @returns {Promise<void>} When it has been read, or stopped
   */
  const readAloud = (key, markdown, voiceId) => {
    const voice = voiceFor(voices.value, voiceId, defaultVoiceId.value)
    const lines = readBlocks(markdown).map(block => applyHints(block.text, parsedHints.value))
    return useSpeech().speak(key, { connection: connection.value, voice, lines })
  }

  /** Stop every reading and let go of their audio. */
  const dispose = () => {
    for (const controller of controllers.values()) controller.abort()
    controllers.clear()
    for (const documentId of [...readings.keys()]) forget(documentId)
  }

  /** @type {NarrationApi} */
  const api = {
    connection,
    configured,
    voices,
    defaultVoiceId,
    hints,
    voiceById,
    addVoice,
    updateVoice,
    removeVoice,
    setDefaultVoice,
    setHints,
    serverVoices,
    loadServerVoices,
    watching,
    blocksOf,
    speakersOf,
    setSpeaker,
    utterancesOf,
    readingOf,
    inStep,
    narrate,
    refreshTrack,
    stop,
    download,
    preview,
    readAloud,
    dispose,
  }

  instances.set(storyId, api)
  return api
}
