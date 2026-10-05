<template>
  <div class="w-full h-full flex flex-col p-2 px-2">
    <div class="flex items-center justify-between px-2">
      <h3 class="text-xl font-semibold text-surface-700 dark:text-surface-200">Projects</h3>
      <Button
        v-tooltip.bottom="'New project'"
        type="button"
        icon="pi pi-plus"
        severity="secondary"
        size="small"
        rounded
        class="!bg-transparent !border-transparent hover:!bg-surface-700"
        aria-label="New project"
        @click="showCreateDialog = true"
      />
    </div>

    <ScrollPanel class="flex-1 overflow-auto">
      <div v-if="projects.projects.value.length > 0" class="flex flex-col gap-2 py-2">
        <ProjectCard
          v-for="story in projects.projects.value"
          :key="story.id"
          :story-id="story.id"
          :title="projects.nameOf(story.id)"
          :updated="story.updated"
          :active="story.id === storyId"
          :is-any-menu-open="isAnyMenuOpen"
          @menu-open="isAnyMenuOpen = true"
          @menu-closed="isAnyMenuOpen = false"
        />
      </div>
      <div
        v-else
        class="flex flex-col items-center justify-center h-full text-surface-400 dark:text-surface-500 p-4"
      >
        <i class="pi pi-book text-4xl mb-3 opacity-50"></i>
        <p class="text-sm text-center mb-3">No projects yet</p>
        <p class="text-xs text-center opacity-75">Start one to begin writing.</p>
      </div>
    </ScrollPanel>

    <!-- Where the old front page kept its help -->
    <nav class="flex flex-wrap gap-x-3 px-2 pt-2 text-xs text-surface-500 dark:text-surface-400">
      <a
        href="https://docs.inksprite.io/about"
        target="_blank"
        rel="noopener"
        class="hover:underline"
      >
        About
      </a>
    </nav>

    <NewProjectDialog v-model:visible="showCreateDialog" @create="handleCreate" />
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import Button from 'primevue/button'
import ScrollPanel from 'primevue/scrollpanel'
import NewProjectDialog from './NewProjectDialog.vue'
import ProjectCard from './ProjectCard.vue'
import { useProjects } from '@/composables/useProjects'

/**
 * Every project, most recently worked on first, with the one open marked.
 *
 * @typedef {Object} Props
 * @property {string} [storyId] - The project open, if any
 */
defineProps({
  storyId: { type: String, default: '' },
})

const projects = useProjects()

const showCreateDialog = ref(false)

// While a card's menu is open, a click anywhere in the list closes it rather
// than opening a project.
const isAnyMenuOpen = ref(false)

/** @param {{ title: string }} options */
const handleCreate = async ({ title }) => {
  try {
    await projects.create(title)
  } catch (error) {
    console.error('Error creating project:', error)
  }
}

onMounted(() => projects.init())
</script>
