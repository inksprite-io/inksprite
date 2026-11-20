/**
 * @module composables/useChatTabs
 * @description The chat panel's tabs in a project: which chats are open, in
 * strip order, which is showing, the order they were shown in, and which the
 * model finished in while they weren't showing. Kept in the project's view
 * beside the editor's tabs, under the same rules (`utils/tabs.js`), so a
 * project reopens on its chats.
 *
 * A chat opens in a tab of its own beside the one showing, and stays until
 * it is closed: one picked from the chat list, a new chat, a fork, a chat
 * started on a card. No chat is a preview, as a document from the outline
 * is. Closing the tab showing goes back to the one shown before it, and the
 * chat closed last can be opened again.
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
 * In the desktop app a tab may be a terminal instead (`useTerminals`), by an
 * id that says so. A terminal is the project's, as a chat is, so it
 * has a tab in whichever project the window shows, for as long as its shell
 * runs: closing the tab ends the shell, and the shell ending closes the tab.
 *
 * One instance per project, made in a scope of its own like `useAIChat`, so
 * the watch that clears what is read outlives the view that first asked.
 */
import { computed, effectScope, ref, watch } from 'vue'
import { useChats } from './useChats.js'
import { onStoppedWorking } from './useChatActivity.js'
import { onTerminalEnded, useTerminals } from './useTerminals.js'
import { isTerminalId } from '@/platform/terminal.js'
import { useProjectViewsStore } from '@/stores/projectViewsStore.js'
import { useSyncStore } from '@/stores/syncStore.js'
import {
  CHAT_TABS,
  NO_TABS,
  closeTab,
  closeTabs,
  dropTabs,
  lastClosed,
  normalizeTabs,
  openTab,
  tabsOf,
  tabsPatch,
} from '@/utils/tabs.js'

/** @typedef {import('@/utils/tabs.js').Tabs} Tabs */

/**
 * @typedef {Object} ChatTabsApi
 * @property {import('vue').ComputedRef<Tabs>} tabs - What the strip shows
 * @property {import('vue').ComputedRef<string|null>} activeId - The tab showing: a
 *   chat's id, or a terminal's
 * @property {import('vue').ComputedRef<string|null>} activeChatId - The chat showing,
 *   or with a terminal showing the chat shown before it
 * @property {(chatId: string) => void} open - Show a chat, in a tab beside the one
 *   showing unless it has one. The unstarted chat shown for want of anything
 *   open is written into the strip by it, as when it is sent in.
 * @property {() => void} openNew - Show the unstarted chat
 * @property {() => Promise<void>} openTerminal - Make a terminal, and show it
 * @property {(chatId: string) => void} close - Close a tab. A terminal's
 *   shell is ended with it.
 * @property {(chatId: string) => void} shut - Close a tab and no more, as for
 *   a terminal whose shell has ended
 * @property {() => void} reopen - Show again the chat whose tab was closed
 *   last, if it is still one of the project's
 * @property {(chatId: string) => void} closeOthers - Close every tab but this one
 * @property {() => void} focus - Put the caret in the message box of the chat
 *   showing, or the keys in the terminal showing, once the panel has it on
 *   screen
 * @property {import('vue').Ref<number>} focusAsked - Counts each time the caret is
 *   asked for, for the panel to watch
 * @property {(chatId: string) => boolean} isUnread - Whether the model finished in
 *   it while it wasn't showing
 * @property {(chatId: string) => void} markUnread - Mark it, unless it is showing
 */

/** @type {Map<string, ChatTabsApi>} */
const instances = new Map()

/** What stops the listeners that mark chats unread and close terminals' tabs, once they are listening. */
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
  // Any chat that stops working, in whichever project, is marked there. A
  // terminal that is gone loses its tab in its project.
  if (!stopListening) {
    const stops = [
      onStoppedWorking((inStory, chatId) => useChatTabs(inStory).markUnread(chatId)),
      onTerminalEnded((id, inStory) => instances.get(inStory)?.shut(id)),
    ]
    stopListening = () => stops.forEach(stop => stop())
  }
  return instance
}

/**
 * @param {string} storyId
 * @returns {ChatTabsApi}
 */
