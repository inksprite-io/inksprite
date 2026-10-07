import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ChatSettings from '@/components/writer/chats/ChatSettings.vue'
import { useProfiles } from '@/composables/useProfiles'
import { useChatProfileStore } from '@/stores/chatProfileStore'
import { DEFAULT_CHAT_PROMPT } from '@/ai/prompts/index.js'
import { CHAT_PROFILE_ID, ROLEPLAY_PROFILE_ID } from '@/ai/profiles/index.js'
import { setLibrarySkills } from '@/ai/skills/index.js'
import { useApplicationState } from '@/composables/useApplicationState'

/** The writer's skills library, as the mocked database holds it. */
const { storedSkills, storedServers } = vi.hoisted(() => ({ storedSkills: [], storedServers: [] }))

vi.mock('@/stores/db', () => ({
  default: {
    chatProfiles: { toArray: vi.fn().mockResolvedValue([]), filter: vi.fn(), bulkDelete: vi.fn() },
    skills: { toArray: vi.fn(async () => [...storedSkills]) },
    mcpServers: { toArray: vi.fn(async () => [...storedServers]) },
  },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

/** The chat being configured, as the mocked chats API holds it. */
const chat = ref({})
const updateChat = vi.fn((id, updates) => {
  chat.value = { ...chat.value, ...updates }
})
const defaultProfileId = vi.fn(() => CHAT_PROFILE_ID)
const preset = ref({ toolsEnabled: true, generationOverrides: {} })

/** The story's unstarted chat, as the mocked chats API holds it. */
const unstartedChat = ref({})
const updateUnstartedChat = vi.fn(updates => {
  unstartedChat.value = { ...unstartedChat.value, ...updates }
})

/** The chat's messages, for what it has loaded. */
const chatMessages = ref([])
const updateMessage = vi.fn()
const writeSegment = vi.fn()

vi.mock('@/composables/useChats', () => ({
  useChats: () => ({
    getChatById: () => chat.value,
    getMessagesForChat: id => (id === 'chat_1' ? chatMessages : ref([])),
    updateMessage,
    writeSegment,
    updateChat,
    defaultProfileId,
    unstartedChat,
    isUnstarted: id => id === 'chat_unstarted',
    updateUnstartedChat,
  }),
}))
vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ activeAIPreset: preset }),
}))

/** The project's voices, as the mocked narration holds them. */
const voices = ref([
  { id: 'narrator', name: 'Narrator', voice: 'af_heart' },
  { id: 'voice_riley', name: 'Riley', voice: 'af_nicole' },
])
vi.mock('@/composables/useNarration', () => ({
  useNarration: () => ({
    voices,
    defaultVoiceId: ref('narrator'),
    voiceById: id => voices.value.find(voice => voice.id === id) ?? null,
  }),
}))

async function mountSettings(chatId = 'chat_1', options = {}) {
  const wrapper = mount(ChatSettings, {
    ...options,
    props: { storyId: 'story_1', chatId },
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      // The AI section reaches for a Toast provider through the model
      // selector, and none of this is about which model answers.
      // ExpandableSection is stubbed open so the sections' contents are there
      // to find without clicking five headers first.
      stubs: {
        AiPresetGroup: true,
        ExpandableSection: { template: '<div><slot name="actions" /><slot /></div>' },
      },
    },
  })
  await flushPromises()
  return wrapper
}

const promptField = wrapper => wrapper.find('textarea')
const button = (wrapper, label) => wrapper.find(`button[aria-label="${label}"]`)

/** The profiles of the writer's own, as the library lists them. */
const saved = library => library.profiles.value.filter(one => !one.readOnly)

