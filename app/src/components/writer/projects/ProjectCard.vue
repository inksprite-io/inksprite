<template>
  <div
    class="bg-surface-0 dark:bg-surface-900 shadow-sm p-3 rounded-lg flex flex-col gap-1 cursor-pointer hover:shadow-md transition-shadow duration-200 relative"
    :class="{ 'ring-2 ring-primary-400 dark:ring-primary-500': active }"
    @click="handleClick"
    @contextmenu.prevent="openMenu"
  >
    <!-- On a phone only, as on the outline's rows: everywhere else the menu is
         on right-click, and a phone has none. -->
    <Button
      v-if="isMobile"
      type="button"
      icon="pi pi-ellipsis-v"
      :aria-controls="`project_menu_${storyId}`"
      aria-label="Project actions"
      class="!absolute top-2 right-2 z-10"
      severity="secondary"
      text
      rounded
      size="small"
      @click.stop="toggleMenu"
    />
    <Menu
      :id="`project_menu_${storyId}`"
      ref="menu"
      :model="menuItems"
      :popup="true"
      @hide="onMenuHide"
    />
    <ProjectDialog v-model:visible="showSettings" :story-id="storyId" />

    <div class="flex flex-col gap-1" :class="{ 'pr-8': isMobile }">
      <div
        v-if="!isEditing"
        class="text-sm font-medium text-surface-900 dark:text-surface-0 truncate"
      >
        {{ title }}
      </div>
      <InputText
        v-else
        ref="titleInput"
        v-model="editedTitle"
        class="text-base"
        size="small"
        :autofocus="true"
        @keyup.enter="saveTitle"
        @keyup.escape="cancelEdit"
        @blur="saveTitle"
        @click.stop
        @contextmenu.stop
      />
      <div class="text-xs text-surface-500 dark:text-surface-500">
        {{ formatRelativeTime(updated) }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useConfirm } from 'primevue/useconfirm'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Menu from 'primevue/menu'
import ProjectDialog from '@/components/writer/tree/ProjectDialog.vue'
import { useBackup } from '@/composables/useBackup'
import { useProjects } from '@/composables/useProjects'
import { useReactiveTime } from '@/composables/useReactiveTime'
import { useScreenSize } from '@/composables/useScreenSize'
import { useToast } from '@/composables/useToast'

/**
 * One project in the list: its name, when it was last worked on, and what can
 * be done to it.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string} title
 * @property {number} updated - When the project was last worked on
 * @property {boolean} [active] - Whether this is the project open
 * @property {boolean} [isAnyMenuOpen] - Whether a menu is open somewhere in the list
 */
const props = defineProps({
  storyId: { type: String, required: true },
  title: { type: String, required: true },
  updated: { type: Number, required: true },
  active: { type: Boolean, default: false },
  isAnyMenuOpen: { type: Boolean, default: false },
})

const emit = defineEmits(['menu-open', 'menu-closed'])

const router = useRouter()
const confirm = useConfirm()
const projects = useProjects()
const backup = useBackup()
const toast = useToast()
const { formatRelativeTime } = useReactiveTime()
const { isMobile } = useScreenSize()

const menu = ref()
const titleInput = ref()
const isEditing = ref(false)
const editedTitle = ref(props.title)
const showSettings = ref(false)

// A click that closes the menu, or lands just after it closed, is not a click
// on the card.
const menuOpen = ref(false)
const closing = ref(false)

const menuItems = computed(() => [
  {
    label: 'Project settings',
    icon: 'pi pi-cog',
    command: () => {
      showSettings.value = true
    },
  },
  {
    label: 'Rename',
    icon: 'pi pi-pencil',
    command: async () => {
      isEditing.value = true
      editedTitle.value = props.title
      await nextTick()
      titleInput.value?.$el?.focus()
    },
  },
  { label: 'Export', icon: 'pi pi-download', command: () => exportProject() },
  { label: 'Delete', icon: 'pi pi-trash', command: () => confirmDelete() },
])

/** @param {Event} event */
const toggleMenu = event => {
  if (menuOpen.value) {
    menu.value?.hide()
    return
  }
  menu.value?.show(event)
  menuOpen.value = true
  emit('menu-open')
}

/** The card's actions, at the pointer. @param {Event} event */
const openMenu = event => {
  if (!menuOpen.value) toggleMenu(event)
}

const onMenuHide = () => {
  if (!menuOpen.value) return
  menuOpen.value = false
  closing.value = true
  setTimeout(() => {
    closing.value = false
    emit('menu-closed')
  }, 300)
}

const handleClick = () => {
  if (
    menuOpen.value ||
    closing.value ||
    props.isAnyMenuOpen ||
    isEditing.value ||
    showSettings.value
  ) {
    return
  }
  projects.open(props.storyId)
}

const saveTitle = async () => {
  const title = editedTitle.value.trim()
  if (title && title !== props.title) {
    try {
      await projects.rename(props.storyId, title)
    } catch (error) {
      console.error('Rename failed', error)
      editedTitle.value = props.title
    }
  }
  isEditing.value = false
}

const cancelEdit = () => {
  editedTitle.value = props.title
  isEditing.value = false
}

/** Save the project, with its chats, to a file of its own. */
const exportProject = async () => {
  try {
    const { filename } = await backup.downloadProject(props.storyId)
    toast.success(`Saved ${filename}`)
  } catch (error) {
    console.error('Project export failed:', error)
    toast.error(`Export failed: ${error.message}`)
  }
}

const confirmDelete = () => {
  confirm.require({
    message: `Are you sure you want to delete "${props.title}"? This action cannot be undone.`,
    header: 'Delete Project',
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: async () => {
      try {
        await projects.remove(props.storyId)
        // The project on screen is gone; the root route finds the next one.
        if (props.active) router.push('/')
      } catch (error) {
        console.error('Delete failed', error)
      }
    },
  })
}
</script>
