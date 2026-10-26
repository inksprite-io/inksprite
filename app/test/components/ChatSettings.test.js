import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computed, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ChatSettings from '@/components/writer/chats/ChatSettings.vue'
import { useProfiles } from '@/composables/useProfiles'
import { useSidebarTab } from '@/composables/useSidebarTab.js'
import { useEditorRequest } from '@/composables/useEditorRequest.js'
import { useChatProfileStore } from '@/stores/chatProfileStore'
import {
  DEFAULT_CHAT_PROMPT,
  DEFAULT_ROLEPLAY_NOTE,
  DEFAULT_ROLEPLAY_NSFW_NOTE,
} from '@/ai/prompts/index.js'
import {
  CHAT_PROFILE_ID,
  ROLEPLAY_PROFILE_ID,
  ROLEPLAY_NSFW_PROFILE_ID,
} from '@/ai/profiles/index.js'
import {
  INTERPRET_PROMPT,
  setExperimentalSkills,
  setLibrarySkills,
  setSkillWordings,
} from '@/ai/skills/index.js'
import { useSkillStore } from '@/stores/skillStore'
import { useApplicationState } from '@/composables/useApplicationState'
import { setWebSearch } from '@/web/config.js'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'

/** The writer's skills library, as the mocked database holds it. */
const { storedSkills, storedWordings, storedServers, storedWeb } = vi.hoisted(() => ({
  storedSkills: [],
  storedWordings: [],
  storedServers: [],
  /** The web search setup, when there is one. */
  storedWeb: { value: /** @type {any} */ (undefined) },
}))

vi.mock('@/stores/db', () => ({
  default: {
    chatProfiles: { toArray: vi.fn().mockResolvedValue([]), filter: vi.fn(), bulkDelete: vi.fn() },
    skills: { toArray: vi.fn(async () => [...storedSkills]) },
    skillWordings: { toArray: vi.fn(async () => [...storedWordings]) },
    mcpServers: { toArray: vi.fn(async () => [...storedServers]) },
    webSearch: { get: vi.fn(async () => storedWeb.value) },
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
/** The preset chats run on when neither they nor their profile name one. */
const preset = ref({ toolsEnabled: true, generationOverrides: {} })
/** The other presets there are. */
const otherPresets = ref([])
const allPresets = () => [preset.value, ...otherPresets.value]
const getPreset = id => allPresets().find(one => one.id === id) || null
const showPreset = vi.fn()
const createPreset = vi.fn((name, source) => {
  const made = { ...source, id: `profile_made_${otherPresets.value.length}`, name }
  otherPresets.value = [...otherPresets.value, made]
  return made
})

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
  useAIConfig: () => ({
    activeAIPreset: preset,
    presets: computed(allPresets),
    getPreset,
    // As useAIConfig has it: the chat's, its profile's, then the default.
    presetFor: (chat, profile) =>
      getPreset(chat?.presetId) || getPreset(profile?.settings?.presetId) || preset.value,
    showPreset,
    createPreset,
  }),
}))

/** Where a tab is opened in the editor. */
const openTab = vi.fn()
vi.mock('@/composables/useDocuments', () => ({ useDocuments: () => ({ open: openTab }) }))

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
      // ExpandableSection is stubbed open so the sections' contents are there
      // to find without clicking five headers first.
      stubs: {
        ExpandableSection: { template: '<div><slot name="actions" /><slot /></div>' },
      },
    },
  })
  await flushPromises()
  return wrapper
}

const promptField = wrapper => wrapper.find('textarea')
const button = (wrapper, label) => wrapper.find(`button[aria-label="${label}"]`)

/**
 * Switch the experimental skills as the writer's switches do: in the app's
 * settings, and in the registry, which App.vue tells.
 *
 * @param {string[]} names - The ones on
 */
const switchExperimental = names => {
  const app = useApplicationState()
  for (const name of ['interpret', 'write']) app.setExperimentalSkill(name, names.includes(name))
  setExperimentalSkills(names)
}

/** The profiles of the writer's own, as the library lists them. */
const saved = library => library.profiles.value.filter(one => !one.readOnly)

