<template>
  <div class="flex items-center gap-1">
    <HeaderButton
      icon="pi pi-book"
      label="Projects"
      aria-haspopup="true"
      aria-controls="project_menu"
      data-action="projects"
      @click="menu?.toggle($event)"
    />
    <HeaderButton
      icon="pi pi-upload"
      label="Import a project"
      :loading="isImporting"
      data-action="import-project"
      @click="fileInput?.click()"
    />
    <HeaderButton
      icon="pi pi-plus"
      label="New project"
      data-action="new-project"
      @click="showCreateDialog = true"
    />

    <Menu
      id="project_menu"
      ref="menu"
      :model="items"
      :popup="true"
      :pt="{
        root: { class: 'w-72 max-w-[calc(100vw-2rem)]' },
        list: { class: 'max-h-[60vh] overflow-y-auto' },
      }"
    >
      <template #item="{ item, props: link }">
        <a v-bind="link.action" :aria-current="item.open || undefined">
          <span class="pi pi-fw shrink-0 self-start mt-0.5" :class="{ 'pi-check': item.open }" />
          <span class="flex flex-col min-w-0">
            <span class="truncate" :class="{ 'font-semibold': item.open }">{{ item.label }}</span>
            <span v-if="item.edited" class="text-xs text-surface-500 dark:text-surface-400">
              {{ item.edited }}
            </span>
          </span>
        </a>
      </template>
    </Menu>
    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json"
      class="hidden"
      @change="importChosen"
    />
    <NewProjectDialog v-model:visible="showCreateDialog" @create="create" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import Menu from 'primevue/menu'
import HeaderButton from '../layout/HeaderButton.vue'
import NewProjectDialog from './NewProjectDialog.vue'
import { useProjects } from '@/composables/useProjects'
import { useReactiveTime } from '@/composables/useReactiveTime'
import { useToast } from '@/composables/useToast'

/**
 * The projects, from the top of the outline: a picker of every one by name,
 * the one open checked and each with when it was last edited, and buttons to
 * start one or import one from a file.
 *
 * @typedef {Object} Props
 * @property {string} storyId - The project open
 */
const props = defineProps({
  storyId: { type: String, required: true },
})

const projects = useProjects()
const toast = useToast()
const { formatRelativeTime } = useReactiveTime()

/** @type {import('vue').Ref<any>} */
const menu = ref(null)
/** @type {import('vue').Ref<HTMLInputElement|null>} */
const fileInput = ref(null)
const showCreateDialog = ref(false)
const isImporting = ref(false)

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

const items = computed(() =>
  sorted.value.map(story => {
    const open = story.id === props.storyId
    const edited = projects.editedOf(story.id)
    return {
      label: projects.nameOf(story.id),
      edited: edited ? formatRelativeTime(edited) : '',
      open,
      command: () => {
        if (!open) projects.open(story.id)
      },
    }
  })
)

/** @param {{ title: string }} options */
const create = async ({ title }) => {
  try {
    await projects.create(title)
  } catch (error) {
    console.error('Error creating project:', error)
  }
}

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

onMounted(() => projects.init())
</script>
