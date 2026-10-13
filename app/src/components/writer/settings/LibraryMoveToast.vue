<template>
  <!-- A toast at the top right, where the others are, that shuts the page
       while the projects move. Shown as a modal dialog, it is in the top
       layer, over everything, and the rest of the page is inert under it. -->
  <dialog
    ref="dialog"
    class="fixed inset-auto top-5 right-5 m-0 p-3 w-[25rem] max-w-[calc(100vw-2.5rem)] rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-900 text-surface-800 dark:text-surface-100 shadow-lg outline-none backdrop:bg-black/20"
    aria-labelledby="library-move-title"
    data-library-move
    @cancel.prevent
    @close="keepOpen"
  >
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <i class="pi pi-folder text-surface-500 dark:text-surface-400" />
        <span id="library-move-title" class="text-sm font-semibold">
          Moving projects into a folder
        </span>
      </div>
      <div
        v-if="state.progress"
        class="flex min-w-0 text-xs text-surface-500 dark:text-surface-400"
        data-library-move-project
      >
        <span class="truncate">{{ state.progress.title }}</span>
        <span v-if="state.progress.count > 1" class="flex-none whitespace-pre">
          · {{ state.progress.index + 1 }} of {{ state.progress.count }}</span
        >
      </div>
      <ProgressBar
        :mode="state.progress ? 'determinate' : 'indeterminate'"
        :value="Math.round((state.progress?.fraction ?? 0) * 100)"
        :show-value="false"
        style="height: 4px"
      />
    </div>
  </dialog>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue'
import ProgressBar from 'primevue/progressbar'
import { useLibraryMove } from '@/composables/useLibraryMove.js'

/**
 * How far the projects are, on their way into the folder they are kept in:
 * the project going, and how much of them all is there.
 */

const { state } = useLibraryMove()
const dialog = ref(/** @type {HTMLDialogElement|null} */ (null))

/** @param {boolean} moving */
const show = moving => {
  const element = dialog.value
  if (!element) return
  if (moving && !element.open) element.showModal()
  else if (!moving && element.open) element.close()
}

// Escape is not let close it. A browser closes it all the same at the
// second Escape, so it opens again for as long as the projects are moving.
const keepOpen = () => show(state.moving)

onMounted(() => show(state.moving))
watch(() => state.moving, show)
</script>
