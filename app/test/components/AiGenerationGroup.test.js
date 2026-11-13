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

// The model the group is for, and what its settings say.
const preset = ref({ id: 'profile_1', toolsEnabled: true })
const changeModelSettings = vi.fn()
const providers = {
  openrouter: { id: 'openrouter', type: 'openrouter' },
  local: { id: 'local', type: 'generic', endpoint: 'http://box:1234/v1' },
}

vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({
    runOn: () => ({ toolsEnabled: preset.value?.toolsEnabled }),
    changeModelSettings,
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
    props: {
      providerId: preset.value?.providerId ?? 'openrouter',
      model: preset.value?.model ?? 'some/model',
    },
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

  it('shows whether the model is let call tools at all', () => {
    expect(toolSwitch(mountGroup()).props('modelValue')).toBe(true)

    preset.value = { id: 'profile_1', toolsEnabled: false }
    expect(toolSwitch(mountGroup()).props('modelValue')).toBe(false)
  })

  it('treats settings kept before the flag existed as allowing them', () => {
    preset.value = { id: 'profile_1' }

    expect(toolSwitch(mountGroup()).props('modelValue')).toBe(true)
  })

  it('writes the switch to the model’s settings, since it is the model that cannot', async () => {
    // Which tools a chat is offered is the chat's; whether this model can be
    // asked for any at all belongs with the model.
    await toolSwitch(mountGroup()).vm.$emit('update:modelValue', false)

    expect(changeModelSettings).toHaveBeenCalledWith('openrouter', 'some/model', {
      toolsEnabled: false,
    })
  })
})

describe('AiGenerationGroup at 0', () => {
  beforeEach(() => {
    effective.value = { ...AI_DEFAULTS }
  })

  it('says what 0 means for Max reply length and Tool rounds, and only at 0', () => {
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
    expect(named('Max reply length')).toBeGreaterThanOrEqual(2)
    expect(named('Tool rounds per turn')).toBeGreaterThanOrEqual(2)
    expect(named('Show reasoning')).toBe(1)
    expect(named('Allow tool use')).toBe(1)
    // How hard the model thinks is each chat's, chosen in the chat.
    expect(named('Reasoning effort')).toBe(0)
  })
})

describe('AiGenerationGroup reasoning', () => {
  const showSwitch = wrapper => wrapper.find('[aria-label="Show reasoning"]')

  beforeEach(() => {
    effective.value = { ...AI_DEFAULTS }
    preset.value = { id: 'profile_1', providerId: 'openrouter', model: 'some/model' }
    listed.value = {}
  })

  it('offers no effort to choose: each chat has its own', () => {
    listed.value = {
      openrouter: [
        { id: 'some/model', traits: { reasoning: { optional: false, levels: ['high', 'xhigh'] } } },
      ],
    }
    const wrapper = mountGroup()

    expect(wrapper.findComponent({ name: 'Select' }).exists()).toBe(false)
    expect(showSwitch(wrapper).exists()).toBe(true)
  })

  it('asks nothing of reasoning for a model that does not reason', () => {
    listed.value = { openrouter: [{ id: 'some/model', traits: { reasoning: null } }] }

    expect(showSwitch(mountGroup()).exists()).toBe(false)
  })

  it('shows nothing of it on a server that is told nothing of reasoning', () => {
    preset.value = { id: 'profile_1', providerId: 'local', model: 'qwen' }

    expect(showSwitch(mountGroup()).exists()).toBe(false)
  })
})
