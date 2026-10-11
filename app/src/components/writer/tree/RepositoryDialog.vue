<template>
  <Dialog
    :visible="visible"
    :header="header"
    :modal="true"
    :closable="!busy"
    class="w-full max-w-xl"
    data-repository-dialog
    @update:visible="close"
  >
    <div class="flex flex-col gap-5">
      <!-- Refreshing reads the same source again; only a token can change. -->
      <template v-if="handed" />
      <template v-else-if="refreshing">
        <p v-if="source?.from === 'folder'" class="text-sm text-surface-600 dark:text-surface-300">
          Choose <strong>{{ source?.name }}</strong> again.
        </p>
        <div v-else class="flex flex-col gap-1">
          <label
            for="repository-token"
            class="text-xs font-medium text-surface-700 dark:text-surface-200"
          >
            Token, for a private repository
          </label>
          <InputText
            id="repository-token"
            v-model="token"
            type="password"
            autocomplete="off"
            class="w-full"
            :disabled="busy"
          />
        </div>
      </template>

      <template v-else>
        <div class="flex flex-col gap-2" data-repository-github>
          <label
            for="repository-url"
            class="text-xs font-medium text-surface-700 dark:text-surface-200"
          >
            From GitHub
          </label>
          <InputText
            id="repository-url"
            v-model="url"
            placeholder="https://github.com/owner/repo"
            class="w-full"
            :disabled="busy || !desktop"
            @keydown.enter="desktop && importGitHub()"
          />
          <p v-if="!desktop" class="text-xs text-surface-500 dark:text-surface-400">
            Desktop app only. Here, clone it and choose the folder.
          </p>
          <template v-else>
            <p class="text-xs text-surface-500 dark:text-surface-400">
              Or a branch or folder: <code>…/tree/main/src</code>
            </p>
            <label
              for="repository-token"
              class="text-xs font-medium text-surface-700 dark:text-surface-200 mt-1"
            >
              Token, for a private repository
            </label>
            <InputText
              id="repository-token"
              v-model="token"
              type="password"
              autocomplete="off"
              class="w-full"
              :disabled="busy"
            />
            <p class="text-xs text-surface-500 dark:text-surface-400">Not saved.</p>
          </template>
        </div>
      </template>

      <p
        v-if="status"
        class="text-sm text-surface-600 dark:text-surface-300"
        data-repository-status
      >
        <i v-if="busy" class="pi pi-spin pi-spinner mr-2" style="font-size: 0.8rem" />{{ status }}
      </p>
      <p v-if="error" class="text-sm text-red-600 dark:text-red-400" data-repository-error>
        {{ error }}
      </p>
    </div>

    <input
      ref="folderInput"
      type="file"
      class="hidden"
      webkitdirectory
      data-repository-folder-input
      @change="readFolder"
    />

    <template #footer>
      <Button
        :label="busy ? 'Stop' : 'Cancel'"
        severity="secondary"
        text
        @click="busy ? stop() : close(false)"
      />
      <Button
        v-if="!handed && (!refreshing || source?.from === 'folder')"
        label="Choose folder…"
        icon="pi pi-folder-open"
        :severity="refreshing || !desktop ? undefined : 'secondary'"
        :outlined="!refreshing && desktop"
        :disabled="busy"
        @click="chooseFolder"
      />
      <Button
        v-if="!handed && refreshing && source?.from === 'github'"
        label="Refresh"
        icon="pi pi-refresh"
        :disabled="busy"
        @click="refreshGitHub"
      />
      <Button
        v-if="!handed && !refreshing && desktop"
        label="Import"
        icon="pi pi-github"
        :disabled="busy || !url.trim()"
        @click="importGitHub"
      />
    </template>
  </Dialog>
</template>

<script setup>
/* global AbortController */
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import { useToast } from 'primevue/usetoast'
import { useDocuments } from '@/composables/useDocuments'
import { describeRepositoryImport, useRepositoryImport } from '@/composables/useRepositoryImport.js'
import { folderOf, listFiles } from '@/files/batch.js'
import { isDesktop } from '@/platform/desktop.js'

