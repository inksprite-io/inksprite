<template>
  <div
    class="mb-1 rounded bg-surface-50 dark:bg-surface-800/50 border-l-2 border-surface-300 dark:border-surface-700"
  >
    <!-- Edit mode -->
    <div v-if="isEditing">
      <Textarea
        ref="summaryTextarea"
        v-model="draft"
        rows="3"
        auto-resize
        class="w-full text-sm !bg-transparent !border-0"
        :placeholder="isGenerating ? 'Summarizing...' : 'Enter a summary...'"
        :disabled="isGenerating"
        @keydown.enter.exact.prevent="save"
        @keydown.escape="handleEscape"
        @blur="save"
      />
      <div class="flex gap-1 px-2 pb-1 justify-between items-center">
        <i v-if="isGenerating" class="pi pi-spin pi-spinner text-xs text-surface-500" />
        <span v-else />
        <div class="flex gap-1">
          <!-- Pressing either must not blur the field first, or a blur
               would save what Cancel was about to throw away. -->
          <Button
            v-if="!isGenerating"
            v-tooltip.top="'Save'"
            icon="pi pi-check"
            aria-label="Save summary"
            text
            rounded
            size="small"
            severity="success"
            @mousedown.prevent
            @click="save"
          />
          <Button
            v-tooltip.top="isGenerating ? 'Stop' : 'Cancel'"
            :icon="isGenerating ? 'pi pi-stop' : 'pi pi-times'"
            :aria-label="isGenerating ? 'Stop summarizing' : 'Cancel'"
            text
            rounded
            size="small"
            :severity="isGenerating ? 'danger' : 'secondary'"
            @mousedown.prevent
            @click="cancelOrStop"
          />
        </div>
      </div>
    </div>

    <!-- Display mode -->
    <div v-else class="flex items-start gap-1">
      <div
        class="flex-1 p-2 prose dark:prose-invert prose-sm max-w-none text-surface-700 dark:text-surface-400 cursor-pointer text-sm"
        @click="startEditing"
        v-html="summaryHtml || '<i>Click to add a summary...</i>'"
      />
      <Button
        v-tooltip.top="'Generate'"
        icon="pi pi-sparkles"
        text
        rounded
        size="small"
        severity="secondary"
        :disabled="isGenerating || !hasContent"
        @click="generate"
      />
    </div>

    <InitialProviderSetup
      v-model:visible="providerSetupDialogVisible"
      @dont-show-again="handleDontShowAgain"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import Button from 'primevue/button'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import InitialProviderSetup from '@/components/common/InitialProviderSetup.vue'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useAISummarize } from '@/composables/useAISummarize'
import { useProviderSetup } from '@/composables/useProviderSetup.js'
import { renderMarkdown } from '@/utils/markdown'

const props = defineProps({
  documentId: { type: String, required: true },
})

defineEmits(['close'])

const documentsStore = useDocumentsStore()
const toast = useToast()
const { handleSummarize, isGenerating, stopGeneration } = useAISummarize()
const { providerSetupDialogVisible, handleDontShowAgain, isProviderSetupDialogEnabled } =
  useProviderSetup()

const summaryTextarea = ref(null)
const isEditing = ref(false)
const draft = ref('')

const node = computed(() => documentsStore.getDocument(props.documentId))
const summaryHtml = computed(() => (node.value?.summary ? renderMarkdown(node.value.summary) : ''))
const hasContent = computed(() => !!node.value?.content?.trim())

const startEditing = async () => {
  draft.value = node.value?.summary || ''
  isEditing.value = true
  await nextTick()
  summaryTextarea.value?.$el?.focus()
}

/**
 * Keep what was typed. Called for Enter and the tick, and for leaving the
 * field: a summary is a note, and a note left by clicking away is a note
 * kept, the way a rename is. Mid-generation nothing is kept yet, since the
 * text is still arriving.
 */
const save = () => {
  if (!isEditing.value || isGenerating.value) return
  if (draft.value !== (node.value?.summary || '')) {
    documentsStore.updateDocument(props.documentId, { summary: draft.value })
  }
  isEditing.value = false
}

const cancelEditing = () => {
  isEditing.value = false
  draft.value = node.value?.summary || ''
}

const handleEscape = () => {
  // Mid-generation, escape stops the stream and keeps whatever arrived rather
  // than throwing the partial summary away.
  if (isGenerating.value) stopGeneration()
  else cancelEditing()
}

const cancelOrStop = () => {
  if (!isGenerating.value) {
    cancelEditing()
    return
  }
  stopGeneration()
  if (!draft.value) cancelEditing()
}

// The panel can go while a draft is open in it — the folder twisted shut,
// the project switched. That is leaving the field too.
onBeforeUnmount(save)

const generate = async () => {
  if (!node.value || isGenerating.value) return

  draft.value = ''
  isEditing.value = true
  await nextTick()
  summaryTextarea.value?.$el?.focus()

  try {
    draft.value = await handleSummarize(node.value.storyId, props.documentId, chunk => {
      draft.value += chunk
    })
    // Stay in edit mode so the summary can be reviewed before it is saved.
  } catch (error) {
    console.error('Failed to generate summary:', error)
    if (!draft.value) cancelEditing()

    if (error.name === 'ProviderNotConfiguredError' && isProviderSetupDialogEnabled()) {
      providerSetupDialogVisible.value = true
      return
    }
    toast.add({
      severity: 'error',
      summary: 'Summary Generation Failed',
      detail:
        error.name === 'ProviderNotConfiguredError'
          ? 'Set up a provider in the settings menu to use AI features.'
          : error.message || 'Failed to generate summary.',
      life: 5000,
    })
  }
}
</script>
