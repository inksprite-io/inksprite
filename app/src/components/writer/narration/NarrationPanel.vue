<template>
  <div class="w-full h-full flex flex-col p-2">
    <div class="flex items-center justify-between px-2">
      <h3 class="text-xl font-semibold text-surface-700 dark:text-surface-200">Narration</h3>
      <div class="flex items-center">
        <Button
          v-tooltip.bottom="
            highlightSpeakers
              ? 'Stop colouring speakers in the editor'
              : 'Colour speakers in the editor'
          "
          type="button"
          icon="pi pi-palette"
          severity="secondary"
          size="small"
          rounded
          class="!bg-transparent !border-transparent hover:!bg-surface-700"
          :class="{ 'opacity-50': !highlightSpeakers }"
          aria-label="Colour speakers in the editor"
          :aria-pressed="highlightSpeakers"
          data-action="toggle-highlight"
          @click="setHighlightSpeakers(!highlightSpeakers)"
        />
        <Button
          v-tooltip.bottom="'Narration settings'"
          type="button"
          icon="pi pi-cog"
          severity="secondary"
          size="small"
          rounded
          class="!bg-transparent !border-transparent hover:!bg-surface-700"
          aria-label="Narration settings"
          data-action="narration-settings"
          @click="openSettings('narration')"
        />
      </div>
    </div>

    <ScrollPanel class="flex-1 min-h-0 overflow-auto">
      <div class="flex flex-col gap-3 px-2 py-2 pb-16">
        <p
          v-if="!narration.configured.value"
          class="text-sm text-surface-500 dark:text-surface-400"
          data-notice="unconfigured"
        >
          No speech server is set up.
          <button type="button" class="underline" @click="openSettings('narration')">
            Set one up
          </button>
          to read documents aloud.
        </p>

        <!-- The document in the editor -->
        <section v-if="documentId" class="flex flex-col gap-2" data-section="document">
          <div class="min-w-0">
            <div
              class="text-sm font-medium text-surface-700 dark:text-surface-200 truncate"
              data-document-title
            >
              {{ title }}
            </div>
            <div class="text-xs text-surface-500 dark:text-surface-400" data-block-count>
              {{ summary }}
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-1">
            <Button
              v-if="!running"
              type="button"
              :label="narrateLabel"
              icon="pi pi-play"
              size="small"
              :disabled="!narration.configured.value || blocks.length === 0"
              data-action="narrate"
              @click="narrate"
            />
            <Button
              v-else
              type="button"
              label="Stop"
              icon="pi pi-stop"
              size="small"
              severity="secondary"
              data-action="stop"
              @click="narration.stop(documentId)"
            />
            <Button
              v-if="selection.length > 0 && !running"
              type="button"
              label="Clear"
              size="small"
              severity="secondary"
              text
              data-action="clear-selection"
              @click="selection = []"
            />
            <Button
              v-if="reading?.url"
              v-tooltip.top="downloadLabel"
              type="button"
              icon="pi pi-download"
              size="small"
              severity="secondary"
              text
              rounded
              :aria-label="downloadLabel"
              data-action="download"
              @click="narration.download(documentId)"
            />
          </div>

          <template v-if="running">
            <ProgressBar :value="progress" :show-value="false" style="height: 6px" />
            <p class="text-xs text-surface-500 dark:text-surface-400" data-progress>
              Reading {{ Math.min(reading.done + 1, reading.total) }} of {{ reading.total }}…
            </p>
          </template>

          <Message
            v-if="reading?.status === 'failed'"
            severity="error"
            size="small"
            :closable="false"
            data-notice="failed"
          >
            {{ reading.error }}
          </Message>
          <Message
            v-else-if="reading?.status === 'stopped'"
            severity="secondary"
            size="small"
            :closable="false"
            data-notice="stopped"
          >
            Stopped after {{ reading.done }} of {{ reading.total }}.
          </Message>

          <NarrationPlayer
            v-if="reading?.url"
            ref="player"
            :url="reading.url"
            @time="time = $event"
          />

          <ExpandableSection title="Voices" storage-key="narration-voices" level="4">
            <NarrationVoices
              :voices="narration.voices.value"
              :default-voice-id="narration.defaultVoiceId.value"
              :server-voices="narration.serverVoices.value"
              :previewing="previewing"
              @add="narration.addVoice()"
              @update="narration.updateVoice"
              @remove="narration.removeVoice"
              @set-default="narration.setDefaultVoice"
              @preview="preview"
            />
          </ExpandableSection>
          <ExpandableSection title="Pronunciation" storage-key="narration-hints" level="4">
            <NarrationHints :hints="narration.hints.value" @update:hints="narration.setHints" />
          </ExpandableSection>

          <NarrationScript
            v-model:selection="selection"
            :blocks="blocks"
            :speakers="speakers"
            :states="states"
            :voices="narration.voices.value"
            :default-voice-id="narration.defaultVoiceId.value"
            :playing="playing"
            :playable="playable"
            :busy="running || !narration.configured.value"
            @assign="assign"
            @play="play"
            @generate="generate"
          />
        </section>

        <template v-else>
          <p class="text-sm text-surface-500 dark:text-surface-400" data-notice="no-document">
            Open a document to read it aloud.
          </p>
          <ExpandableSection title="Voices" storage-key="narration-voices" level="4">
            <NarrationVoices
              :voices="narration.voices.value"
              :default-voice-id="narration.defaultVoiceId.value"
              :server-voices="narration.serverVoices.value"
              :previewing="previewing"
              @add="narration.addVoice()"
              @update="narration.updateVoice"
              @remove="narration.removeVoice"
              @set-default="narration.setDefaultVoice"
              @preview="preview"
            />
          </ExpandableSection>
          <ExpandableSection title="Pronunciation" storage-key="narration-hints" level="4">
            <NarrationHints :hints="narration.hints.value" @update:hints="narration.setHints" />
          </ExpandableSection>
        </template>
      </div>
    </ScrollPanel>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import Message from 'primevue/message'
