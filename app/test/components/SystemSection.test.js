import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ToggleSwitch from 'primevue/toggleswitch'
import SystemSection from '@/components/writer/settings/SystemSection.vue'

const {
  aiEnabled,
  setAiEnabled,
  debug,
  setDebug,
  compactText,
  setCompactText,
  setChatProfileId,
  askBeforeExploring,
  setAskBeforeExploring,
  forgetSavedRequests,
  setSpellingEnabled,
  setSpellingDialect,
  setGrammar,
  activeAIPresetId,
  setActiveAIPreset,
} = vi.hoisted(() => ({
  aiEnabled: { value: true },
  setAiEnabled: vi.fn(),
  debug: { value: false },
  setDebug: vi.fn(),
  compactText: { value: true },
  setCompactText: vi.fn(),
  setChatProfileId: vi.fn(),
  askBeforeExploring: { value: true },
  setAskBeforeExploring: vi.fn(),
  forgetSavedRequests: vi.fn(),
  setSpellingEnabled: vi.fn(),
  setSpellingDialect: vi.fn(),
  setGrammar: vi.fn(),
  activeAIPresetId: { value: 'profile_default' },
  setActiveAIPreset: vi.fn(),
}))

const SPELLING = { enabled: true, dialect: 'american', grammar: true, words: [] }
const spelling = ref({ ...SPELLING })

const theme = ref('system')
const setTheme = vi.fn()

vi.mock('@/composables/useApplicationState', () => ({
  useApplicationState: () => ({
    theme,
    setTheme,
    aiEnabled,
    setAiEnabled,
    debug,
    setDebug,
    compactText,
    setCompactText,
    setChatProfileId,
    askBeforeExploring,
    setAskBeforeExploring,
    spelling,
    setSpellingEnabled,
    setSpellingDialect,
    setGrammar,
  }),
}))
vi.mock('@/composables/useProfiles', () => ({
  useProfiles: () => ({
    profiles: ref([
      { id: 'builtin_profile_chat', name: 'Default', readOnly: true },
      { id: 'builtin_profile_roleplay', name: 'Roleplay', readOnly: true },
      { id: 'chatprofile_mine', name: 'Default - Custom', readOnly: false },
    ]),
    getProfile: id => ({ id }),
    chatDefaultId: () => 'chatprofile_mine',
    roleplayDefaultId: () => 'builtin_profile_roleplay',
  }),
}))
vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({
    presets: {
      value: [
        { id: 'profile_default', name: 'Default' },
        { id: 'profile_glm', name: 'GLM' },
      ],
    },
    activeAIPresetId,
    setActiveAIPreset,
  }),
}))
vi.mock('@/stores/messagesStore', () => ({ useMessagesStore: () => ({ forgetSavedRequests }) }))

/** The switch whose root carries this attribute. */
const toggle = (wrapper, attribute) => wrapper.findComponent(`[${attribute}]`)

const mountSection = () =>
  mount(SystemSection, {
    global: {
      plugins: [PrimeVue],
      stubs: {
        DictionaryDialog: {
          props: ['visible'],
          template: '<div v-if="visible" data-dictionary-dialog />',
        },
      },
    },
  })

describe('SystemSection theme', () => {
  beforeEach(() => {
    theme.value = 'system'
    setTheme.mockClear()
  })

  it('shows the theme chosen, and keeps the one picked', async () => {
    theme.value = 'dark'
    const wrapper = mountSection()
    const select = wrapper.findComponent('#theme-select')
    expect(select.props('modelValue')).toBe('dark')

    await select.vm.$emit('update:modelValue', 'light')

    expect(setTheme).toHaveBeenCalledWith('light')
  })
})

