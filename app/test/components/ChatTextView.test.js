import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { EditorView } from '@codemirror/view'
import ChatTextView from '@/components/writer/editor/ChatTextView.vue'

const { settings, chats } = vi.hoisted(() => ({
  settings: {
    prompt: /** @type {any} */ (null),
    note: /** @type {any} */ (null),
    setPrompt: vi.fn(),
    setNote: vi.fn(),
  },
  chats: { init: vi.fn(async () => {}) },
}))

vi.mock('@/composables/useChatSettings.js', () => ({ useChatSettings: () => settings }))
vi.mock('@/composables/useChats.js', () => ({ useChats: () => chats }))

// The bar's own workings are FindBar's business.
const FindBar = { name: 'FindBar', template: '<div data-find />', methods: { focus() {} } }

const mountView = async text => {
  const wrapper = mount(ChatTextView, {
    props: { storyId: 'story_1', chatId: 'chat_1', text },
    attachTo: document.body,
    global: { stubs: { FindBar } },
  })
  await flushPromises()
  return wrapper
}

/** @returns {EditorView} */
const viewIn = wrapper => EditorView.findFromDOM(wrapper.find('.cm-editor').element)
const shown = wrapper => viewIn(wrapper).state.doc.toString()

/** Type at the end of the text, the way a keystroke would come through. */
const typeAtEnd = async (wrapper, value) => {
  const view = viewIn(wrapper)
  const end = view.state.doc.length
  view.dispatch({ changes: { from: end, insert: value }, userEvent: 'input.type' })
  await flushPromises()
}

describe('ChatTextView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settings.prompt = ref('You are a heist planner.')
    settings.note = ref(undefined)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('waits for the chats, so the chat reads as on its own profile', async () => {
    let loaded
    chats.init.mockImplementationOnce(() => new Promise(resolve => (loaded = resolve)))
    const wrapper = mount(ChatTextView, {
      props: { storyId: 'story_1', chatId: 'chat_1', text: 'prompt' },
      global: { stubs: { FindBar } },
    })
    await flushPromises()
    expect(wrapper.find('.cm-editor').exists()).toBe(false)

    loaded()
    await flushPromises()
    expect(wrapper.find('.cm-editor').exists()).toBe(true)
  })

  it('shows the system prompt, and puts what is typed into it', async () => {
    const wrapper = await mountView('prompt')
    expect(shown(wrapper)).toBe('You are a heist planner.')

    await typeAtEnd(wrapper, ' Be brief.')

    expect(settings.setPrompt).toHaveBeenCalledWith('You are a heist planner. Be brief.')
    expect(settings.setNote).not.toHaveBeenCalled()
  })

  it('shows the author’s note, empty when there is none, and puts what is typed into it', async () => {
    const wrapper = await mountView('note')
    expect(shown(wrapper)).toBe('')

    await typeAtEnd(wrapper, 'Past tense.')

    expect(settings.setNote).toHaveBeenCalledWith('Past tense.')
    expect(settings.setPrompt).not.toHaveBeenCalled()
  })

  it('follows the text as it is changed elsewhere, in the chat’s settings', async () => {
    const wrapper = await mountView('prompt')

    settings.prompt.value = 'You are a heist planner in Venice.'
    await flushPromises()

    expect(shown(wrapper)).toBe('You are a heist planner in Venice.')
    expect(settings.setPrompt).not.toHaveBeenCalled()
  })

  it('has a find of its own', async () => {
    const wrapper = await mountView('prompt')

    expect(wrapper.vm.openFind()).toBe(true)
    await flushPromises()

    expect(wrapper.find('[data-find]').exists()).toBe(true)
  })
})