import ProgressBar from 'primevue/progressbar'
import ScrollPanel from 'primevue/scrollpanel'
import ExpandableSection from '@/components/common/ExpandableSection.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { useDocuments } from '@/composables/useDocuments'
import { useNarration } from '@/composables/useNarration'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'
import { useToast } from '@/composables/useToast'
import { describeFailure } from '@/tts/client.js'
import { blockStatesOf } from '@/tts/reading.js'
import { segmentAt } from '@/tts/wav.js'
import NarrationHints from './NarrationHints.vue'
import NarrationPlayer from './NarrationPlayer.vue'
import NarrationScript from './NarrationScript.vue'
import NarrationVoices from './NarrationVoices.vue'

/**
 * The document in the editor, read aloud. Read all of it, some blocks, or
 * one block again; hear it, download it; say who speaks each block; keep
 * the project's voices and its pronunciation hints. The reading itself lives
 * in `useNarration`, so it carries on while the writer looks at something
 * else. While this is showing, the editor colours each speaker's lines.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string} [documentId] - The document open in the editor
 */
const props = defineProps({
  storyId: { type: String, required: true },
  documentId: { type: String, default: '' },
})

/** How long the document rests before the track is joined again, in ms. */
const REFRESH_DELAY = 400

const documents = useDocuments(props.storyId)
const narration = useNarration(props.storyId)
const toast = useToast()
const { open: openSettings } = useSettingsPanel()
const { highlightSpeakers, setHighlightSpeakers } = useApplicationState()

const title = computed(() => documents.displayTitle(documents.get(props.documentId)))

// The document as it would be read now, following the editor: its blocks,
// who speaks each, and what the server would be asked for.
const blocks = computed(() => (props.documentId ? narration.blocksOf(props.documentId) : []))
const speakers = computed(() =>
  props.documentId ? narration.speakersOf(props.documentId, blocks.value) : []
)
const utterances = computed(() =>
  props.documentId ? narration.utterancesOf(props.documentId, blocks.value, speakers.value) : []
)

