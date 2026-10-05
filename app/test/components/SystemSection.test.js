import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ToggleSwitch from 'primevue/toggleswitch'
import SystemSection from '@/components/writer/settings/SystemSection.vue'

const { debug, setDebug, forgetSavedRequests } = vi.hoisted(() => ({
  debug: { value: false },
  setDebug: vi.fn(),
  forgetSavedRequests: vi.fn(),
}))

const theme = ref('system')
const applyEdits = ref('auto')
const setTheme = vi.fn()
const setApplyEdits = vi.fn()

vi.mock('@/composables/useApplicationState', () => ({
  useApplicationState: () => ({ theme, setTheme, applyEdits, setApplyEdits, debug, setDebug }),
}))
vi.mock('@/composables/useSystemSettings.js', () => ({ applyTheme: vi.fn() }))
vi.mock('@/stores/messagesStore', () => ({ useMessagesStore: () => ({ forgetSavedRequests }) }))

const mountSection = () =>
  mount(SystemSection, {
    global: {
      plugins: [PrimeVue],
      stubs: { DataSection: { template: '<div data-data-section />' } },
    },
  })

/** The Edits select: the theme's is the first, this is the other. */
const editsSelect = wrapper => wrapper.findAllComponents({ name: 'Select' }).at(1)

describe('SystemSection edits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    applyEdits.value = 'auto'
  })

  it("shows how the assistant's changes are applied", async () => {
    const wrapper = mountSection()
    expect(editsSelect(wrapper).props('modelValue')).toBe('auto')

    applyEdits.value = 'ask'
    await wrapper.vm.$nextTick()
    expect(editsSelect(wrapper).props('modelValue')).toBe('ask')
  })

  it('writes the choice app-wide', () => {
    const wrapper = mountSection()
    editsSelect(wrapper).vm.$emit('update:modelValue', 'ask')
    expect(setApplyEdits).toHaveBeenCalledWith('ask')
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

    await wrapper.findComponent(ToggleSwitch).vm.$emit('update:modelValue', false)

    expect(setDebug).toHaveBeenCalledWith(false)
    expect(forgetSavedRequests).toHaveBeenCalledTimes(1)
  })

  it('forgets nothing when it is switched on', async () => {
    const wrapper = mountSection()

    await wrapper.findComponent(ToggleSwitch).vm.$emit('update:modelValue', true)

    expect(setDebug).toHaveBeenCalledWith(true)
    expect(forgetSavedRequests).not.toHaveBeenCalled()
  })

  it('says so on the console when they could not be forgotten, rather than throwing', async () => {
    debug.value = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    forgetSavedRequests.mockRejectedValue(new Error('Database error'))
    const wrapper = mountSection()

    await wrapper.findComponent(ToggleSwitch).vm.$emit('update:modelValue', false)
    await new Promise(resolve => setTimeout(resolve))

    expect(error).toHaveBeenCalledWith('Failed to forget saved requests:', expect.any(Error))
    error.mockRestore()
  })
})

describe('SystemSection data', () => {
  it('holds backup and restore', () => {
    expect(mountSection().find('[data-data-section]').exists()).toBe(true)
  })
})