describe('ChatSettings profile', () => {
  /** @type {ReturnType<typeof useProfiles>} */
  let library

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    chat.value = { id: 'chat_1', storyId: 'story_1', profileId: CHAT_PROFILE_ID }
    useApplicationState().setExtension('roleplay', true)
    library = useProfiles()
    await useChatProfileStore().ensureInitialized()
  })

  afterEach(() => {
    const app = useApplicationState()
    app.setNsfwProfiles(false)
    app.setChatProfileId(null)
    app.setRoleplayProfileId(null)
    app.setExtension('roleplay', false)
  })

  it('shows the prompt of the profile the chat is on', async () => {
    const wrapper = await mountSettings()

    expect(promptField(wrapper).element.value).toBe(DEFAULT_CHAT_PROMPT)
  })

  it('keeps an edit to the prompt in the chat, leaving the profile as it is', async () => {
    const editor = library.saveProfile('Editor', { prompt: 'Be terse.' })
    chat.value.profileId = editor.id
    const wrapper = await mountSettings()

    await promptField(wrapper).setValue('Be very terse.')

    // Every change in a chat is the chat's; Save to profile is how one
    // reaches the profile.
    expect(chat.value.prompt).toBe('Be very terse.')
    expect(library.getProfile(editor.id).settings.prompt).toBe('Be terse.')
  })

  it("makes no copy when a built-in's prompt is edited", async () => {
    const wrapper = await mountSettings()

    await promptField(wrapper).setValue('Run a heist.')
    await flushPromises()

    expect(saved(library)).toHaveLength(0)
    expect(chat.value.profileId).toBe(CHAT_PROFILE_ID)
    expect(chat.value.prompt).toBe('Run a heist.')
    expect(promptField(wrapper).element.value).toBe('Run a heist.')
  })

  it("reads the profile's prompt again once it is typed back, or reset", async () => {
    const wrapper = await mountSettings()

    await promptField(wrapper).setValue('Run a heist.')
    await promptField(wrapper).setValue(DEFAULT_CHAT_PROMPT)
    expect(chat.value.prompt).toBeUndefined()

    await promptField(wrapper).setValue('Run a heist.')
    await button(wrapper, 'Reset System prompt').trigger('click')
    await flushPromises()
    expect(chat.value.prompt).toBeUndefined()
    expect(promptField(wrapper).element.value).toBe(DEFAULT_CHAT_PROMPT)
  })

  it('offers Save to profile only once the chat runs differently from its profile', async () => {
    // Stamped from Default, as a new chat on it is.
    chat.value.disabledToolGroups = ['experimental']
    const wrapper = await mountSettings()
    expect(button(wrapper, 'Save to profile').exists()).toBe(false)

    await promptField(wrapper).setValue('Run a heist.')
    await flushPromises()
    expect(button(wrapper, 'Save to profile').exists()).toBe(true)
  })

  it("saves the chat's settings to a profile of the writer's own", async () => {
    const editor = library.saveProfile('Editor', { prompt: 'Be terse.' })
    chat.value = { ...chat.value, profileId: editor.id, disabledTools: ['create_folder'] }
    const wrapper = await mountSettings()

    await promptField(wrapper).setValue('Be very terse.')
    await button(wrapper, 'Save to profile').trigger('click')
    await flushPromises()

    const profile = library.getProfile(editor.id)
    expect(profile.settings.prompt).toBe('Be very terse.')
    expect(profile.settings.disabledTools).toEqual(['create_folder'])
    expect(chat.value.prompt).toBeUndefined()
    expect(saved(library)).toHaveLength(1)
    expect(button(wrapper, 'Save to profile').exists()).toBe(false)
  })

  it("saves a built-in's settings to Default - Custom, where new chats then start", async () => {
    const wrapper = await mountSettings()

    await promptField(wrapper).setValue('Run a heist.')
    await button(wrapper, 'Save to profile').trigger('click')
    await flushPromises()

    const [copy] = saved(library)
    expect(copy.name).toBe('Default - Custom')
    expect(copy.settings.prompt).toBe('Run a heist.')
    expect(chat.value.profileId).toBe(copy.id)
    expect(chat.value.prompt).toBeUndefined()
    expect(useApplicationState().chatProfileId.value).toBe(copy.id)
    expect(library.getProfile(CHAT_PROFILE_ID).settings.prompt).toBe(DEFAULT_CHAT_PROMPT)
  })

  it('carries the whole chat onto the copy, not just its prompt', async () => {
    chat.value = {
      ...chat.value,
      profileId: ROLEPLAY_PROFILE_ID,
      disabledToolGroups: ['rpg', 'skills', 'experimental'],
    }
    const wrapper = await mountSettings()

    await promptField(wrapper).setValue('Play someone else.')
    await button(wrapper, 'Save to profile').trigger('click')
    await flushPromises()

    // A prompt without the tools it was written for is half an answer.
    const [copy] = saved(library)
    expect(copy.name).toBe('Roleplay - Custom')
    expect(copy.settings.disabledToolGroups).toEqual(['rpg', 'skills', 'experimental'])
    expect(useApplicationState().roleplayProfileId.value).toBe(copy.id)
  })

  it('numbers a second copy of a built-in', async () => {
    library.saveProfile('Default - Custom', { prompt: 'Run a heist.' })
    const wrapper = await mountSettings()

    await promptField(wrapper).setValue('Run a different heist.')
    await button(wrapper, 'Save to profile').trigger('click')
    await flushPromises()

    expect(saved(library).map(one => one.name)).toContain('Default - Custom (2)')
  })

  /** Pick an item from the profile actions menu. */
  const pick = async (wrapper, label) => {
    await button(wrapper, 'Profile actions').trigger('click')
    await flushPromises()
    const item = [
      ...document.body.querySelectorAll('#chat_profile_actions [role="menuitem"]'),
    ].find(one => one.textContent.trim() === label)
    item.querySelector('a').click()
    await flushPromises()
  }

  it("starts new chats on a New profile with this chat's settings", async () => {
    chat.value = {
      ...chat.value,
      profileId: ROLEPLAY_PROFILE_ID,
      rules: 'Keep it to two lines.',
      disabledToolGroups: ['skills', 'experimental'],
    }
    const wrapper = await mountSettings('chat_1', { attachTo: document.body })

    await pick(wrapper, 'New profile')

    const [copy] = saved(library)
    expect(copy.name).toBe('Roleplay - Custom')
    expect(copy.settings.rules).toBe('Keep it to two lines.')
    expect(copy.settings.disabledToolGroups).toEqual(['skills', 'experimental'])
    expect(copy.settings.prompt).toBe(library.getProfile(ROLEPLAY_PROFILE_ID).settings.prompt)
    expect(chat.value.profileId).toBe(copy.id)
    // A New profile is a variation to try, not where chats start.
    expect(useApplicationState().roleplayProfileId.value).toBeNull()
    wrapper.unmount()
  })

  it("numbers a New profile made from one of the writer's own", async () => {
    const mine = library.saveProfile('Mine', { prompt: 'Be terse.' })
    chat.value.profileId = mine.id
    const wrapper = await mountSettings('chat_1', { attachTo: document.body })

    await pick(wrapper, 'New profile')

    expect(saved(library).map(one => one.name)).toEqual(['Mine', 'Mine (2)'])
    wrapper.unmount()
  })

  it('gives a New profile the note the chat reads, on a chat the NSFW switch moved', async () => {
    chat.value = { ...chat.value, profileId: ROLEPLAY_PROFILE_ID, rules: DEFAULT_ROLEPLAY_NOTE }
    useApplicationState().setNsfwProfiles(true)
    const wrapper = await mountSettings('chat_1', { attachTo: document.body })

    await pick(wrapper, 'New profile')

    // The copy has no counterpart to read Roleplay's note as the NSFW one's,
    // so the chat moving onto it takes the note it was showing.
    const [copy] = saved(library)
    expect(copy.settings.rules).toBe(DEFAULT_ROLEPLAY_NSFW_NOTE)
    expect(chat.value.rules).toBe(DEFAULT_ROLEPLAY_NSFW_NOTE)
    wrapper.unmount()
  })

  it('puts the chat back as its profile has it', async () => {
    chat.value = { ...chat.value, rules: 'Short.', disabledTools: ['create_folder'] }
    const wrapper = await mountSettings('chat_1', { attachTo: document.body })
    await promptField(wrapper).setValue('Run a heist.')

    await pick(wrapper, 'Reset to profile')

    expect(chat.value.prompt).toBeUndefined()
    expect(chat.value.rules).toBeUndefined()
    expect(chat.value.disabledTools).toBeUndefined()
    expect(chat.value.profileId).toBe(CHAT_PROFILE_ID)
    wrapper.unmount()
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
    expect(updateChat).toHaveBeenLastCalledWith('chat_1', {
      profileId: CHAT_PROFILE_ID,
      disabledToolGroups: ['experimental'],
    })
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
    expect(updateChat).toHaveBeenLastCalledWith('chat_1', {
      profileId: CHAT_PROFILE_ID,
      disabledToolGroups: ['experimental'],
    })
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

describe('ChatSettings preset', () => {
  /** @type {ReturnType<typeof useProfiles>} */
  let library

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    chat.value = { id: 'chat_1', storyId: 'story_1', profileId: CHAT_PROFILE_ID }
    preset.value = { id: 'profile_default', name: 'Default', toolsEnabled: true }
    otherPresets.value = [{ id: 'profile_glm', name: 'GLM', toolsEnabled: true }]
    library = useProfiles()
    await useChatProfileStore().ensureInitialized()
  })

  afterEach(() => {
    useApplicationState().setChatProfileId(null)
    useSettingsPanel().close()
  })

  const presetPicker = wrapper => wrapper.findComponent('[data-chat-preset]')

  /** Pick an item from the preset actions menu. */
  const pick = async (wrapper, label) => {
    await button(wrapper, 'Preset actions').trigger('click')
    await flushPromises()
    const item = [...document.body.querySelectorAll('#chat_preset_actions [role="menuitem"]')].find(
      one => one.textContent.trim() === label
    )
    item.querySelector('a').click()
    await flushPromises()
  }

  it('shows the preset chats run on until the chat or its profile picks one', async () => {
    const wrapper = await mountSettings()

    expect(presetPicker(wrapper).props('modelValue')).toBe('profile_default')
    expect(
      presetPicker(wrapper)
        .props('options')
        .map(one => one.name)
    ).toEqual(['Default', 'GLM'])
    expect(button(wrapper, 'Reset Preset').exists()).toBe(false)
  })

  it('runs this chat on the preset picked, and no other chat or preset', async () => {
    const wrapper = await mountSettings()

    await presetPicker(wrapper).vm.$emit('update:modelValue', 'profile_glm')
    await flushPromises()

    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { presetId: 'profile_glm' })
    expect(presetPicker(wrapper).props('modelValue')).toBe('profile_glm')
    // The chat differs from its profile now, as an edited prompt does.
    expect(button(wrapper, 'Reset Preset').exists()).toBe(true)
    expect(button(wrapper, 'Save to profile').exists()).toBe(true)
    expect(preset.value).toEqual({ id: 'profile_default', name: 'Default', toolsEnabled: true })
  })

  it("follows its profile's again once picked back, or reset", async () => {
    const wrapper = await mountSettings()

    await presetPicker(wrapper).vm.$emit('update:modelValue', 'profile_glm')
    await presetPicker(wrapper).vm.$emit('update:modelValue', 'profile_default')
    expect(chat.value.presetId).toBeUndefined()

    await presetPicker(wrapper).vm.$emit('update:modelValue', 'profile_glm')
    await flushPromises()
    await button(wrapper, 'Reset Preset').trigger('click')
    await flushPromises()
    expect(chat.value.presetId).toBeUndefined()
    expect(presetPicker(wrapper).props('modelValue')).toBe('profile_default')
  })

  it("shows a profile's preset, and marks the chat that differs from it", async () => {
    const mine = library.saveProfile('On GLM', { prompt: 'Be terse.', presetId: 'profile_glm' })
    chat.value.profileId = mine.id
    const wrapper = await mountSettings()

    expect(presetPicker(wrapper).props('modelValue')).toBe('profile_glm')
    expect(button(wrapper, 'Reset Preset').exists()).toBe(false)

    await presetPicker(wrapper).vm.$emit('update:modelValue', 'profile_default')
    await flushPromises()
    // The default, chosen over a profile that names another, is the chat's own.
    expect(chat.value.presetId).toBe('profile_default')
    expect(button(wrapper, 'Reset Preset').exists()).toBe(true)
  })

  it("saves the chat's preset to a profile of the writer's own", async () => {
    const mine = library.saveProfile('Mine', { prompt: 'Be terse.' })
    chat.value.profileId = mine.id
    const wrapper = await mountSettings()

    await presetPicker(wrapper).vm.$emit('update:modelValue', 'profile_glm')
    await button(wrapper, 'Save to profile').trigger('click')
    await flushPromises()

    expect(library.getProfile(mine.id).settings.presetId).toBe('profile_glm')
    expect(chat.value.presetId).toBeUndefined()
    expect(presetPicker(wrapper).props('modelValue')).toBe('profile_glm')
  })

  it("saves a built-in's to Default - Custom, which new chats then start on", async () => {
    const wrapper = await mountSettings()

    await presetPicker(wrapper).vm.$emit('update:modelValue', 'profile_glm')
    await button(wrapper, 'Save to profile').trigger('click')
    await flushPromises()

    const [copy] = saved(library)
    expect(copy.name).toBe('Default - Custom')
    expect(copy.settings.presetId).toBe('profile_glm')
    expect(chat.value.profileId).toBe(copy.id)
    expect(chat.value.presetId).toBeUndefined()
  })

  it('leaves a profile on the default when only something else is saved', async () => {
    const mine = library.saveProfile('Mine', { prompt: 'Be terse.' })
    chat.value.profileId = mine.id
    const wrapper = await mountSettings()

    await promptField(wrapper).setValue('Be very terse.')
    await button(wrapper, 'Save to profile').trigger('click')
    await flushPromises()

    // Not pinned to whichever is the default today.
    expect(library.getProfile(mine.id).settings.presetId).toBeUndefined()
  })

  it('goes back to the profile’s preset on Reset to profile, and on a switch', async () => {
    chat.value.presetId = 'profile_glm'
    const wrapper = await mountSettings('chat_1', { attachTo: document.body })

    await button(wrapper, 'Profile actions').trigger('click')
    await flushPromises()
    const reset = [...document.body.querySelectorAll('#chat_profile_actions [role="menuitem"]')]
    reset
      .find(one => one.textContent.trim() === 'Reset to profile')
      .querySelector('a')
      .click()
    await flushPromises()
    expect(chat.value.presetId).toBeUndefined()

    chat.value = { ...chat.value, presetId: 'profile_glm' }
    const mine = library.saveProfile('Mine', { prompt: 'Be terse.' })
    await wrapper.findAll('.p-select').at(0).trigger('click')
    // Moving profile is the profile's preset, as it is the profile's prompt.
    await wrapper.findComponent({ name: 'Select' }).vm.$emit('update:modelValue', mine.id)
    expect(chat.value.presetId).toBeUndefined()
    wrapper.unmount()
  })

  it('opens Settings › AI on the chat’s preset to edit it', async () => {
    chat.value.presetId = 'profile_glm'
    const wrapper = await mountSettings('chat_1', { attachTo: document.body })

    await pick(wrapper, 'Edit preset')

    expect(showPreset).toHaveBeenCalledWith('profile_glm')
    expect(useSettingsPanel().visible.value).toBe(true)
    expect(useSettingsPanel().takeSection()).toBe('ai')
    wrapper.unmount()
  })

  it('moves the chat onto a New preset, a copy of its own, open to be changed', async () => {
    chat.value.presetId = 'profile_glm'
    const wrapper = await mountSettings('chat_1', { attachTo: document.body })

    await pick(wrapper, 'New preset')

    expect(createPreset).toHaveBeenCalledWith(
      'GLM copy',
      expect.objectContaining({ id: 'profile_glm' })
    )
    const [, made] = otherPresets.value
    expect(chat.value.presetId).toBe(made.id)
    expect(useSettingsPanel().takeSection()).toBe('ai')
    wrapper.unmount()
  })

  it('gates the tools on the chat’s preset, not the default', async () => {
    otherPresets.value = [{ id: 'profile_bare', name: 'Bare', toolsEnabled: false }]
    chat.value.presetId = 'profile_bare'
    const wrapper = await mountSettings()

    const enable = wrapper
      .findAllComponents({ name: 'ToggleSwitch' })
      .find(one => one.props('ariaLabel') === 'Enable tools')
    expect(enable.props('disabled')).toBe(true)
    expect(wrapper.text()).toContain("Allow tool use is off for this chat's preset.")
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

  describe('on a chat the NSFW switch has moved', () => {
    afterEach(() => useApplicationState().setNsfwProfiles(false))

    it("shows Roleplay (NSFW)'s note on a chat started on Roleplay", async () => {
      chat.value = { profileId: ROLEPLAY_PROFILE_ID, rules: DEFAULT_ROLEPLAY_NOTE }
      useApplicationState().setNsfwProfiles(true)
      const wrapper = await mountSettings()

      expect(rulesField(wrapper).element.value).toBe(DEFAULT_ROLEPLAY_NSFW_NOTE)
      expect(updateChat).not.toHaveBeenCalled()
    })

    it("shows Roleplay's again once the switch is off", async () => {
      chat.value = { profileId: ROLEPLAY_NSFW_PROFILE_ID, rules: DEFAULT_ROLEPLAY_NSFW_NOTE }
      const wrapper = await mountSettings()

      expect(rulesField(wrapper).element.value).toBe(DEFAULT_ROLEPLAY_NOTE)
    })
  })
})

describe('ChatSettings roleplay', () => {
  /** @type {ReturnType<typeof useProfiles>} */
  let library

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // On Roleplay, stamped as a new chat on it is.
    chat.value = {
      id: 'chat_1',
      storyId: 'story_1',
      profileId: ROLEPLAY_PROFILE_ID,
      rules: DEFAULT_ROLEPLAY_NOTE,
      disabledToolGroups: ['rpg', 'skills', 'experimental'],
    }
    library = useProfiles()
    await useChatProfileStore().ensureInitialized()
    useEditorRequest().take()
  })

  afterEach(() => useApplicationState().setRoleplayProfileId(null))

  const field = (wrapper, name) => wrapper.find(`[data-roleplay="${name}"]`)

  it('is not shown in a chat that is not a roleplay', async () => {
    chat.value = { ...chat.value, profileId: CHAT_PROFILE_ID, rules: undefined }
    const wrapper = await mountSettings()

    expect(field(wrapper, 'user').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Post-history instructions')
  })

  it('is shown on Roleplay (NSFW), and on the profile character cards start on', async () => {
    useApplicationState().setNsfwProfiles(true)
    chat.value.profileId = ROLEPLAY_NSFW_PROFILE_ID
    expect(field(await mountSettings(), 'user').exists()).toBe(true)
    useApplicationState().setNsfwProfiles(false)

    const mine = library.saveProfile('Scenes', { prompt: 'Play it.' })
    useApplicationState().setRoleplayProfileId(mine.id)
    chat.value.profileId = mine.id
    expect(field(await mountSettings(), 'user').exists()).toBe(true)
  })

  it('stays shown in a card chat moved to another profile', async () => {
    // Its names are still filled in, so they stay where they can be changed.
    chat.value = { ...chat.value, profileId: CHAT_PROFILE_ID, userName: 'Tal' }
    const wrapper = await mountSettings()

    expect(field(wrapper, 'user').element.value).toBe('Tal')
  })

  it("shows the chat's names and a card's instructions", async () => {
    chat.value = {
      ...chat.value,
      userName: 'Tal',
      characterName: 'Maren',
      roleplayPrompt: 'You are {{char}}.',
      postHistory: 'Thoughts in italics.',
    }
    const wrapper = await mountSettings()

    expect(field(wrapper, 'user').element.value).toBe('Tal')
    expect(field(wrapper, 'character').element.value).toBe('Maren')
    expect(field(wrapper, 'prompt').element.value).toBe('You are {{char}}.')
    expect(field(wrapper, 'post-history').element.value).toBe('Thoughts in italics.')
  })

  it('shows each macro where the chat has no name for it', async () => {
    const wrapper = await mountSettings()

    // An empty name is a macro read as written, and the field says which.
    expect(field(wrapper, 'user').attributes('placeholder')).toBe('{{user}}')
    expect(field(wrapper, 'character').attributes('placeholder')).toBe('{{char}}')
  })

  it('saves a name trimmed as it is typed, and none once it is cleared', async () => {
    chat.value.userName = 'Riley'
    const wrapper = await mountSettings()

    await field(wrapper, 'user').setValue('  Tal ')
    expect(chat.value.userName).toBe('Tal')

    await field(wrapper, 'user').setValue('  ')
    expect(chat.value.userName).toBeUndefined()
  })

  it('keeps a name being typed as it is, while the chat changes around it', async () => {
    const wrapper = await mountSettings()

    // A letter at a time, as it is typed.
    await field(wrapper, 'user').setValue('Tal')
    await field(wrapper, 'user').setValue('Tal ')
    updateChat('chat_1', { lastMessageAt: 1 })
    await flushPromises()

    // Stored trimmed, but the space is where the next word goes.
    expect(field(wrapper, 'user').element.value).toBe('Tal ')
  })

  it("saves the card's instructions as they are typed", async () => {
    const wrapper = await mountSettings()

    await field(wrapper, 'prompt').setValue('You are {{char}}.')
    await field(wrapper, 'post-history').setValue('{{original}}\nThoughts in italics.\n')

    expect(chat.value.roleplayPrompt).toBe('You are {{char}}.')
    expect(chat.value.postHistory).toBe('{{original}}\nThoughts in italics.')
  })

  it('offers no Save to profile for what is only the chat’s', async () => {
    chat.value = {
      ...chat.value,
      userName: 'Tal',
      characterName: 'Maren',
      roleplayPrompt: 'You are Maren.',
      postHistory: 'Thoughts in italics.',
    }
    const wrapper = await mountSettings()

    expect(button(wrapper, 'Save to profile').exists()).toBe(false)
  })

  it('leaves them on the chat, and out of the profile, when it is saved to one', async () => {
    chat.value = { ...chat.value, roleplayPrompt: 'You are Maren.', postHistory: 'Italics.' }
    const wrapper = await mountSettings()

    await promptField(wrapper).setValue('Play someone else.')
    await button(wrapper, 'Save to profile').trigger('click')
    await flushPromises()

    const [copy] = saved(library)
    expect(copy.settings.prompt).toBe('Play someone else.')
    expect(copy.settings.rules).toBe(DEFAULT_ROLEPLAY_NOTE)
    expect(copy.settings).not.toHaveProperty('roleplayPrompt')
    expect(copy.settings).not.toHaveProperty('postHistory')
    expect(chat.value).toMatchObject({ roleplayPrompt: 'You are Maren.', postHistory: 'Italics.' })
  })

  it('keeps them when the chat moves to another profile', async () => {
    chat.value = { ...chat.value, userName: 'Tal', postHistory: 'Italics.' }
    const wrapper = await mountSettings()

    await wrapper.findComponent({ name: 'Select' }).vm.$emit('update:modelValue', CHAT_PROFILE_ID)
    await flushPromises()

    expect(chat.value.profileId).toBe(CHAT_PROFILE_ID)
    expect(chat.value).toMatchObject({ userName: 'Tal', postHistory: 'Italics.' })
  })

  it('opens either of the instructions in a tab of the editor', async () => {
    const wrapper = await mountSettings()

    await wrapper.find('[data-action="open-roleplay-prompt"]').trigger('click')
    expect(openTab).toHaveBeenCalledWith('chat:chat_1:roleplay-prompt')
    expect(useEditorRequest().take()).toBe(true)

    await wrapper.find('[data-action="open-post-history"]').trigger('click')
    expect(openTab).toHaveBeenCalledWith('chat:chat_1:post-history')
  })
})

