/**
 * @module composables/useMenuCommands
 * @description What the desktop app's menu asks of the writer, done: the
 * keys a browser keeps for its own tabs, which the app has to itself in a
 * window of its own (`platform/menu.js`).
 *
 * A new document and a new chat are made wherever the writer is. Closing a
 * tab, opening the one closed last again, and going along the tabs or to one
 * by its place are done to the panel the writer is in, the editor's
 * documents or the chat's chats and terminals (`useWriterPanel`). The
 * projects and the settings open over the writer.
 *
 * While a dialog is open, none of it is done: what the key would change is
 * behind the dialog. And one that can't apply, a tab closed with none open,
 * a chat with the AI switched off, does nothing.
 */

import { nextTick, onBeforeUnmount, onMounted } from 'vue'
import { hasMenuCommands, onMenuCommand } from '@/platform/menu.js'
import { tabAt, tabBeside } from '@/utils/tabs.js'
import { useApplicationState } from './useApplicationState.js'
import { useChatTabs } from './useChatTabs.js'
import { useDocuments } from './useDocuments.js'
import { useFocusMode } from './useFocusMode.js'
import { useNewDocument } from './useNewDocument.js'
import { useProjectsDialog } from './useProjectsDialog.js'
import { useSettingsPanel } from './useSettingsPanel.js'
import { watchWriterPanel, writerPanel } from './useWriterPanel.js'

/** @typedef {import('@/platform/menu.js').MenuCommand} MenuCommand */

/** Whether a dialog is open over the writer. */
const dialogOpen = () => document.querySelector('.p-dialog-mask') !== null

/**
 * A panel's tabs, as the keys act on them, whichever panel it is.
 *
 * @typedef {Object} PanelTabs
 * @property {import('@/utils/tabs.js').Tabs} tabs
 * @property {(id: string) => void} show - Bring a tab forward
 * @property {(id: string) => void} close
 * @property {() => void} reopen - Open the one closed last again
 */

/**
 * Do what the desktop app's menu asks, for as long as the component calling
 * this is mounted: the writer's frame. Nothing in a browser, which has no
 * such menu.
 *
 * @param {Object} frame
 * @param {() => string|null|undefined} frame.storyId - The project open
 * @param {() => void} frame.showEditor - Show the editor, where it is hidden
 * @param {() => void} frame.showChat - Show the chat, where it is hidden
 */
export function useMenuCommands({ storyId, showEditor, showChat }) {
  const { aiEnabled } = useApplicationState()
  const { focused } = useFocusMode()
  const settings = useSettingsPanel()
  const projects = useProjectsDialog()

  /**
   * The tabs of the panel the writer is in.
   * @param {string} project
   * @returns {PanelTabs}
   */
  const panelTabs = project => {
    if (aiEnabled.value && writerPanel() === 'chat') {
      const chats = useChatTabs(project)
      /**
       * A tab brought forward by a key gets the keys, for the next thing
       * typed: a chat the caret in its message box, a terminal the keys
       * themselves. The box they were in went with the chat that was showing.
       * @template {any[]} A
       * @param {(...args: A) => void} act
       * @returns {(...args: A) => void}
       */
      const thenFocus =
        act =>
        (...args) => {
          const showing = chats.activeId.value
          act(...args)
          if (chats.activeId.value !== showing) chats.focus()
        }
      return {
        tabs: chats.tabs.value,
        show: thenFocus(chats.open),
        close: thenFocus(chats.close),
        reopen: thenFocus(chats.reopen),
      }
    }
    const documents = useDocuments(project)
    return {
      tabs: documents.tabs.value,
      show: documents.open,
      close: documents.closeTab,
      reopen: documents.reopenTab,
    }
  }

  /**
   * @param {MenuCommand} command
   * @param {number} [detail] - For `showTab`, the tab's place, from 1
   */
  const run = (command, detail) => {
    if (dialogOpen()) return
    if (command === 'settings') return settings.open()
    if (command === 'projects') return projects.open()

    const project = storyId()
    if (!project) return

    if (command === 'newDocument') {
      useNewDocument(project)()
      showEditor()
      return
    }
    if (command === 'newChat') {
      // Focus mode is the document alone.
      if (!aiEnabled.value || focused.value) return
      const chats = useChatTabs(project)
      chats.openNew()
      showChat()
      // Once the panel is showing, which a field has to be to take the caret.
      nextTick(chats.focus)
      return
    }

    const panel = panelTabs(project)
    const { active } = panel.tabs
    /** @param {string|null} id */
    const show = id => {
      if (id && id !== active) panel.show(id)
    }
    if (command === 'closeTab' && active) panel.close(active)
    else if (command === 'reopenTab') panel.reopen()
    else if (command === 'nextTab') show(tabBeside(panel.tabs, 1))
    else if (command === 'previousTab') show(tabBeside(panel.tabs, -1))
    else if (command === 'showTab') show(tabAt(panel.tabs, detail ?? 0))
  }

  /** @type {() => void} */
  let stop = () => {}
  onMounted(() => {
    if (!hasMenuCommands()) return
    watchWriterPanel()
    stop = onMenuCommand(run)
  })
  onBeforeUnmount(() => stop())
}
