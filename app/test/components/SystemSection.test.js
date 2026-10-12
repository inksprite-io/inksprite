import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ToggleSwitch from 'primevue/toggleswitch'
import SystemSection from '@/components/writer/settings/SystemSection.vue'

const {
  debug,
  setDebug,
  nsfwProfiles,
  setNsfwProfiles,
  compactText,
  setCompactText,
  setChatProfileId,
  setRoleplayProfileId,
  forgetSavedRequests,
} = vi.hoisted(() => ({
  debug: { value: false },
  setDebug: vi.fn(),
  nsfwProfiles: { value: false },
  setNsfwProfiles: vi.fn(),
  compactText: { value: true },
  setCompactText: vi.fn(),
  setChatProfileId: vi.fn(),
  setRoleplayProfileId: vi.fn(),
  forgetSavedRequests: vi.fn(),
}))

const theme = ref('system')
const setTheme = vi.fn()

vi.mock('@/composables/useApplicationState', () => ({
  useApplicationState: () => ({
    theme,
    setTheme,
    debug,
    setDebug,
    nsfwProfiles,
    setNsfwProfiles,
    compactText,
    setCompactText,
    setChatProfileId,
    setRoleplayProfileId,
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
vi.mock('@/composables/useSystemSettings.js', () => ({ applyTheme: vi.fn() }))
vi.mock('@/stores/messagesStore', () => ({ useMessagesStore: () => ({ forgetSavedRequests }) }))
const desktop = vi.hoisted(() => ({ isDesktop: vi.fn(() => false) }))
vi.mock('@/platform/desktop.js', () => desktop)

/** The switch whose root carries this attribute. */
const toggle = (wrapper, attribute) => wrapper.findComponent(`[${attribute}]`)

const mountSection = () =>
  mount(SystemSection, {
    global: {
      plugins: [PrimeVue],
      stubs: {
        DataSection: { template: '<div data-data-section />' },
        LibrarySection: { template: '<div data-library-section />' },
      },
    },
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

describe('SystemSection NSFW profiles', () => {
  beforeEach(() => {
    nsfwProfiles.value = false
    setNsfwProfiles.mockClear()
  })

  it('sits with the chats, after the debug switch', () => {
    const switches = mountSection().findAllComponents(ToggleSwitch)
    expect(switches.map(one => one.props('inputId'))).toEqual([
      'compact-text-switch',
      'debug-switch',
      'nsfw-switch',
    ])
  })

  it('shows whether they are on', () => {
    nsfwProfiles.value = true
    expect(toggle(mountSection(), 'data-nsfw-profiles').props('modelValue')).toBe(true)
  })

  it('switches them on and off', async () => {
    const wrapper = mountSection()

    await toggle(wrapper, 'data-nsfw-profiles').vm.$emit('update:modelValue', true)
    expect(setNsfwProfiles).toHaveBeenLastCalledWith(true)

    await toggle(wrapper, 'data-nsfw-profiles').vm.$emit('update:modelValue', false)
    expect(setNsfwProfiles).toHaveBeenLastCalledWith(false)
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

describe('SystemSection data', () => {
  it('holds backup and restore', () => {
    expect(mountSection().find('[data-data-section]').exists()).toBe(true)
  })
})

describe('SystemSection projects folder', () => {
  it('is shown in the desktop app, and nowhere else', () => {
    desktop.isDesktop.mockReturnValueOnce(false)
    expect(mountSection().find('[data-library-section]').exists()).toBe(false)
    desktop.isDesktop.mockReturnValueOnce(true)
    expect(mountSection().find('[data-library-section]').exists()).toBe(true)
  })
})

describe('SystemSection chats', () => {
  beforeEach(() => vi.clearAllMocks())

  /** The picker whose root carries this attribute. */
  const picker = (wrapper, attribute) => wrapper.findComponent(`[${attribute}]`)

  it('shows the profiles chats and character cards start on', () => {
    const wrapper = mountSection()
    expect(picker(wrapper, 'data-chat-profile').props('modelValue')).toBe('chatprofile_mine')
    expect(picker(wrapper, 'data-roleplay-profile').props('modelValue')).toBe(
      'builtin_profile_roleplay'
    )
  })

  it('keeps the profile chosen for each', async () => {
    const wrapper = mountSection()
    await picker(wrapper, 'data-chat-profile').vm.$emit('update:modelValue', 'builtin_profile_chat')
    await picker(wrapper, 'data-roleplay-profile').vm.$emit('update:modelValue', 'chatprofile_mine')

    expect(setChatProfileId).toHaveBeenCalledWith('builtin_profile_chat')
    expect(setRoleplayProfileId).toHaveBeenCalledWith('chatprofile_mine')
  })
})