describe('ChatSettings texts in the editor', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    chat.value = { id: 'chat_1', storyId: 'story_1', profileId: CHAT_PROFILE_ID }
    await useChatProfileStore().ensureInitialized()
    useEditorRequest().take()
  })

  it('sizes the system prompt as the author’s note', async () => {
    const wrapper = await mountSettings()
    const [prompt, note] = wrapper.findAll('textarea')

    expect(note.attributes('aria-label')).toBe("Author's note")
    expect(prompt.attributes('rows')).toBe(note.attributes('rows'))
    expect(prompt.classes()).toContain('max-h-48')
    expect(note.classes()).toContain('max-h-48')
  })

  it('opens the system prompt in a tab of the editor, and asks for the editor', async () => {
    const wrapper = await mountSettings()

    await wrapper.find('[data-action="open-prompt"]').trigger('click')

    expect(openTab).toHaveBeenCalledWith('chat:chat_1:prompt')
    expect(useEditorRequest().take()).toBe(true)
  })

  it('opens the author’s note in a tab of its own', async () => {
    const wrapper = await mountSettings()

    await wrapper.find('[data-action="open-note"]').trigger('click')

    expect(openTab).toHaveBeenCalledWith('chat:chat_1:note')
  })
})

describe('ChatSettings voice', () => {
  const voiceSelect = wrapper =>
    wrapper
      .findAllComponents({ name: 'Select' })
      .find(select => select.attributes('data-chat-voice') !== undefined)
  const resetVoice = wrapper => wrapper.find('button[aria-label="Reset Assistant voice"]')

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

  it('asks for the Narration list, where the voices are made', async () => {
    const wrapper = await mountSettings()
    await wrapper.find('[data-action="edit-voices"]').trigger('click')
    expect(useSidebarTab().take()).toBe('narration')
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
    switchExperimental(['interpret', 'write'])
  })

  afterEach(() => switchExperimental([]))

  it('leaves the skills out of the tool list, since they have a section', async () => {
    const wrapper = await mountSettings()

    // One switch per thing, in the place that explains what it is.
    expect(toggle(wrapper, 'Documents tools')).toBeDefined()
    expect(toggle(wrapper, 'Skills tools')).toBeUndefined()
  })

  it('lists the tools by their names in words, not as the model calls them', async () => {
    const wrapper = await mountSettings()

    expect(toggle(wrapper, 'Read document')).toBeDefined()
    expect(toggle(wrapper, 'read_document')).toBeUndefined()
    expect(wrapper.text()).toContain('Roll dice')
    expect(wrapper.text()).not.toContain('roll_dice')
  })

  it('names a group already called tools once', async () => {
    const wrapper = await mountSettings()

    expect(toggle(wrapper, 'RPG Tools')).toBeDefined()
    expect(toggle(wrapper, 'RPG Tools tools')).toBeUndefined()
  })

  it('switches every group in the list off and on at once', async () => {
    chat.value.disabledTools = ['roll_dice']
    const wrapper = await mountSettings()
    expect(toggle(wrapper, 'Enable tools').props('modelValue')).toBe(true)

    await toggle(wrapper, 'Enable tools').vm.$emit('update:modelValue', false)

    expect(updateChat).toHaveBeenLastCalledWith('chat_1', {
      disabledToolGroups: ['documents', 'rpg'],
    })
    expect(toggle(wrapper, 'Enable tools').props('modelValue')).toBe(false)
    expect(toggle(wrapper, 'Documents tools').props('modelValue')).toBe(false)

    await toggle(wrapper, 'Enable tools').vm.$emit('update:modelValue', true)

    // Each tool's own switch is as it was: the groups came back, not the tools.
    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { disabledToolGroups: [] })
    expect(chat.value.disabledTools).toEqual(['roll_dice'])
  })

  it('leaves the skills alone when switching all tools', async () => {
    chat.value.disabledToolGroups = ['skills']
    const wrapper = await mountSettings()

    await toggle(wrapper, 'Enable tools').vm.$emit('update:modelValue', false)
    await toggle(wrapper, 'Enable tools').vm.$emit('update:modelValue', true)

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

    expect(toggle(wrapper, 'Enable tools').props('modelValue')).toBe(false)
    expect(toggle(wrapper, 'Enable tools').props('disabled')).toBe(true)
  })

  it('switches one skill off on its own', async () => {
    const wrapper = await mountSettings()

    await toggle(wrapper, 'Interpret available to the model').vm.$emit('update:modelValue', false)

    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { disabledTools: ['interpret'] })
  })

  it('switches on only the skill asked for when a profile shipped its group off', async () => {
    // A second skill in the group, to be left off: one of the writer's.
    storedSkills.splice(0, storedSkills.length, {
      id: 'skill_critique',
      name: 'critique',
      text: '---\nname: critique\ndescription: A critique.\ncontext: fork\n---\n\nCritique it.\n',
    })
    chat.value.disabledToolGroups = ['documents', 'rpg', 'skills']
    try {
      const wrapper = await mountSettings()
      const critique = () => toggle(wrapper, 'Critique available to the model')
      expect(critique().props('modelValue')).toBe(false)
      // Not a dead switch: nothing else in the panel can lift the group.
      expect(critique().props('disabled')).toBe(false)

      await critique().vm.$emit('update:modelValue', true)

      expect(chat.value.disabledToolGroups).toEqual(['documents', 'rpg'])
      // The experimental skills are in a group of their own, which is on here.
      expect(chat.value.disabledTools).toEqual([])
      expect(critique().props('modelValue')).toBe(true)
    } finally {
      storedSkills.splice(0, storedSkills.length)
      setLibrarySkills([])
    }
  })

  it('switches on one experimental skill, and only that one', async () => {
    chat.value.disabledToolGroups = ['rpg', 'skills', 'experimental']
    const wrapper = await mountSettings()
    const interpret = () => toggle(wrapper, 'Interpret available to the model')
    const write = () => toggle(wrapper, 'Write available to the model')
    expect(interpret().props('modelValue')).toBe(false)
    expect(write().props('modelValue')).toBe(false)
    expect(interpret().props('disabled')).toBe(false)

    await interpret().vm.$emit('update:modelValue', true)

    expect(chat.value.disabledToolGroups).toEqual(['rpg', 'skills'])
    expect(chat.value.disabledTools).toEqual(['write'])
    expect(interpret().props('modelValue')).toBe(true)
    expect(write().props('modelValue')).toBe(false)
  })

  it('marks the experimental skills, and lists them as skills rather than tools', async () => {
    const wrapper = await mountSettings()

    expect(wrapper.findAll('[data-skill-experimental]')).toHaveLength(2)
    expect(toggle(wrapper, 'Experimental tools')).toBeUndefined()
  })

  /** The skills listed, in order, by the prompt each has. */
  const listed = wrapper =>
    wrapper
      .findAll('textarea')
      .map(field => field.attributes('aria-label') || '')
      .filter(label => label.endsWith(' prompt') && !/system prompt$/i.test(label))
      .map(label => label.replace(/ prompt$/, ''))

  it('lists yours, then the built-ins, then the experimental ones, each by name', async () => {
    const fork = name =>
      `---\nname: ${name}\ndescription: The ${name}.\ncontext: fork\n---\n\nDo it.\n`
    storedSkills.splice(
      0,
      storedSkills.length,
      { id: 'skill_zest', name: 'zest', text: fork('zest') },
      { id: 'skill_aside', name: 'aside', text: fork('aside') }
    )
    try {
      const wrapper = await mountSettings()

      expect(listed(wrapper)).toEqual(['Aside', 'Zest', 'Compact', 'Interpret', 'Write'])
    } finally {
      storedSkills.splice(0, storedSkills.length)
      setLibrarySkills([])
    }
  })

  it('leaves out the experimental skills switched off', async () => {
    switchExperimental([])
    const wrapper = await mountSettings()

    expect(listed(wrapper)).toEqual(['Compact'])
    expect(toggle(wrapper, 'Interpret available to the model')).toBeUndefined()
    expect(wrapper.find('[data-skill-experimental]').exists()).toBe(false)
  })

  it('brings one in when it is switched on while it is open', async () => {
    switchExperimental([])
    const wrapper = await mountSettings()

    switchExperimental(['write'])
    await flushPromises()

    expect(listed(wrapper)).toEqual(['Compact', 'Write'])
    expect(toggle(wrapper, 'Write available to the model')).toBeDefined()
    expect(toggle(wrapper, 'Interpret available to the model')).toBeUndefined()
  })
})

