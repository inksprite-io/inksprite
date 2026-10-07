<template>
  <main class="h-full w-full flex items-center justify-center bg-surface-0 dark:bg-surface-900 p-4">
    <div class="text-center">
      <i class="pi pi-book text-6xl text-surface-400 mb-4"></i>
      <h2 class="text-2xl font-semibold text-surface-700 dark:text-surface-200">No project open</h2>
      <div class="mt-4 flex flex-wrap justify-center gap-2">
        <Button
          label="New project"
          icon="pi pi-plus"
          size="small"
          data-action="new-project"
          @click="showCreateDialog = true"
        />
        <Button
          label="Import project"
          icon="pi pi-upload"
          size="small"
          severity="secondary"
          :loading="isImporting"
          data-action="import-project"
          @click="fileInput?.click()"
        />
      </div>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json"
      class="hidden"
      @change="importChosen"
    />
    <NewProjectDialog v-model:visible="showCreateDialog" @create="projects.create($event.title)" />
  </main>
</template>

<script setup>
import { ref } from 'vue'
import Button from 'primevue/button'
import NewProjectDialog from '../projects/NewProjectDialog.vue'
import { useProjects } from '@/composables/useProjects'
import { useToast } from '@/composables/useToast'

/**
 * The writer with no project open: what they see on first launch, and after
 * deleting the last project. There are none to switch to, so the only things
 * to do are to start one or bring one in from a file.
 */
const projects = useProjects()
const toast = useToast()
const showCreateDialog = ref(false)

/** @type {import('vue').Ref<HTMLInputElement|null>} */
const fileInput = ref(null)
const isImporting = ref(false)

/** @param {Event} event */
const importChosen = async event => {
  const input = /** @type {HTMLInputElement} */ (event.target)
  const file = input.files?.[0]
  // Reset immediately so picking the same file again still fires a change.
  input.value = ''
  if (!file) return

  isImporting.value = true
  try {
    const story = await projects.importFile(file)
    toast.success(`Imported "${projects.nameOf(story.id)}"`)
  } catch (error) {
    console.error('Project import failed:', error)
    toast.error(error.message)
  } finally {
    isImporting.value = false
  }
}
</script>
