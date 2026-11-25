import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ChatPanel from '@/components/writer/layout/ChatPanel.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { clearChatsInstances, useChats } from '@/composables/useChats'
import { clearChatTabsInstances, useChatTabs } from '@/composables/useChatTabs.js'
import { clearChatActivity, reportWorking } from '@/composables/useChatActivity.js'
import { clearTerminals } from '@/composables/useTerminals.js'
import { useChatsStore } from '@/stores/chatsStore'

vi.mock('@/stores/db', () => {
  const empty = () => ({
    toArray: vi.fn(async () => []),
    where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
  })
  return { default: { chats: empty(), messages: empty(), stories: empty() } }
})

/** What the panel says went wrong. */
const toastError = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ error: toastError }) }))
vi.mock('@/composables/useBackup', () => ({ useBackup: () => ({ downloadChat: vi.fn() }) }))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

const openFind = vi.fn()
const send = vi.fn()
const focusMessage = vi.fn()

/** The chat a fork in the stand-in chat makes, and what its /fork brought. */
const forking = { to: '', send: undefined }

/** The chat itself: which it is, and the two things it asks of the panel. */
const Chat = {
  props: ['chatId'],
  emits: ['open-chat', 'sent'],
  setup: (_props, { expose }) => {
    expose({ openFind, send, focusMessage })
    return { forking }
  },
  template:
    '<div data-chat :data-id="chatId"><button data-fork @click="$emit(\'open-chat\', { chatId: forking.to, send: forking.send })" /><button data-send @click="$emit(\'sent\', chatId)" /></div>',
}

/** Which terminals' frames were given the keys, by their ids. */
const framesFocused = []

/** A terminal's frame: which terminal it is, and that it can take the keys. */
const TerminalFrame = {
  props: ['terminalId', 'active'],
  setup: (props, { expose }) => {
    expose({ focus: () => framesFocused.push(props.terminalId) })
  },
  template: '<div data-terminal-frame :data-id="terminalId" />',
}

const mountPanel = async (props = {}) => {
  const wrapper = mount(ChatPanel, {
    props: { storyId: 'story_1', ...props },
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      stubs: { Chat, TerminalFrame },
    },
  })
  await flushPromises()
  return wrapper
}

const shown = wrapper => wrapper.find('[data-chat]').attributes('data-id')
const strip = wrapper => wrapper.findAll('[role="tab"]').map(tab => tab.attributes('data-tab-id'))
const tab = (wrapper, id) => wrapper.find(`[data-tab-id="${id}"]`)

