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

    <!-- The recent projects in a list of their own beside the menu, which
         scrolls where it has no room, so what comes after them is never below
         it. -->
    <TieredMenu
      id="project_menu"
      ref="menu"
      :model="items"
      :popup="true"
      :pt="{
        ...hoverSubmenus,
        submenu: { class: 'w-72 max-w-[calc(100vw-2rem)] max-h-[50vh] overflow-y-auto' },
      }"
    >
      <template #item="{ item, hasSubmenu, props: link }">
        <a
          v-bind="link.action"
          :aria-current="item.open || undefined"
          @contextmenu="item.storyId && showProjectMenu($event, item.storyId)"
          @touchstart.passive="item.storyId && pressOn($event, item.storyId)"
          @touchmove.passive="press.touchmove"
          @touchend="press.touchend"
          @touchcancel="press.touchend"
        >
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
    <ContextMenu ref="projectMenu" :model="projectMenuItems" @hide="returnFocus" />
    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json,application/zip,.zip,.scriv"
      class="hidden"
      @change="importChosen"
    />
    <NewProjectDialog v-model:visible="showCreateDialog" @create="create" />
    <ProjectsDialog
      ref="projectsDialog"
      v-model:visible="showProjects"
      :story-id="storyId"
      @project-menu="showProjectMenu"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import ContextMenu from 'primevue/contextmenu'
import TieredMenu from 'primevue/tieredmenu'
import HeaderButton from '../layout/HeaderButton.vue'
import NewProjectDialog from './NewProjectDialog.vue'
import ProjectsDialog from './ProjectsDialog.vue'
import { useHoverSubmenus } from '@/composables/useHoverSubmenus.js'
import { useLongPress } from '@/composables/useLongPress.js'
import { useProjectActions } from '@/composables/useProjectActions.js'
import { useProjects } from '@/composables/useProjects'
import { useReactiveTime } from '@/composables/useReactiveTime'
import { useToast } from '@/composables/useToast'
import { recentProjects } from '@/utils/projectList.js'
import { isDesktop } from '@/platform/desktop.js'

/**
 * The projects, from a menu at the top of the outline: Recent projects for
 * those edited last, the one open checked and each with when it was last
 * edited, or that it is open in another window; Switch project for all of them
 * in a table; a new one or one imported from a file; in the desktop app a new
 * window; then what the outline does to the one open.
 *
 * Picked with Command or Ctrl held, a project opens in a new window (a new
 * tab in a browser). One open in another window is shown there. Right-clicked
 * or held under a finger, in either list, a project has its own menu: the
 * outline's for the one open, and the same for another, without opening it.
 *
 * @typedef {Object} Props
 * @property {string} storyId - The project open
 * @property {Array<Object>} [projectItems] - Menu items for the project open: its settings, an export, a delete
 */
const props = defineProps({
  storyId: { type: String, required: true },
  projectItems: { type: Array, default: () => [] },
})

/** How many projects Recent projects lists. */
const RECENT = 8

const projects = useProjects()
const projectActions = useProjectActions()
const toast = useToast()
const { formatRelativeTime } = useReactiveTime()

/** @type {import('vue').Ref<any>} */
const menu = ref(null)
/** @type {import('vue').Ref<HTMLInputElement|null>} */
const fileInput = ref(null)
const showCreateDialog = ref(false)
const showProjects = ref(false)
const isImporting = ref(false)

const hoverSubmenus = useHoverSubmenus(menu)

/** @type {import('vue').Ref<any>} */
const projectMenu = ref(null)
/** @type {import('vue').Ref<Array<Object>>} */
const projectMenuItems = ref([])

/**
 * Open a project's own menu where the pointer is.
 * @param {Event|{pageX: number, pageY: number, stopPropagation: () => void, preventDefault: () => void}} event
 * @param {string} storyId
 */
const showProjectMenu = (event, storyId) => {
  projectMenuItems.value =
    storyId === props.storyId ? props.projectItems : projectActions.itemsFor(storyId)
  projectMenu.value?.show(event)
}

/** @type {import('vue').Ref<any>} */
const projectsDialog = ref(null)

/**
 * A project's menu shut gives the focus back to the list it was opened from,
 * for the keys to go on working there: the next Escape shuts that too. An item
 * that opens something takes the focus on from here.
 */
const returnFocus = () => {
  if (showProjects.value) projectsDialog.value?.focusSearch?.()
  else if (menu.value?.visible) menu.value.menubar?.focus()
}

/** The project a finger went down on. */
let pressedOn = ''

const press = useLongPress(
  ({ x, y }) =>
    showProjectMenu(
      {
        pageX: x + window.scrollX,
        pageY: y + window.scrollY,
        stopPropagation() {},
        preventDefault() {},
      },
      pressedOn
    ),
  () => projectMenu.value?.hide()
)

/**
 * @param {TouchEvent} event
 * @param {string} storyId
 */
const pressOn = (event, storyId) => {
  pressedOn = storyId
  press.touchstart(event)
}

const recent = computed(() =>
  recentProjects(projects.rows.value, RECENT).map(row => {
    const open = row.id === props.storyId
    const away = projects.elsewhere.value.has(row.id)
    return {
      label: row.name,
      detail: away ? 'Open in another window' : row.edited ? formatRelativeTime(row.edited) : '',
      icon: away ? 'pi pi-clone' : undefined,
      open,
      storyId: row.id,
      /** @param {{originalEvent?: Event}} [event] */
      command: event => {
        if (!open) projects.pick(row.id, event?.originalEvent)
      },
    }
  })
)

const items = computed(() => [
  { label: 'Recent projects', icon: 'pi pi-history', items: recent.value },
  {
    label: 'Switch project…',
    icon: 'pi pi-book',
    command: () => {
      showProjects.value = true
    },
  },
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
