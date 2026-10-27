<template>
  <div class="flex flex-wrap gap-2 pt-2 pb-1">
    <Button
      label="Export"
      icon="pi pi-download"
      size="small"
      outlined
      severity="secondary"
      :loading="isExporting"
      data-action="export"
      @click="exportDialogVisible = true"
    />
    <Button
      label="Export settings"
      icon="pi pi-sliders-h"
      size="small"
      outlined
      severity="secondary"
      :loading="isExportingSettings"
      data-action="export-settings"
      @click="settingsDialogVisible = true"
    />
    <Button
      label="Import"
      icon="pi pi-upload"
      size="small"
      outlined
      severity="secondary"
      :loading="isImporting"
      data-action="import"
      @click="handleImportClick"
    />
    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json,application/zip,.zip"
      class="hidden"
      @change="handleFileChange"
    />
    <ExportDialog v-model:visible="exportDialogVisible" @export="handleExport" />
    <SettingsExportDialog v-model:visible="settingsDialogVisible" @export="handleSettingsExport" />
    <ImportBackupDialog
      :visible="restoring !== null"
      :message="restoring?.message ?? ''"
      :addable="restoring?.addable ?? null"
      @update:visible="restoreDialogShown"
      @replace="replaceAll"
      @add="addPicked"
    />
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
import ImportBackupDialog from './ImportBackupDialog.vue'
import SettingsExportDialog from './SettingsExportDialog.vue'
import { getWebService } from '@/web/services.js'

/** @typedef {import('@/utils/backup.js').Backup} Backup */
/** @typedef {import('@/utils/settingsFile.js').SettingsImport} SettingsImport */

/**
 * Settings › Sync and sharing › Backup: everything saved to a file, the
 * settings picked saved to a file of their own, and a file taken back in,
 * whatever it holds: a whole backup, settings, or a selection or a project
 * saved before.
 */

const backup = useBackup()
const toast = useToast()
const confirm = useConfirm()

const exportDialogVisible = ref(false)
const settingsDialogVisible = ref(false)
const isExporting = ref(false)
const isExportingSettings = ref(false)
const isImporting = ref(false)
/** @type {import('vue').Ref<HTMLInputElement|null>} */
const fileInput = ref(null)
/**
 * The whole backup being asked about: what it holds, said, and what of it
 * can be added.
 *
 * @type {import('vue').Ref<{backup: Backup, message: string, addable: import('@/composables/useBackup').BackupAddable}|null>}
 */
const restoring = ref(null)

/** What a web search service is called, for naming the keys a file left out. */
const webName = (/** @type {string} */ id) => getWebService(id)?.name ?? id

/**
 * Save everything.
 *
 * @param {{includeApiKeys: boolean}} choice
 */
const handleExport = async choice => {
  isExporting.value = true
  try {
    await backup.downloadBackup({ includeApiKeys: choice.includeApiKeys })
  } catch (error) {
    console.error('Export failed:', error)
    toast.error(`The backup couldn't be saved. ${error.message}`)
  } finally {
    isExporting.value = false
  }
}

/**
 * Save the settings ticked.
 *
 * @param {import('./SettingsExportDialog.vue').SettingsExportChoice} choice
 */
const handleSettingsExport = async choice => {
  isExportingSettings.value = true
  try {
    await backup.downloadSettings(choice)
  } catch (error) {
    console.error('Settings export failed:', error)
    toast.error(`The settings couldn't be saved. ${error.message}`)
  } finally {
    isExportingSettings.value = false
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
    else askToRestore(read.backup, read.addable)
  } catch (error) {
    console.error('Import failed:', error)
    toast.error(error.message)
    isImporting.value = false
  }
}

/**
 * Ask whether a whole backup takes the place of everything here, or only
 * some of its projects and cards are added beside what is here.
 *
 * @param {Backup} parsed
 * @param {import('@/composables/useBackup').BackupAddable} addable
 */
function askToRestore(parsed, addable) {
  // The keys to enter again afterwards, named while the writer can still
  // go and find them: otherwise a chat or a search is how they find out.
  const leftOut = keysLeftOut(parsed, webName)
  const keys = leftOut.length > 0 ? ` Keys left out: ${leftOut.join(', ')}.` : ''
  restoring.value = { backup: parsed, message: `${describeBackupContents(parsed)}${keys}`, addable }
}

/** Whether the dialog closed on a restore or an add, which keeps the spinner going. */
let taking = false

/** @param {boolean} visible */
function restoreDialogShown(visible) {
  if (visible) return
  restoring.value = null
  if (!taking) isImporting.value = false
}

/** Put the backup asked about in place of everything here, and start again on it. */
async function replaceAll() {
  const parsed = restoring.value?.backup
  if (!parsed) return
  taking = true
  try {
    await backup.restoreBackup(parsed)
    // Every Pinia store is holding rows that no longer exist. Reloading
    // is the only honest way back to a consistent view.
    window.location.reload()
  } catch (error) {
    console.error('Backup restore failed:', error)
    toast.error(`The backup couldn't be restored. ${error.message}`)
    taking = false
    isImporting.value = false
  }
}

/**
 * Add the projects and cards ticked of a backup beside what is here, and say
 * what was added, since none of it shows from here.
 *
 * @param {import('@/composables/useBackup').BackupAddable} taken
 */
async function addPicked(taken) {
  taking = true
  try {
    const done = await backup.addFromBackup(taken)
    const added = describeSelection({ ...done, plan: { added: [], changed: [] } }, { done: true })
    if (added) toast.success(added)
  } catch (error) {
    console.error('Import failed:', error)
    toast.error(`Nothing was imported. ${error.message}`)
  } finally {
    taking = false
    isImporting.value = false
  }
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