/**
 * Bring a codebase into the project as a repository — from GitHub in the
 * desktop app, or from a folder in either — or bring one up to date.
 *
 * The import runs with the dialog open, saying where it is, and Stop ends it
 * by its own signal. What was written before a stop stays, as the tree shows
 * it. A folder the tree took for a codebase is handed over with
 * `importListed`, and the dialog only says how its import goes. See
 * `.llm/source_code_design.md`.
 *
 * @typedef {Object} Props
 * @property {boolean} visible
 * @property {string} storyId
 * @property {string|null} [parentId] - Where a new repository goes
 * @property {string|null} [refreshId] - The repository to refresh, rather than importing one
 */
const props = defineProps({
  visible: { type: Boolean, default: false },
  storyId: { type: String, required: true },
  parentId: { type: String, default: null },
  refreshId: { type: String, default: null },
})
const emit = defineEmits(['update:visible'])

const api = useDocuments(props.storyId)
const repositories = useRepositoryImport(props.storyId)
const toast = useToast()
const desktop = isDesktop()

const url = ref('')
const token = ref('')
const busy = ref(false)
const status = ref('')
const error = ref('')
/** @type {import('vue').Ref<HTMLInputElement|null>} */
const folderInput = ref(null)
/** @type {AbortController|null} */
let controller = null
/** The name of a folder the tree handed over to import, when it did. */
const handed = ref('')

const refreshing = computed(() => !!props.refreshId)
const source = computed(() => (props.refreshId ? api.get(props.refreshId)?.source : null))
const header = computed(() =>
  refreshing.value
    ? `Refresh ${api.displayTitle(api.get(props.refreshId || ''))}`
    : handed.value
      ? `Import ${handed.value}`
      : 'Import repository'
)

watch(
  () => props.visible,
  open => {
    if (!open) return
    error.value = ''
    status.value = ''
    token.value = ''
    handed.value = ''
  }
)

/** @param {boolean} visible */
const close = visible => {
  if (busy.value || visible) return
  emit('update:visible', false)
}

const stop = () => controller?.abort()

/** @type {import('@/composables/useRepositoryImport.js').OnStep} */
const onStep = (step, done, total) => {
  if (step === 'downloading') status.value = 'Downloading…'
  else {
    const verb = step === 'reading' ? 'Reading' : 'Writing'
    status.value = `${verb} ${done?.toLocaleString('en-US')} of ${total?.toLocaleString('en-US')} files…`
  }
}

/**
 * Run one import or refresh with the dialog saying how it goes, and close it
 * with the tally when it is done.
 *
 * @param {(signal: AbortSignal) => Promise<import('@/composables/useRepositoryImport.js').RepositoryImported>} run
 */
const perform = async run => {
  controller = new AbortController()
  busy.value = true
  error.value = ''
  status.value = ''
  try {
    const result = await run(controller.signal)
    toast.add({ ...describeRepositoryImport(result), life: 6000 })
    busy.value = false
    emit('update:visible', false)
  } catch (failure) {
    error.value = controller.signal.aborted
      ? 'Stopped. Whatever was written before stays.'
      : failure instanceof Error
        ? failure.message
        : String(failure)
    status.value = ''
  } finally {
    busy.value = false
    controller = null
  }
}

const importGitHub = () =>
  perform(signal =>
    repositories.importGitHub(url.value, {
      parentId: props.parentId || undefined,
      token: token.value.trim() || undefined,
      signal,
      onStep,
    })
  )

const refreshGitHub = () =>
  perform(signal =>
    repositories.refresh(/** @type {string} */ (props.refreshId), {
      token: token.value.trim() || undefined,
      signal,
      onStep,
    })
  )

const chooseFolder = () => {
  if (folderInput.value) folderInput.value.value = ''
  folderInput.value?.click()
}

/** @param {Event} event */
const readFolder = event => {
  const chosen = /** @type {HTMLInputElement} */ (event.target).files
  if (!chosen || chosen.length === 0) return
  const listed = listFiles(chosen)
  perform(signal =>
    props.refreshId
      ? repositories.refresh(props.refreshId, { listed, signal, onStep })
      : repositories.importFolder(listed, {
          parentId: props.parentId || undefined,
          signal,
          onStep,
        })
  )
}

/**
 * Import a folder the tree already has, chosen or dropped there and taken for
 * a codebase.
 *
 * @param {import('@/files/batch.js').Gathered[]} listed
 * @returns {Promise<void>}
 */
const importListed = listed => {
  handed.value = folderOf(listed) || 'repository'
  return perform(signal =>
    repositories.importFolder(listed, { parentId: props.parentId || undefined, signal, onStep })
  )
}

defineExpose({ importListed })
</script>
