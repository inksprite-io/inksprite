<template>
  <div class="h-full flex bg-surface-50 dark:bg-surface-950">
    <div
      class="w-72 shrink-0 h-full overflow-hidden bg-surface-100 dark:bg-surface-800 border-r border-surface-200 dark:border-surface-700"
    >
      <ProjectList />
    </div>

    <main
      class="flex-1 min-w-0 flex items-center justify-center bg-surface-0 dark:bg-surface-900 p-4"
    >
      <div class="text-center">
        <i class="pi pi-book text-6xl text-surface-400 mb-4"></i>
        <h2 class="text-2xl font-semibold text-surface-700 dark:text-surface-200">
          No project open
        </h2>
        <p class="text-surface-500 dark:text-surface-400 mt-2">
          Start one here, or pick one from the list.
        </p>
        <Button
          label="New project"
          icon="pi pi-plus"
          class="mt-4"
          size="small"
          @click="showCreateDialog = true"
        />
      </div>
    </main>

    <NewProjectDialog v-model:visible="showCreateDialog" @create="projects.create($event.title)" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import Button from 'primevue/button'
import NewProjectDialog from '../projects/NewProjectDialog.vue'
import ProjectList from '../projects/ProjectList.vue'
import { useProjects } from '@/composables/useProjects'

/**
 * The desktop with no project open: the list, and room to say so. What the
 * writer sees on first launch, and after deleting the last project.
 */
const projects = useProjects()
const showCreateDialog = ref(false)
</script>
