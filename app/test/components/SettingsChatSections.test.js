import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Settings from '@/components/writer/settings/Settings.vue'
import { useProfiles } from '@/composables/useProfiles'
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
import { setTrialSkills } from '@/ai/skills/index.js'
import { TRIAL_SKILLS } from '../../harness/skills/trials.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { setWebSearch } from '@/web/config.js'

/*
 * The sections of the settings that are the chat's showing: its profile's
 * chip over the list, Prompts (a roleplay chat's scene under them) and
 * Tools, mounted through Settings, which hands each the chat. Which
 * sections there are, and when, is Settings.test.js's.
 */

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
    aiProfiles: { toArray: vi.fn().mockResolvedValue([]) },
  },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

/** The chat being configured, as the mocked chats API holds it. */
const chat = ref({})
const updateChat = vi.fn((id, updates) => {
  chat.value = { ...chat.value, ...updates }
})
const defaultProfileId = vi.fn(() => CHAT_PROFILE_ID)
/** What a chat starts on where its profile names no model, and its settings. */
const preset = ref({
  providerId: 'p_or',
  model: 'sonnet',
  toolsEnabled: true,
  generationOverrides: {},
})
/** The settings of other models, where the writer changed them. */
const otherPresets = ref([])
const changeModelSettings = vi.fn()

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
  useAIConfig: () => {
    /** A model, on its settings. */
    const runOn = (providerId, model) => ({
      toolsEnabled: true,
      generationOverrides: {},
      ...otherPresets.value.find(one => one.providerId === providerId && one.model === model),
      providerId,
      model,
    })
    return {
      init: vi.fn(async () => {}),
      getProvider: () => null,
      runOn,
      settingsOf: () => null,
      changeModelSettings,
      // As useAIConfig has it: the model the chat names, then its profile's,
      // then what new chats start on.
      presetFor: (chat, profile) => {
        const named = chat?.providerId && chat.model ? chat : profile?.settings
        return named?.providerId && named.model
          ? runOn(named.providerId, named.model)
          : preset.value
      },
    }
  },
}))

// The models' names, as their connections list them.
vi.mock('@/composables/useModelLists', () => ({
  useModelLists: () => ({
    listOf: id =>
      id === 'p_or'
        ? {
            models: [
              { id: 'glm', name: 'GLM 5.2' },
              { id: 'sonnet', name: 'Sonnet' },
              { id: 'plain', name: 'Plain', traits: { tools: false } },
            ],
          }
        : undefined,
    load: vi.fn(async () => []),
  }),
}))