function createChatTabs(storyId) {
  const chatsApi = useChats(storyId)
  const terminals = useTerminals()
  const views = useProjectViewsStore()

  /** @returns {Record<string, any>|undefined} */
  const view = () => views.getView(storyId)

  /**
   * Whether a tab's chat is there to show: one of the project's, or the
   * unstarted one. A terminal's tab is there while its shell runs, in this
   * project, and until the terminals there are are known is taken as stored.
   * @param {string} chatId
   */
  const canShow = chatId =>
    isTerminalId(chatId)
      ? !terminals.ready.value || terminals.get(chatId)?.project === storyId
      : chatsApi.isUnstarted(chatId) || Boolean(chatsApi.getChatById(chatId))

  /**
   * The tabs with a tab for each of the project's terminals that has none,
   * as one whose tab was lost with the view has none: a terminal with no tab
   * would run where nothing shows it.
   * @param {Tabs} tabs
   * @returns {Tabs}
   */
  const withTerminals = tabs => {
    const missing = terminals.of(storyId).filter(id => !tabs.open.includes(id))
    return missing.length ? { ...tabs, open: [...tabs.open, ...missing] } : tabs
  }

  /**
   * The tabs as kept, less any whose chat has gone. A project whose chats
   * were never in tabs opens on its latest chat, as the panel did before it
   * had them. Before the chats are loaded they are taken as stored. A tab
   * left a preview, from when a chat's could be one, is a tab like the rest.
   * @type {import('vue').ComputedRef<Tabs>}
   */
  const stored = computed(() => {
    const kept = view()
    const tabs = { ...tabsOf(kept, CHAT_TABS), preview: null }
    if (!chatsApi.ready.value) return tabs
    const latest = chatsApi.chats.value[0]
    if (!Array.isArray(kept?.[CHAT_TABS.open]) && latest) {
      return withTerminals(openTab(NO_TABS, latest.id))
    }
    return withTerminals(normalizeTabs(tabs, canShow))
  })

  /** @type {import('vue').ComputedRef<Tabs>} */
  const tabs = computed(() =>
    stored.value.active ? stored.value : openTab(stored.value, chatsApi.unstartedChat.value.id)
  )

  const activeId = computed(() => tabs.value.active)

  const activeChatId = computed(() => {
    const { active, shown } = tabs.value
    if (!isTerminalId(active)) return active
    return shown.find(id => !isTerminalId(id)) ?? chatsApi.unstartedChat.value.id
  })

  /** @param {Tabs} next */
  const write = next => {
    if (next !== stored.value) views.updateView(storyId, tabsPatch(next, CHAT_TABS))
  }

  /** @type {ChatTabsApi['open']} */
  const open = chatId => write(openTab(stored.value, chatId, { beside: true }))

  const openNew = () => open(chatsApi.unstartedChat.value.id)

  const openTerminal = async () => {
    const id = await terminals.create(storyId)
    // A project not saved yet is saved by it, as by a chat: there would be
    // no project to find the terminal in again.
    useSyncStore().start(storyId)
    open(id)
  }

  /**
   * A chat's tab is the one closed last, for reopening. A terminal's is not
   * remembered: its shell has ended, and there is nothing of it to open
   * again.
   * @type {ChatTabsApi['shut']}
   */
  const shut = chatId =>
    write(isTerminalId(chatId) ? dropTabs(stored.value, [chatId]) : closeTab(stored.value, chatId))

  /** @type {ChatTabsApi['close']} */
  const close = chatId => {
    shut(chatId)
    if (isTerminalId(chatId)) terminals.close(chatId)
  }

  /**
   * A chat not started has nothing to bring back, and is passed over.
   * @type {ChatTabsApi['reopen']}
   */
  const reopen = () => {
    const chatId = lastClosed(stored.value, id => Boolean(chatsApi.getChatById(id)))
    if (chatId) open(chatId)
  }

  /** @type {ChatTabsApi['closeOthers']} */
  const closeOthers = chatId => {
    const showing = openTab(stored.value, chatId)
    const others = showing.open.filter(id => id !== chatId)
    const chats = others.filter(id => !isTerminalId(id))
    write(dropTabs(closeTabs(showing, chats), others.filter(isTerminalId)))
    for (const id of others) if (isTerminalId(id)) terminals.close(id)
  }

  /**
   * The message box and the terminals are the panel's, which watches for
   * this: a key that brings a tab forward asks, where a click would have
   * left the pointer over it.
   */
  const focusAsked = ref(0)

  /** @type {ChatTabsApi['focus']} */
  const focus = () => {
    focusAsked.value++
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

  return {
    tabs,
    activeId,
    activeChatId,
    open,
    openNew,
    openTerminal,
    close,
    shut,
    reopen,
    closeOthers,
    focus,
    focusAsked,
    isUnread,
    markUnread,
  }
}
