<template>
  <div class="flex items-center">
    <HeaderButton
      icon="pi pi-bars"
      label="Projects"
      :loading="isImporting"
      aria-haspopup="true"
      aria-controls="project_menu"
      data-action="projects"
      @click="toggle"
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
            <span v-if="item.detail" class="text-xs text-surface-500 dark:text-surface-400">
              {{ item.detail }}
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
import { isDesktop } from '@/platform/desktop.js'

/**
 * The projects, from a menu at the top of the outline: Switch project for every
 * one by name, the one open checked and each with when it was last edited, or
 * that it is open in another window; a new one or one imported from a file;
 * in the desktop app a new window; then what the outline does to the one
 * open.
 *
 * Picked with Command or Ctrl held, a project opens in a new window (a new
 * tab in a browser). One open in another window is shown there.
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
    const away = projects.elsewhere.value.has(story.id)
    const edited = projects.editedOf(story.id)
    return {
      label: projects.nameOf(story.id),
      detail: away ? 'Open in another window' : edited ? formatRelativeTime(edited) : '',
      icon: away ? 'pi pi-clone' : undefined,
      open,
      /** @param {{originalEvent?: Event}} [event] */
      command: event => {
        if (open) return
        const mouse = /** @type {MouseEvent|undefined} */ (event?.originalEvent)
        if (mouse?.metaKey || mouse?.ctrlKey) projects.openInNewWindow(story.id)
        else projects.open(story.id)
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
  ...(isDesktop()
    ? [{ label: 'New window', icon: 'pi pi-clone', command: () => projects.openInNewWindow() }]
    : []),
  ...(props.projectItems.length > 0 ? [{ separator: true }, ...props.projectItems] : []),
])

/**
 * Open the menu, and read again what other windows may have changed: which
 * projects they have open, and the list itself.
 * @param {Event} event
 */
const toggle = event => {
  menu.value?.toggle(event)
  projects.lookElsewhere()
  projects.refresh()
}

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
    // It opens, which shows it came in.
    await projects.importFile(file)
  } catch (error) {
    console.error('Project import failed:', error)
    toast.error(error.message)
  } finally {
    isImporting.value = false
  }
}

onMounted(() => projects.init())
</script>
