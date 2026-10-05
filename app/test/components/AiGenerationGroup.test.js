import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ToggleSwitch from 'primevue/toggleswitch'
import AiGenerationGroup from '@/components/writer/settings/ai/AiGenerationGroup.vue'
import { AI_DEFAULTS } from '@/ai/defaults.js'

const effective = ref({ ...AI_DEFAULTS })
const overridden = ref(new Set())
const setSetting = vi.fn()
const resetSettings = vi.fn()

vi.mock('@/composables/useGenerationSettings', () => ({
  useGenerationSettings: () => ({
    effective,
    isOverridden: key => overridden.value.has(key),
    setSetting,
    resetSettings,
  }),
}))

const preset = ref({ id: 'profile_1', toolsEnabled: true })
const updatePreset = vi.fn()

vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ activeAIPreset: preset, updatePreset }),
}))

/** Mount the group with the collapsible wrapper stubbed open. */
const mountGroup = () =>
  mount(AiGenerationGroup, {
    global: {
      plugins: [PrimeVue],
      stubs: { ExpandableSection: { template: '<div><slot /></div>' } },
      directives: { tooltip: {} },
    },
  })

/** The last switch in the group, which is Allow Tool Use. */
const toolSwitch = wrapper => wrapper.findAllComponents(ToggleSwitch).at(-1)

describe('AiGenerationGroup tool use', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    effective.value = { ...AI_DEFAULTS }
    overridden.value = new Set()
    preset.value = { id: 'profile_1', toolsEnabled: true }
  })

  it('shows whether the preset allows tools at all', () => {
    expect(toolSwitch(mountGroup()).props('modelValue')).toBe(true)

    preset.value = { id: 'profile_1', toolsEnabled: false }
    expect(toolSwitch(mountGroup()).props('modelValue')).toBe(false)
  })

  it('treats a preset saved before the flag existed as allowing them', () => {
    preset.value = { id: 'profile_1' }

    expect(toolSwitch(mountGroup()).props('modelValue')).toBe(true)
  })

  it('writes the switch to the preset, since it is the model that cannot', async () => {
    // Which tools a chat is offered is the chat's; whether this model can be
    // asked for any at all belongs with the model.
    await toolSwitch(mountGroup()).vm.$emit('update:modelValue', false)

    expect(updatePreset).toHaveBeenCalledWith('profile_1', { toolsEnabled: false })
  })

  it('does nothing when there is no preset to write to', async () => {
    preset.value = null

    await toolSwitch(mountGroup()).vm.$emit('update:modelValue', false)

    expect(updatePreset).not.toHaveBeenCalled()
  })
})
