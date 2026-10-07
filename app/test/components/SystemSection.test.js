import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ToggleSwitch from 'primevue/toggleswitch'
import SystemSection from '@/components/writer/settings/SystemSection.vue'

const { debug, setDebug, nsfwProfiles, setNsfwProfiles, forgetSavedRequests } = vi.hoisted(() => ({
  debug: { value: false },
  setDebug: vi.fn(),
  nsfwProfiles: { value: false },
  setNsfwProfiles: vi.fn(),
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
  }),
}))
vi.mock('@/composables/useSystemSettings.js', () => ({ applyTheme: vi.fn() }))
vi.mock('@/stores/messagesStore', () => ({ useMessagesStore: () => ({ forgetSavedRequests }) }))

const { noticeFor } = vi.hoisted(() => ({ noticeFor: vi.fn() }))
vi.mock('@/composables/useProfileNotice.js', () => ({ useProfileNotice: () => ({ noticeFor }) }))

/** The switch whose root carries this attribute. */
const toggle = (wrapper, attribute) => wrapper.findComponent(`[${attribute}]`)

const mountSection = () =>
  mount(SystemSection, {
    global: {
      plugins: [PrimeVue],
      stubs: { DataSection: { template: '<div data-data-section />' } },
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
    noticeFor.mockClear()
  })

  it('sits above the debug switch', () => {
    const switches = mountSection().findAllComponents(ToggleSwitch)
    expect(switches.map(one => one.props('inputId'))).toEqual(['nsfw-switch', 'debug-switch'])
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

  it('tells the writer what Roleplay (NSFW) asks of them when they switch it on', async () => {
    const wrapper = mountSection()

    await toggle(wrapper, 'data-nsfw-profiles').vm.$emit('update:modelValue', true)
    expect(noticeFor).toHaveBeenCalledWith('builtin_profile_roleplay_nsfw')

    noticeFor.mockClear()
    await toggle(wrapper, 'data-nsfw-profiles').vm.$emit('update:modelValue', false)
    expect(noticeFor).not.toHaveBeenCalled()
  })
})

describe('SystemSection data', () => {
  it('holds backup and restore', () => {
    expect(mountSection().find('[data-data-section]').exists()).toBe(true)
  })
})
