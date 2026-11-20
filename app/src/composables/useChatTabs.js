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
 * id that says so. A terminal is its project's, as a chat is, and has a tab
 * in that project for as long as its shell runs: closing the tab ends the
 * shell, and a tab whose shell has ended is gone, as a deleted chat's is.
 *
 * One instance per project, made in a scope of its own like `useAIChat`, so
 * the watch that clears what is read outlives the view that first asked.
 */
import { computed, effectScope, ref, watch } from 'vue'
import { useChats } from './useChats.js'
import { onStoppedWorking } from './useChatActivity.js'
import { useTerminals } from './useTerminals.js'
import { isTerminalId } from '@/platform/terminal.js'
import { useProjectViewsStore } from '@/stores/projectViewsStore.js'
import {
  CHAT_TABS,
  NO_TABS,
  closeTabs,
  dropTabs,
  lastClosed,
  moveTab,
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
 * @property {(id: string) => void} open - Show a chat, in a tab beside the one
 *   showing unless it has one, or a terminal that has a tab. The unstarted
 *   chat shown for want of anything open is written into the strip by it, as
 *   when it is sent in.
 * @property {() => void} openNew - Show the unstarted chat
 * @property {() => Promise<void>} openTerminal - Make a terminal, and show it
 *   in a tab beside the one showing
 * @property {(id: string) => void} close - Close a tab. A terminal's shell is
 *   ended with it.
 * @property {(id: string, to: number) => void} move - Put a tab at another
 *   place in the strip, counted from 0
 * @property {() => void} reopen - Show again the chat whose tab was closed
 *   last, if it is still one of the project's
 * @property {(id: string) => void} closeOthers - Close every tab but this one
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
  const terminals = useTerminals()
  const views = useProjectViewsStore()

  /** @returns {Record<string, any>|undefined} */
  const view = () => views.getView(storyId)

  /**
   * Whether a tab's chat is there to show: one of the project's, or the
   * unstarted one. A terminal's tab is there while its shell runs, in this
   * project, and until the terminals there are are known is taken as stored.
   * @param {string} id
   */
  const canShow = id =>
    isTerminalId(id)
      ? !terminals.ready.value || terminals.get(id)?.project === storyId
      : chatsApi.isUnstarted(id) || Boolean(chatsApi.getChatById(id))

  /**
   * The tabs as kept, less any whose chat has gone, or whose terminal has. A
   * project whose chats were never in tabs opens on its latest chat, as the
   * panel did before it had them. Before the chats are loaded they are taken
   * as stored. A tab left a preview, from when a chat's could be one, is a
   * tab like the rest.
   * @type {import('vue').ComputedRef<Tabs>}
   */
  const kept = computed(() => {
    const left = view()
    const tabs = { ...tabsOf(left, CHAT_TABS), preview: null }
    if (!chatsApi.ready.value) return tabs
    const latest = chatsApi.chats.value[0]
    if (!Array.isArray(left?.[CHAT_TABS.open]) && latest) return openTab(NO_TABS, latest.id)
    return normalizeTabs(tabs, canShow)
  })

  /**
   * The tabs with a tab, after the rest, for each of the project's terminals
   * that has none, as one whose tab was lost with the view has none: a
   * terminal with no tab would run where nothing shows it, or ends it.
   * @type {import('vue').ComputedRef<Tabs>}
   */
  const stored = computed(() => {
    const tabs = kept.value
    if (!chatsApi.ready.value) return tabs
    const missing = terminals.of(storyId).filter(id => !tabs.open.includes(id))
    return missing.length ? { ...tabs, open: [...tabs.open, ...missing] } : tabs
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
  const open = id => write(openTab(stored.value, id, { beside: true }))

  const openNew = () => open(chatsApi.unstartedChat.value.id)

  /**
   * Beside the tab showing, as a new chat is. Its tab is placed among the
   * tabs as kept, where a terminal just made has none yet: `stored` has
   * given it one by now, at the end.
   * @type {ChatTabsApi['openTerminal']}
   */
  const openTerminal = async () => {
    const id = await terminals.create(storyId)
    write(openTab(kept.value, id, { beside: true }))
  }

  /**
   * Close tabs, as the writer does. A chat's is remembered, the one closed
   * last first, for reopening. A terminal's is not: its shell is ended with
   * it, and there is nothing of it to open again.
   * @param {Tabs} from
   * @param {string[]} ids
   */
  const closeFrom = (from, ids) => {
    const ended = ids.filter(isTerminalId)
    const chats = ids.filter(id => !isTerminalId(id))
    write(dropTabs(closeTabs(from, chats), ended))
    for (const id of ended) terminals.close(id)
  }

  /** @type {ChatTabsApi['close']} */
  const close = id => closeFrom(stored.value, [id])

  /**
   * Among the tabs as the strip shows them: the unstarted chat shown for
   * want of a chat open, beside a terminal, is written into the strip by
   * being moved, as by being opened.
   * @type {ChatTabsApi['move']}
   */
  const move = (id, to) => {
    const next = moveTab(tabs.value, id, to)
    if (next !== tabs.value) write(next)
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
  const closeOthers = id => {
    const showing = openTab(stored.value, id)
    closeFrom(
      showing,
      showing.open.filter(other => other !== id)
    )
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
    move,
    reopen,
    closeOthers,
    focus,
    focusAsked,
    isUnread,
    markUnread,
  }
}
