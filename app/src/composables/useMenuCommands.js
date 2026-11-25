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
 * The terminal's keys work wherever the writer is: Command-L makes a
 * terminal (Control-Shift-L off a Mac), and Control-` shows one, the one
 * shown last or a new one, as code editors have it, with Shift making one as
 * they have that too. Control-` in a terminal goes back to where the writer
 * was before it, as an editor of code has it: what had the keys last outside
 * a terminal, and the chat that was showing then. The menu shows them, but
 * the keys are taken here, from the page and from a terminal's frame, which
 * hands them over (`platform/terminal.js`): a menu's key would never reach
 * the page from inside a terminal off a Mac. One held down makes one
 * terminal, not one for each time it repeats.
 *
 * The menu is told what it holds of what the settings decide: a new chat
 * while the AI is on, and the terminals while their extension is.
 *
 * While a dialog is open, none of it is done: what the key would change is
 * behind the dialog. And one that can't apply, a tab closed with none open,
 * a chat with the AI switched off, a tab's key with neither panel on screen,
 * does nothing.
 */

/* global Element, HTMLElement */
import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { hasMenuCommands, onMenuCommand, showInMenu } from '@/platform/menu.js'
import { hasTerminal, isTerminalId, terminalKey } from '@/platform/terminal.js'
import { tabAt, tabBeside } from '@/utils/tabs.js'
import { useApplicationState } from './useApplicationState.js'
import { useChatTabs } from './useChatTabs.js'
import { useDocuments } from './useDocuments.js'
import { useEditor } from './useEditor.js'
import { useFocusMode } from './useFocusMode.js'
import { useNewDocument } from './useNewDocument.js'
import { useProjectsDialog } from './useProjectsDialog.js'
import { useSettingsPanel } from './useSettingsPanel.js'
import { useToast } from './useToast.js'
import { watchWriterPanel, writerPanel } from './useWriterPanel.js'

/** @typedef {import('@/platform/menu.js').MenuCommand} MenuCommand */

/** Whether a dialog is open over the writer. */
const dialogOpen = () => document.querySelector('.p-dialog-mask') !== null

/**
 * Whether something is a terminal, or in one: its frame hands its keys to
 * the page as if pressed on the frame's element (`TerminalFrame`).
 *
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
const inTerminal = target =>
  target instanceof Element && target.closest('[data-terminal-frame]') !== null

/**
 * The panel something is in, or picks things for, as the writer's panel is
 * told (`useWriterPanel`): the outline is the editor's.
 *
 * @param {Element} target
 * @returns {'editor'|'chat'|null}
 */
const panelOf = target => {
  const within = target.closest('[data-panel], [data-panel-for]')
  const name = within?.getAttribute('data-panel') ?? within?.getAttribute('data-panel-for')
  return name === 'editor' || name === 'chat' ? name : null
}

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
 * Do what the desktop app's menu asks, and the terminal's keys, for as long
 * as the component calling this is mounted: the writer's frame. Nothing in a
 * browser, which has no such menu and no terminals.
 *
 * @param {Object} frame
 * @param {() => string|null|undefined} frame.storyId - The project open
 * @param {() => void} frame.showEditor - Show the editor, where it is hidden
 * @param {() => void} frame.showChat - Show the chat, where it is hidden
 */
