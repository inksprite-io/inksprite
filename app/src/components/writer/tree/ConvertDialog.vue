<template>
  <Dialog
    :visible="documentId !== null"
    header="Convert to Markdown?"
    :modal="true"
    class="w-full max-w-lg"
    data-convert-dialog
    @update:visible="open => open || emit('close')"
  >
    <div class="flex flex-col gap-4 text-sm text-surface-700 dark:text-surface-200">
      <p data-convert-size>{{ size }}</p>
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-surface-700 dark:text-surface-200">Model</span>
        <div class="flex items-center gap-2">
          <span class="flex-1 min-w-0 truncate" data-convert-model>{{ modelName || 'None' }}</span>
          <Button
            label="Change…"
            size="small"
            severity="secondary"
            outlined
            data-action="change-model"
            @click="choosing = true"
          />
        </div>
      </div>
      <ModelPickerDialog
        v-if="choosing"
        :provider-id="picked?.providerId ?? null"
        :model="picked?.model ?? null"
        @use="picked = $event"
        @close="choosing = false"
      />
    </div>
    <template #footer>
      <Button
        label="Cancel"
        severity="secondary"
        outlined
        size="small"
        data-action="convert-cancel"
        @click="emit('close')"
      />
      <Button
        label="Convert"
        size="small"
        :disabled="!picked"
        :loading="busy"
        data-action="convert-confirm"
        @click="convert"
      />
    </template>
  </Dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import ModelPickerDialog from '../models/ModelPickerDialog.vue'
import { useAIConfig } from '@/composables/useAIConfig'
import { useApplicationState } from '@/composables/useApplicationState'
import { useDocuments } from '@/composables/useDocuments'
import { useJobs } from '@/composables/useJobs.js'
import { useJobsToast } from '@/composables/useJobsToast.js'
import { useModelLists } from '@/composables/useModelLists'
import { useToast } from '@/composables/useToast.js'
import { requestsFor } from '@/jobs/index.js'

/**
 * Asks before turning a document's text into Markdown, a long job, with the
 * size of it and the model it runs on: a book is many requests. The model
 * starts on the one last converted with, or, the first time, on what new
 * chats start on, and a conversion keeps the one it ran on for the next. It
 * runs on that model's settings. A choice here is Convert's alone; no chat
 * moves.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string|null} documentId - The document asked about; null while closed
 */
const props = defineProps({
  storyId: { type: String, required: true },
  documentId: { type: String, default: null },
})

const emit = defineEmits(['close'])

const aiConfig = useAIConfig()
const { workflows, setWorkflow } = useApplicationState()
const api = useDocuments(props.storyId)
const jobs = useJobs()
const jobsToast = useJobsToast()
const toast = useToast()
const modelLists = useModelLists()

/**
 * The model it converts with: the one last converted with, or the first time,
 * what new chats start on.
 * @type {import('vue').Ref<{providerId: string, model: string}|null>}
 */
const picked = ref(null)
const busy = ref(false)
/** Whether the model picker is open. */
const choosing = ref(false)

watch(
  () => props.documentId,
  id => {
    if (!id) return
    const own = workflows.value.convert || {}
    const starting = aiConfig.startingPreset.value
    picked.value =
      own.providerId && own.model
        ? { providerId: own.providerId, model: own.model }
        : starting
          ? { providerId: starting.providerId, model: starting.model }
          : null
  },
  { immediate: true }
)

/** The model by its name in its connection's list, or its id. */
const modelName = computed(() => {
  const choice = picked.value
  if (!choice) return ''
  return (
    modelLists.listOf(choice.providerId)?.models.find(one => one.id === choice.model)?.name ??
    choice.model
  )
})

watch(
  () => picked.value?.providerId,
  providerId => {
    if (providerId && !modelLists.listOf(providerId)) {
      modelLists.load(providerId).catch(() => {})
    }
  },
  { immediate: true }
)

const size = computed(() => {
  const document = props.documentId ? api.get(props.documentId) : null
  const requests = requestsFor(document?.content || '')
  const words = document?.wordCount || 0
  return `${words.toLocaleString()} words, about ${requests} ${requests === 1 ? 'request' : 'requests'}. The Markdown goes in a new document under it.`
})

/** Keep the model as Convert's, and start the conversion on it. */
async function convert() {
  const documentId = props.documentId
  const choice = picked.value
  if (!documentId || !choice || busy.value) return
  setWorkflow('convert', { providerId: choice.providerId, model: choice.model })
  busy.value = true
  try {
    await jobs.convert(props.storyId, documentId)
    jobsToast.show()
    emit('close')
  } catch (error) {
    toast.error(`The conversion couldn't start. ${/** @type {Error} */ (error).message}`)
  } finally {
    busy.value = false
  }
}
</script>