/** The chat showing in the chat panel, whose settings these are. */
const shownChat = ref('chat_1')
vi.mock('@/composables/useChatTabs.js', () => ({
  useChatTabs: () => ({ activeChatId: shownChat }),
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
  shownChat.value = chatId
  const wrapper = mount(Settings, {
    ...options,
    props: { storyId: 'story_1' },
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      // ExpandableSection is stubbed open so the sections' contents are there
      // to find without clicking five headers first.
      stubs: {
        ExpandableSection: { template: '<div><slot name="actions" /><slot /></div>' },
        // The chat's sections at once, rather than the one picked from the
        // list, and none of the app's.
        SectionLayout: {
          props: ['sections'],
          computed: {
            chats() {
              return this.sections.filter(one => ['prompts', 'tools'].includes(one.id))
            },
          },
          template:
            '<div><slot name="nav-start" /><component :is="section.component" v-for="section in chats" :key="section.id" v-bind="section.props" /></div>',
        },
        ModelSettings: {
          name: 'ModelSettings',
          props: ['providerId', 'model'],
          template: '<div />',
        },
        ModelPicker: {
          name: 'ModelPicker',
          props: ['providerId', 'model'],
          emits: ['update:choice', 'use'],
          template: '<div />',
        },
        ModelPickerDialog: {
          name: 'ModelPickerDialog',
          props: ['providerId', 'model'],
          emits: ['use', 'close'],
          template: '<div />',
        },
      },
    },
  })
  await flushPromises()
  return wrapper
}

const promptField = wrapper => wrapper.find('textarea')
const button = (wrapper, label) => wrapper.find(`button[aria-label="${label}"]`)
/** The Save beside a text, there while it differs from the profile's. */
const saveOf = (wrapper, label) =>
  wrapper.findAll('button').find(one => one.attributes('aria-label') === `Save ${label}`)
const savePrompt = wrapper => saveOf(wrapper, 'System prompt')
const saveNote = wrapper => saveOf(wrapper, "Author's note")
/** Pick a profile from the chip at the top of the chat's settings. */
const pickProfile = async (wrapper, profileId) => {
  await wrapper.find('[data-chat-profile]').trigger('click')
  await flushPromises()
  document.body.querySelector(`[data-profile="${profileId}"]`).click()
  await flushPromises()
}

/** The profiles of the writer's own, as the library lists them. */
const saved = library => library.profiles.value.filter(one => !one.readOnly)

describe('Settings, a chat’s profile', () => {
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
    app.state.value.system.builtInProfiles = {}
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

  it("offers Save beside a text only once it differs from the profile's", async () => {
    // Stamped from Default, as a new chat on it is.
    chat.value.disabledToolGroups = ['experimental']
    const wrapper = await mountSettings()
    expect(savePrompt(wrapper)).toBeUndefined()
    expect(saveNote(wrapper)).toBeUndefined()

    await promptField(wrapper).setValue('Run a heist.')
    await flushPromises()
    expect(savePrompt(wrapper)).toBeDefined()
    expect(saveNote(wrapper)).toBeUndefined()
  })

  it("saves the chat's prompt to a profile of the writer's own", async () => {
    const editor = library.saveProfile('Editor', { prompt: 'Be terse.', rules: 'Short.' })
    chat.value = { ...chat.value, profileId: editor.id, rules: 'Long.' }
    const wrapper = await mountSettings()

    await promptField(wrapper).setValue('Be very terse.')
    await savePrompt(wrapper).trigger('click')
    await flushPromises()

    const profile = library.getProfile(editor.id)
    expect(profile.settings.prompt).toBe('Be very terse.')
    // Each text is saved on its own.
    expect(profile.settings.rules).toBe('Short.')
    expect(chat.value.prompt).toBeUndefined()
    expect(saved(library)).toHaveLength(1)
    expect(savePrompt(wrapper)).toBeUndefined()
    expect(saveNote(wrapper)).toBeDefined()
  })

  it("saves a built-in's settings in place, for new chats on it", async () => {
    const wrapper = await mountSettings()

    await promptField(wrapper).setValue('Run a heist.')
    await savePrompt(wrapper).trigger('click')
    await flushPromises()

    expect(saved(library)).toEqual([])
    expect(library.getProfile(CHAT_PROFILE_ID).settings.prompt).toBe('Run a heist.')
    expect(useApplicationState().builtInProfiles.value[CHAT_PROFILE_ID].prompt).toBe('Run a heist.')
    expect(chat.value.profileId).toBe(CHAT_PROFILE_ID)
    // The chat reads the profile's again, which is its own now.
    expect(chat.value.prompt).toBeUndefined()
    expect(savePrompt(wrapper)).toBeUndefined()
  })

  it("keeps none of a built-in's own texts beside it, so it keeps up with them", async () => {
    chat.value = { ...chat.value, rules: 'Short.' }
    const wrapper = await mountSettings()

    await saveNote(wrapper).trigger('click')
    await flushPromises()
    expect(useApplicationState().builtInProfiles.value[CHAT_PROFILE_ID].rules).toBe('Short.')
    expect(saveNote(wrapper)).toBeUndefined()

    // Typed back to the note Default ships with, and saved, it is kept as none.
    await wrapper.find('textarea[aria-label^="Author"]').setValue('')
    await saveNote(wrapper).trigger('click')
    await flushPromises()
    const kept = useApplicationState().builtInProfiles.value[CHAT_PROFILE_ID]
    expect(kept).not.toHaveProperty('rules')
    expect(kept).not.toHaveProperty('prompt')
    expect(kept).not.toHaveProperty('skills')
  })

  it('puts the chat back as its profile has it when that profile is picked again', async () => {
    chat.value = { ...chat.value, rules: 'Short.', disabledTools: ['create_folder'] }
    const wrapper = await mountSettings('chat_1', { attachTo: document.body })
    await promptField(wrapper).setValue('Run a heist.')

    await pickProfile(wrapper, CHAT_PROFILE_ID)

    expect(chat.value.prompt).toBeUndefined()
    expect(chat.value.rules).toBeUndefined()
    expect(chat.value.disabledTools).toBeUndefined()
    expect(chat.value.profileId).toBe(CHAT_PROFILE_ID)
    wrapper.unmount()
  })

  it('switches profiles from the chip at the top, stamping the new one’s settings', async () => {
    chat.value = { ...chat.value, profileId: ROLEPLAY_PROFILE_ID }
    const wrapper = await mountSettings('chat_1', { attachTo: document.body })
    expect(wrapper.find('[data-chat-profile]').text()).toContain('Roleplay')

    await pickProfile(wrapper, CHAT_PROFILE_ID)

    // A chat that silently retooled itself when its profile changed would be
    // a chat whose settings nobody could trust — so they are stamped, not
    // followed.
    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { profileId: CHAT_PROFILE_ID })
    wrapper.unmount()
  })
})

