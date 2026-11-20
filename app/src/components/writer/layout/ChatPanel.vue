<template>
  <div
    class="h-full w-full min-w-0 flex flex-col bg-surface-0 dark:bg-surface-850"
    data-panel="chat"
  >
    <!-- The chats open, as the editor's documents are. Before them, the
         editor's toggle beside an editor, or on a phone the way back to the
         list behind the panel; after them, finding in the chat showing, a
         new terminal where there are terminals, and a new chat. -->
    <TabStrip
      :items="items"
      :active-id="activeId"
      :actions="tabActions"
      @activate="showTab"
      @close="chatTabs.close"
    >
      <template v-if="showBack || editorShowing !== null" #start>
        <HeaderButton
          v-if="showBack"
          icon="pi pi-chevron-left"
          label="Back"
          data-action="back"
          @click="$emit('back')"
        />
        <PanelToggle
          v-else
          panel="editor"
          side="left"
          :showing="Boolean(editorShowing)"
          @toggle="$emit('toggle-editor')"
        />
      </template>
      <template #end>
        <!-- Finding in the chat, which the browser's find cannot do for the
             turns not in the page. A chat not started has nothing to find. -->
        <HeaderButton
          v-if="activeId && !isTerminalId(activeId) && !chatsApi.isUnstarted(activeId)"
          icon="pi pi-search"
          label="Find in chat"
          data-action="find"
          @click="chat?.openFind()"
        />
        <HeaderButton
          v-if="terminalsOffered"
          label="New terminal"
          data-action="new-terminal"
          @click="openTerminal"
        >
          <TerminalIcon style="font-size: 0.85rem" />
        </HeaderButton>
        <HeaderButton icon="pi pi-plus" label="New chat" @click="chatTabs.openNew()" />
      </template>
    </TabStrip>
    <!-- Nothing until the chats have loaded, when the unstarted chat would
         only flash before the saved one took over. Keyed on the chat, so a
         tab brought forward is a chat of its own. One sent in is in the
         strip from then on: the unstarted chat shown for want of anything
         open is not until it is used. -->
    <Chat
      v-if="ready && activeId && !isTerminalId(activeId)"
      ref="chat"
      :key="`chat:${activeId}`"
      :story-id="storyId"
      :chat-id="activeId"
      class="flex-1 min-h-0 w-full"
      @open-chat="showChat"
      @sent="chatTabs.open"
    />
    <!-- The terminals open, each kept behind the tab showing, so that going
         back to one is at once. -->
    <TerminalFrame
      v-for="id in terminalIds"
      v-show="id === activeId"
      :key="id"
      :ref="frame => keepFrame(id, frame)"
      :terminal-id="id"
      :active="id === activeId"
      class="flex-1 w-full"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import Chat from '../chats/Chat.vue'
import HeaderButton from './HeaderButton.vue'
import PanelToggle from './PanelToggle.vue'
import TabStrip from './TabStrip.vue'
import TerminalFrame from '../terminal/TerminalFrame.vue'
import TerminalIcon from '../terminal/TerminalIcon.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { useBackup } from '@/composables/useBackup'
import { isWorking } from '@/composables/useChatActivity.js'
import { useChats } from '@/composables/useChats'
import { useChatTabs } from '@/composables/useChatTabs.js'
import { useProfiles } from '@/composables/useProfiles'
import { onTerminalEnded, useTerminals } from '@/composables/useTerminals.js'
import { useToast } from '@/composables/useToast'
import { hasTerminal, isTerminalId } from '@/platform/terminal.js'
import { shownChatTitle } from '@/utils/chatTitle.js'

/**
 * The conversation panel: the project's chats open in tabs, and the one
 * showing under them. Which are open is the project's (`useChatTabs`); the
 * strip is never empty, since with nothing open it shows the unstarted chat.
 * In the desktop app, with the Terminal extension on, a tab may be a terminal
 * instead (`useTerminals`).
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {boolean|null} [editorShowing] - Whether the editor is showing
 *   beside this panel, for the toggle at the start of the strip that hides
 *   and shows it. Null where there is no editor beside it to toggle, and then
 *   there is no toggle.
 * @property {boolean} [showBack] - Whether the strip starts with a way back
 *   to the list of chats, where the list is behind this panel: on a phone.
 */
const props = defineProps({
  storyId: { type: String, required: true },
  editorShowing: { type: [Boolean, null], default: null },
  showBack: { type: Boolean, default: false },
})

defineEmits(['toggle-editor', 'back'])

const chatsApi = useChats(props.storyId)
const chatTabs = useChatTabs(props.storyId)
const terminals = useTerminals()
const applicationState = useApplicationState()
const profilesApi = useProfiles()
const backup = useBackup()
const toast = useToast()

const ready = ref(false)

/** @type {import('vue').Ref<{ openFind: () => boolean, send: (text: string) => unknown, focusMessage: () => void }|null>} */
const chat = ref(null)

