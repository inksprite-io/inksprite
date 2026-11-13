import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ChatRoleplay from '@/components/writer/chats/settings/ChatRoleplay.vue'
import { chatTabId } from '@/utils/chatTabs.js'

/** The scene's settings, as useChatSettings hands them over. */
const settings = {
  roleplay: ref({
    userName: 'Mara',
    characterName: 'Wren',
    prompt: 'Stay in the scene.',
    postHistory: '',
  }),
  setUserName: vi.fn(),
  setCharacterName: vi.fn(),
  setRoleplayPrompt: vi.fn(),
  setPostHistory: vi.fn(),
}
vi.mock('@/composables/useChatSettings', () => ({ useChatSettings: () => settings }))

const openDocument = vi.fn()
vi.mock('@/composables/useDocuments', () => ({ useDocuments: () => ({ open: openDocument }) }))

const showEditor = vi.fn()
vi.mock('@/composables/useEditorRequest.js', () => ({
  useEditorRequest: () => ({ show: showEditor }),
}))

const mountRoleplay = () =>
  mount(ChatRoleplay, {
    props: { storyId: 'story_1', chatId: 'chat_1' },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })

const field = (wrapper, name) => wrapper.find(`[data-roleplay="${name}"]`)

describe('ChatRoleplay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settings.roleplay.value = {
      userName: 'Mara',
      characterName: 'Wren',
      prompt: 'Stay in the scene.',
      postHistory: '',
    }
  })

  it('shows the names, the roleplay prompt and the post-history instructions', () => {
    const wrapper = mountRoleplay()

    expect(field(wrapper, 'user').element.value).toBe('Mara')
    expect(field(wrapper, 'character').element.value).toBe('Wren')
    expect(field(wrapper, 'prompt').element.value).toBe('Stay in the scene.')
    expect(field(wrapper, 'post-history').element.value).toBe('')
  })

  it('writes each to the chat as it is typed', async () => {
    const wrapper = mountRoleplay()

    await field(wrapper, 'user').setValue('Mara Voss')
    expect(settings.setUserName).toHaveBeenCalledWith('Mara Voss')

    await field(wrapper, 'character').setValue('Wren the Younger')
    expect(settings.setCharacterName).toHaveBeenCalledWith('Wren the Younger')

    await field(wrapper, 'prompt').setValue('Stay in the scene, briefly.')
    expect(settings.setRoleplayPrompt).toHaveBeenCalledWith('Stay in the scene, briefly.')

    await field(wrapper, 'post-history').setValue('End on a question.')
    expect(settings.setPostHistory).toHaveBeenCalledWith('End on a question.')
  })

  it('takes a value changed from outside, and leaves the others as they were typed', async () => {
    const wrapper = mountRoleplay()
    await field(wrapper, 'user').setValue('Mara ')

    settings.roleplay.value = { ...settings.roleplay.value, characterName: 'Finch' }
    await wrapper.vm.$nextTick()

    expect(field(wrapper, 'character').element.value).toBe('Finch')
    expect(field(wrapper, 'user').element.value).toBe('Mara ')
  })

  it('opens either text in a tab of the editor, and asks for the settings to close', async () => {
    const wrapper = mountRoleplay()

    await wrapper.find('[data-action="open-roleplay-prompt"]').trigger('click')
    await wrapper.find('[data-action="open-post-history"]').trigger('click')

    expect(openDocument.mock.calls).toEqual([
      [chatTabId('chat_1', 'roleplay-prompt')],
      [chatTabId('chat_1', 'post-history')],
    ])
    expect(showEditor).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('close')).toHaveLength(2)
  })
})
