import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ChatPrompts from '@/components/writer/chats/settings/ChatPrompts.vue'

/** The chat's settings, as useChatSettings hands them over. */
const settings = {
  selectedProfile: ref(/** @type {any} */ ({ settings: { rules: 'Keep it short.' } })),
  note: ref('Keep it short.'),
  setNote: vi.fn(),
  isRoleplay: ref(false),
  prompt: ref('You help with a novel.'),
  profilePrompt: ref('You help with a novel.'),
  setPrompt: vi.fn(),
  promptUnsaved: ref(false),
  noteUnsaved: ref(false),
  savePrompt: vi.fn(),
  saveNote: vi.fn(),
}
vi.mock('@/composables/useChatSettings', () => ({ useChatSettings: () => settings }))

const openDocument = vi.fn()
vi.mock('@/composables/useDocuments', () => ({ useDocuments: () => ({ open: openDocument }) }))

const showEditor = vi.fn()
vi.mock('@/composables/useEditorRequest.js', () => ({
  useEditorRequest: () => ({ show: showEditor }),
}))

/** The scene's fields, reduced to whose they are. */
const ChatRoleplay = {
  props: ['storyId', 'chatId'],
  emits: ['close'],
  template: '<div data-roleplay :data-chat="chatId" @click="$emit(\'close\')" />',
}

const mountPrompts = () =>
  mount(ChatPrompts, {
    props: { storyId: 'story_1', chatId: 'chat_1' },
    global: { plugins: [PrimeVue], directives: { tooltip: {} }, stubs: { ChatRoleplay } },
  })

/** A text's field, by its name: an apostrophe in one is more than a selector takes. */
const field = (wrapper, label) =>
  wrapper.findAll('textarea').find(one => one.attributes('aria-label') === label)

describe('ChatPrompts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage?.clear?.()
    settings.isRoleplay.value = false
    settings.prompt.value = 'You help with a novel.'
    settings.note.value = 'Keep it short.'
    settings.promptUnsaved.value = false
    settings.noteUnsaved.value = false
  })

  it('shows the chat’s system prompt and its author’s note, and writes each as it is typed', async () => {
    const wrapper = mountPrompts()

    expect(field(wrapper, 'System prompt').element.value).toBe('You help with a novel.')
    expect(field(wrapper, "Author's note").element.value).toBe('Keep it short.')

    await field(wrapper, 'System prompt').setValue('You edit a novel.')
    expect(settings.setPrompt).toHaveBeenCalledWith('You edit a novel.')

    await field(wrapper, "Author's note").setValue('Longer is fine.')
    expect(settings.setNote).toHaveBeenCalledWith('Longer is fine.')
  })

  it('takes a prompt changed from outside, as a switch of profile changes it', async () => {
    const wrapper = mountPrompts()

    settings.prompt.value = 'You run a scene.'
    settings.note.value = ''
    await wrapper.vm.$nextTick()

    expect(field(wrapper, 'System prompt').element.value).toBe('You run a scene.')
    expect(field(wrapper, "Author's note").element.value).toBe('')
  })

  it('opens either text in a tab of the editor, and asks for the settings to close', async () => {
    const wrapper = mountPrompts()

    await wrapper.find('[data-action="open-prompt"]').trigger('click')
    await wrapper.find('[data-action="open-note"]').trigger('click')

    expect(openDocument).toHaveBeenCalledTimes(2)
    const [[promptTab], [noteTab]] = openDocument.mock.calls
    expect(promptTab).toContain('chat_1')
    expect(noteTab).toContain('chat_1')
    expect(promptTab).not.toBe(noteTab)
    expect(showEditor).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  it('has no Roleplay subsection in a chat that is not a roleplay', () => {
    const wrapper = mountPrompts()

    expect(wrapper.find('[data-prompts-roleplay]').exists()).toBe(false)
    expect(wrapper.find('[data-roleplay]').exists()).toBe(false)
  })

  it('has the scene under the prompts in a roleplay chat, open from the start', async () => {
    settings.isRoleplay.value = true
    const wrapper = mountPrompts()
    const section = wrapper.find('[data-prompts-roleplay]')

    expect(section.exists()).toBe(true)
    const heading = section.find('h3 button')
    expect(heading.text()).toBe('Roleplay')
    expect(heading.attributes('aria-expanded')).toBe('true')
    expect(section.find('[data-roleplay]').attributes('data-chat')).toBe('chat_1')
    // After both prompts.
    const html = wrapper.html()
    expect(html.indexOf('data-prompts-roleplay')).toBeGreaterThan(
      html.indexOf('aria-label="Author\'s note"')
    )

    // The scene closing the settings, for a text it opened, is passed on.
    await section.find('[data-roleplay]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('comes and goes as the chat moves onto a roleplay profile and off it', async () => {
    const wrapper = mountPrompts()

    settings.isRoleplay.value = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-prompts-roleplay]').exists()).toBe(true)

    settings.isRoleplay.value = false
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-prompts-roleplay]').exists()).toBe(false)
  })
})
