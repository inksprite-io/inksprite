<template>
  <div class="w-full h-full flex flex-col">
    <PanelHeader title="Narration">
      <HeaderButton
        icon="pi pi-palette"
        :label="
          highlightSpeakers
            ? 'Stop colouring speakers in the editor'
            : 'Colour speakers in the editor'
        "
        :class="{ 'opacity-50': !highlightSpeakers }"
        aria-label="Colour speakers in the editor"
        :aria-pressed="highlightSpeakers"
        data-action="toggle-highlight"
        @click="setHighlightSpeakers(!highlightSpeakers)"
      />
    </PanelHeader>

    <ScrollPanel class="flex-1 min-h-0 overflow-auto">
      <div class="flex flex-col gap-3 p-4 pb-16">
        <p
          v-if="!narration.configured.value"
          class="text-sm text-surface-500 dark:text-surface-400"
          data-notice="unconfigured"
        >
          <button type="button" class="underline" @click="openVoices">Choose a speech model</button>
          to read aloud.
        </p>

        <!-- The document in the editor, or with none open the same, empty -->
        <section class="flex flex-col gap-2" data-section="document">
          <div class="min-w-0">
            <div
              class="text-sm font-medium truncate"
              :class="
                documentId
                  ? 'text-surface-700 dark:text-surface-200'
                  : 'text-surface-500 dark:text-surface-400'
              "
              data-document-title
            >
              {{ title }}
            </div>
            <div class="text-xs text-surface-500 dark:text-surface-400" data-block-count>
              {{ summary }}
            </div>
          </div>

          <div class="flex items-center gap-1" data-actions>
            <Button
              v-if="!running"
              v-tooltip.top="generateLabel"
              type="button"
              icon="pi pi-sparkles"
              size="small"
              rounded
              :aria-label="generateLabel"
              :disabled="!canGenerate"
              data-action="generate"
              @click="generateMissing"
            />
            <Button
              v-else
              v-tooltip.top="'Stop'"
              type="button"
              icon="pi pi-stop"
              size="small"
              severity="secondary"
              rounded
              aria-label="Stop"
              data-action="stop"
              @click="narration.stop(documentId)"
            />
            <Button
              v-tooltip.top="'Generate a sample'"
              type="button"
              icon="pi pi-headphones"
              size="small"
              severity="secondary"
              text
              rounded
              aria-label="Generate a sample"
              :disabled="!idle || sample.length === 0"
              data-action="generate-sample"
              @click="narration.narrate(documentId, { blocks: sample })"
            />
            <Button
              v-tooltip.top="'Regenerate all'"
              type="button"
              icon="pi pi-refresh"
              size="small"
              severity="secondary"
              text
              rounded
              aria-label="Regenerate all"
              :disabled="!idle || readCount === 0"
              data-action="regenerate-all"
              @click="regenerateAll"
            />
            <Button
              v-if="selection.length > 0 && !running"
              v-tooltip.top="'Clear selection'"
              type="button"
              icon="pi pi-times"
              size="small"
              severity="secondary"
              text
              rounded
              aria-label="Clear selection"
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
              class="ml-auto"
              :aria-label="downloadLabel"
              data-action="download"
              @click="narration.download(documentId)"
            />
          </div>

          <template v-if="running">
            <ProgressBar :value="progress" :show-value="false" style="height: 6px" />
            <p class="text-xs text-surface-500 dark:text-surface-400" data-progress>
              Generating {{ Math.min(reading.done + 1, reading.total) }} of {{ reading.total }}…
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

          <NarrationPlayer ref="player" :url="reading?.url ?? ''" @time="time = $event" />
        </section>

        <!-- The voices, the hints and the filters are the project's, and
             are kept with or without a document open. -->
        <ExpandableSection
          ref="voicesSection"
          title="Voices"
          storage-key="narration-voices"
          level="4"
          content-wrapper-class="pt-2"
        >
          <NarrationModel
            class="mx-1 mb-3 pb-3 border-b border-surface-200 dark:border-surface-700"
            :choice="narration.choice.value"
            @choose="narration.choose"
          />
          <NarrationVoices
            :voices="narration.voices.value"
            :default-voice-id="narration.defaultVoiceId.value"
            :server-voices="narration.serverVoices.value"
            :mixes="narration.mixes.value"
            :previewing="previewing"
            @add="narration.addVoice()"
            @update="narration.updateVoice"
            @remove="narration.removeVoice"
            @set-default="narration.setDefaultVoice"
            @preview="preview"
          />
        </ExpandableSection>
        <ExpandableSection
          title="Pronunciation"
          storage-key="narration-hints"
          level="4"
          content-wrapper-class="pt-2"
        >
          <NarrationHints
            :hints="narration.hints.value"
            :previewing="previewingHints"
            @update:hints="narration.setHints"
            @preview="previewHints"
          />
        </ExpandableSection>
        <ExpandableSection
          title="Filters"
          storage-key="narration-filters"
          level="4"
          content-wrapper-class="pt-2"
        >
          <NarrationFilters
            :filters="narration.filters.value"
            @update:filters="narration.setFilters"
          />
        </ExpandableSection>

        <ExpandableSection
          title="Segments"
          storage-key="narration-segments"
          level="4"
          default-expanded
          content-wrapper-class="pt-2"
        >
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
            :filters="narration.filterPatterns.value"
            @assign="assign"
            @play="play"
            @generate="generate"
          />
        </ExpandableSection>
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
import HeaderButton from '../layout/HeaderButton.vue'
import PanelHeader from '../layout/PanelHeader.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { useDocuments } from '@/composables/useDocuments'
import { useNarration } from '@/composables/useNarration'
import { useToast } from '@/composables/useToast'
import { describeFailure } from '@/tts/client.js'
import { blockStatesOf, sampleOf } from '@/tts/reading.js'
import { segmentAt } from '@/tts/wav.js'
import NarrationFilters from './NarrationFilters.vue'
import NarrationHints from './NarrationHints.vue'
import NarrationModel from './NarrationModel.vue'
import NarrationPlayer from './NarrationPlayer.vue'
import NarrationScript from './NarrationScript.vue'
import NarrationVoices from './NarrationVoices.vue'

