<template>
  <div class="flex flex-col gap-1 px-2 pt-1 pb-2" data-library>
    <div class="flex items-center justify-between gap-2">
      <label for="library-switch" class="text-xs font-medium text-surface-700 dark:text-surface-200"
        >Keep projects in a folder</label
      >
      <ToggleSwitch
        :model-value="enabled"
        input-id="library-switch"
        class="flex-none"
        :disabled="busy"
        data-library-switch
        @update:model-value="turn"
      />
    </div>
    <p
      v-if="enabled"
      class="text-xs font-mono break-all text-surface-600 dark:text-surface-300"
      data-library-path
    >
      {{ path }}
    </p>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import ToggleSwitch from 'primevue/toggleswitch'
import { useConfirm } from 'primevue/useconfirm'
import { enableLibrary, librarySettings } from '@/platform/library.js'
import { keepProjectsInApp } from '@/storage/open.js'
import { storage } from '@/storage/index.js'
import { useEditor } from '@/composables/useEditor.js'
import { useSyncStore } from '@/stores/syncStore.js'
import { useToast } from '@/composables/useToast.js'

/**
 * The desktop app's library: whether the projects are kept in a folder of
 * markdown files, in the app's data folder, and where that is. Either way
 * the switch goes, the app opens again with the projects moved into the
 * folder or back into the app. The button that shows the folder sits with
 * the backup buttons, in DataSection.
 */

const toast = useToast()
const confirm = useConfirm()
const enabled = ref(false)
const path = ref('')
const busy = ref(false)

onMounted(async () => {
  try {
    const settings = await librarySettings()
    enabled.value = settings.enabled
    path.value = settings.path
  } catch (error) {
    console.error('Where the library is could not be read:', error)
  }
})

// Everything still on its way to be saved is saved first: the app opens
// again on the projects where they are moved to, and anything unsaved would
// be in neither.
const saveAll = async () => {
  useEditor().flush()
  await useSyncStore().processSync()
}

/**
 * Move the projects, then open the app again on them, saying what went
 * wrong if it does not get that far.
 * @param {() => Promise<void>} work
 * @param {string} failed - What could not be done
 */
const reopenAfter = async (work, failed) => {
  busy.value = true
  try {
    await saveAll()
    await work()
    window.location.reload()
  } catch (error) {
    toast.error(`${failed}: ${error.message}`)
  } finally {
    busy.value = false
  }
}

/** @param {boolean} on */
const turn = on => {
  const cancel = { label: 'Cancel', severity: 'secondary', outlined: true }
  if (on) {
    confirm.require({
      header: 'Keep projects in a folder?',
      message: 'Each project is moved into a folder of Markdown files, then inksprite reloads.',
      icon: 'pi pi-folder',
      rejectProps: cancel,
      acceptProps: { label: 'Keep in a folder' },
      accept: () =>
        reopenAfter(async () => {
          await enableLibrary()
        }, "The projects couldn't be moved into a folder"),
    })
    return
  }
  confirm.require({
    header: 'Keep projects in the app?',
    message:
      'Projects are moved back into the app, then inksprite reloads. The folder is left as it is.',
    icon: 'pi pi-folder',
    rejectProps: cancel,
    acceptProps: { label: 'Keep in the app' },
    accept: () =>
      reopenAfter(
        () => keepProjectsInApp(storage),
        "The projects couldn't be moved back into the app"
      ),
  })
}
</script>