describe('ChatSettings profile', () => {
  /** @type {ReturnType<typeof useProfiles>} */
  let library

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    chat.value = { id: 'chat_1', storyId: 'story_1', profileId: CHAT_PROFILE_ID }
    library = useProfiles()
    await useChatProfileStore().ensureInitialized()
  })

  it('shows the prompt of the profile the chat is on', async () => {
    const wrapper = await mountSettings()

    expect(promptField(wrapper).element.value).toBe(DEFAULT_CHAT_PROMPT)
  })

  it("saves edits to a profile of the writer's own as they are typed", async () => {
    const editor = library.saveProfile('Editor', { prompt: 'Be terse.' })
    chat.value.profileId = editor.id
    const wrapper = await mountSettings()

    await promptField(wrapper).setValue('Be very terse.')

    // The prompt lives on the profile, so it changes for every chat on it.
    expect(library.getProfile(editor.id).settings.prompt).toBe('Be very terse.')
    expect(updateChat).not.toHaveBeenCalled()
  })

  it('forks a copy when a built-in is edited, and moves the chat onto it', async () => {
    const wrapper = await mountSettings()

    await promptField(wrapper).setValue('Run a heist.')
    await flushPromises()

    const [copy] = saved(library)
    expect(copy.name).toBe('Default copy')
    expect(copy.settings.prompt).toBe('Run a heist.')
    expect(updateChat).toHaveBeenCalledWith('chat_1', { profileId: copy.id })
    expect(promptField(wrapper).element.value).toBe('Run a heist.')
  })

  it('keeps editing the copy after the fork', async () => {
    const wrapper = await mountSettings()
    await promptField(wrapper).setValue('Run a heist.')
    await flushPromises()

    await promptField(wrapper).setValue('Run a heist in Venice.')

    expect(saved(library)).toHaveLength(1)
    expect(saved(library)[0].settings.prompt).toBe('Run a heist in Venice.')
  })

  it('carries the whole profile onto the copy, not just its prompt', async () => {
    chat.value.profileId = 'builtin_profile_roleplay'
    const wrapper = await mountSettings()

    await promptField(wrapper).setValue('Play someone else.')
    await flushPromises()

    // A prompt without the tools it was written for is half an answer.
    const [copy] = saved(library)
    expect(copy.settings.disabledToolGroups).toEqual(['documents', 'rpg', 'skills'])
  })

  it('offers a way back to the project default only when off it', async () => {
    const wrapper = await mountSettings()
    expect(button(wrapper, 'Reset Profile').exists()).toBe(false)

    chat.value = { ...chat.value, profileId: ROLEPLAY_PROFILE_ID }
    await flushPromises()
    await button(wrapper, 'Reset Profile').trigger('click')

    expect(chat.value.profileId).toBe(CHAT_PROFILE_ID)
  })

  it('stamps the settings of a profile the chat is switched to', async () => {
    const wrapper = await mountSettings()

    chat.value = { ...chat.value, profileId: ROLEPLAY_PROFILE_ID }
    await flushPromises()
    await button(wrapper, 'Reset Profile').trigger('click')

    // A chat that silently retooled itself when its profile changed would be
    // a chat whose settings nobody could trust — so they are stamped, not
    // followed.
    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { profileId: CHAT_PROFILE_ID })
  })
  it("deletes one of the writer's own from its right-click menu in the picker", async () => {
    const mine = library.saveProfile('Mine', { prompt: 'Be terse.' })
    chat.value.profileId = mine.id
    const wrapper = await mountSettings('chat_1', { attachTo: document.body })

    await wrapper.find('.p-select').trigger('click')
    await flushPromises()
    // A right click is a press of the right button before it is a context
    // menu, and the press must not pick the profile.
    const option = document.body.querySelector(`[data-profile="${mine.id}"]`)
    option.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 2 }))
    option.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(updateChat).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull()
    const remove = [...document.body.querySelectorAll('.p-contextmenu [role="menuitem"]')].find(
      item => item.textContent.trim() === 'Delete profile'
    )
    remove.querySelector('a').click()
    await flushPromises()

    expect(library.getProfile(mine.id)).toBeNull()
    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { profileId: CHAT_PROFILE_ID })
    wrapper.unmount()
  })

  it('offers no right-click menu on a built-in in the picker', async () => {
    const wrapper = await mountSettings('chat_1', { attachTo: document.body })

    await wrapper.find('.p-select').trigger('click')
    await flushPromises()
    document.body
      .querySelector(`[data-profile="${ROLEPLAY_PROFILE_ID}"]`)
      .dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(document.body.querySelector('.p-contextmenu')).toBeNull()
    wrapper.unmount()
  })
})

describe('ChatSettings author’s note', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    chat.value = {}
    updateChat.mockClear()
  })

  const rulesField = wrapper => wrapper.find('textarea[aria-label^="Author"]')

  it("shows the chat's author's note", async () => {
    chat.value.rules = 'Never write for the player.'
    const wrapper = await mountSettings()

    expect(rulesField(wrapper).element.value).toBe('Never write for the player.')
  })

  it('saves them trimmed as they are typed', async () => {
    const wrapper = await mountSettings()

    await rulesField(wrapper).setValue('  Two paragraphs at most.  ')

    expect(updateChat).toHaveBeenCalledWith('chat_1', { rules: 'Two paragraphs at most.' })
  })

  it('stores nothing rather than an empty string when they are cleared', async () => {
    chat.value.rules = 'Never write for the player.'
    const wrapper = await mountSettings()

    await rulesField(wrapper).setValue('   ')

    // An empty string and no note at all mean the same thing to the turn, and
    // only one of them should reach the row.
    expect(updateChat).toHaveBeenCalledWith('chat_1', { rules: undefined })
  })
})

