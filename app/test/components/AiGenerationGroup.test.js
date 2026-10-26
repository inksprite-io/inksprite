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
const providers = {
  openrouter: { id: 'openrouter', type: 'openrouter' },
  local: { id: 'local', type: 'generic', endpoint: 'http://box:1234/v1' },
}

vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({
    shownPreset: preset,
    updatePreset,
    getProvider: id => providers[id] || null,
  }),
}))

// The models each connection's list describes, by connection.
const listed = ref({})
vi.mock('@/composables/useModelLists', () => ({
  useModelLists: () => ({
    listOf: id => (listed.value[id] ? { models: listed.value[id] } : undefined),
  }),
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
    preset.value = { id: 'profile_1', toolsEnabled: true, providerId: 'openrouter' }
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

describe('AiGenerationGroup at 0', () => {
  beforeEach(() => {
    effective.value = { ...AI_DEFAULTS }
  })

  it('says what 0 means for Max tokens and Tool rounds, and only at 0', () => {
    effective.value = { ...AI_DEFAULTS, maxTokens: 0, maxToolRounds: 0 }
    const wrapper = mountGroup()

    expect(wrapper.find('[data-zero="maxTokens"]').text()).toBe('Unlimited')
    expect(wrapper.find('[data-zero="maxToolRounds"]').text()).toBe('Unlimited')

    effective.value = { ...AI_DEFAULTS, maxTokens: 500, maxToolRounds: 100 }
    const set = mountGroup()
    expect(set.find('[data-zero="maxTokens"]').exists()).toBe(false)
    expect(set.find('[data-zero="maxToolRounds"]').exists()).toBe(false)
  })
})

describe('AiGenerationGroup names', () => {
  beforeEach(() => {
    preset.value = { id: 'profile_1', providerId: 'openrouter', model: 'some/model' }
    listed.value = {}
  })

  it('names every control after its setting, for a screen reader', () => {
    const wrapper = mountGroup()
    const named = label => wrapper.findAll(`[aria-label="${label}"]`).length

    // A slider and the number beside it each carry the name.
    expect(named('Max tokens')).toBeGreaterThanOrEqual(2)
    expect(named('Tool rounds per turn')).toBeGreaterThanOrEqual(2)
    expect(named('Show reasoning')).toBe(1)
    expect(named('Allow tool use')).toBe(1)
    expect(named('Reasoning effort')).toBeGreaterThanOrEqual(1)
  })
})

describe('AiGenerationGroup reasoning', () => {
  const effortSelect = wrapper => wrapper.findComponent({ name: 'Select' })
  const showSwitch = wrapper => wrapper.find('[aria-label="Show reasoning"]')

  beforeEach(() => {
    effective.value = { ...AI_DEFAULTS }
    preset.value = { id: 'profile_1', providerId: 'openrouter', model: 'some/model' }
    listed.value = {}
  })

  it('offers a model only the efforts it takes, and shows the one it would be sent', () => {
    // Always thinks, at two levels: no Disabled, and Medium is sent as High.
    listed.value = {
      openrouter: [
        {
          id: 'some/model',
          traits: {
            reasoning: { optional: false, levels: ['high', 'xhigh'], defaultLevel: 'high' },
          },
        },
      ],
    }
    effective.value = { ...AI_DEFAULTS, reasoningEffort: 'medium' }
    const select = effortSelect(mountGroup())

    expect(select.props('options').map(option => option.value)).toEqual(['high', 'xhigh'])
    expect(select.props('modelValue')).toBe('high')
  })

  it('offers what there always was while the model is not described', () => {
    const select = effortSelect(mountGroup())

    expect(select.props('options').map(option => option.value)).toEqual([
      'disabled',
      'enabled',
      'low',
      'medium',
      'high',
    ])
  })

  it('asks nothing of reasoning for a model that does not reason', () => {
    listed.value = { openrouter: [{ id: 'some/model', traits: { reasoning: null } }] }
    const wrapper = mountGroup()

    expect(effortSelect(wrapper).exists()).toBe(false)
    expect(showSwitch(wrapper).exists()).toBe(false)
  })

  it('keeps Show reasoning for a model with nothing to choose but that it reasons', () => {
    listed.value = {
      openrouter: [{ id: 'some/model', traits: { reasoning: { optional: false, levels: [] } } }],
    }
    const wrapper = mountGroup()

    expect(effortSelect(wrapper).exists()).toBe(false)
    expect(showSwitch(wrapper).exists()).toBe(true)
  })

  it('shows neither on a server that is told nothing of reasoning', () => {
    preset.value = { id: 'profile_1', providerId: 'local', model: 'qwen' }
    const wrapper = mountGroup()

    expect(effortSelect(wrapper).exists()).toBe(false)
    expect(showSwitch(wrapper).exists()).toBe(false)
  })
})