const reading = computed(() => (props.documentId ? narration.readingOf(props.documentId) : null))
const running = computed(() => reading.value?.status === 'running')
const states = computed(() => blockStatesOf(utterances.value, reading.value))
const readCount = computed(() => states.value.filter(state => state === 'ready').length)

const summary = computed(() => {
  const count = blocks.value.length
  const noun = count === 1 ? 'block' : 'blocks'
  return readCount.value > 0 ? `${readCount.value} of ${count} ${noun} read` : `${count} ${noun}`
})

const progress = computed(() => {
  const current = reading.value
  return current?.total ? Math.round((current.done / current.total) * 100) : 0
})

/** The blocks selected, for reading only those. */
const selection = ref(/** @type {number[]} */ ([]))

// A selection is of one document's blocks as they stood: another document,
// or blocks come and gone, and it no longer says what the writer meant.
watch([() => props.documentId, () => blocks.value.length], () => {
  selection.value = []
})

const narrateLabel = computed(() => {
  if (selection.value.length > 0) return `Narrate ${selection.value.length} selected`
  return blocks.value.length > 0 && readCount.value === blocks.value.length
    ? 'Narrate again'
    : 'Narrate'
})

const downloadLabel = computed(() =>
  readCount.value < blocks.value.length
    ? `Download what has been read (${readCount.value} of ${blocks.value.length}) as WAV`
    : 'Download as WAV'
)

const narrate = () => {
  if (!props.documentId) return
  const picked = selection.value
  selection.value = []
  narration.narrate(props.documentId, picked.length > 0 ? { blocks: picked } : {})
}

/**
 * Read one block, again if it has been read.
 * @param {number} index
 */
const generate = index => narration.narrate(props.documentId, { blocks: [index] })

/**
 * @param {number[]} indices - One block, or the selection
 * @param {string|null} voiceId
 */
const assign = (indices, voiceId) => narration.setSpeaker(props.documentId, indices, voiceId)

// The track is joined from the audio the document has. An edit, a speaker
// given, a voice changed: each can leave it holding something the document
// no longer says, or missing something it says again. Once the document has
// rested, the track is joined again to match.
const playable = computed(
  () =>
    !!reading.value?.url && !running.value && narration.inStep(props.documentId, utterances.value)
)
/** @type {ReturnType<typeof setTimeout>|null} */
let refreshTimer = null
watch([utterances, running, () => props.documentId], () => {
  if (refreshTimer) clearTimeout(refreshTimer)
  const documentId = props.documentId
  if (!documentId || running.value || !reading.value) return
  refreshTimer = setTimeout(() => narration.refreshTrack(documentId), REFRESH_DELAY)
})

/** Where the player is, in seconds. */
const time = ref(0)
/** @type {import('vue').Ref<{seek: (seconds: number) => void}|null>} */
const player = ref(null)

/** The block the track is at, while it still stands for the document. */
const playing = computed(() => {
  const track = reading.value?.track
  if (!track || !playable.value) return null
  const at = segmentAt(track, time.value)
  return at === null ? null : track.segments[at].index
})

/** @param {number} index */
const play = index => {
  const segment = reading.value?.track?.segments.find(candidate => candidate.index === index)
  if (segment) player.value?.seek(segment.start)
}

const previewing = ref(false)

/** @param {import('@/types/models.js').TtsVoice} voice */
const preview = async voice => {
  previewing.value = true
  try {
    await narration.preview(voice)
  } catch (error) {
    toast.error(describeFailure(error, narration.connection.value))
  } finally {
    previewing.value = false
  }
}

onMounted(async () => {
  narration.watching.value += 1
  await documents.init()
  narration.loadServerVoices()
})

onBeforeUnmount(() => {
  narration.watching.value -= 1
  if (refreshTimer) clearTimeout(refreshTimer)
})
</script>
