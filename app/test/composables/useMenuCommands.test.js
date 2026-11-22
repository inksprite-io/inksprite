/* global KeyboardEvent */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'

/** What the menu's listener is, once the frame is mounted. */
let heard = null
const stopListening = vi.fn()
const inDesktop = { value: true }
const showInMenu = vi.fn()
vi.mock('@/platform/menu.js', () => ({
  hasMenuCommands: () => inDesktop.value,
  onMenuCommand: listener => {
    heard = listener
    return stopListening
  },
  showInMenu: items => showInMenu(items),
}))

const panel = ref('editor')
vi.mock('@/composables/useWriterPanel.js', () => ({
  watchWriterPanel: vi.fn(),
  writerPanel: () => panel.value,
}))

const aiEnabled = ref(true)
const terminal = ref(true)
vi.mock('@/composables/useApplicationState.js', () => ({
  useApplicationState: () => ({ aiEnabled, terminal }),
}))

const hasTerminals = { value: true }
vi.mock('@/platform/terminal.js', async original => ({
  ...(await original()),
  hasTerminal: () => hasTerminals.value,
}))

const toast = { error: vi.fn() }
vi.mock('@/composables/useToast.js', () => ({ useToast: () => toast }))

const focused = ref(false)
vi.mock('@/composables/useFocusMode.js', () => ({
  useFocusMode: () => ({ focused }),
}))

/** A panel's tabs, as the composables hold them. */
const strip = (open, active) => ({ open, active, preview: null, shown: [], closed: [] })

const documents = {
  tabs: ref(strip([], null)),
  open: vi.fn(),
  closeTab: vi.fn(),
  reopenTab: vi.fn(),
}
vi.mock('@/composables/useDocuments.js', () => ({ useDocuments: () => documents }))

const chatTabs = {
  tabs: ref(strip([], null)),
  activeId: ref(null),
  open: vi.fn(id => {
    chatTabs.activeId.value = id
  }),
  openNew: vi.fn(),
  openTerminal: vi.fn(async () => {}),
  close: vi.fn(),
  reopen: vi.fn(),
  focus: vi.fn(),
}
vi.mock('@/composables/useChatTabs.js', () => ({ useChatTabs: () => chatTabs }))

const newDocument = vi.fn()
vi.mock('@/composables/useNewDocument.js', () => ({ useNewDocument: () => newDocument }))

const { useMenuCommands } = await import('@/composables/useMenuCommands.js')
const { watchWriterPanel } = await import('@/composables/useWriterPanel.js')
const { useSettingsPanel } = await import('@/composables/useSettingsPanel.js')
const { useProjectsDialog } = await import('@/composables/useProjectsDialog.js')

const storyId = ref('story_1')
const showEditor = vi.fn()
const showChat = vi.fn()

/** The writer's frame, as far as the menu goes. */
const Frame = defineComponent({
  setup() {
    useMenuCommands({ storyId: () => storyId.value, showEditor, showChat })
    return () => h('div')
  },
})