describe('ChatPanel', () => {
  /** @type {ReturnType<typeof useChatsStore>} */
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    clearChatsInstances()
    clearChatTabsInstances()
    clearChatActivity()
    openFind.mockClear()
    send.mockClear()
    focusMessage.mockClear()
    toastError.mockClear()
    framesFocused.length = 0
    forking.send = undefined
    store = useChatsStore()
  })

  afterEach(() => {
    clearTerminals()
    delete globalThis.__INKSPRITE_DESKTOP__
  })

  it('opens a project whose chats were never in tabs on its latest chat', async () => {
    store.createChat('story_1', 'Older')
    const newer = store.createChat('story_1', 'Newer')
    newer.created += 1000
    const wrapper = await mountPanel()

    expect(shown(wrapper)).toBe(newer.id)
    expect(strip(wrapper)).toEqual([newer.id])
    expect(tab(wrapper, newer.id).text()).toBe('Newer')
  })

  it('shows the unstarted chat in a project with none, making nothing', async () => {
    const wrapper = await mountPanel({ editorShowing: false })
    const unstarted = useChats('story_1').unstartedChat.value.id

    expect(shown(wrapper)).toBe(unstarted)
    expect(wrapper.find('[data-panel-toggle="editor"]').exists()).toBe(true)
    expect(store.getChatsForStory('story_1')).toHaveLength(0)
  })

  it('keeps showing the chat once it has started, in the same tab', async () => {
    const chats = useChats('story_1')
    const id = chats.unstartedChat.value.id
    const wrapper = await mountPanel()

    chats.startChat()
    await wrapper.find('[data-send]').trigger('click')
    await flushPromises()

    expect(shown(wrapper)).toBe(id)
    expect(strip(wrapper)).toEqual([id])
  })

  it('keeps showing a chat started with every tab closed', async () => {
    const first = store.createChat('story_1', 'First')
    const wrapper = await mountPanel()
    useChatTabs('story_1').close(first.id)
    await flushPromises()
    const chats = useChats('story_1')
    const id = chats.unstartedChat.value.id
    expect(shown(wrapper)).toBe(id)

    // As the chat does it: the chat is made, then the panel is told.
    chats.startChat()
    await wrapper.find('[data-send]').trigger('click')
    await flushPromises()

    expect(shown(wrapper)).toBe(id)
    expect(strip(wrapper)).toEqual([id])
  })

  it('opens New chat beside the tab showing, making nothing yet', async () => {
    const first = store.createChat('story_1', 'First')
    const wrapper = await mountPanel()

    await wrapper.find('[aria-label="New chat"]').trigger('click')
    await flushPromises()

    const unstarted = useChats('story_1').unstartedChat.value.id
    expect(strip(wrapper)).toEqual([first.id, unstarted])
    expect(shown(wrapper)).toBe(unstarted)
    expect(store.getChatsForStory('story_1')).toHaveLength(1)
  })

  it('goes back to the chat it came from when a tab closes', async () => {
    const one = store.createChat('story_1', 'One')
    const two = store.createChat('story_1', 'Two')
    const wrapper = await mountPanel()
    const tabs = useChatTabs('story_1')
    tabs.open(one.id)
    tabs.open(two.id)
    tabs.open(one.id)
    await flushPromises()

    await tab(wrapper, one.id).find(`[aria-label="Close One"]`).trigger('click')
    await flushPromises()

    expect(shown(wrapper)).toBe(two.id)
  })

  it('puts a tab dragged along the strip where it was let go of, and keeps the chat showing', async () => {
    const one = store.createChat('story_1', 'One')
    const two = store.createChat('story_1', 'Two')
    const wrapper = await mountPanel()
    const tabs = useChatTabs('story_1')
    tabs.open(one.id)
    tabs.open(two.id)
    await flushPromises()
    const before = strip(wrapper)

    wrapper.findComponent({ name: 'TabStrip' }).vm.$emit('move', two.id, 0)
    await flushPromises()

    expect(strip(wrapper)).toEqual([two.id, ...before.filter(id => id !== two.id)])
    expect(shown(wrapper)).toBe(two.id)
  })

  it('moves on when the chat it was showing is deleted', async () => {
    const remaining = store.createChat('story_1', 'Keeps')
    const doomed = store.createChat('story_1', 'Goes')
    const wrapper = await mountPanel()
    useChatTabs('story_1').open(remaining.id)
    useChatTabs('story_1').open(doomed.id)

    await store.deleteChat(doomed.id)
    await flushPromises()

    expect(shown(wrapper)).toBe(remaining.id)
  })

  it('opens a fork beside the chat it came from', async () => {
    const one = store.createChat('story_1', 'One')
    forking.to = store.createChat('story_1', 'One - forked').id
    const other = store.createChat('story_1', 'Other')
    // The latest, so the panel opens on it: made in the same millisecond,
    // the three would tie, and it could open on the fork instead.
    one.created += 1000
    const wrapper = await mountPanel()
    const tabs = useChatTabs('story_1')
    tabs.open(other.id)
    tabs.open(one.id)
    await flushPromises()
    await wrapper.find('[data-fork]').trigger('click')
    await flushPromises()
    const open = tabs.tabs.value.open
    expect(open.indexOf(forking.to)).toBe(open.indexOf(one.id) + 1)
    expect(shown(wrapper)).toBe(forking.to)
    // Fork from here: the caret goes in the fork's box, for something to say.
    expect(focusMessage).toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('sends in the fork what its /fork brought, as if typed there', async () => {
    const one = store.createChat('story_1', 'One')
    forking.to = store.createChat('story_1', 'One - forked').id
    forking.send = 'What should I do next?'
    one.created += 1000
    const wrapper = await mountPanel()

    await wrapper.find('[data-fork]').trigger('click')
    await flushPromises()

    expect(shown(wrapper)).toBe(forking.to)
    expect(send).toHaveBeenCalledWith('What should I do next?')
  })

  it('marks a tab the model is working in, and names its profile on hover', async () => {
    const one = store.createChat('story_1', 'One')
    const two = store.createChat('story_1', 'Two')
    const wrapper = await mountPanel()
    useChatTabs('story_1').open(one.id)
    useChatTabs('story_1').open(two.id)

    reportWorking('story_1', one.id, true)
    await flushPromises()
    expect(tab(wrapper, one.id).find('[data-mark="busy"]').exists()).toBe(true)

    reportWorking('story_1', one.id, false)
    await flushPromises()
    expect(tab(wrapper, one.id).find('[data-mark="unread"]').exists()).toBe(true)

    expect(tab(wrapper, two.id).attributes('title')).toMatch(/^Two · \S/)
  })

  it('finds in the chat showing, and not in one not started', async () => {
    store.createChat('story_1', 'One')
    const wrapper = await mountPanel()

    await wrapper.find('[data-action="find"]').trigger('click')
    expect(openFind).toHaveBeenCalled()

    useChatTabs('story_1').openNew()
    await flushPromises()
    expect(wrapper.find('[data-action="find"]').exists()).toBe(false)
  })

  it('puts the editor’s toggle at the start of the strip, beside an editor', async () => {
    store.createChat('story_1', 'One')

    const alone = await mountPanel()
    expect(alone.find('[data-panel-toggle="editor"]').exists()).toBe(false)

    const beside = await mountPanel({ editorShowing: true })
    const toggle = beside.find('[data-panel-toggle="editor"]')
    expect(toggle.attributes('aria-label')).toBe('Expand chat')
    await toggle.trigger('click')
    expect(beside.emitted('toggle-editor')).toHaveLength(1)
  })

  it('says it is the chat panel, for a key that acts on the panel the writer is in', async () => {
    const wrapper = await mountPanel()
    expect(wrapper.attributes('data-panel')).toBe('chat')
  })

  it('puts the caret in the message box of the chat showing, when a key asks', async () => {
    const one = store.createChat('story_1', 'One')
    const two = store.createChat('story_1', 'Two')
    const wrapper = await mountPanel()
    const tabs = useChatTabs('story_1')
    tabs.open(one.id)
    tabs.open(two.id)
    await flushPromises()
    expect(focusMessage).not.toHaveBeenCalled()

    tabs.open(one.id)
    tabs.focus()
    await flushPromises()

    expect(shown(wrapper)).toBe(one.id)
    expect(focusMessage).toHaveBeenCalledTimes(1)
  })

  it('gives a terminal the keys instead, when that is the tab showing', async () => {
    globalThis.__INKSPRITE_DESKTOP__ = {
      terminals: {
        list: vi.fn(async () => []),
        create: vi.fn(async () => 'terminal:1'),
        close: vi.fn(),
        onEvent: vi.fn(),
      },
    }
    store.createChat('story_1', 'One')
    const wrapper = await mountPanel()
    const tabs = useChatTabs('story_1')
    await tabs.openTerminal()
    await flushPromises()
    expect(wrapper.find('[data-terminal-frame]').attributes('data-id')).toBe('terminal:1')
    framesFocused.length = 0

    tabs.focus()
    await flushPromises()

    expect(framesFocused).toEqual(['terminal:1'])
    expect(focusMessage).not.toHaveBeenCalled()
  })

  it('starts the strip with the way back to the list, where the list is behind it', async () => {
    store.createChat('story_1', 'One')

    const beside = await mountPanel()
    expect(beside.find('[data-action="back"]').exists()).toBe(false)

    const phone = await mountPanel({ showBack: true })
    await phone.find('[data-action="back"]').trigger('click')
    expect(phone.emitted('back')).toHaveLength(1)
  })

  describe('with terminals', () => {
    /** The desktop app's terminals. */
    let native
    /**
     * Says what has become of a terminal, as the desktop app tells every page.
     * @type {(id: string, event: object) => void}
     */
    let say

    beforeEach(() => {
      let made = 0
      native = {
        list: vi.fn(async () => []),
        create: vi.fn(async () => `terminal:${++made}`),
        close: vi.fn(async () => {}),
        seen: vi.fn(async () => {}),
        onEvent: vi.fn(listener => {
          say = listener
        }),
      }
      globalThis.__INKSPRITE_DESKTOP__ = { terminals: native }
      useApplicationState().setExtension('terminal', true)
    })

    afterEach(() => useApplicationState().resetState())

    const newTerminal = wrapper => wrapper.find('[data-action="new-terminal"]')
    const frames = wrapper => wrapper.findAll('[data-terminal-frame]')

    /** Open a terminal from the strip, as the writer does. */
    const openTerminal = async wrapper => {
      await newTerminal(wrapper).trigger('click')
      await flushPromises()
    }

    /** Bring a tab forward by a click on it. */
    const show = async (wrapper, id) => {
      await tab(wrapper, id).trigger('click')
      await flushPromises()
    }

    it('offers a new terminal in the desktop app, with the Terminal extension on', async () => {
      const wrapper = await mountPanel()

      expect(newTerminal(wrapper).attributes('aria-label')).toBe('New terminal')
      // Before New chat, at the end of the strip.
      const labels = wrapper.findAll('button[aria-label]').map(one => one.attributes('aria-label'))
      expect(labels.indexOf('New terminal')).toBe(labels.indexOf('New chat') - 1)
    })

    it('offers none with the extension off, in a browser, or in a desktop app from before it had terminals', async () => {
      useApplicationState().setExtension('terminal', false)
      expect(newTerminal(await mountPanel()).exists()).toBe(false)

      useApplicationState().setExtension('terminal', true)
      delete globalThis.__INKSPRITE_DESKTOP__
      expect(newTerminal(await mountPanel()).exists()).toBe(false)

      globalThis.__INKSPRITE_DESKTOP__ = {}
      expect(newTerminal(await mountPanel()).exists()).toBe(false)
    })

    it('opens a terminal in a tab beside the one showing, in the chat’s place', async () => {
      const one = store.createChat('story_1', 'One')
      const wrapper = await mountPanel()

      await openTerminal(wrapper)

      expect(native.create).toHaveBeenCalledWith('story_1')
      expect(strip(wrapper)).toEqual([one.id, 'terminal:1'])
      expect(tab(wrapper, 'terminal:1').attributes('aria-selected')).toBe('true')
      expect(wrapper.find('[data-chat]').exists()).toBe(false)
      expect(frames(wrapper).map(frame => frame.attributes('data-id'))).toEqual(['terminal:1'])
      expect(wrapper.findComponent(TerminalFrame).props()).toEqual({
        terminalId: 'terminal:1',
        active: true,
      })
    })

    it('gives the terminal the button made the keys, unless the writer put them elsewhere meanwhile', async () => {
      const wrapper = await mountPanel()
      framesFocused.length = 0

      await openTerminal(wrapper)
      expect(framesFocused).toEqual(['terminal:1'])

      // A click elsewhere while the next is being made.
      framesFocused.length = 0
      const box = document.createElement('textarea')
      document.body.append(box)
      native.create.mockImplementationOnce(async () => {
        box.focus()
        return 'terminal:2'
      })
      await openTerminal(wrapper)

      expect(tab(wrapper, 'terminal:2').attributes('aria-selected')).toBe('true')
      expect(framesFocused).toEqual([])
      expect(document.activeElement).toBe(box)
      box.remove()
    })

    it('calls a terminal’s tab Terminal until the program in it names it, and marks it as one', async () => {
      const wrapper = await mountPanel()
      await openTerminal(wrapper)

      expect(tab(wrapper, 'terminal:1').text()).toBe('Terminal')
      expect(tab(wrapper, 'terminal:1').find('[data-terminal]').exists()).toBe(true)

      say('terminal:1', { type: 'title', title: 'zsh' })
      await flushPromises()

      expect(tab(wrapper, 'terminal:1').text()).toBe('zsh')
    })

    it('shows the terminals the project already has, as after the page reloads, and no other project’s', async () => {
      native.list.mockResolvedValue([
        { id: 'terminal:4', project: 'story_1', title: 'zsh', rang: false },
        { id: 'terminal:5', project: 'story_2', title: '', rang: false },
      ])
      const one = store.createChat('story_1', 'One')
      const wrapper = await mountPanel()

      expect(strip(wrapper)).toEqual([one.id, 'terminal:4'])
      expect(tab(wrapper, 'terminal:4').text()).toBe('zsh')
      expect(frames(wrapper).map(frame => frame.attributes('data-id'))).toEqual(['terminal:4'])
    })

    it('keeps a terminal’s frame behind another tab, hidden, for going back to it at once', async () => {
      const one = store.createChat('story_1', 'One')
      const wrapper = await mountPanel()
      await openTerminal(wrapper)
      const frame = wrapper.findComponent(TerminalFrame)

      await show(wrapper, one.id)

      expect(shown(wrapper)).toBe(one.id)
      expect(wrapper.findComponent(TerminalFrame).element).toBe(frame.element)
      expect(frame.element.style.display).toBe('none')
      expect(frame.props('active')).toBe(false)

      await show(wrapper, 'terminal:1')

      expect(frame.element.style.display).not.toBe('none')
      expect(frame.props('active')).toBe(true)
      expect(wrapper.find('[data-chat]').exists()).toBe(false)
    })

    it('gives a terminal the keys when its tab is clicked', async () => {
      const one = store.createChat('story_1', 'One')
      const wrapper = await mountPanel()
      await openTerminal(wrapper)
      await show(wrapper, one.id)
      framesFocused.length = 0

      await show(wrapper, 'terminal:1')

      expect(framesFocused).toEqual(['terminal:1'])
    })

    it('marks a terminal that rang behind another tab, until it is the tab showing', async () => {
      const one = store.createChat('story_1', 'One')
      const wrapper = await mountPanel()
      await openTerminal(wrapper)
      await show(wrapper, one.id)

      say('terminal:1', { type: 'bell' })
      await flushPromises()

      expect(tab(wrapper, 'terminal:1').find('[data-mark="unread"]').exists()).toBe(true)
      expect(native.seen).not.toHaveBeenCalled()

      await show(wrapper, 'terminal:1')

      expect(tab(wrapper, 'terminal:1').find('[data-mark]').exists()).toBe(false)
      // And every other window showing the project is told.
      expect(native.seen).toHaveBeenCalledWith('terminal:1')
    })

    it('leaves unmarked a terminal that rings while it is the tab showing', async () => {
      const wrapper = await mountPanel()
      await openTerminal(wrapper)

      say('terminal:1', { type: 'bell' })
      await flushPromises()

      expect(tab(wrapper, 'terminal:1').find('[data-mark]').exists()).toBe(false)
      expect(native.seen).toHaveBeenCalledWith('terminal:1')
    })

    it('offers no Find for a terminal', async () => {
      const one = store.createChat('story_1', 'One')
      const wrapper = await mountPanel()
      expect(wrapper.find('[data-action="find"]').exists()).toBe(true)

      await openTerminal(wrapper)
      expect(wrapper.find('[data-action="find"]').exists()).toBe(false)

      await show(wrapper, one.id)
      expect(wrapper.find('[data-action="find"]').exists()).toBe(true)
    })

    it('says so when a terminal can’t be opened, and opens no tab', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      native.create.mockRejectedValue(new Error('no'))
      const one = store.createChat('story_1', 'One')
      const wrapper = await mountPanel()

      await openTerminal(wrapper)

      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith('The terminal couldn’t be opened.')
      expect(strip(wrapper)).toEqual([one.id])
      expect(shown(wrapper)).toBe(one.id)
      logged.mockRestore()
    })

    it('closes the tab of a terminal whose shell couldn’t start, and says why it went', async () => {
      const one = store.createChat('story_1', 'One')
      const wrapper = await mountPanel()
      await openTerminal(wrapper)

      say('terminal:1', { type: 'exit', failed: true })
      await flushPromises()

      expect(strip(wrapper)).toEqual([one.id])
      expect(shown(wrapper)).toBe(one.id)
      expect(frames(wrapper)).toHaveLength(0)
      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith('The terminal couldn’t start.')
    })

    it('closes the tab of a terminal whose shell has ended, and says nothing', async () => {
      const one = store.createChat('story_1', 'One')
      const wrapper = await mountPanel()
      await openTerminal(wrapper)

      say('terminal:1', { type: 'exit' })
      await flushPromises()

      expect(strip(wrapper)).toEqual([one.id])
      expect(shown(wrapper)).toBe(one.id)
      expect(toastError).not.toHaveBeenCalled()
      // It has ended already: there is nothing to end.
      expect(native.close).not.toHaveBeenCalled()
    })

    it('says nothing of a terminal that couldn’t start in another project', async () => {
      await mountPanel()

      say('terminal:9', { type: 'made', project: 'story_2' })
      say('terminal:9', { type: 'exit', failed: true })
      await flushPromises()

      expect(toastError).not.toHaveBeenCalled()
    })

    it('ends a terminal when its tab is closed, and goes back to the chat it came from', async () => {
      const one = store.createChat('story_1', 'One')
      const wrapper = await mountPanel()
      await openTerminal(wrapper)

      await tab(wrapper, 'terminal:1').find('[aria-label="Close Terminal"]').trigger('click')
      await flushPromises()

      expect(native.close).toHaveBeenCalledWith('terminal:1')
      expect(strip(wrapper)).toEqual([one.id])
      expect(shown(wrapper)).toBe(one.id)
      expect(frames(wrapper)).toHaveLength(0)
      expect(toastError).not.toHaveBeenCalled()
    })

    it('offers only closing on a terminal’s tab, which has no chat to export or delete', async () => {
      const one = store.createChat('story_1', 'One')
      const wrapper = await mountPanel()
      await openTerminal(wrapper)
      const menu = wrapper.findComponent({ name: 'ContextMenu' })
      const offered = () => menu.props('model').map(item => item.label ?? '-')

      await tab(wrapper, one.id).trigger('contextmenu')
      expect(offered()).toEqual(['Close', 'Close others', '-', 'Export', 'Delete'])

      await tab(wrapper, 'terminal:1').trigger('contextmenu')
      expect(offered()).toEqual(['Close', 'Close others'])

      menu.props('model')[0].command()
      await flushPromises()
      expect(native.close).toHaveBeenCalledWith('terminal:1')
      expect(strip(wrapper)).toEqual([one.id])
    })

    it('keeps a terminal that is open when the extension goes off, and offers no new one', async () => {
      const wrapper = await mountPanel()
      await openTerminal(wrapper)

      useApplicationState().setExtension('terminal', false)
      await flushPromises()

      expect(newTerminal(wrapper).exists()).toBe(false)
      expect(strip(wrapper)).toContain('terminal:1')
      expect(frames(wrapper)).toHaveLength(1)
      expect(native.close).not.toHaveBeenCalled()
    })
  })
})