describe('SystemSection debug', () => {
  beforeEach(() => {
    debug.value = false
    setDebug.mockClear()
    forgetSavedRequests.mockReset()
    forgetSavedRequests.mockResolvedValue(undefined)
  })

  it('forgets every saved request when it is switched off', async () => {
    debug.value = true
    const wrapper = mountSection()

    await toggle(wrapper, 'data-debug').vm.$emit('update:modelValue', false)

    expect(setDebug).toHaveBeenCalledWith(false)
    expect(forgetSavedRequests).toHaveBeenCalledTimes(1)
  })

  it('forgets nothing when it is switched on', async () => {
    const wrapper = mountSection()

    await toggle(wrapper, 'data-debug').vm.$emit('update:modelValue', true)

    expect(setDebug).toHaveBeenCalledWith(true)
    expect(forgetSavedRequests).not.toHaveBeenCalled()
  })

  it('says so on the console when they could not be forgotten, rather than throwing', async () => {
    debug.value = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    forgetSavedRequests.mockRejectedValue(new Error('Database error'))
    const wrapper = mountSection()

    await toggle(wrapper, 'data-debug').vm.$emit('update:modelValue', false)
    await new Promise(resolve => setTimeout(resolve))

    expect(error).toHaveBeenCalledWith('Failed to forget saved requests:', expect.any(Error))
    error.mockRestore()
  })
})

describe('SystemSection switches', () => {
  it("has no roleplay switches: they are the Roleplay extension's", () => {
    const switches = mountSection().findAllComponents(ToggleSwitch)
    expect(switches.map(one => one.props('inputId'))).toEqual([
      'ai-switch',
      'compact-text-switch',
      'debug-switch',
      'spelling-switch',
      'grammar-switch',
      'ask-before-exploring',
    ])
  })
})

describe('SystemSection AI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiEnabled.value = true
  })

  it('shows whether it is on, and switches it off and on', async () => {
    const wrapper = mountSection()
    const ai = toggle(wrapper, 'data-ai-enabled')
    expect(wrapper.find('label[for="ai-switch"]').text()).toBe('Enable AI')
    expect(ai.props('modelValue')).toBe(true)

    await ai.vm.$emit('update:modelValue', false)
    expect(setAiEnabled).toHaveBeenLastCalledWith(false)

    await ai.vm.$emit('update:modelValue', true)
    expect(setAiEnabled).toHaveBeenLastCalledWith(true)
  })

  it('stays with the AI switched off, to switch it back on', () => {
    aiEnabled.value = false
    expect(toggle(mountSection(), 'data-ai-enabled').props('modelValue')).toBe(false)
  })
})

describe('SystemSection folds', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    aiEnabled.value = true
  })

  /** The button that opens and closes the section with this title. */
  const fold = (wrapper, title) =>
    wrapper.findAll('button[aria-expanded]').find(button => button.text() === title)

  it('has spelling and the chats folded away, and opens them', async () => {
    const wrapper = mountSection()
    for (const title of ['Spelling', 'Chats']) {
      expect(fold(wrapper, title).attributes('aria-expanded')).toBe('false')
      await fold(wrapper, title).trigger('click')
      expect(fold(wrapper, title).attributes('aria-expanded')).toBe('true')
    }
  })

  it('opens them as they were left', async () => {
    await fold(mountSection(), 'Chats').trigger('click')
    const wrapper = mountSection()
    expect(fold(wrapper, 'Chats').attributes('aria-expanded')).toBe('true')
    expect(fold(wrapper, 'Spelling').attributes('aria-expanded')).toBe('false')
  })
})

describe('SystemSection compact text', () => {
  it('shows whether it is on, and switches it', async () => {
    const wrapper = mountSection()
    const compact = toggle(wrapper, 'data-compact-text')
    expect(compact.props('modelValue')).toBe(true)

    await compact.vm.$emit('update:modelValue', false)

    expect(setCompactText).toHaveBeenCalledWith(false)
  })
})

