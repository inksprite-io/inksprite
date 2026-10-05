/* global DOMException */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { computed, reactive } from 'vue'
import { encodeWav } from '@/tts/wav.js'
import { DEFAULT_VOICES, VOICE_COLORS } from '@/tts/voices.js'

const mockClient = vi.hoisted(() => ({
  synthesize: vi.fn(),
  listVoices: vi.fn(),
}))
vi.mock('@/tts/client.js', async importOriginal => ({
  ...(await importOriginal()),
  synthesize: mockClient.synthesize,
  listVoices: mockClient.listVoices,
}))

const mockStory = reactive({ id: 'story_1' })
const updateStory = vi.fn((_id, updates) => Object.assign(mockStory, updates))
vi.mock('@/stores/storiesStore', () => ({
  useStoriesStore: () => ({
    getStory: id => (id === 'story_1' ? mockStory : null),
    updateStory,
  }),
}))

/** @type {Record<string, any>} */
const docs = reactive({})
const updateDocument = vi.fn((id, updates) => Object.assign(docs[id], updates))
vi.mock('@/stores/documentsStore', () => ({
  useDocumentsStore: () => ({
    getDocument: id => docs[id] ?? null,
    updateDocument,
  }),
}))

vi.mock('@/composables/useDocuments', () => ({
  useDocuments: () => ({
    init: vi.fn(async () => {}),
    get: id => docs[id] ?? null,
    currentContent: id => docs[id]?.content ?? '',
    displayTitle: doc => doc?.title || 'Untitled',
  }),
}))

const connection = reactive({ endpoint: 'http://localhost:8880/v1', apiKey: '', model: 'kokoro' })
vi.mock('@/composables/useApplicationState', () => ({
  useApplicationState: () => ({
    narration: computed(() => ({ ...connection })),
    setNarration: patch => Object.assign(connection, patch),
  }),
}))

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'abc') }))

const mockSpeech = vi.hoisted(() => ({ speak: vi.fn(async () => {}), stop: vi.fn() }))
vi.mock('@/composables/useSpeech.js', () => ({ useSpeech: () => mockSpeech }))

const mockPlayer = vi.hoisted(() => ({ playClip: vi.fn(async () => {}) }))
vi.mock('@/tts/player.js', async importOriginal => ({
  ...(await importOriginal()),
  playClip: mockPlayer.playClip,
}))

import { useNarration, clearNarrationInstances } from '@/composables/useNarration'

/** What a block nobody was given is asked for in: the default voice, whatever it is. */
const READER = { voice: DEFAULT_VOICES[0].voice, speed: DEFAULT_VOICES[0].speed }

const MONO = { channels: 1, sampleRate: 24000, bitsPerSample: 16 }
/** A clip of so many seconds. */
const clip = seconds => encodeWav(MONO, [new Uint8Array(Math.round(seconds * 48000))])

const CONTENT = 'Riley walked in.\n\n"What do you want to eat?" she asked.\n\n"You pick."'

/** Every reading has ended, and its track is built. */
const settled = () => new Promise(resolve => setTimeout(resolve, 0))