/**
 * Show a chat the one showing asked for, a fork, in a tab beside it, and
 * once it is showing send what its /fork brought there, or put the caret in
 * its box for the writer to say something.
 *
 * @param {{chatId: string, send?: string}} asked
 */
const showChat = async ({ chatId, send }) => {
  chatTabs.open(chatId)
  await nextTick()
  if (send) chat.value?.send(send)
  else chat.value?.focusMessage()
}

const activeId = computed(() => chatTabs.activeId.value)

/** Whether a new terminal is offered: in the desktop app, with its extension on. */
const terminalsOffered = computed(() => hasTerminal() && applicationState.terminal.value)

/** The tabs that are terminals of this window's, in strip order. */
const terminalIds = computed(() => chatTabs.tabs.value.open.filter(id => terminals.has(id)))

/**
 * The terminals' frames, by their ids, to put the keys in.
 * @type {Map<string, {focus: () => void}>}
 */
const frames = new Map()

/**
 * @param {string} id
 * @param {any} frame - The frame's component, or null once it is gone
 */
const keepFrame = (id, frame) => {
  if (frame) frames.set(id, frame)
  else frames.delete(id)
}

/**
 * Show a tab the strip was clicked on. A terminal's takes the keys, whether
 * or not it was already the one showing.
 *
 * @param {string} id
 */
const showTab = async id => {
  chatTabs.open(id)
  if (!isTerminalId(id)) return
  await nextTick()
  frames.get(id)?.focus()
}

/** Make a terminal, in a tab beside the one showing. */
const openTerminal = async () => {
  try {
    await chatTabs.openTerminal()
  } catch (error) {
    console.error('A terminal could not be made:', error)
    toast.error('The terminal couldn’t be opened.')
  }
}

// The keys asked for in the tab showing, which a key brought forward
// (`useMenuCommands`), once it is the one in the panel: the caret in a
// chat's message box, or a terminal taking them.
watch(chatTabs.focusAsked, async () => {
  await nextTick()
  const id = activeId.value
  if (isTerminalId(id)) frames.get(id)?.focus()
  else chat.value?.focusMessage()
})

/**
 * A tab's chat: one of the project's, or the unstarted one's settings.
 * @param {string} chatId
 */
const chatOf = chatId =>
  chatsApi.isUnstarted(chatId) ? chatsApi.unstartedChat.value : chatsApi.getChatById(chatId)

/**
 * The name of the profile a chat runs on, which the header showed before the
 * chat had tabs and the tab's tooltip says now.
 * @param {string} chatId
 */
const profileName = chatId =>
  (
    profilesApi.getProfile(chatOf(chatId)?.profileId) ??
    profilesApi.getProfile(chatsApi.defaultProfileId())
  )?.name

const items = computed(() => {
  return chatTabs.tabs.value.open.map(id => {
    if (isTerminalId(id)) {
      const title = terminals.get(id)?.title || 'Terminal'
      return { id, title, terminal: true, mark: terminals.rang(id) ? 'unread' : undefined }
    }
    const title = shownChatTitle(chatOf(id)?.title)
    const profile = profileName(id)
    return {
      id,
      title,
      mark: isWorking(id) ? 'busy' : chatTabs.isUnread(id) ? 'unread' : undefined,
      tooltip: profile ? `${title} · ${profile}` : title,
    }
  })
})

/**
 * What a tab's right-click menu offers: closing it or the others, and for a
 * chat that has started, what the chat list offers for it. Closing a
 * terminal's tab ends its shell.
 * @param {string} chatId
 * @returns {import('primevue/menuitem').MenuItem[]}
 */
const tabActions = chatId => [
  { label: 'Close', icon: 'pi pi-times', command: () => chatTabs.close(chatId) },
  { label: 'Close others', command: () => chatTabs.closeOthers(chatId) },
  ...(isTerminalId(chatId) || chatsApi.isUnstarted(chatId)
    ? []
    : [
        { separator: true },
        { label: 'Export', icon: 'pi pi-download', command: () => exportChat(chatId) },
        { label: 'Delete', icon: 'pi pi-trash', command: () => chatsApi.trashChat(chatId) },
      ]),
]

/**
 * Save a chat to a file of its own. The download says it is saved.
 * @param {string} chatId
 */
const exportChat = async chatId => {
  try {
    await backup.downloadChat(chatId)
  } catch (error) {
    console.error('Chat export failed:', error)
    toast.error(`The chat couldn't be exported. ${error.message}`)
  }
}

// A terminal that rang is marked until it is the tab showing.
watchEffect(() => {
  const id = activeId.value
  if (id && terminals.rang(id)) terminals.seen(id)
})

// A shell that never started closes its tab, and here is why it went.
onBeforeUnmount(
  onTerminalEnded((_id, failed) => {
    if (failed) toast.error('The terminal couldn’t start.')
  })
)

onMounted(async () => {
  await chatsApi.init()
  ready.value = true
})
</script>
