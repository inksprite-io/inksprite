<template>
  <div class="flex items-center">
    <HeaderButton
      icon="pi pi-bars"
      label="Projects"
      :loading="isImporting"
      aria-haspopup="true"
      aria-controls="project_menu"
      data-action="projects"
      @click="menu?.toggle($event)"
    />

    <!-- The projects in a list of their own beside the menu, which scrolls
         when there are many, so what comes after them is never below it. -->
    <TieredMenu
      id="project_menu"
      ref="menu"
      :model="items"
      :popup="true"
      :pt="{ submenu: { class: 'w-72 max-w-[calc(100vw-2rem)] max-h-[50vh] overflow-y-auto' } }"
    >
      <template #item="{ item, hasSubmenu, props: link }">
        <a v-bind="link.action" :aria-current="item.open || undefined">
          <span
            class="pi pi-fw shrink-0 self-start mt-0.5"
            :class="item.icon || (item.open && 'pi-check')"
          />
          <span class="flex flex-col min-w-0">
            <span class="truncate" :class="{ 'font-semibold': item.open }">{{ item.label }}</span>
            <span v-if="item.edited" class="text-xs text-surface-500 dark:text-surface-400">
              {{ item.edited }}
            </span>
          </span>
          <i v-if="hasSubmenu" class="pi pi-angle-right" v-bind="link.submenuicon" />
        </a>
      </template>
    </TieredMenu>
    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json,application/zip,.zip,.scriv"
      class="hidden"
      @change="importChosen"
    />
    <NewProjectDialog v-model:visible="showCreateDialog" @create="create" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import TieredMenu from 'primevue/tieredmenu'
import HeaderButton from '../layout/HeaderButton.vue'
import NewProjectDialog from './NewProjectDialog.vue'
import { useProjects } from '@/composables/useProjects'
import { useReactiveTime } from '@/composables/useReactiveTime'
import { useToast } from '@/composables/useToast'
import { compareNames } from '@/utils/compareNames.js'

/**
 * The projects, from a menu at the top of the outline: Switch project for every
 * one by name, the one open checked and each with when it was last edited; a
 * new one or one imported from a file; then what the outline does to the one
 * open.
 *
 * @typedef {Object} Props
 * @property {string} storyId - The project open
 * @property {Array<Object>} [projectItems] - Menu items for the project open: its settings, an export, a delete
 */
const props = defineProps({
  storyId: { type: String, required: true },
  projectItems: { type: Array, default: () => [] },
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
    (a, b) => compareNames(projects.nameOf(a.id), projects.nameOf(b.id)) || a.id.localeCompare(b.id)
  )
)

const listed = computed(() =>
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

const items = computed(() => [
  { label: 'Switch project', icon: 'pi pi-book', items: listed.value },
  {
    label: 'New project…',
    icon: 'pi pi-plus',
    command: () => {
      showCreateDialog.value = true
    },
  },
  { label: 'Import project…', icon: 'pi pi-upload', command: () => fileInput.value?.click() },
  ...(props.projectItems.length > 0 ? [{ separator: true }, ...props.projectItems] : []),
])

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
