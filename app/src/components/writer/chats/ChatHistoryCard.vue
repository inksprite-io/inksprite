<template>
  <div
    class="bg-surface-0 dark:bg-surface-900 shadow-sm p-3 rounded-lg flex flex-col gap-2 cursor-pointer hover:shadow-md transition-shadow duration-200 relative"
    :class="{ 'ring-2 ring-primary-400 dark:ring-primary-500': active }"
    @click="handleClick"
    @contextmenu="openContextMenu"
  >
    <div class="absolute top-2 right-2 z-10">
      <!-- Menu Button -->
      <Button
        type="button"
        icon="pi pi-ellipsis-v"
        :aria-controls="`chat_menu_${chatId}`"
        class="bg-surface-0/90 dark:bg-surface-900/90 backdrop-blur-md shadow-sm hover:shadow-md"
        severity="secondary"
        text
        rounded
        size="small"
        @click.stop="toggleMenu"
      />

      <!-- Menu -->
      <Menu
        :id="`chat_menu_${chatId}`"
        ref="menu"
        :model="menuItems"
        :popup="true"
        @hide="onMenuHide('button')"
      />
    </div>
    <!-- The same actions, at the pointer -->
    <ContextMenu ref="contextMenu" :model="menuItems" @hide="onMenuHide('context')" />

    <div class="flex flex-col gap-1 pr-8">
      <!-- Chat Title -->
      <div v-if="!isEditing" class="text-sm font-medium text-surface-900 dark:text-surface-0">
        {{ chat?.title || 'Untitled Chat' }}
      </div>
      <InputText
        v-else
        ref="titleInput"
        v-model="editedTitle"
        class="text-base"
        :autofocus="true"
        @keyup.enter="saveTitle"
        @keyup.escape="cancelEdit"
        @blur="saveTitle"
        @click.stop
        @contextmenu.stop
      />

      <!-- First Message Preview -->
      <div v-if="firstMessage" class="text-sm text-surface-600 dark:text-surface-400 line-clamp-2">
        {{ messagePreview }}
      </div>
      <div v-else class="text-sm text-surface-500 dark:text-surface-500 italic">
        No messages yet
      </div>

      <!-- Last Message Time -->
      <div class="text-xs text-surface-500 dark:text-surface-500 mt-1">
        {{ lastMessageTime }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { useConfirm } from 'primevue/useconfirm'
import Button from 'primevue/button'
import Menu from 'primevue/menu'
import ContextMenu from 'primevue/contextmenu'
import InputText from 'primevue/inputtext'
import { useApplicationState } from '@/composables/useApplicationState'
import { useChats } from '@/composables/useChats'
import { useReactiveTime } from '@/composables/useReactiveTime'

/**
 * @typedef {Object} Props
 * @property {string} chatId - The ID of the chat
 * @property {string} storyId - The ID of the story
 * @property {boolean} isAnyMenuOpen - Whether any menu is open globally
 */

/** @type {Props} */
const props = defineProps({
  chatId: {
    type: String,
    required: true,
  },
  storyId: {
    type: String,
    required: true,
  },
  isAnyMenuOpen: {
    type: Boolean,
    default: false,
  },
  /** Whether this is the chat open beside the list. */
  active: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['select', 'delete', 'export', 'menu-open', 'menu-closed'])

const { debug } = useApplicationState()

const confirm = useConfirm()
const chatsApi = useChats(props.storyId)
const { formatRelativeTime } = useReactiveTime()

const menu = ref()
const contextMenu = ref()
const titleInput = ref()
const isEditing = ref(false)
const editedTitle = ref('')
/**
 * Which of the card's two menus is up, if either. Recorded as it opens rather
 * than on `show`, which waits on the transition; a click in that gap would
 * otherwise read as a selection.
 *
 * @type {import('vue').Ref<'button'|'context'|null>}
 */
const openMenu = ref(null)
const isClosingMenu = ref(false)

// Get the chat data
const chat = computed(() => chatsApi.getChatById(props.chatId))

// Get messages for this chat - already a computed ref
const messages = chatsApi.getMessagesForChat(props.chatId)

// Get first message for preview
const firstMessage = computed(() => {
  const msgs = messages.value
  return msgs && msgs.length > 0 ? msgs[0] : null
})

// Format message preview
const messagePreview = computed(() => {
  if (!firstMessage.value) return ''
  const content = firstMessage.value.content
  // Strip HTML tags and truncate
  const text = content.replace(/<[^>]*>/g, '').trim()
  return text.length > 100 ? text.substring(0, 100) + '...' : text
})

// Format last message time - now reactive and will update automatically
const lastMessageTime = computed(() => {
  const msgs = messages.value
  // Get the last message's timestamp
  if (msgs && msgs.length > 0) {
    const lastMessage = msgs[msgs.length - 1]
    return formatRelativeTime(lastMessage.created)
  }
  // Fall back to chat creation time if no messages
  const chatData = chat.value
  if (chatData?.created) {
    return formatRelativeTime(chatData.created)
  }
  return 'Never'
})

const menuItems = computed(() => [
  {
    label: 'Rename',
    icon: 'pi pi-pencil',
    command: async () => {
      isEditing.value = true
      editedTitle.value = chat.value?.title || 'Untitled Chat'
      await nextTick()
      titleInput.value?.$el?.focus()
    },
  },
  {
    label: 'Export',
    icon: 'pi pi-download',
    command: () => emit('export', props.chatId),
  },
  // With its words taken out, for reporting a problem without sharing the
  // story. Offered only with the debug switch on: it is a tool for that.
  ...(debug.value
    ? [
        {
          label: 'Export obfuscated',
          icon: 'pi pi-eye-slash',
          command: () => emit('export', props.chatId, { obfuscated: true }),
        },
      ]
    : []),
  {
    separator: true,
  },
  {
    label: 'Delete',
    icon: 'pi pi-trash',
    command: () => {
      confirmDelete()
    },
  },
])

/**
 * Open one menu, closing the other if it is up. Only one is ever showing;
 * the `hide` the other fires on its way out is ignored by `onMenuHide` once
 * this one is on record.
 *
 * @param {'button'|'context'} which
 * @param {Event} event
 */
const showMenu = (which, event) => {
  if (openMenu.value === 'button') menu.value.hide()
  if (openMenu.value === 'context') contextMenu.value.hide()
  if (which === 'button') menu.value.show(event)
  else contextMenu.value.show(event)
  openMenu.value = which
  emit('menu-open')
}

/**
 * A menu has gone. The card stays unselectable for the length of the close
 * animation, so the click that dismissed it cannot also open the chat.
 */
const settle = () => {
  openMenu.value = null
  isClosingMenu.value = true
  setTimeout(() => {
    isClosingMenu.value = false
    emit('menu-closed')
  }, 300)
}

/** @param {Event} event */
const toggleMenu = event => {
  if (openMenu.value === 'button') {
    menu.value.hide()
    settle()
  } else {
    showMenu('button', event)
  }
}

/** @param {Event} event */
const openContextMenu = event => showMenu('context', event)

const handleClick = () => {
  if (openMenu.value || isClosingMenu.value || props.isAnyMenuOpen || isEditing.value) return
  emit('select', props.chatId)
}

const saveTitle = async () => {
  if (editedTitle.value && editedTitle.value !== chat.value?.title) {
    try {
      await chatsApi.updateChat(props.chatId, { title: editedTitle.value })
    } catch (e) {
      console.error('Rename failed', e)
      editedTitle.value = chat.value?.title || 'Untitled Chat'
    }
  }
  isEditing.value = false
}

const cancelEdit = () => {
  editedTitle.value = chat.value?.title || 'Untitled Chat'
  isEditing.value = false
}

/**
 * A menu closed on its own: a click elsewhere, or an item chosen.
 *
 * @param {'button'|'context'} which
 */
const onMenuHide = which => {
  if (openMenu.value === which) settle()
}

const confirmDelete = () => {
  confirm.require({
    message: `Are you sure you want to delete "${chat.value?.title || 'this chat'}"?`,
    header: 'Delete Chat',
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: () => {
      emit('delete', props.chatId)
    },
  })
}

onMounted(async () => {
  await chatsApi.init()
})
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