describe('useMenuCommands', () => {
  let wrapper

  /** The editor's tabs, and the chat's. */
  const have = ({ docs = strip([], null), chats = strip([], null) }) => {
    documents.tabs.value = docs
    chatTabs.tabs.value = chats
    chatTabs.activeId.value = chats.active
  }

  beforeEach(() => {
    vi.clearAllMocks()
    panel.value = 'editor'
    aiEnabled.value = true
    terminal.value = true
    hasTerminals.value = true
    focused.value = false
    storyId.value = 'story_1'
    useSettingsPanel().visible.value = false
    useProjectsDialog().visible.value = false
    have({})
    wrapper = mount(Frame)
  })

  afterEach(() => {
    wrapper.unmount()
    document.body.innerHTML = ''
  })

  it('listens to the menu while the frame is mounted', () => {
    expect(heard).toBeTypeOf('function')
    expect(watchWriterPanel).toHaveBeenCalled()
    wrapper.unmount()
    expect(stopListening).toHaveBeenCalled()
  })

  it('listens to nothing in a browser, which has no such menu', () => {
    wrapper.unmount()
    vi.clearAllMocks()
    heard = null
    inDesktop.value = false
    try {
      wrapper = mount(Frame)
      expect(heard).toBeNull()
      expect(watchWriterPanel).not.toHaveBeenCalled()
    } finally {
      inDesktop.value = true
    }
  })

  it('opens the settings, and the projects', () => {
    heard('settings')
    expect(useSettingsPanel().visible.value).toBe(true)

    useSettingsPanel().visible.value = false
    heard('projects')
    expect(useProjectsDialog().visible.value).toBe(true)
  })

  it('opens them with no project open, and does nothing else', () => {
    storyId.value = ''
    heard('newDocument')
    heard('closeTab')
    expect(newDocument).not.toHaveBeenCalled()

    heard('projects')
    expect(useProjectsDialog().visible.value).toBe(true)
  })

  it('makes a document, and shows the editor it opens in', () => {
    heard('newDocument')
    expect(newDocument).toHaveBeenCalled()
    expect(showEditor).toHaveBeenCalled()
  })

  it('starts a chat, shows the chat panel, and puts the caret in its box', async () => {
    heard('newChat')
    expect(chatTabs.openNew).toHaveBeenCalled()
    expect(showChat).toHaveBeenCalled()
    await nextTick()
    expect(chatTabs.focus).toHaveBeenCalled()
  })

  it('starts no chat with the AI switched off, nor in focus mode', () => {
    aiEnabled.value = false
    heard('newChat')
    aiEnabled.value = true
    focused.value = true
    heard('newChat')

    expect(chatTabs.openNew).not.toHaveBeenCalled()
    expect(showChat).not.toHaveBeenCalled()
  })

  describe('in the editor', () => {
    beforeEach(() => have({ docs: strip(['a', 'b', 'c'], 'b'), chats: strip(['x', 'y'], 'x') }))

    it('closes the tab showing', () => {
      heard('closeTab')
      expect(documents.closeTab).toHaveBeenCalledWith('b')
      expect(chatTabs.close).not.toHaveBeenCalled()
    })

    it('does nothing with no tab to close', () => {
      have({ docs: strip([], null) })
      heard('closeTab')
      expect(documents.closeTab).not.toHaveBeenCalled()
    })

    it('opens the tab closed last again', () => {
      heard('reopenTab')
      expect(documents.reopenTab).toHaveBeenCalled()
    })

    it('goes to the next tab, and the one before', () => {
      heard('nextTab')
      expect(documents.open).toHaveBeenLastCalledWith('c')
      heard('previousTab')
      expect(documents.open).toHaveBeenLastCalledWith('a')
    })

    it('goes to a tab by its place, and 9 to the last', () => {
      heard('showTab', 1)
      expect(documents.open).toHaveBeenLastCalledWith('a')
      heard('showTab', 9)
      expect(documents.open).toHaveBeenLastCalledWith('c')
    })

    it('does nothing for the tab already showing, or a place with no tab', () => {
      heard('showTab', 2)
      heard('showTab', 5)
      expect(documents.open).not.toHaveBeenCalled()
    })
  })

  describe('in the chat', () => {
    beforeEach(() => {
      panel.value = 'chat'
      have({ docs: strip(['a', 'b'], 'a'), chats: strip(['x', 'y', 'z'], 'y') })
    })

    it('closes the chat showing, and leaves the documents alone', () => {
      heard('closeTab')
      expect(chatTabs.close).toHaveBeenCalledWith('y')
      expect(documents.closeTab).not.toHaveBeenCalled()
    })

    it('opens the chat closed last again', () => {
      heard('reopenTab')
      expect(chatTabs.reopen).toHaveBeenCalled()
      expect(documents.reopenTab).not.toHaveBeenCalled()
    })

    it('goes along the chats, with the caret in the box of the one shown', () => {
      heard('nextTab')
      expect(chatTabs.open).toHaveBeenLastCalledWith('z')
      expect(chatTabs.focus).toHaveBeenCalledTimes(1)
    })

    it('leaves the caret where it is when no other chat came forward', () => {
      // Closing the one chat not started shows it still.
      heard('closeTab')
      expect(chatTabs.focus).not.toHaveBeenCalled()
    })

    it('is the editor’s with the AI switched off', () => {
      aiEnabled.value = false
      heard('closeTab')
      expect(documents.closeTab).toHaveBeenCalledWith('a')
    })
  })

  it('leaves the tabs alone with neither panel on screen, and still makes a document', () => {
    have({ docs: strip(['a', 'b'], 'a'), chats: strip(['x', 'terminal:1'], 'terminal:1') })
    panel.value = null

    heard('closeTab')
    heard('reopenTab')
    heard('nextTab')
    heard('previousTab')
    heard('showTab', 2)

    expect(documents.closeTab).not.toHaveBeenCalled()
    expect(documents.reopenTab).not.toHaveBeenCalled()
    expect(documents.open).not.toHaveBeenCalled()
    expect(chatTabs.close).not.toHaveBeenCalled()
    expect(chatTabs.reopen).not.toHaveBeenCalled()
    expect(chatTabs.open).not.toHaveBeenCalled()

    heard('newDocument')
    expect(newDocument).toHaveBeenCalled()
  })

  it('does nothing while a dialog is open', () => {
    have({ docs: strip(['a'], 'a') })
    const mask = document.createElement('div')
    mask.className = 'p-dialog-mask'
    document.body.append(mask)

    heard('closeTab')
    heard('newDocument')
    heard('settings')
    heard('projects')

    expect(documents.closeTab).not.toHaveBeenCalled()
    expect(newDocument).not.toHaveBeenCalled()
    expect(useSettingsPanel().visible.value).toBe(false)
    expect(useProjectsDialog().visible.value).toBe(false)
  })

  describe('the terminal’s keys', () => {
    /**
     * Press Control-`, with Shift for a new terminal, where the page has it.
     * @param {{shift?: boolean, on?: EventTarget}} [how]
     * @returns {KeyboardEvent}
     */
    const press = ({ shift = false, on = document.body } = {}) => {
      const event = new KeyboardEvent('keydown', {
        key: shift ? '~' : '`',
        code: 'Backquote',
        ctrlKey: true,
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
      })
      on.dispatchEvent(event)
      return event
    }

    /** Let the terminal be made, and the panel take it. */
    const settle = async () => {
      await Promise.resolve()
      await nextTick()
    }

    it('shows the terminal shown last, with the keys in it, and the panel it is in', async () => {
      have({
        chats: {
          ...strip(['x', 'terminal:1', 'terminal:2'], 'x'),
          shown: ['x', 'terminal:2', 'terminal:1'],
        },
      })
      const event = press()
      expect(event.defaultPrevented).toBe(true)
      await settle()

      expect(chatTabs.open).toHaveBeenCalledWith('terminal:2')
      expect(chatTabs.openTerminal).not.toHaveBeenCalled()
      expect(showChat).toHaveBeenCalled()
      expect(chatTabs.focus).toHaveBeenCalled()
    })

    it('shows the first terminal in the strip when none has been shown', async () => {
      have({ chats: { ...strip(['x', 'terminal:1', 'terminal:2'], 'x'), shown: ['x'] } })
      press()
      await settle()
      expect(chatTabs.open).toHaveBeenCalledWith('terminal:1')
    })

    it('makes one when none is open, and with Shift whatever is', async () => {
      have({ chats: strip(['x'], 'x') })
      press()
      await settle()
      expect(chatTabs.openTerminal).toHaveBeenCalledTimes(1)
      expect(chatTabs.focus).toHaveBeenCalledTimes(1)

      have({ chats: { ...strip(['x', 'terminal:1'], 'terminal:1'), shown: ['terminal:1'] } })
      press({ shift: true })
      await settle()
      expect(chatTabs.openTerminal).toHaveBeenCalledTimes(2)
      expect(chatTabs.open).not.toHaveBeenCalled()
    })

    it('says so when the terminal can’t be made', async () => {
      const failed = vi.spyOn(console, 'error').mockImplementation(() => {})
      chatTabs.openTerminal.mockRejectedValueOnce(new Error('no shell'))
      press()
      await settle()
      await settle()
      expect(toast.error).toHaveBeenCalledWith('The terminal couldn’t be opened.')
      expect(showChat).not.toHaveBeenCalled()
      failed.mockRestore()
    })

    it('takes a key handed over by a terminal’s frame, as from anywhere in the page', async () => {
      const panelRoot = document.createElement('div')
      document.body.append(panelRoot)
      press({ on: panelRoot, shift: true })
      await settle()
      expect(chatTabs.openTerminal).toHaveBeenCalled()
    })

    it('leaves the key alone with the Terminal extension off, in focus mode or under a dialog', async () => {
      terminal.value = false
      expect(press().defaultPrevented).toBe(false)
      terminal.value = true

      focused.value = true
      expect(press().defaultPrevented).toBe(false)
      focused.value = false

      const mask = document.createElement('div')
      mask.className = 'p-dialog-mask'
      document.body.append(mask)
      expect(press().defaultPrevented).toBe(false)
      mask.remove()

      storyId.value = ''
      expect(press().defaultPrevented).toBe(false)

      await settle()
      expect(chatTabs.openTerminal).not.toHaveBeenCalled()
      expect(chatTabs.open).not.toHaveBeenCalled()
    })

    it('listens for nothing where there are no terminals, and stops with the frame', async () => {
      wrapper.unmount()
      hasTerminals.value = false
      wrapper = mount(Frame)
      expect(press().defaultPrevented).toBe(false)

      wrapper.unmount()
      hasTerminals.value = true
      wrapper = mount(Frame)
      wrapper.unmount()
      expect(press().defaultPrevented).toBe(false)
      wrapper = mount(Frame)
    })

    it('does the same when the menu asks, from its items or a Mac’s keys', async () => {
      have({ chats: { ...strip(['x', 'terminal:1'], 'x'), shown: ['x', 'terminal:1'] } })
      heard('showTerminal')
      await settle()
      expect(chatTabs.open).toHaveBeenCalledWith('terminal:1')
      heard('newTerminal')
      await settle()
      expect(chatTabs.openTerminal).toHaveBeenCalledTimes(1)
      expect(chatTabs.focus).toHaveBeenCalledTimes(2)

      vi.clearAllMocks()
      terminal.value = false
      heard('newTerminal')
      terminal.value = true
      focused.value = true
      heard('showTerminal')
      await settle()
      expect(chatTabs.openTerminal).not.toHaveBeenCalled()
      expect(chatTabs.open).not.toHaveBeenCalled()
    })
  })

  it('tells the menu what it holds: a new chat with the AI on, terminals with their extension', async () => {
    expect(showInMenu).toHaveBeenLastCalledWith({ chat: true, terminal: true })

    aiEnabled.value = false
    await nextTick()
    expect(showInMenu).toHaveBeenLastCalledWith({ chat: false, terminal: true })

    terminal.value = false
    await nextTick()
    expect(showInMenu).toHaveBeenLastCalledWith({ chat: false, terminal: false })

    // Where there are no terminals, as in a desktop app older than the page.
    wrapper.unmount()
    aiEnabled.value = true
    terminal.value = true
    hasTerminals.value = false
    wrapper = mount(Frame)
    expect(showInMenu).toHaveBeenLastCalledWith({ chat: true, terminal: false })
  })
})