describe('ChatSettings skill prompts', () => {
  const interpretField = wrapper => wrapper.find('textarea[aria-label="Interpret prompt"]')
  const resetInterpret = wrapper => wrapper.find('button[aria-label="Reset Prompt"]')

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    chat.value = { id: 'chat_1', storyId: 'story_1', profileId: CHAT_PROFILE_ID }
    switchExperimental(['interpret', 'write'])
    await useChatProfileStore().ensureInitialized()
  })

  afterEach(() => {
    storedWordings.splice(0, storedWordings.length)
    setSkillWordings([])
    switchExperimental([])
  })

  it('shows the wording a skill has in the library, on a profile with none of its own', async () => {
    storedWordings.push({ name: 'interpret', prompt: 'Read darkly.', updated: 1 })
    await useSkillStore().ensureInitialized()
    const wrapper = await mountSettings()

    expect(interpretField(wrapper).element.value).toBe('Read darkly.')
    expect(resetInterpret(wrapper).exists()).toBe(false)
  })

  it('follows a change made in the library while it is open', async () => {
    const wrapper = await mountSettings()
    expect(interpretField(wrapper).element.value).toBe(INTERPRET_PROMPT)

    useSkillStore().setWording('interpret', 'Read darkly.')
    await flushPromises()

    expect(interpretField(wrapper).element.value).toBe('Read darkly.')
  })

  it("goes back to the library's wording when the profile's is reset", async () => {
    storedWordings.push({ name: 'interpret', prompt: 'Read darkly.', updated: 1 })
    await useSkillStore().ensureInitialized()
    const editor = useProfiles().saveProfile('Editor', {
      prompt: 'Be terse.',
      skills: { interpret: { prompt: 'Read kindly.' } },
    })
    chat.value.profileId = editor.id
    const wrapper = await mountSettings()
    expect(interpretField(wrapper).element.value).toBe('Read kindly.')

    await resetInterpret(wrapper).trigger('click')
    await flushPromises()

    expect(interpretField(wrapper).element.value).toBe('Read darkly.')
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
    expect(wrapper.find('[data-skill-dropped]').text()).toContain('at the next summary')
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

describe('ChatSettings web', () => {
  const toggle = (wrapper, label) =>
    wrapper
      .findAllComponents({ name: 'ToggleSwitch' })
      .find(one => one.props('ariaLabel') === label)

  beforeEach(() => {
    setActivePinia(createPinia())
    chat.value = {}
    updateChat.mockClear()
    preset.value = { toolsEnabled: true, generationOverrides: {} }
    storedWeb.value = { id: 'web', service: 'exa', keys: {}, profiles: [CHAT_PROFILE_ID] }
  })

  afterEach(() => {
    storedWeb.value = undefined
    setWebSearch(null)
  })

  it('lists the web with the connections, on for a chat whose profile searches', async () => {
    const wrapper = await mountSettings()

    expect(toggle(wrapper, 'Web tools').props('modelValue')).toBe(true)
    expect(toggle(wrapper, 'Web search')).toBeDefined()
    expect(toggle(wrapper, 'Read web page')).toBeDefined()
    // Not also among the groups a chat withholds.
    expect(wrapper.find('[data-tool-group="web"]').exists()).toBe(false)
  })

  it('is off for a chat on a profile that does not search', async () => {
    storedWeb.value = { ...storedWeb.value, profiles: [] }
    const wrapper = await mountSettings()

    expect(toggle(wrapper, 'Web tools').props('modelValue')).toBe(false)
  })

  it('writes the chat’s own choice', async () => {
    const wrapper = await mountSettings()

    await toggle(wrapper, 'Web tools').vm.$emit('update:modelValue', false)
    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { web: false })
  })

  it('is not listed while no service can search', async () => {
    storedWeb.value = { id: 'web', service: 'kagi', keys: {}, profiles: [CHAT_PROFILE_ID] }
    const wrapper = await mountSettings()

    expect(toggle(wrapper, 'Web tools')).toBeUndefined()
  })
})

describe('ChatSettings Python', () => {
  const toggle = (wrapper, label) =>
    wrapper
      .findAllComponents({ name: 'ToggleSwitch' })
      .find(one => one.props('ariaLabel') === label)

  beforeEach(() => {
    setActivePinia(createPinia())
    chat.value = {}
    updateChat.mockClear()
    preset.value = { toolsEnabled: true, generationOverrides: {} }
    vi.stubEnv('VITE_PREVIEW', 'python')
    globalThis.__INKSPRITE_DESKTOP__ = { python: { run: vi.fn(), stop: vi.fn() } }
    useApplicationState().setExtension('python', true)
  })

  afterEach(() => {
    delete globalThis.__INKSPRITE_DESKTOP__
    vi.unstubAllEnvs()
    useApplicationState().setExtension('python', false)
    useApplicationState().state.value.system.pythonProfiles = null
  })

  it('lists Python with the connections, on for a chat on Default', async () => {
    const wrapper = await mountSettings()

    expect(toggle(wrapper, 'Python tools').props('modelValue')).toBe(true)
    expect(toggle(wrapper, 'Run python')).toBeDefined()
    // Not also among the groups a chat withholds.
    expect(wrapper.find('[data-tool-group="python"]').exists()).toBe(false)
  })

  it('is off for a chat on a profile that does not run it', async () => {
    useApplicationState().setPythonProfiles([])
    const wrapper = await mountSettings()

    expect(toggle(wrapper, 'Python tools').props('modelValue')).toBe(false)
  })

  it('writes the chat’s own choice', async () => {
    const wrapper = await mountSettings()

    await toggle(wrapper, 'Python tools').vm.$emit('update:modelValue', false)
    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { python: false })
  })

  it('is not listed with the extension off, or in a browser', async () => {
    useApplicationState().setExtension('python', false)
    expect(toggle(await mountSettings(), 'Python tools')).toBeUndefined()

    useApplicationState().setExtension('python', true)
    delete globalThis.__INKSPRITE_DESKTOP__
    expect(toggle(await mountSettings(), 'Python tools')).toBeUndefined()
  })
})

describe('ChatSettings voices', () => {
  const userVoiceSelect = wrapper =>
    wrapper
      .findAllComponents({ name: 'Select' })
      .find(select => select.attributes('data-chat-user-voice') !== undefined)
  const resetUserVoice = wrapper => wrapper.find('button[aria-label="Reset Your voice"]')

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