describe('ChatSettings voice', () => {
  const voiceSelect = wrapper =>
    wrapper
      .findAllComponents({ name: 'Select' })
      .find(select => select.attributes('data-chat-voice') !== undefined)
  const resetVoice = wrapper => wrapper.find('button[aria-label="Reset Assistant Voice"]')

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    chat.value = { id: 'chat_1', storyId: 'story_1', profileId: CHAT_PROFILE_ID }
    await useChatProfileStore().ensureInitialized()
  })

  it("shows the project's default until the chat picks a voice of its own", async () => {
    const wrapper = await mountSettings()
    expect(voiceSelect(wrapper).props('modelValue')).toBe('narrator')
    expect(voiceSelect(wrapper).props('options')).toEqual(voices.value)
    expect(resetVoice(wrapper).exists()).toBe(false)
  })

  it('keeps the voice picked on the chat, and offers the way back', async () => {
    const wrapper = await mountSettings()
    await voiceSelect(wrapper).vm.$emit('update:modelValue', 'voice_riley')

    expect(updateChat).toHaveBeenCalledWith('chat_1', { voiceId: 'voice_riley' })
    expect(voiceSelect(wrapper).props('modelValue')).toBe('voice_riley')

    await resetVoice(wrapper).trigger('click')
    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { voiceId: null })
    expect(voiceSelect(wrapper).props('modelValue')).toBe('narrator')
  })

  it('shows the default for a voice the project no longer has', async () => {
    chat.value.voiceId = 'voice_gone'
    const wrapper = await mountSettings()
    expect(voiceSelect(wrapper).props('modelValue')).toBe('narrator')
    expect(resetVoice(wrapper).exists()).toBe(false)
  })
})

describe('ChatSettings tools', () => {
  const toggle = (wrapper, label) =>
    wrapper
      .findAllComponents({ name: 'ToggleSwitch' })
      .find(one => one.props('ariaLabel') === label)

  beforeEach(() => {
    setActivePinia(createPinia())
    chat.value = {}
    updateChat.mockClear()
    preset.value = { toolsEnabled: true, generationOverrides: {} }
  })

  it('leaves the skills out of the tool list, since they have a section', async () => {
    const wrapper = await mountSettings()

    // One switch per thing, in the place that explains what it is.
    expect(toggle(wrapper, 'Documents tools')).toBeDefined()
    expect(toggle(wrapper, 'Skills tools')).toBeUndefined()
  })

  it('switches every group in the list off and on at once', async () => {
    chat.value.disabledTools = ['roll_dice']
    const wrapper = await mountSettings()
    expect(toggle(wrapper, 'Enable Tools').props('modelValue')).toBe(true)

    await toggle(wrapper, 'Enable Tools').vm.$emit('update:modelValue', false)

    expect(updateChat).toHaveBeenLastCalledWith('chat_1', {
      disabledToolGroups: ['documents', 'rpg'],
    })
    expect(toggle(wrapper, 'Enable Tools').props('modelValue')).toBe(false)
    expect(toggle(wrapper, 'Documents tools').props('modelValue')).toBe(false)

    await toggle(wrapper, 'Enable Tools').vm.$emit('update:modelValue', true)

    // Each tool's own switch is as it was: the groups came back, not the tools.
    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { disabledToolGroups: [] })
    expect(chat.value.disabledTools).toEqual(['roll_dice'])
  })

  it('leaves the skills alone when switching all tools', async () => {
    chat.value.disabledToolGroups = ['skills']
    const wrapper = await mountSettings()

    await toggle(wrapper, 'Enable Tools').vm.$emit('update:modelValue', false)
    await toggle(wrapper, 'Enable Tools').vm.$emit('update:modelValue', true)

    expect(chat.value.disabledToolGroups).toEqual(['skills'])
  })

  it('applies edits automatically, or asks first, app-wide rather than on the chat', async () => {
    const { applyEdits, setApplyEdits } = useApplicationState()
    setApplyEdits('auto')
    const wrapper = await mountSettings()
    const edits = () => toggle(wrapper, 'Apply edits automatically')
    expect(edits().props('modelValue')).toBe(true)

    await edits().vm.$emit('update:modelValue', false)

    expect(applyEdits.value).toBe('ask')
    expect(edits().props('modelValue')).toBe(false)
    expect(updateChat).not.toHaveBeenCalled()

    await edits().vm.$emit('update:modelValue', true)
    expect(applyEdits.value).toBe('auto')
  })

  it('reads as off, and cannot be switched, when the preset has no tools', async () => {
    preset.value = { toolsEnabled: false, generationOverrides: {} }
    const wrapper = await mountSettings()

    expect(toggle(wrapper, 'Enable Tools').props('modelValue')).toBe(false)
    expect(toggle(wrapper, 'Enable Tools').props('disabled')).toBe(true)
  })

  it('switches one skill off on its own', async () => {
    const wrapper = await mountSettings()

    await toggle(wrapper, 'Director available to the model').vm.$emit('update:modelValue', false)

    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { disabledTools: ['director'] })
  })

  it('switches on only the skill asked for when a profile shipped them all off', async () => {
    chat.value.disabledToolGroups = ['documents', 'rpg', 'skills']
    const wrapper = await mountSettings()
    const director = () => toggle(wrapper, 'Director available to the model')
    expect(director().props('modelValue')).toBe(false)
    // Not a dead switch: nothing else in the panel can lift the group.
    expect(director().props('disabled')).toBe(false)

    await director().vm.$emit('update:modelValue', true)

    expect(chat.value.disabledToolGroups).toEqual(['documents', 'rpg'])
    expect(chat.value.disabledTools).toEqual(['interpret'])
    expect(director().props('modelValue')).toBe(true)
    expect(toggle(wrapper, 'Interpret available to the model').props('modelValue')).toBe(false)
  })
})