describe('useNarration', () => {
  /** @type {ReturnType<typeof useNarration>} */
  let api

  beforeEach(() => {
    clearNarrationInstances()
    vi.clearAllMocks()
    for (const key of Object.keys(mockStory)) if (key !== 'id') delete mockStory[key]
    for (const key of Object.keys(docs)) delete docs[key]
    docs.doc_1 = {
      id: 'doc_1',
      storyId: 'story_1',
      type: 'text',
      title: 'Dinner',
      content: CONTENT,
    }
    Object.assign(connection, { endpoint: 'http://localhost:8880/v1', apiKey: '', model: 'kokoro' })
    mockClient.synthesize.mockImplementation(async () => clip(1))
    api = useNarration('story_1')
  })

  describe('voices', () => {
    it('start as the default narrator', () => {
      expect(api.voices.value).toEqual(DEFAULT_VOICES)
      expect(api.defaultVoiceId.value).toBe('narrator')
      expect(api.hints.value).toBe('')
    })

    it('are written to the story in full once one is added', () => {
      const riley = api.addVoice({ name: 'Riley', voice: 'af_heart+af_nicole(2)', speed: 1.1 })

      expect(riley).toEqual({
        id: 'voice_abc',
        name: 'Riley',
        voice: 'af_heart+af_nicole(2)',
        speed: 1.1,
        color: VOICE_COLORS[0],
      })
      expect(updateStory).toHaveBeenCalledWith('story_1', {
        narration: { voices: [DEFAULT_VOICES[0], riley] },
      })
      expect(api.voices.value).toHaveLength(2)
    })

    it('change in place', () => {
      const riley = api.addVoice({ name: 'Riley' })
      api.updateVoice(riley.id, { voice: 'af_sky', id: 'ignored' })
      expect(api.voiceById(riley.id)).toEqual({ ...riley, voice: 'af_sky' })
    })

    it('can be removed, all but the last', () => {
      const riley = api.addVoice({ name: 'Riley' })
      api.removeVoice('narrator')
      expect(api.voices.value).toEqual([riley])
      expect(api.defaultVoiceId.value).toBe(riley.id)

      api.removeVoice(riley.id)
      expect(api.voices.value).toEqual([riley])
    })

    it('carry over a default chosen while it was called the narrator', () => {
      const riley = { id: 'riley', name: 'Riley', voice: 'af_nicole' }
      mockStory.narration = { voices: [DEFAULT_VOICES[0], riley], narratorId: 'riley' }
      expect(api.defaultVoiceId.value).toBe('riley')

      api.setHints('a:b')
      expect(mockStory.narration).toEqual({
        voices: [DEFAULT_VOICES[0], riley],
        defaultVoiceId: 'riley',
        hints: 'a:b',
      })
    })

    it('have a default among them', () => {
      const riley = api.addVoice({ name: 'Riley' })
      api.setDefaultVoice(riley.id)
      expect(api.defaultVoiceId.value).toBe(riley.id)
      api.setDefaultVoice('nobody')
      expect(api.defaultVoiceId.value).toBe(riley.id)
    })

    it('keep the hints beside them', () => {
      api.setHints('Aelinor:AY-lin-or')
      expect(api.hints.value).toBe('Aelinor:AY-lin-or')
      expect(mockStory.narration).toEqual({ hints: 'Aelinor:AY-lin-or' })
    })
  })

  describe('speakers', () => {
    it('read the document as blocks, a paragraph each, all the default voice’s to begin with', () => {
      expect(api.blocksOf('doc_1').map(block => block.text)).toEqual([
        'Riley walked in.',
        '"What do you want to eat?" she asked.',
        '"You pick."',
      ])
      expect(api.speakersOf('doc_1')).toEqual([null, null, null])
    })

    it('are written onto the document, by the block’s words', () => {
      api.setSpeaker('doc_1', [1], 'riley')
      expect(updateDocument).toHaveBeenCalledWith('doc_1', {
        speakers: [{ text: '"What do you want to eat?" she asked.', index: 1, voiceId: 'riley' }],
      })
      expect(api.speakersOf('doc_1')).toEqual([null, 'riley', null])

      api.setSpeaker('doc_1', [2], 'cody')
      api.setSpeaker('doc_1', [1], null)
      expect(api.speakersOf('doc_1')).toEqual([null, null, 'cody'])
    })

    it('are given to several blocks in one write', () => {
      api.setSpeaker('doc_1', [0, 2], 'cody')
      expect(updateDocument).toHaveBeenCalledTimes(1)
      expect(api.speakersOf('doc_1')).toEqual(['cody', null, 'cody'])

      api.setSpeaker('doc_1', [0, 2], null)
      expect(api.speakersOf('doc_1')).toEqual([null, null, null])
    })

    it('follow the block through an edit', () => {
      api.setSpeaker('doc_1', [2], 'cody')
      docs.doc_1.content = `A new first line.\n\n${CONTENT}`
      expect(api.speakersOf('doc_1')).toEqual([null, null, null, 'cody'])
    })

    it('let go of a speaker given to half a paragraph, from when paragraphs were split', () => {
      docs.doc_1.speakers = [{ text: '"What do you want to eat?"', index: 1, voiceId: 'riley' }]
      expect(api.speakersOf('doc_1')).toEqual([null, null, null])
    })
  })

  describe('narrate', () => {
    /** What the server was asked for, in order. */
    const requests = () => mockClient.synthesize.mock.calls.map(call => call[1])

    it('reads each block in its speaker’s voice, hints applied', async () => {
      const riley = api.addVoice({ name: 'Riley', voice: 'af_nicole', speed: 1.2 })
      api.setSpeaker('doc_1', [1], riley.id)
      api.setHints('Riley:Rye-lee')

      await api.narrate('doc_1')

      // A paragraph is one request, speech and tag together.
      expect(requests()).toEqual([
        { input: 'Rye-lee walked in.', ...READER },
        { input: '"What do you want to eat?" she asked.', voice: 'af_nicole', speed: 1.2 },
        { input: '"You pick."', ...READER },
      ])
      expect(mockClient.synthesize.mock.calls[0][0]).toEqual({
        endpoint: 'http://localhost:8880/v1',
        apiKey: '',
        model: 'kokoro',
      })

      const reading = api.readingOf('doc_1')
      expect(reading.status).toBe('done')
      expect([reading.done, reading.total]).toEqual([3, 3])
      expect(reading.error).toBeNull()
      expect(reading.clips.size).toBe(3)
      // A pause between blocks.
      const places = reading.track.segments.map(({ start, index }) => [
        Math.round(start * 100) / 100,
        index,
      ])
      expect(places).toEqual([
        [0, 0],
        [1.4, 1],
        [2.8, 2],
      ])
      expect(api.inStep('doc_1')).toBe(true)
    })

    it('reports as it goes, and which utterance it is on', async () => {
      /** @type {Array<[number, boolean]>} */
      const seen = []
      mockClient.synthesize.mockImplementation(async () => {
        const reading = api.readingOf('doc_1')
        seen.push([reading.done, reading.current !== null])
        return clip(0.1)
      })
      await api.narrate('doc_1')
      expect(seen).toEqual([
        [0, true],
        [1, true],
        [2, true],
      ])
      expect(api.readingOf('doc_1').current).toBeNull()
    })

    it('reads only what changed the second time', async () => {
      await api.narrate('doc_1')
      mockClient.synthesize.mockClear()

      docs.doc_1.content = CONTENT.replace('You pick.', 'You choose.')
      expect(api.inStep('doc_1')).toBe(false)
      await api.narrate('doc_1')

      expect(requests()).toEqual([{ input: '"You choose."', ...READER }])
      expect(api.readingOf('doc_1').track.segments).toHaveLength(3)
      expect(api.inStep('doc_1')).toBe(true)
    })

    it('reads a block again once it has a new speaker', async () => {
      await api.narrate('doc_1')
      mockClient.synthesize.mockClear()

      const riley = api.addVoice({ name: 'Riley', voice: 'af_nicole' })
      api.setSpeaker('doc_1', [1], riley.id)
      await api.narrate('doc_1')

      expect(requests()).toEqual([
        { input: '"What do you want to eat?" she asked.', voice: 'af_nicole', speed: 1 },
      ])
    })

    it('reads everything again when nothing lacks audio', async () => {
      await api.narrate('doc_1')
      await api.narrate('doc_1')
      expect(mockClient.synthesize).toHaveBeenCalledTimes(6)
    })

    it('reads the blocks asked for, and only those', async () => {
      await api.narrate('doc_1', { blocks: [0, 2] })

      expect(requests().map(request => request.input)).toEqual(['Riley walked in.', '"You pick."'])
      const reading = api.readingOf('doc_1')
      expect([reading.done, reading.total]).toEqual([2, 2])
      // The track holds what there is audio for, and says which blocks.
      expect(reading.track.segments.map(segment => segment.index)).toEqual([0, 2])
    })

    it('reads one block again when asked, though it has been read', async () => {
      await api.narrate('doc_1')
      const before = api.readingOf('doc_1').track
      mockClient.synthesize.mockClear()
      mockClient.synthesize.mockImplementation(async () => clip(2))

      await api.narrate('doc_1', { blocks: [0] })

      expect(requests()).toEqual([{ input: 'Riley walked in.', ...READER }])
      const reading = api.readingOf('doc_1')
      // The same utterance in the same place, with a different take: the
      // track is joined again all the same, or the new take is never heard.
      expect(reading.clips.size).toBe(3)
      expect(reading.track).not.toBe(before)
      expect(reading.track.segments[0].end).toBe(2)
    })

    it('lets go of audio nothing asks for any more, when a run starts', async () => {
      await api.narrate('doc_1')
      docs.doc_1.content = 'Riley walked in.'
      await api.narrate('doc_1', { blocks: [0] })
      expect(api.readingOf('doc_1').clips.size).toBe(1)
    })

    it('does nothing while a run is under way', async () => {
      const first = api.narrate('doc_1')
      await api.narrate('doc_1')
      await first
      expect(mockClient.synthesize).toHaveBeenCalledTimes(3)
    })

    it('keeps what was read when it fails, and says why and where', async () => {
      mockClient.synthesize
        .mockImplementationOnce(async () => clip(1))
        .mockImplementationOnce(async () => {
          throw new Error('Voice not found: af_nobody')
        })

      await api.narrate('doc_1')

      const reading = api.readingOf('doc_1')
      expect(reading.status).toBe('failed')
      expect(reading.error).toBe('Voice not found: af_nobody')
      expect(reading.failed).toBe(api.utterancesOf('doc_1')[1].signature)
      expect(reading.done).toBe(1)
      expect(reading.track.segments).toHaveLength(1)
      expect(mockClient.synthesize).toHaveBeenCalledTimes(2)
    })

    it('names the server when it cannot be reached', async () => {
      mockClient.synthesize.mockRejectedValue(new TypeError('Failed to fetch'))
      await api.narrate('doc_1')
      const reading = api.readingOf('doc_1')
      expect(reading.status).toBe('failed')
      expect(reading.error).toBe('Could not reach the speech server at http://localhost:8880/v1.')
      expect(reading.track).toBeNull()
    })

    it('can be stopped, keeping what was read', async () => {
      mockClient.synthesize
        .mockImplementationOnce(async () => clip(1))
        .mockImplementationOnce(
          (_connection, _request, signal) =>
            new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () =>
                reject(new DOMException('The user aborted a request.', 'AbortError'))
              )
            })
        )

      const done = api.narrate('doc_1')
      await settled()
      expect(api.readingOf('doc_1').status).toBe('running')
      expect(api.readingOf('doc_1').done).toBe(1)

      api.stop('doc_1')
      await done

      const reading = api.readingOf('doc_1')
      expect(reading.status).toBe('stopped')
      expect(reading.error).toBeNull()
      expect(reading.failed).toBeNull()
      expect(reading.track.segments).toHaveLength(1)
    })

    it('has nothing to say of a document never read', () => {
      expect(api.readingOf('doc_1')).toBeNull()
      expect(api.inStep('doc_1')).toBe(false)
    })
  })

  describe('the track', () => {
    it('is joined again once the document stops agreeing with it', async () => {
      await api.narrate('doc_1')
      const track = api.readingOf('doc_1').track

      // A paragraph goes: nothing new to read, and the track is out of step.
      docs.doc_1.content = 'Riley walked in.\n\n"You pick."'
      expect(api.inStep('doc_1')).toBe(false)

      api.refreshTrack('doc_1')
      const rejoined = api.readingOf('doc_1').track
      expect(rejoined).not.toBe(track)
      expect(rejoined.segments.map(segment => segment.index)).toEqual([0, 1])
      expect(api.inStep('doc_1')).toBe(true)
      expect(mockClient.synthesize).toHaveBeenCalledTimes(3)
    })

    it('is left alone while it still agrees', async () => {
      await api.narrate('doc_1')
      const track = api.readingOf('doc_1').track
      api.refreshTrack('doc_1')
      expect(api.readingOf('doc_1').track).toBe(track)
    })

    it('gets its audio back when the words are put back', async () => {
      await api.narrate('doc_1')
      docs.doc_1.content = CONTENT.replace('You pick.', 'You choose.')
      api.refreshTrack('doc_1')
      expect(api.readingOf('doc_1').track.segments).toHaveLength(2)

      docs.doc_1.content = CONTENT
      api.refreshTrack('doc_1')
      expect(api.readingOf('doc_1').track.segments).toHaveLength(3)
    })

    it('goes when the document has no audio left', async () => {
      await api.narrate('doc_1')
      docs.doc_1.content = 'Something else entirely.'
      api.refreshTrack('doc_1')
      expect(api.readingOf('doc_1').track).toBeNull()
      expect(api.inStep('doc_1')).toBe(false)
    })
  })

  describe('reading a message aloud', () => {
    const MESSAGE = '## The Door\n\nRiley knocked. **Nobody** answered.\n\n"Hello?" she called.'

    it('reads it a paragraph at a time, in the default voice, markdown off and hints applied', () => {
      api.setHints('Riley:Rye-lee')
      api.readAloud('turn:m1', MESSAGE)

      expect(mockSpeech.speak).toHaveBeenCalledWith('turn:m1', {
        connection: { endpoint: 'http://localhost:8880/v1', apiKey: '', model: 'kokoro' },
        voice: DEFAULT_VOICES[0],
        lines: ['The Door', 'Rye-lee knocked. Nobody answered.', '"Hello?" she called.'],
      })
    })

    it('reads in the voice asked for, and the default when that voice is gone', () => {
      const riley = api.addVoice({ name: 'Riley', voice: 'af_nicole' })
      api.readAloud('turn:m1', 'Hello.', riley.id)
      expect(mockSpeech.speak.mock.calls[0][1].voice).toEqual(riley)

      api.readAloud('turn:m1', 'Hello.', 'voice_gone')
      expect(mockSpeech.speak.mock.calls[1][1].voice).toEqual(DEFAULT_VOICES[0])
    })

    it('has nothing to read in a message with no words', () => {
      api.readAloud('turn:m1', '```\ncode\n```')
      expect(mockSpeech.speak.mock.calls[0][1].lines).toEqual([])
    })
  })

  describe('previewing a voice', () => {
    it('asks for a line in that voice and plays it, without waiting for it to end', async () => {
      mockPlayer.playClip.mockReturnValue(new Promise(() => {}))
      const riley = { id: 'riley', name: 'Riley', voice: 'af_nicole', speed: 1.2 }

      await api.preview(riley)

      expect(mockClient.synthesize.mock.calls[0][1]).toMatchObject({
        voice: 'af_nicole',
        speed: 1.2,
      })
      expect(mockPlayer.playClip).toHaveBeenCalledTimes(1)
    })
  })

  describe('the server', () => {
    it('is asked for its voices once per endpoint', async () => {
      mockClient.listVoices.mockResolvedValue(['af_heart', 'af_nicole'])
      expect(await api.loadServerVoices()).toEqual(['af_heart', 'af_nicole'])
      await api.loadServerVoices()
      expect(mockClient.listVoices).toHaveBeenCalledTimes(1)

      connection.endpoint = 'http://elsewhere:8880/v1'
      await api.loadServerVoices()
      expect(mockClient.listVoices).toHaveBeenCalledTimes(2)
    })

    it('offers no voices when it cannot be asked', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockClient.listVoices.mockRejectedValue(new TypeError('Failed to fetch'))
      expect(await api.loadServerVoices()).toEqual([])
      expect(api.serverVoices.value).toEqual([])
    })

    it('is not asked when there is none', async () => {
      connection.endpoint = ''
      expect(api.configured.value).toBe(false)
      expect(await api.loadServerVoices()).toEqual([])
      expect(mockClient.listVoices).not.toHaveBeenCalled()
    })
  })
})
