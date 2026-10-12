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
import { librarySettings } from '@/platform/library.js'
import { useLibraryMove } from '@/composables/useLibraryMove.js'

/**
 * The desktop app's library: whether the projects are kept in a folder of
 * markdown files, in the app's data folder, and where that is. Either way
 * the switch goes, the projects are moved, with a toast that says how far
 * they are (`useLibraryMove`), and the app opens again on them. The button
 * that shows the folder sits with the backup buttons, in DataSection.
 */

const confirm = useConfirm()
const { moveIn, moveOut } = useLibraryMove()
const enabled = ref(false)
const path = ref('')

onMounted(async () => {
  try {
    const settings = await librarySettings()
    enabled.value = settings.enabled
    path.value = settings.path
  } catch (error) {
    console.error('Where the library is could not be read:', error)
  }
})

/**
 * Show the switch the way it is going while the projects move, and put it
 * back if they could not be.
 * @param {boolean} on
 * @param {() => Promise<boolean>} move
 */
const turnTo = async (on, move) => {
  enabled.value = on
  if (!(await move())) enabled.value = !on
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
      accept: () => turnTo(true, moveIn),
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
    accept: () => turnTo(false, moveOut),
  })
}
</script>
