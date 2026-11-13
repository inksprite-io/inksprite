/**
 * @module composables/useChatTabs
 * @description The chat panel's tabs in a project: which chats are open, in
 * strip order, which is showing, which is only being looked at, the order
 * they were shown in, and which the model finished in while they weren't
 * showing. Kept in the project's view beside the editor's tabs, under the
 * same rules (`utils/tabs.js`), so a project reopens on its chats.
 *
 * A chat opened from the chat list is a preview, as a document from the
 * outline is: the next one takes its tab, until the writer keeps it by
 * sending in it or double-clicking it. Anything else opens a kept tab beside
 * the one showing: a new chat, a fork, a chat started on a card. Closing the
 * tab showing goes back to the one shown before it.
 *
 * The strip is never empty. With nothing open it shows the unstarted chat,
 * which is written into the view only once it is used, so opening a chat
 * from the list then leaves no blank tab behind. There is only ever one
 * unstarted chat (`useChats`): New chat shows its tab, and its first message
 * makes it a chat under the same id, in the same tab.
 *
 * A chat the model stops working in while it isn't the tab showing is
 * marked unread until it is shown (`useChatActivity`). A turn that stops to
 * wait for the writer to allow a call has stopped working too.
 *
 * One instance per project, made in a scope of its own like `useAIChat`, so
 * the watch that clears what is read outlives the view that first asked.
 */
import { computed, effectScope, watch } from 'vue'
import { useChats } from './useChats.js'
import { onStoppedWorking } from './useChatActivity.js'
import { useProjectViewsStore } from '@/stores/projectViewsStore.js'
import {
  CHAT_TABS,
  NO_TABS,
  closeTab,
  dropTabs,
  keepTab,
  normalizeTabs,
  openTab,
  tabsOf,
  tabsPatch,
} from '@/utils/tabs.js'

/** @typedef {import('@/utils/tabs.js').Tabs} Tabs */

/**
 * @typedef {Object} ChatTabsApi
 * @property {import('vue').ComputedRef<Tabs>} tabs - What the strip shows
 * @property {import('vue').ComputedRef<string|null>} activeChatId - The chat showing
 * @property {(chatId: string, options?: {preview?: boolean}) => void} open - Show a
 *   chat: a preview from the chat list, otherwise a kept tab beside the one showing
 * @property {() => void} openNew - Show the unstarted chat
 * @property {(chatId: string) => void} keep - Keep a tab: one sent in, or double-clicked
 * @property {(chatId: string) => void} close
 * @property {(chatId: string) => void} closeOthers - Close every tab but this one
 * @property {(chatId: string) => boolean} isUnread - Whether the model finished in
 *   it while it wasn't showing
 * @property {(chatId: string) => void} markUnread - Mark it, unless it is showing
 */

/** @type {Map<string, ChatTabsApi>} */
const instances = new Map()

/** What stops the listener that marks chats unread, once it is listening. */
let stopListening = /** @type {(() => void)|null} */ (null)

/**
 * Forget every project's tabs, and stop listening (for testing).
 */
export const clearChatTabsInstances = () => {
  instances.clear()
  stopListening?.()
  stopListening = null
}

/**
 * A project's chat tabs: the one instance for it.
 *
 * @param {string} storyId
 * @returns {ChatTabsApi}
 */
export function useChatTabs(storyId) {
  let instance = instances.get(storyId)
  if (!instance) {
    instance = /** @type {ChatTabsApi} */ (effectScope(true).run(() => createChatTabs(storyId)))
    instances.set(storyId, instance)
  }
  // Any chat that stops working, in whichever project, is marked there.
  if (!stopListening) {
    stopListening = onStoppedWorking((inStory, chatId) => useChatTabs(inStory).markUnread(chatId))
  }
  return instance
}

/**
 * @param {string} storyId
 * @returns {ChatTabsApi}
 */
function createChatTabs(storyId) {
  const chatsApi = useChats(storyId)
  const views = useProjectViewsStore()

  /** @returns {Record<string, any>|undefined} */
  const view = () => views.getView(storyId)

  /**
   * Whether a tab's chat is there to show: one of the project's, or the
   * unstarted one.
   * @param {string} chatId
   */
  const canShow = chatId => chatsApi.isUnstarted(chatId) || Boolean(chatsApi.getChatById(chatId))

  /**
   * The tabs as kept, less any whose chat has gone. A project whose chats
   * were never in tabs opens on its latest chat, as the panel did before it
   * had them. Before the chats are loaded they are taken as stored.
   * @type {import('vue').ComputedRef<Tabs>}
   */
  const stored = computed(() => {
    const kept = view()
    const tabs = tabsOf(kept, CHAT_TABS)
    if (!chatsApi.ready.value) return tabs
    const latest = chatsApi.chats.value[0]
    if (!Array.isArray(kept?.[CHAT_TABS.open]) && latest) return openTab(NO_TABS, latest.id)
    return normalizeTabs(tabs, canShow)
  })

  /** @type {import('vue').ComputedRef<Tabs>} */
  const tabs = computed(() =>
    stored.value.active ? stored.value : openTab(NO_TABS, chatsApi.unstartedChat.value.id)
  )

  const activeChatId = computed(() => tabs.value.active)

  /** @param {Tabs} next */
  const write = next => {
    if (next !== stored.value) views.updateView(storyId, tabsPatch(next, CHAT_TABS))
  }

  /** @type {ChatTabsApi['open']} */
  const open = (chatId, { preview = false } = {}) =>
    write(openTab(stored.value, chatId, { preview, beside: !preview }))

  const openNew = () => open(chatsApi.unstartedChat.value.id)

  /** @type {ChatTabsApi['keep']} */
  const keep = chatId => {
    // The unstarted chat shown for want of anything open is written in now.
    if (!stored.value.open.includes(chatId)) open(chatId)
    else write(keepTab(stored.value, chatId))
  }

  /** @type {ChatTabsApi['close']} */
  const close = chatId => write(closeTab(stored.value, chatId))

  /** @type {ChatTabsApi['closeOthers']} */
  const closeOthers = chatId => {
    const showing = openTab(stored.value, chatId)
    write(
      dropTabs(
        showing,
        showing.open.filter(id => id !== chatId)
      )
    )
  }

  /** The chats marked unread, as kept. @returns {string[]} */
  const unreadIds = () => view()?.unreadChatIds ?? []

  /** @type {ChatTabsApi['isUnread']} */
  const isUnread = chatId => unreadIds().includes(chatId) && canShow(chatId)

  /** @type {ChatTabsApi['markUnread']} */
  const markUnread = chatId => {
    if (tabs.value.active === chatId || unreadIds().includes(chatId)) return
    views.updateView(storyId, { unreadChatIds: [...unreadIds(), chatId] })
  }

  // A chat is read once it is the tab showing.
  watch(
    () => tabs.value.active,
    chatId => {
      if (chatId && unreadIds().includes(chatId)) {
        views.updateView(storyId, { unreadChatIds: unreadIds().filter(id => id !== chatId) })
      }
    },
    { immediate: true }
  )

  return { tabs, activeChatId, open, openNew, keep, close, closeOthers, isUnread, markUnread }
}