describe('ChatSettings skills the chat has loaded', () => {
  const style = {
    id: 'skill_style',
    name: 'house-style',
    text: '---\nname: house-style\ndescription: The house style.\n---\n\nPast tense.\n',
  }

  /** A turn that loaded the house style. */
  const loadedTurn = {
    id: 'm1',
    role: 'assistant',
    content: 'Noted.',
    metadata: {
      apiTrajectory: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'L1',
              type: 'function',
              function: { name: 'use_skill', arguments: '{"name":"house-style"}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'L1',
          content: '{"name":"house-style","instructions":"Past tense."}',
        },
      ],
    },
  }

  const toggle = (wrapper, label) =>
    wrapper
      .findAllComponents({ name: 'ToggleSwitch' })
      .find(one => one.props('ariaLabel') === label)

  beforeEach(() => {
    setActivePinia(createPinia())
    chat.value = {}
    updateChat.mockClear()
    updateMessage.mockClear()
    preset.value = { toolsEnabled: true, generationOverrides: {} }
    storedSkills.splice(0, storedSkills.length, style)
  })

  afterEach(() => {
    storedSkills.splice(0, storedSkills.length)
    setLibrarySkills([])
    chatMessages.value = []
  })

  it('gives a skill the model loads a switch of its own, by its name', async () => {
    const wrapper = await mountSettings()

    await toggle(wrapper, 'House style available to the model').vm.$emit('update:modelValue', false)

    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { disabledTools: ['house-style'] })
  })

  it('says a skill is loaded here only when it is', async () => {
    expect((await mountSettings()).find('[data-skill-loaded]').exists()).toBe(false)

    chatMessages.value = [loadedTurn]
    expect((await mountSettings()).find('[data-skill-loaded]').exists()).toBe(true)
  })

  it('drops it from the turn that loaded it, without editing the turn', async () => {
    chatMessages.value = [loadedTurn]
    const wrapper = await mountSettings()

    await wrapper.find('[data-action="drop-skill"]').trigger('click')

    expect(updateMessage).toHaveBeenCalledTimes(1)
    const [id, patch] = updateMessage.mock.calls[0]
    expect(id).toBe('m1')
    expect(Object.keys(patch)).toEqual(['metadata'])
    expect(patch.metadata.apiTrajectory[1]._dropped).toBe(true)
  })

  it('says a dropped skill goes at the next summary, with nothing more to drop', async () => {
    const [call, result] = loadedTurn.metadata.apiTrajectory
    chatMessages.value = [
      { ...loadedTurn, metadata: { apiTrajectory: [call, { ...result, _dropped: true }] } },
    ]
    const wrapper = await mountSettings()

    expect(wrapper.find('[data-skill-loaded]').exists()).toBe(true)
    expect(wrapper.find('[data-skill-dropped]').text()).toContain('until the next summary')
    expect(wrapper.find('[data-action="drop-skill"]').exists()).toBe(false)
  })
})

