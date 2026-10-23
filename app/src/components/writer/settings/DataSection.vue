<template>
  <div class="flex flex-wrap justify-end gap-2 pt-2 pb-1">
    <Button
      label="Export"
      icon="pi pi-download"
      size="small"
      outlined
      :loading="isExporting"
      @click="exportDialogVisible = true"
    />
    <Button
      label="Import"
      icon="pi pi-upload"
      size="small"
      outlined
      severity="secondary"
      :loading="isImporting"
      @click="handleImportClick"
    />
    <Button
      v-if="desktop"
      :label="revealLabel"
      icon="pi pi-folder-open"
      size="small"
      outlined
      severity="secondary"
      data-action="reveal"
      @click="reveal"
    />
    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json,application/zip,.zip"
      class="hidden"
      @change="handleFileChange"
    />
    <ExportDialog v-model:visible="exportDialogVisible" @export="handleExport" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import Button from 'primevue/button'
import { useConfirm } from 'primevue/useconfirm'
import { useBackup } from '@/composables/useBackup'
import { useToast } from '@/composables/useToast'
import { describeBackupContents, keysLeftOut, projectName } from '@/utils/backup.js'
import { changesAnything, describeImport, describeSelection } from '@/utils/settingsFile.js'
import ExportDialog from './ExportDialog.vue'
import { getWebService } from '@/web/services.js'
import { isDesktop } from '@/platform/desktop.js'
import { revealInLibrary } from '@/platform/library.js'

/** @typedef {import('@/utils/backup.js').Backup} Backup */
/** @typedef {import('@/utils/settingsFile.js').SettingsImport} SettingsImport */

const backup = useBackup()
const toast = useToast()
const confirm = useConfirm()

const exportDialogVisible = ref(false)
const isExporting = ref(false)
const isImporting = ref(false)
/** @type {import('vue').Ref<HTMLInputElement|null>} */
const fileInput = ref(null)

/** What a web search service is called, for naming the keys a file left out. */
const webName = (/** @type {string} */ id) => getWebService(id)?.name ?? id

// In the desktop app, the folder the projects are kept in can be shown in
// the system's file manager.
const desktop = isDesktop()
const platform = typeof navigator === 'undefined' ? '' : navigator.userAgent
const revealLabel = /Mac/.test(platform)
  ? 'Show in Finder'
  : /Windows/.test(platform)
    ? 'Show in Explorer'
    : 'Show folder'

const reveal = async () => {
  try {
    await revealInLibrary()
  } catch (error) {
    toast.error(`The folder couldn't be shown. ${error.message}`)
  }
}

/**
 * Save what was ticked.
 *
 * @param {import('./ExportDialog.vue').ExportChoice} choice
 */
const handleExport = async choice => {
  isExporting.value = true
  try {
    await backup.downloadSelection(choice.pick, { includeApiKeys: choice.includeApiKeys })
  } catch (error) {
    console.error('Export failed:', error)
    toast.error(`The file couldn't be saved. ${error.message}`)
  } finally {
    isExporting.value = false
  }
}

const handleImportClick = () => {
  fileInput.value?.click()
}

/**
 * Read the file picked, and ask before taking anything that replaces or
 * changes what is here: a backup replaces everything, and settings are
 * merged into what is here. A selection that only adds projects and cards
 * is taken at once.
 *
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
    const read = await backup.readDataFile(file)
    if (read.kind === 'settings') askToImportSettings(read.backup, read.plan)
    else if (read.kind === 'selection') askToImportSelection(read.backup, read.selection)
    else askToRestore(read.backup)
  } catch (error) {
    console.error('Import failed:', error)
    toast.error(error.message)
    isImporting.value = false
  }
}

/**
 * Ask before a whole backup takes the place of everything here.
 *
 * @param {Backup} parsed
 */
function askToRestore(parsed) {
  // The keys to enter again afterwards, named while the writer can still
  // go and find them: otherwise a chat or a search is how they find out.
  const leftOut = keysLeftOut(parsed, webName)
  const keys = leftOut.length > 0 ? ` Keys left out: ${leftOut.join(', ')}.` : ''

  confirm.require({
    header: 'Replace all data?',
    message: `${describeBackupContents(parsed)}${keys} Everything in inksprite now is replaced.`,
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
        toast.error(`The backup couldn't be restored. ${error.message}`)
      }
    },
    reject: () => {
      isImporting.value = false
    },
    onHide: () => {
      isImporting.value = false
    },
  })
}

/**
 * Ask before a settings file is merged into the setup here, saying what it
 * adds and changes; one that changes nothing does nothing.
 *
 * @param {Backup} parsed
 * @param {SettingsImport} plan
 */
function askToImportSettings(parsed, plan) {
  if (!changesAnything(plan)) {
    isImporting.value = false
    return
  }
  // The keys still empty once the file is in: those it left out that
  // aren't here either.
  const leftOut = keysLeftOut({ ...parsed, tables: plan.rows }, webName)
  const keys = leftOut.length > 0 ? ` Keys left out: ${leftOut.join(', ')}.` : ''

  confirm.require({
    header: 'Import settings?',
    message: `${describeImport(plan)}${keys}`,
    icon: 'pi pi-upload',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Import' },
    accept: async () => {
      isImporting.value = true
      try {
        await backup.importSettings(plan)
        // The stores hold the rows they read; the page reads them again.
        window.location.reload()
      } catch (error) {
        console.error('Settings import failed:', error)
        toast.error(`The settings couldn't be imported. ${error.message}`)
        isImporting.value = false
      }
    },
    reject: () => {
      isImporting.value = false
    },
    onHide: () => {
      isImporting.value = false
    },
  })
}

/**
 * Take a selection: its projects and cards are added beside what is here,
 * which the trash can take back, so only one that changes settings asks
 * first. Nothing new in it does nothing.
 *
 * @param {Backup} parsed
 * @param {import('@/composables/useBackup').SelectionImport} selection
 */
function askToImportSelection(parsed, selection) {
  const projects = selection.projects.map(projectName)
  const cards = selection.cards.rows.map(card => card.title || 'Untitled')
  const description = describeSelection({ projects, cards, plan: selection.plan })
  if (!description) {
    isImporting.value = false
    return
  }
  if (!changesAnything(selection.plan)) {
    importSelection(selection)
    return
  }
  const leftOut = keysLeftOut({ ...parsed, tables: selection.plan.rows }, webName)
  const keys = leftOut.length > 0 ? ` Keys left out: ${leftOut.join(', ')}.` : ''

  confirm.require({
    header: 'Import?',
    message: `${description}${keys}`,
    icon: 'pi pi-upload',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Import' },
    accept: () => importSelection(selection),
    reject: () => {
      isImporting.value = false
    },
    onHide: () => {
      isImporting.value = false
    },
  })
}

/**
 * Add a selection's projects and cards, and merge its settings. What was
 * added is said, since none of it shows from here; settings changed reload
 * the page instead.
 *
 * @param {import('@/composables/useBackup').SelectionImport} selection
 */
async function importSelection(selection) {
  isImporting.value = true
  try {
    const done = await backup.importSelection(selection)
    // Settings went straight to storage, past the stores that hold them.
    if (done.settingsChanged) {
      window.location.reload()
      return
    }
    const added = describeSelection({ ...done, plan: { added: [], changed: [] } }, { done: true })
    if (added) toast.success(added)
  } catch (error) {
    console.error('Import failed:', error)
    toast.error(`Nothing was imported. ${error.message}`)
  } finally {
    isImporting.value = false
  }
}
</script>