/**
 * The document in the editor, read aloud. Generate what has no audio, a
 * sample from its opening, some blocks, one block again, or all of it again;
 * hear it, download it; say who speaks each block; keep the project's voices
 * and its pronunciation hints, and hear them, and its filters for what is not
 * read. The writer sees the blocks as
 * segments. The reading itself lives in `useNarration`, so it carries on
 * while the writer looks at something else. With no document open it is all
 * still there, with nothing in it. While this is showing, the editor colours
 * each speaker's lines.
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

/** @type {import('vue').Ref<{expand: () => void, $el?: HTMLElement}|null>} */
const voicesSection = ref(null)

/** Open Voices, where the speech model is chosen, and bring it into view. */
const openVoices = () => {
  voicesSection.value?.expand()
  voicesSection.value?.$el?.scrollIntoView?.({ block: 'nearest' })
}
const { highlightSpeakers, setHighlightSpeakers } = useApplicationState()

const title = computed(() =>
  props.documentId ? documents.displayTitle(documents.get(props.documentId)) : 'No open document'
)

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
/** Whether a run could start now. */
const idle = computed(() => narration.configured.value && !running.value)
const states = computed(() => blockStatesOf(utterances.value, reading.value))
const readCount = computed(() => states.value.filter(state => state === 'ready').length)
/** How many blocks are read at all: those the filters leave something of. */
const spokenCount = computed(() => states.value.filter(state => state !== 'skipped').length)

/** The blocks selected, for reading only those. */
const selection = ref(/** @type {number[]} */ ([]))

// A selection is of one document's blocks as they stood: another document,
// or blocks come and gone, and it no longer says what the writer meant.
watch([() => props.documentId, () => blocks.value.length], () => {
  selection.value = []
})

const summary = computed(() => {
  const count = spokenCount.value
  const noun = count === 1 ? 'segment' : 'segments'
  const made =
    readCount.value > 0 ? `${readCount.value} of ${count} ${noun} generated` : `${count} ${noun}`
  return selection.value.length > 0 ? `${made} · ${selection.value.length} selected` : made
})

const progress = computed(() => {
  const current = reading.value
  return current?.total ? Math.round((current.done / current.total) * 100) : 0
})

const generateLabel = computed(() => {
  const count = selection.value.length
  if (count === 0) return 'Generate'
  return `Generate ${count} selected ${count === 1 ? 'segment' : 'segments'}`
})

/** Whether Generate has anything to do: the selection, or what has no audio. */
const canGenerate = computed(
  () =>
    idle.value &&
    (selection.value.length > 0
      ? selection.value.some(index => states.value[index] !== 'skipped')
      : readCount.value < spokenCount.value)
)

/** The opening blocks a sample is read from, those that have no audio yet. */
const sample = computed(() =>
  sampleOf(utterances.value).filter(index => states.value[index] !== 'ready')
)

const downloadLabel = computed(() =>
  readCount.value < spokenCount.value
    ? `Download what has been generated (${readCount.value} of ${spokenCount.value}) as WAV`
    : 'Download as WAV'
)

/** Generate the selection, or everything that has no audio. */
const generateMissing = () => {
  if (!props.documentId) return
  const picked = selection.value
  selection.value = []
  narration.narrate(props.documentId, picked.length > 0 ? { blocks: picked } : {})
}

const regenerateAll = () =>
  narration.narrate(props.documentId, { blocks: blocks.value.map((_, index) => index) })

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
const previewingHints = ref(false)

/**
 * Hear something, saying why not when it cannot be had.
 * @param {import('vue').Ref<boolean>} busy - What says it is on its way
 * @param {() => Promise<void>} hear
 */
const listen = async (busy, hear) => {
  busy.value = true
  try {
    await hear()
  } catch (error) {
    toast.error(describeFailure(error, narration.connection.value))
  } finally {
    busy.value = false
  }
}

/** @param {import('@/types/models.js').TtsVoice} voice */
const preview = voice => listen(previewing, () => narration.preview(voice))

const previewHints = () => listen(previewingHints, () => narration.previewHints())

// The model's voices, to pick from, asked for again when the model changes.
watch(
  () => `${narration.choice.value.providerId}\n${narration.choice.value.model}`,
  () => narration.loadServerVoices()
)

onMounted(async () => {
  narration.watching.value += 1
  await documents.init()
  narration.loadServerVoices()
})

// What was kept of a document's narration, read back once it is shown with
// its words, and again when it is read through another model.
watch(
  () =>
    props.documentId && blocks.value.length > 0
      ? `${props.documentId}\n${narration.choice.value.providerId}\n${narration.choice.value.model}`
      : '',
  asked => {
    if (asked) narration.restore(props.documentId)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  narration.watching.value -= 1
  if (refreshTimer) clearTimeout(refreshTimer)
})
</script>
