<template>
  <Dialog
    :visible="visible"
    header="Import from Google Drive"
    :modal="true"
    :closable="phase !== 'importing'"
    class="w-full max-w-md"
    data-drive-dialog
    @update:visible="shown => !shown && cancel()"
  >
    <div class="flex flex-col items-center gap-4">
      <p v-if="status" class="text-sm text-surface-600 dark:text-surface-300" data-drive-status>
        <i class="pi pi-spin pi-spinner mr-2" style="font-size: 0.8rem" />{{ status }}
      </p>
      <p v-if="error" class="text-sm text-red-600 dark:text-red-400" data-drive-error>
        {{ error }}
      </p>
    </div>

    <template #footer>
      <Button
        :label="phase === 'importing' ? 'Stop' : 'Cancel'"
        severity="secondary"
        text
        data-drive-cancel
        @click="cancel"
      />
      <Button
        v-if="phase === 'failed'"
        label="Try again"
        icon="pi pi-google"
        data-drive-retry
        @click="start"
      />
    </template>
  </Dialog>
</template>

<script setup>
/* global AbortController */
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'
import { describeImport } from '@/composables/useBulkImport.js'
import { useDriveImport } from '@/composables/useDriveImport.js'

/**
 * Bring files from the writer's Google Drive into a folder.
 *
 * Opened with `open`, from the click on the menu that asked for it: that
 * click opens Google's sign-in with its picker, a popup in a browser (which
 * would be blocked opened any later) and the system browser in the desktop
 * window. The dialog waits for it to come back, with Cancel, then shows the
 * download, with Stop, which ends it by its own signal. See
 * `.llm/google_docs_design.md`.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 */
const props = defineProps({
  storyId: { type: String, required: true },
})

const drive = useDriveImport(props.storyId)
const toast = useToast()

const visible = ref(false)
/** The folder the files go into; the project's top when null. @type {import('vue').Ref<string|null>} */
const into = ref(null)
/**
 * Waiting on Google's page, downloading and writing, or stopped short.
 * @type {import('vue').Ref<'waiting'|'importing'|'failed'|null>}
 */
const phase = ref(null)
const progress = ref('')
const error = ref('')
/** @type {AbortController|null} */
let controller = null

const status = computed(() =>
  phase.value === 'waiting'
    ? 'Waiting for Google…'
    : phase.value === 'importing'
      ? progress.value
      : ''
)

/** @param {unknown} failure */
const messageOf = failure => (failure instanceof Error ? failure.message : String(failure))

/** @type {import('@/composables/useDriveImport.js').OnStep} */
const onStep = (step, done, total) => {
  const verb = step === 'downloading' ? 'Downloading' : 'Writing'
  progress.value = `${verb} ${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}…`
}

/**
 * Sign in and pick, then import what was picked. Called from a click, with
 * nothing awaited before `choose`, which opens Google's page.
 */
const start = async () => {
  const own = new AbortController()
  controller = own
  error.value = ''
  progress.value = ''
  phase.value = 'waiting'

  let picked
  try {
    picked = await drive.choose({ signal: own.signal })
  } catch (failure) {
    if (own.signal.aborted) return
    phase.value = 'failed'
    error.value = messageOf(failure)
    return
  }
  // Cancelled on Google's page, or nothing picked: done with it.
  if (!picked) {
    visible.value = false
    phase.value = null
    return
  }

  phase.value = 'importing'
  try {
    const result = await drive.importPicked(picked.ids, picked.token, {
      parentId: into.value || undefined,
      signal: own.signal,
      onStep,
    })
    toast.add({ ...describeImport(result), life: result.skipped.length > 0 ? 10000 : 5000 })
    visible.value = false
    phase.value = null
  } catch (failure) {
    phase.value = 'failed'
    error.value = own.signal.aborted
      ? 'Stopped. Whatever was written before stays.'
      : messageOf(failure)
  } finally {
    if (controller === own) controller = null
  }
}

/**
 * Import into a folder. Call it from the click that asked: with nothing
 * awaited before it, that click is what opens Google's page.
 *
 * @param {string|null} parentId
 */
const open = parentId => {
  into.value = parentId
  visible.value = true
  start()
}

/**
 * Cancel the wait for Google, which closes its popup if it still can; stop
 * a download; or close the dialog after one stopped short.
 */
const cancel = () => {
  if (phase.value === 'importing') {
    controller?.abort()
    return
  }
  controller?.abort()
  controller = null
  visible.value = false
  phase.value = null
}

defineExpose({ open })
</script>