describe('Settings, a chat’s author’s note', () => {
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

describe('Settings, a chat’s roleplay', () => {
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

  afterEach(() => {
    useApplicationState().setRoleplayProfileId(null)
    useApplicationState().state.value.system.builtInProfiles = {}
  })

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

  it('offers no Save for what is only the chat’s', async () => {
    chat.value = {
      ...chat.value,
      userName: 'Tal',
      characterName: 'Maren',
      roleplayPrompt: 'You are Maren.',
      postHistory: 'Thoughts in italics.',
    }
    const wrapper = await mountSettings()

    expect(
      wrapper.findAll('button').filter(one => one.attributes('aria-label')?.startsWith('Save '))
    ).toEqual([])
  })

  it('leaves them on the chat, and out of the profile, when it is saved to one', async () => {
    chat.value = { ...chat.value, roleplayPrompt: 'You are Maren.', postHistory: 'Italics.' }
    const wrapper = await mountSettings()

    await promptField(wrapper).setValue('Play someone else.')
    await savePrompt(wrapper).trigger('click')
    await flushPromises()

    const kept = useApplicationState().builtInProfiles.value[ROLEPLAY_PROFILE_ID]
    expect(kept.prompt).toBe('Play someone else.')
    // Its note, which is the one Roleplay ships with, is left to it.
    expect(kept).not.toHaveProperty('rules')
    expect(kept).not.toHaveProperty('roleplayPrompt')
    expect(kept).not.toHaveProperty('postHistory')
    expect(chat.value).toMatchObject({ roleplayPrompt: 'You are Maren.', postHistory: 'Italics.' })
  })

  it('keeps them when the chat moves to another profile', async () => {
    chat.value = { ...chat.value, userName: 'Tal', postHistory: 'Italics.' }
    const wrapper = await mountSettings('chat_1', { attachTo: document.body })

    await pickProfile(wrapper, CHAT_PROFILE_ID)

    expect(chat.value.profileId).toBe(CHAT_PROFILE_ID)
    expect(chat.value).toMatchObject({ userName: 'Tal', postHistory: 'Italics.' })
    wrapper.unmount()
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

describe('Settings, a chat’s texts in the editor', () => {
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

describe('Settings, a chat’s tools', () => {
  const toggle = (wrapper, label) =>
    wrapper
      .findAllComponents({ name: 'ToggleSwitch' })
      .find(one => one.props('ariaLabel') === label)

  /** What the chat's profile, Default, has of the tools, beside the built-in. */
  const onProfile = () => useApplicationState().builtInProfiles.value[CHAT_PROFILE_ID] || {}

  beforeEach(() => {
    setActivePinia(createPinia())
    chat.value = {}
    updateChat.mockClear()
    preset.value = { toolsEnabled: true, generationOverrides: {} }
    setTrialSkills(TRIAL_SKILLS)
  })

  afterEach(() => {
    setTrialSkills([])
    useApplicationState().state.value.system.builtInProfiles = {}
  })

  /** The groups listed, in order, by their switches. */
  const groups = wrapper =>
    wrapper.findAll('[data-tool-group]').map(one => one.attributes('data-tool-group'))

  it('lists the groups by where each comes from, the skills among them', async () => {
    const wrapper = await mountSettings()

    expect(groups(wrapper)).toEqual(['documents', 'skills', 'rpg'])
    expect(toggle(wrapper, 'Interpret')).toBeDefined()
    expect(toggle(wrapper, 'Write')).toBeDefined()
    // Compact is the writer's, and no tool.
    expect(toggle(wrapper, 'Compact')).toBeUndefined()
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

  it('switches a group in this chat and in its profile’s next chats', async () => {
    const wrapper = await mountSettings()

    await toggle(wrapper, 'RPG Tools').vm.$emit('update:modelValue', false)

    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { disabledToolGroups: ['rpg'] })
    expect(onProfile().disabledToolGroups).toEqual(['rpg'])
    expect(toggle(wrapper, 'Roll dice').props('disabled')).toBe(true)
  })

  it('switches a tool in this chat and in its profile’s next chats', async () => {
    const wrapper = await mountSettings()

    await toggle(wrapper, 'Interpret').vm.$emit('update:modelValue', false)

    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { disabledTools: ['interpret'] })
    expect(onProfile().disabledTools).toEqual(['interpret'])
  })

  it('switches the profile’s tools as asked, not to the chat’s whole list', async () => {
    // A chat started before its profile's RPG tools went off keeps them on.
    useApplicationState().setBuiltInProfile(CHAT_PROFILE_ID, { disabledToolGroups: ['rpg'] })
    const wrapper = await mountSettings()

    await toggle(wrapper, 'Documents tools').vm.$emit('update:modelValue', false)

    expect(chat.value.disabledToolGroups).toEqual(['documents'])
    expect(onProfile().disabledToolGroups).toEqual(['rpg', 'documents'])
  })

  it('offers a chat on a profile that offers only some just those, until one is switched on', async () => {
    chat.value = {
      profileId: ROLEPLAY_PROFILE_ID,
      onlyToolGroups: ['documents'],
      disabledToolGroups: ['rpg', 'skills'],
    }
    const wrapper = await mountSettings()
    expect(toggle(wrapper, 'Documents tools').props('modelValue')).toBe(true)
    expect(toggle(wrapper, 'RPG Tools').props('modelValue')).toBe(false)

    await toggle(wrapper, 'RPG Tools').vm.$emit('update:modelValue', true)

    expect(chat.value.onlyToolGroups).toEqual(['documents', 'rpg'])
    expect(chat.value.disabledToolGroups).toEqual(['skills'])
    expect(toggle(wrapper, 'RPG Tools').props('modelValue')).toBe(true)
  })

  it('switches every tool off from Enable tools, greying each switch as it was set', async () => {
    chat.value = { disabledToolGroups: ['rpg'] }
    const wrapper = await mountSettings()
    expect(toggle(wrapper, 'Enable tools').props('modelValue')).toBe(true)

    await toggle(wrapper, 'Enable tools').vm.$emit('update:modelValue', false)

    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { toolsOff: true })
    expect(onProfile().toolsOff).toBe(true)
    // What was switched stays as it was, for when the tools are back on.
    expect(chat.value.disabledToolGroups).toEqual(['rpg'])
    expect(onProfile().disabledToolGroups).toBeUndefined()
    expect(toggle(wrapper, 'Enable tools').props('modelValue')).toBe(false)
    for (const [label, on] of [
      ['Documents tools', true],
      ['RPG Tools', false],
      ['Read document', true],
    ]) {
      expect(toggle(wrapper, label).props('disabled')).toBe(true)
      expect(toggle(wrapper, label).props('modelValue')).toBe(on)
    }

    await toggle(wrapper, 'Enable tools').vm.$emit('update:modelValue', true)

    expect(chat.value.toolsOff).toBeUndefined()
    expect(chat.value.disabledToolGroups).toEqual(['rpg'])
    expect(toggle(wrapper, 'Documents tools').props('disabled')).toBe(false)
    expect(toggle(wrapper, 'Read document').props('disabled')).toBe(false)
  })

  it('leaves whether edits wait to the chip under the message box', async () => {
    const wrapper = await mountSettings()

    expect(wrapper.text()).not.toContain('Document edits')
  })

  it('reads as off, and cannot be switched, when the preset has no tools', async () => {
    preset.value = { toolsEnabled: false, generationOverrides: {} }
    const wrapper = await mountSettings()

    expect(toggle(wrapper, 'Enable tools').props('modelValue')).toBe(false)
    expect(toggle(wrapper, 'Enable tools').props('disabled')).toBe(true)
  })

  it('reads as off when the model’s list says it can’t call tools, and says so', async () => {
    chat.value = { providerId: 'p_or', model: 'plain' }
    const wrapper = await mountSettings()

    expect(toggle(wrapper, 'Enable tools').props('disabled')).toBe(true)
    expect(toggle(wrapper, 'Documents tools').props('modelValue')).toBe(false)
    expect(wrapper.find('[data-tools-note]').text()).toBe("This chat's model can't call tools.")
  })
})

describe('Settings, a chat’s servers', () => {
  const wiki = {
    id: 'mcp_wiki',
    name: 'Wiki',
    prefix: 'wiki',
    url: 'https://wiki.example/mcp',
    tools: [
      {
        name: 'search',
        title: 'Search',
        exposed: 'wiki__search',
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      { name: 'edit', exposed: 'wiki__edit', inputSchema: {} },
      { name: 'delete', exposed: 'wiki__delete', inputSchema: {} },
    ],
    prompts: [],
    allowed: ['delete'],
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
    useApplicationState().state.value.system.builtInProfiles = {}
  })

  it('lists a server after the documents, on until switched off', async () => {
    const wrapper = await mountSettings()

    expect(toggle(wrapper, 'Wiki tools').props('modelValue')).toBe(true)
    expect(toggle(wrapper, 'Search')).toBeDefined()
    const ids = wrapper.findAll('[data-tool-group]').map(one => one.attributes('data-tool-group'))
    expect(ids.slice(0, 2)).toEqual(['documents', 'mcp:mcp_wiki'])
  })

  it('is off in a chat that switched it off, and in its profile’s next chats', async () => {
    const wrapper = await mountSettings()

    await toggle(wrapper, 'Wiki tools').vm.$emit('update:modelValue', false)

    expect(chat.value.disabledToolGroups).toEqual(['mcp:mcp_wiki'])
    expect(toggle(wrapper, 'Wiki tools').props('modelValue')).toBe(false)
    expect(useApplicationState().builtInProfiles.value[CHAT_PROFILE_ID].disabledToolGroups).toEqual(
      ['mcp:mcp_wiki']
    )
  })

  it('is off in a chat on a profile that offers only some', async () => {
    chat.value = { profileId: ROLEPLAY_PROFILE_ID, onlyToolGroups: ['documents'] }
    const wrapper = await mountSettings()

    expect(toggle(wrapper, 'Wiki tools').props('modelValue')).toBe(false)
  })

  it('switches one of its tools off by the name the model calls it', async () => {
    const wrapper = await mountSettings()

    await toggle(wrapper, 'Search').vm.$emit('update:modelValue', false)

    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { disabledTools: ['wiki__search'] })
  })

  it('says which tools ask first, and which are always allowed, beside their switches', async () => {
    const wrapper = await mountSettings()
    const marker = name => wrapper.find(`[data-tool="${name}"] [data-approval]`)

    expect(marker('wiki__search').exists()).toBe(false)
    expect(marker('wiki__edit').text()).toBe('Asks first')
    expect(marker('wiki__delete').text()).toBe('Always allowed')
    expect(marker('read_document').exists()).toBe(false)
  })
})

describe('Settings, a chat’s web search', () => {
  const toggle = (wrapper, label) =>
    wrapper
      .findAllComponents({ name: 'ToggleSwitch' })
      .find(one => one.props('ariaLabel') === label)

  beforeEach(() => {
    setActivePinia(createPinia())
    chat.value = {}
    updateChat.mockClear()
    preset.value = { toolsEnabled: true, generationOverrides: {} }
    storedWeb.value = { id: 'web', service: 'exa', keys: {} }
  })

  afterEach(() => {
    storedWeb.value = undefined
    setWebSearch(null)
    useApplicationState().state.value.system.builtInProfiles = {}
  })

  it('lists the web after the documents, on until switched off', async () => {
    const wrapper = await mountSettings()

    expect(toggle(wrapper, 'Web tools').props('modelValue')).toBe(true)
    expect(toggle(wrapper, 'Web search')).toBeDefined()
    expect(toggle(wrapper, 'Read web page')).toBeDefined()
    const ids = wrapper.findAll('[data-tool-group]').map(one => one.attributes('data-tool-group'))
    expect(ids.slice(0, 2)).toEqual(['documents', 'web'])
  })

  it('switches off in this chat and its profile’s next', async () => {
    const wrapper = await mountSettings()

    await toggle(wrapper, 'Web tools').vm.$emit('update:modelValue', false)

    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { disabledToolGroups: ['web'] })
    expect(useApplicationState().builtInProfiles.value[CHAT_PROFILE_ID].disabledToolGroups).toEqual(
      ['web']
    )
  })

  it('says keeping a page asks first until it is always allowed', async () => {
    let wrapper = await mountSettings()
    expect(wrapper.find('[data-tool="save_web_page"] [data-approval]').text()).toBe('Asks first')

    setWebSearch({ ...storedWeb.value, saveWithoutAsking: true })
    storedWeb.value = { ...storedWeb.value, saveWithoutAsking: true }
    setActivePinia(createPinia())
    wrapper = await mountSettings()
    expect(wrapper.find('[data-tool="save_web_page"] [data-approval]').text()).toBe(
      'Always allowed'
    )
  })

  it('is not listed while no service can search', async () => {
    storedWeb.value = { id: 'web', service: 'kagi', keys: {} }
    const wrapper = await mountSettings()

    expect(toggle(wrapper, 'Web tools')).toBeUndefined()
  })
})

describe('Settings, a chat’s Python', () => {
  const toggle = (wrapper, label) =>
    wrapper
      .findAllComponents({ name: 'ToggleSwitch' })
      .find(one => one.props('ariaLabel') === label)

  beforeEach(() => {
    setActivePinia(createPinia())
    chat.value = {}
    updateChat.mockClear()
    preset.value = { toolsEnabled: true, generationOverrides: {} }
    globalThis.__INKSPRITE_DESKTOP__ = { python: { run: vi.fn(), stop: vi.fn() } }
    useApplicationState().setExtension('python', true)
  })

  afterEach(() => {
    delete globalThis.__INKSPRITE_DESKTOP__
    useApplicationState().setExtension('python', false)
    useApplicationState().state.value.system.builtInProfiles = {}
  })

  it('lists Python after the documents, on until switched off', async () => {
    const wrapper = await mountSettings()

    expect(toggle(wrapper, 'Python tools').props('modelValue')).toBe(true)
    expect(toggle(wrapper, 'Run python')).toBeDefined()
  })

  it('switches off in this chat and its profile’s next', async () => {
    const wrapper = await mountSettings()

    await toggle(wrapper, 'Python tools').vm.$emit('update:modelValue', false)

    expect(updateChat).toHaveBeenLastCalledWith('chat_1', { disabledToolGroups: ['python'] })
  })

  it('is not listed with the extension off, or in a browser', async () => {
    useApplicationState().setExtension('python', false)
    expect(toggle(await mountSettings(), 'Python tools')).toBeUndefined()

    useApplicationState().setExtension('python', true)
    delete globalThis.__INKSPRITE_DESKTOP__
    expect(toggle(await mountSettings(), 'Python tools')).toBeUndefined()
  })
})

describe('Settings, of a chat not started yet', () => {
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