export function useMenuCommands({ storyId, showEditor, showChat }) {
  const { aiEnabled, terminal } = useApplicationState()
  const { focused } = useFocusMode()
  const settings = useSettingsPanel()
  const projects = useProjectsDialog()
  const toast = useToast()

  /**
   * The tabs of the panel the writer is in, or null when they are in neither:
   * a tab that can't be seen is not closed, least of all a terminal's, whose
   * shell would end with it.
   * @param {string} project
   * @returns {PanelTabs|null}
   */
  const panelTabs = project => {
    const where = writerPanel()
    if (!where) return null
    if (aiEnabled.value && where === 'chat') {
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
    if (command === 'newTerminal' || command === 'showTerminal') {
      if (terminalsHere()) showTerminal(project, command === 'newTerminal')
      return
    }

    const panel = panelTabs(project)
    if (!panel) return
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

  /** Whether there are terminals to show: with their extension on, and out of focus mode. */
  const terminalsHere = () => hasTerminal() && terminal.value && !focused.value

  /**
   * Where the writer last was outside a terminal: what had the keys, the
   * panel it was in, the outline counting as the editor's, and the chat tab
   * showing then where that was the chat. Noted as the keys go anywhere but a
   * terminal, by a click or a key alike.
   * @type {{element: HTMLElement, panel: 'editor'|'chat'|null, chatTab: string|null}|null}
   */
  let outside = null

  /** @param {FocusEvent} event */
  const noteOutside = event => {
    const target = event.target
    if (!(target instanceof HTMLElement) || inTerminal(target)) return
    const project = storyId()
    const panel = panelOf(target)
    outside = {
      element: target,
      panel,
      chatTab: project && panel === 'chat' ? useChatTabs(project).activeId.value : null,
    }
  }

  /**
   * Go back from a terminal to where the writer was before it: the chat that
   * was showing then, brought forward, and what had the keys given them
   * again. Where that has gone, as a title's field goes once it is named, the
   * panel it was in has them: the document showing, or the chat's message
   * box. Where nothing was noted, the chat shown before the terminal.
   *
   * @param {string} project
   */
  const leaveTerminal = async project => {
    const chats = useChatTabs(project)
    const was = outside
    const chatTab = was ? was.chatTab : chats.activeChatId.value
    if (chatTab && chatTab !== chats.activeId.value) chats.open(chatTab)
    const inEditor = was?.panel === 'editor'
    if (inEditor) showEditor()
    else showChat()
    await nextTick()
    if (was?.element.isConnected) was.element.focus()
    else if (inEditor) {
      const shown = useDocuments(project).tabs.value.active
      if (shown) useEditor().focus(shown)
    } else if (chatTab) chats.focus()
  }

  /**
   * Show a terminal in the chat panel, with the keys in it: the one shown
   * last, or the first in the strip, or a new one where none is open or one
   * was asked for.
   *
   * @param {string} project
   * @param {boolean} fresh - Whether to make one, whatever is open
   */
  const showTerminal = async (project, fresh) => {
    const chats = useChatTabs(project)
    const { shown, open } = chats.tabs.value
    const id = fresh ? null : (shown.find(isTerminalId) ?? open.find(isTerminalId))
    // What has the keys as it is asked: a terminal still being made gets
    // them only if the writer hasn't put them elsewhere meanwhile.
    const had = document.activeElement
    if (id) chats.open(id)
    else {
      try {
        await chats.openTerminal()
      } catch (error) {
        console.error('A terminal could not be made:', error)
        toast.error('The terminal couldn’t be opened.')
        return
      }
      if (document.activeElement !== had) return
    }
    showChat()
    // Once the panel is showing, which the terminal has to be to take the keys.
    await nextTick()
    chats.focus()
  }

  /**
   * The terminal's keys, from the page or handed over by a terminal's frame.
   * One that can't apply is left alone.
   *
   * @param {KeyboardEvent} event
   */
  const onKeyDown = event => {
    const command = terminalKey(event)
    if (!command || event.defaultPrevented) return
    const project = storyId()
    if (!terminalsHere() || dialogOpen() || !project) return
    event.preventDefault()
    if (event.repeat) return
    if (command === 'showTerminal' && inTerminal(event.target)) leaveTerminal(project)
    else run(command)
  }

  // What the menu holds that the settings decide.
  watch(() => ({ chat: aiEnabled.value, terminal: hasTerminal() && terminal.value }), showInMenu, {
    immediate: true,
  })

  /** @type {() => void} */
  let stop = () => {}
  onMounted(() => {
    if (hasTerminal()) {
      window.addEventListener('keydown', onKeyDown)
      document.addEventListener('focusin', noteOutside, true)
    }
    if (!hasMenuCommands()) return
    watchWriterPanel()
    stop = onMenuCommand(run)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('focusin', noteOutside, true)
    stop()
  })
}
