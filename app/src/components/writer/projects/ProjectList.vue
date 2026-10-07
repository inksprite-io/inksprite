<template>
  <div class="w-full h-full flex flex-col p-2 px-2">
    <div class="flex items-center justify-between px-2">
      <h3 class="text-xl font-semibold text-surface-700 dark:text-surface-200">Projects</h3>
      <div class="flex items-center">
        <!-- Import a project exported from a project's menu -->
        <Button
          v-tooltip.bottom="'Import a project'"
          type="button"
          icon="pi pi-upload"
          severity="secondary"
          size="small"
          rounded
          class="!bg-transparent !border-transparent hover:!bg-surface-700"
          aria-label="Import a project"
          :loading="isImporting"
          @click="fileInput?.click()"
        />
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
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json"
      class="hidden"
      @change="handleImportFile"
    />

    <ScrollPanel class="flex-1 overflow-auto">
      <div v-if="sorted.length > 0" class="flex flex-col gap-2 py-2">
        <ProjectCard
          v-for="story in sorted"
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
        <p class="text-sm text-center">No projects yet</p>
      </div>
    </ScrollPanel>

    <NewProjectDialog v-model:visible="showCreateDialog" @create="handleCreate" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import Button from 'primevue/button'
import ScrollPanel from 'primevue/scrollpanel'
import NewProjectDialog from './NewProjectDialog.vue'
import ProjectCard from './ProjectCard.vue'
import { useBackup } from '@/composables/useBackup'
import { useProjects } from '@/composables/useProjects'
import { useToast } from '@/composables/useToast'

/**
 * Every project, by name, with the one open marked.
 *
 * @typedef {Object} Props
 * @property {string} [storyId] - The project open, if any
 */
defineProps({
  storyId: { type: String, default: '' },
})

const projects = useProjects()
const backup = useBackup()
const toast = useToast()

/**
 * By name, so a project stays where the writer last saw it: ordered by when
 * each was last worked on, the one being written in jumped to the top on every
 * save. Numbers count as numbers ("Draft 2" before "Draft 10"), case and accents
 * are ignored, and two projects of one name keep a fixed order between them.
 */
const sorted = computed(() =>
  [...projects.projects.value].sort(
    (a, b) =>
      projects
        .nameOf(a.id)
        .localeCompare(projects.nameOf(b.id), undefined, { numeric: true, sensitivity: 'base' }) ||
      a.id.localeCompare(b.id)
  )
)

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

/** @type {import('vue').Ref<HTMLInputElement|null>} */
const fileInput = ref(null)
const isImporting = ref(false)

/**
 * Add a project file beside the others and open it.
 * @param {Event} event
 */
const handleImportFile = async event => {
  const input = /** @type {HTMLInputElement} */ (event.target)
  const file = input.files?.[0]
  // Reset immediately so picking the same file again still fires a change.
  input.value = ''
  if (!file) return

  isImporting.value = true
  try {
    const story = await backup.importProject(await backup.readProjectFile(file))
    toast.success(`Imported "${projects.nameOf(story.id)}"`)
    projects.open(story.id)
  } catch (error) {
    console.error('Project import failed:', error)
    toast.error(error.message)
  } finally {
    isImporting.value = false
  }
}

onMounted(() => projects.init())
</script>
