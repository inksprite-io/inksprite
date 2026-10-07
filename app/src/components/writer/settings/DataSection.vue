<template>
  <div class="flex flex-wrap gap-2 px-2 pt-1 pb-2">
    <Button
      label="Export backup"
      icon="pi pi-download"
      size="small"
      outlined
      :loading="isExporting"
      @click="exportDialogVisible = true"
    />
    <Button
      label="Import backup"
      icon="pi pi-upload"
      size="small"
      outlined
      severity="secondary"
      :loading="isImporting"
      @click="handleImportClick"
    />
    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json"
      class="hidden"
      @change="handleFileChange"
    />

    <Dialog
      v-model:visible="exportDialogVisible"
      modal
      header="Export backup"
      :style="{ width: '24rem', maxWidth: '95vw' }"
    >
      <p class="text-sm text-surface-600 dark:text-surface-300 mb-3">
        Saves every project, chat, and setting to a JSON file.
      </p>
      <div class="flex items-center gap-2">
        <Checkbox v-model="includeApiKeys" input-id="include-api-keys" binary />
        <label for="include-api-keys" class="text-sm">Include API keys</label>
      </div>
      <template #footer>
        <Button
          label="Cancel"
          severity="secondary"
          outlined
          size="small"
          @click="exportDialogVisible = false"
        />
        <Button label="Export" size="small" data-action="export" @click="handleExport" />
      </template>
    </Dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Dialog from 'primevue/dialog'
import { useConfirm } from 'primevue/useconfirm'
import { useBackup } from '@/composables/useBackup'
import { useToast } from '@/composables/useToast'

const backup = useBackup()
const toast = useToast()
const confirm = useConfirm()

const exportDialogVisible = ref(false)
const includeApiKeys = ref(false)
const isExporting = ref(false)
const isImporting = ref(false)
/** @type {import('vue').Ref<HTMLInputElement|null>} */
const fileInput = ref(null)

/**
 * Render row counts as a short phrase for the confirmation prompt.
 * @param {Array<{table: string, count: number}>} summary
 * @returns {string}
 */
const describeSummary = summary => {
  if (summary.length === 0) return 'It contains no data.'
  const head = summary
    .slice(0, 3)
    .map(entry => `${entry.count} ${entry.table}`)
    .join(', ')
  const rest = summary.length - 3
  return rest > 0 ? `It contains ${head}, and ${rest} more tables.` : `It contains ${head}.`
}

const handleExport = async () => {
  exportDialogVisible.value = false
  isExporting.value = true
  try {
    const { filename } = await backup.downloadBackup({ includeApiKeys: includeApiKeys.value })
    toast.success(`Saved ${filename}`)
  } catch (error) {
    console.error('Backup export failed:', error)
    toast.error(`Export failed: ${error.message}`)
  } finally {
    isExporting.value = false
  }
}

const handleImportClick = () => {
  fileInput.value?.click()
}

/**
 * @param {Event} event
 */
const handleFileChange = async event => {
  const input = /** @type {HTMLInputElement} */ (event.target)
  const file = input.files?.[0]
  // Reset immediately so picking the same file again still fires a change.
  input.value = ''
  if (!file) return

  isImporting.value = true
  try {
    const { backup: parsed, summary } = await backup.readBackupFile(file)

    confirm.require({
      header: 'Replace all data?',
      message: `${describeSummary(summary)} Everything currently in inksprite will be permanently replaced, and the app will reload.`,
      icon: 'pi pi-exclamation-triangle',
      rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
      acceptProps: { label: 'Replace', severity: 'danger' },
      accept: async () => {
        // onHide fires as the dialog closes, so re-arm the spinner for the
        // restore itself.
        isImporting.value = true
        try {
          await backup.restoreBackup(parsed)
          // Every Pinia store is holding rows that no longer exist. Reloading
          // is the only honest way back to a consistent view.
          window.location.reload()
        } catch (error) {
          console.error('Backup restore failed:', error)
          toast.error(`Restore failed: ${error.message}`)
        }
      },
      reject: () => {
        isImporting.value = false
      },
      onHide: () => {
        isImporting.value = false
      },
    })
  } catch (error) {
    console.error('Backup import failed:', error)
    toast.error(error.message)
    isImporting.value = false
  }
}
</script>
