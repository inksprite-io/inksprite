import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import SystemSection from '@/components/writer/settings/SystemSection.vue'

const {
  aiEnabled,
  setAiEnabled,
  debug,
  setDebug,
  compactText,
  setCompactText,
  forgetSavedRequests,
  setSpellingEnabled,
  setSpellingDialect,
  setGrammar,
} = vi.hoisted(() => ({
  aiEnabled: { value: true },
  setAiEnabled: vi.fn(),
  debug: { value: false },
  setDebug: vi.fn(),
  compactText: { value: true },
  setCompactText: vi.fn(),
  forgetSavedRequests: vi.fn(),
  setSpellingEnabled: vi.fn(),
  setSpellingDialect: vi.fn(),
  setGrammar: vi.fn(),
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
    spelling,
    setSpellingEnabled,
    setSpellingDialect,
    setGrammar,
  }),
}))
/** Whether the writer types on a touch screen's keyboard. */
const touch = vi.hoisted(() => ({ keyboard: false }))
vi.mock('@/utils/touch.js', () => ({ hasTouchKeyboard: () => touch.keyboard }))
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

  it('has no Chats group: a profile, a model and asking before exploring are a chat’s own', () => {
    const wrapper = mountSection()

    expect(wrapper.text()).not.toContain('Chats')
    expect(wrapper.text()).not.toContain('exploring')
    for (const attribute of ['data-chat-profile', 'data-roleplay-profile', 'data-chat-preset']) {
      expect(wrapper.find(`[${attribute}]`).exists()).toBe(false)
    }
  })

  it('is the same with the AI switched off', () => {
    aiEnabled.value = false
    const wrapper = mountSection()

    expect(wrapper.text()).not.toContain('Chats')
    expect(toggle(wrapper, 'data-debug').exists()).toBe(true)
  })
})

describe('SystemSection layout', () => {
  beforeEach(() => {
    window.localStorage.clear()
    spelling.value = { ...SPELLING }
  })

  afterEach(() => (touch.keyboard = false))

  /** The folds' titles, in order. */
  const folds = wrapper => wrapper.findAll('h3 button[aria-expanded]').map(one => one.text())

  it('has the theme and the switches in the open, and Spelling as its one fold', () => {
    const wrapper = mountSection()

    expect(
      wrapper
        .findAll('label')
        .map(label => label.text())
        .slice(0, 4)
    ).toEqual(['Theme', 'Enable AI', 'Compact text', 'Debug'])
    expect(folds(wrapper)).toEqual(['Spelling'])
  })

  it('opens and shuts Spelling from its title', async () => {
    const wrapper = mountSection()
    const title = wrapper.find('h3 button[aria-expanded]')
    const before = title.attributes('aria-expanded')

    await title.trigger('click')

    expect(title.attributes('aria-expanded')).toBe(before === 'true' ? 'false' : 'true')
  })

  it('offers no spelling on a phone, which keeps its keyboard’s checker', () => {
    touch.keyboard = true
    const wrapper = mountSection()

    expect(folds(wrapper)).toEqual([])
    expect(wrapper.find('[data-spelling-enabled]').exists()).toBe(false)
    expect(toggle(wrapper, 'data-debug').exists()).toBe(true)
  })
})