describe('SystemSection spelling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    spelling.value = { ...SPELLING }
  })

  it('switches the spell checker off and on', async () => {
    const wrapper = mountSection()
    const checker = toggle(wrapper, 'data-spelling-enabled')
    expect(checker.props('modelValue')).toBe(true)
    await checker.vm.$emit('update:modelValue', false)
    expect(setSpellingEnabled).toHaveBeenCalledWith(false)
  })

  it('shows the language and grammar, and changes them', async () => {
    const wrapper = mountSection()
    const language = wrapper.findComponent('[data-spelling-language]')
    expect(language.props('modelValue')).toBe('american')
    await language.vm.$emit('update:modelValue', 'british')
    expect(setSpellingDialect).toHaveBeenCalledWith('british')

    const grammar = toggle(wrapper, 'data-grammar')
    expect(grammar.props('modelValue')).toBe(true)
    await grammar.vm.$emit('update:modelValue', false)
    expect(setGrammar).toHaveBeenCalledWith(false)
  })

  it('opens the dictionary from its button', async () => {
    const wrapper = mountSection()
    expect(wrapper.find('[data-dictionary-dialog]').exists()).toBe(false)
    await wrapper.find('[data-manage-dictionary]').trigger('click')
    expect(wrapper.find('[data-dictionary-dialog]').exists()).toBe(true)
  })

  it('offers nothing more with the checker off', () => {
    spelling.value = { ...SPELLING, enabled: false }
    const wrapper = mountSection()
    expect(wrapper.find('[data-spelling-enabled]').exists()).toBe(true)
    for (const attribute of ['data-spelling-language', 'data-grammar', 'data-manage-dictionary']) {
      expect(wrapper.find(`[${attribute}]`).exists()).toBe(false)
    }
  })
})

describe('SystemSection data', () => {
  it('leaves backups and sync to a section of their own', () => {
    const wrapper = mountSection()
    expect(wrapper.text()).not.toContain('Data')
    expect(wrapper.text()).not.toContain('Sync')
  })
})

describe('SystemSection chats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiEnabled.value = true
  })

  /** The picker whose root carries this attribute. */
  const picker = (wrapper, attribute) => wrapper.findComponent(`[${attribute}]`)

  it('shows the profile new chats start on, and keeps the one chosen', async () => {
    const wrapper = mountSection()
    expect(picker(wrapper, 'data-chat-profile').props('modelValue')).toBe('chatprofile_mine')
    expect(picker(wrapper, 'data-roleplay-profile').exists()).toBe(false)

    await picker(wrapper, 'data-chat-profile').vm.$emit('update:modelValue', 'builtin_profile_chat')
    expect(setChatProfileId).toHaveBeenCalledWith('builtin_profile_chat')
  })

  it('shows the preset chats run on when they name none, and keeps the one chosen', async () => {
    const wrapper = mountSection()
    expect(wrapper.find('[for="chat-preset"]').text()).toBe('Default preset')
    expect(picker(wrapper, 'data-chat-preset').props('modelValue')).toBe('profile_default')

    await picker(wrapper, 'data-chat-preset').vm.$emit('update:modelValue', 'profile_glm')
    expect(setActiveAIPreset).toHaveBeenCalledWith('profile_glm')
  })

  it('asks before exploring a lot until switched off', async () => {
    const wrapper = mountSection()

    expect(wrapper.find('[for="ask-before-exploring"]').text()).toBe(
      'Ask before exploring large folders'
    )
    const ask = toggle(wrapper, 'data-ask-before-exploring')
    expect(ask.props('modelValue')).toBe(true)
    await ask.vm.$emit('update:modelValue', false)
    expect(setAskBeforeExploring).toHaveBeenCalledWith(false)
  })

  it('goes with the AI switched off, and the rest stays', () => {
    aiEnabled.value = false
    const wrapper = mountSection()

    expect(picker(wrapper, 'data-chat-profile').exists()).toBe(false)
    expect(picker(wrapper, 'data-chat-preset').exists()).toBe(false)
    expect(toggle(wrapper, 'data-ask-before-exploring').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Chats')
    expect(toggle(wrapper, 'data-debug').exists()).toBe(true)
  })
})