describe('ChatSettings servers', () => {
  const wiki = {
    id: 'mcp_wiki',
    name: 'Wiki',
    prefix: 'wiki',
    url: 'https://wiki.example/mcp',
    tools: [
      { name: 'search', title: 'Search', exposed: 'wiki__search', inputSchema: {} },
      { name: 'edit', exposed: 'wiki__edit', inputSchema: {} },
    ],
    prompts: [],
    profiles: [CHAT_PROFILE_ID],
    allowed: [],
    created: 1,
    updated: 1,
  }

  const toggle = (wrapper, label) =>
    wrapper
      .findAllComponents({ name: 'ToggleSwitch' })
      .find(one => one.props('ariaLabel') === label)

  beforeEach(() => {
    setActivePinia(createPinia())
    chat.value = {}
    updateChat.mockClear()
    preset.value = { toolsEnabled: true, generationOverrides: {} }
    storedServers.splice(0, storedServers.length, wiki)
  })

  afterEach(() => {
    storedServers.splice(0, storedServers.length)
  })

  it('lists a server under Tools, on for a chat whose profile it is used with', async () => {
    const wrapper = await mountSettings()

    expect(toggle(wrapper, 'Wiki tools').props('modelValue')).toBe(true)
    expect(toggle(wrapper, 'Search')).toBeDefined()
  })

  it('is off for a chat on a profile it is not used with', async () => {
    storedServers.splice(0, 1, { ...wiki, profiles: [] })
    const wrapper = await mountSettings()

    expect(toggle(wrapper, 'Wiki tools').props('modelValue')).toBe(false)
  })

  it('writes the chat’s own choice the first time it is switched', async () => {
    const wrapper = await mountSettings()

    await toggle(wrapper, 'Wiki tools').vm.$emit('update:modelValue', false)
    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { mcpServers: [] })

    await toggle(wrapper, 'Wiki tools').vm.$emit('update:modelValue', true)
    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { mcpServers: ['mcp_wiki'] })
  })

  it('switches one of its tools off by the name the model calls it', async () => {
    const wrapper = await mountSettings()

    await toggle(wrapper, 'Search').vm.$emit('update:modelValue', false)

    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { disabledTools: ['wiki__search'] })
  })
})

describe('ChatSettings voices', () => {
  const userVoiceSelect = wrapper =>
    wrapper
      .findAllComponents({ name: 'Select' })
      .find(select => select.attributes('data-chat-user-voice') !== undefined)
  const resetUserVoice = wrapper => wrapper.find('button[aria-label="Reset Your Voice"]')

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    chat.value = { id: 'chat_1', storyId: 'story_1', profileId: CHAT_PROFILE_ID }
    await useChatProfileStore().ensureInitialized()
  })

  it("reads the writer's messages in the assistant's voice until told otherwise", async () => {
    chat.value.voiceId = 'voice_riley'
    const wrapper = await mountSettings()

    // Falling back to the assistant's rather than the project's default keeps
    // one voice for the whole chat as one setting.
    expect(userVoiceSelect(wrapper).props('modelValue')).toBe('voice_riley')
    expect(resetUserVoice(wrapper).exists()).toBe(false)
  })

  it('keeps a voice picked for the writer, and offers the way back', async () => {
    const wrapper = await mountSettings()
    await userVoiceSelect(wrapper).vm.$emit('update:modelValue', 'voice_riley')

    expect(updateChat).toHaveBeenCalledWith('chat_1', { userVoiceId: 'voice_riley' })

    await resetUserVoice(wrapper).trigger('click')
    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { userVoiceId: null })
  })
})

describe('ChatSettings on a chat not started yet', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    chat.value = null
    unstartedChat.value = {
      id: 'chat_unstarted',
      profileId: CHAT_PROFILE_ID,
      rules: 'Keep it short.',
    }
    await useChatProfileStore().ensureInitialized()
  })

  it('shows and keeps its settings without touching any saved chat', async () => {
    const wrapper = await mountSettings('chat_unstarted')
    const note = wrapper.findAll('textarea').find(one => one.element.value === 'Keep it short.')
    expect(note).toBeDefined()

    await note.setValue('Keep it shorter.')

    expect(updateUnstartedChat).toHaveBeenCalledWith({ rules: 'Keep it shorter.' })
    expect(updateChat).not.toHaveBeenCalled()
  })
})
