import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import MultiSelect from 'primevue/multiselect'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import ProviderRouting from '@/components/writer/settings/ai/ProviderRouting.vue'
import { ROUTING_DEFAULTS } from '@/ai/routing.js'

const PROVIDER_ID = 'provider_openrouter_default'

/** @type {import('vue').Ref<Object>} */
const provider = ref({})
const updateProvider = vi.fn((id, updates) => {
  provider.value = { ...provider.value, ...updates }
})
const listOpenRouterProviders = vi.fn()

vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ getProvider: () => provider.value, updateProvider }),
}))

vi.mock('@/composables/useAIService', () => ({
  useAIService: () => ({ listOpenRouterProviders }),
}))

/**
 * Mount the panel with the collapsible wrapper stubbed open — the section is
 * collapsed by default in the dialog, so its slot wouldn't render otherwise.
 */
async function mountPanel() {
  const wrapper = mount(ProviderRouting, {
    props: { providerId: PROVIDER_ID },
    global: {
      plugins: [PrimeVue],
      stubs: { ExpandableSection: { template: '<div><slot /></div>' } },
      directives: { tooltip: {} },
    },
  })
  await flushPromises()
  return wrapper
}

/** The three MultiSelects, in template order. */
function selectors(wrapper) {
  const [only, ignore, quantizations] = wrapper.findAllComponents(MultiSelect)
  return { only, ignore, quantizations }
}

describe('ProviderRouting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    provider.value = { id: PROVIDER_ID, type: 'openrouter' }
    listOpenRouterProviders.mockResolvedValue([
      { slug: 'anthropic', name: 'Anthropic' },
      { slug: 'deepinfra', name: 'DeepInfra' },
      { slug: 'morph', name: 'Morph' },
    ])
  })

  it('offers the fetched providers by display name', async () => {
    const wrapper = await mountPanel()

    expect(selectors(wrapper).only.props('options')).toEqual([
      { slug: 'anthropic', name: 'Anthropic' },
      { slug: 'deepinfra', name: 'DeepInfra' },
      { slug: 'morph', name: 'Morph' },
    ])
  })

  it('shows Morph left out of a connection nobody has configured', async () => {
    const wrapper = await mountPanel()

    expect(selectors(wrapper).ignore.props('modelValue')).toEqual(['morph'])
  })

  it('writes a complete policy when one knob changes', async () => {
    // Stored records are always whole, so a knob added later can't leave an
    // older record half-written.
    const wrapper = await mountPanel()

    selectors(wrapper).only.vm.$emit('update:modelValue', ['anthropic'])

    expect(updateProvider).toHaveBeenCalledWith(PROVIDER_ID, {
      routing: { ...ROUTING_DEFAULTS, only: ['anthropic'] },
    })
  })

  it('keeps the other knobs when one changes', async () => {
    provider.value.routing = { ...ROUTING_DEFAULTS, zdr: false }
    const wrapper = await mountPanel()

    selectors(wrapper).quantizations.vm.$emit('update:modelValue', ['fp8'])

    expect(updateProvider).toHaveBeenCalledWith(PROVIDER_ID, {
      routing: { ...ROUTING_DEFAULTS, zdr: false, quantizations: ['fp8'] },
    })
  })

  it('treats a cleared MultiSelect as an empty list', async () => {
    // PrimeVue's clear affordance emits null, which would otherwise land in
    // storage and be read back as junk.
    provider.value.routing = { ...ROUTING_DEFAULTS, ignore: ['deepinfra'] }
    const wrapper = await mountPanel()

    selectors(wrapper).ignore.vm.$emit('update:modelValue', null)

    expect(updateProvider).toHaveBeenCalledWith(PROVIDER_ID, {
      routing: { ...ROUTING_DEFAULTS, ignore: [] },
    })
  })

  it('offers a stored slug the directory does not list', async () => {
    // Sub-provider variants like `deepinfra/turbo` aren't in the directory.
    // Without them in the options the MultiSelect renders the stored choice as
    // unselected and drops it on the next edit.
    provider.value.routing = { ...ROUTING_DEFAULTS, only: ['deepinfra/turbo'] }
    const wrapper = await mountPanel()

    expect(selectors(wrapper).only.props('options')).toContainEqual({
      slug: 'deepinfra/turbo',
      name: 'deepinfra/turbo',
    })
  })

  it('warns but stays usable when the directory fetch fails', async () => {
    listOpenRouterProviders.mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    provider.value.routing = { ...ROUTING_DEFAULTS, only: ['anthropic'] }

    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain("Couldn't load the provider list")
    expect(selectors(wrapper).only.props('options')).toEqual([
      { slug: 'anthropic', name: 'anthropic' },
      { slug: 'morph', name: 'morph' },
    ])
  })

  it('renders the stored scalar knobs', async () => {
    provider.value.routing = {
      ...ROUTING_DEFAULTS,
      dataCollection: 'allow',
      zdr: false,
      allowFallbacks: false,
    }
    const wrapper = await mountPanel()

    const [zdr, allowFallbacks] = wrapper.findAllComponents(ToggleSwitch)
    expect(wrapper.findComponent(Select).props('modelValue')).toBe('allow')
    expect(zdr.props('modelValue')).toBe(false)
    expect(allowFallbacks.props('modelValue')).toBe(false)
  })

  it('shows the privacy floor for a connection with no stored policy', async () => {
    provider.value.routing = undefined
    const wrapper = await mountPanel()

    const [zdr] = wrapper.findAllComponents(ToggleSwitch)
    expect(wrapper.findComponent(Select).props('modelValue')).toBe('deny')
    expect(zdr.props('modelValue')).toBe(true)
  })

  it('resets a knob back to its default', async () => {
    provider.value.routing = { ...ROUTING_DEFAULTS, quantizations: ['fp8'] }
    const wrapper = await mountPanel()

    const label = wrapper
      .findAll('button')
      .find(b => b.attributes('aria-label') === 'Reset Quantization')
    await label.trigger('click')

    expect(updateProvider).toHaveBeenCalledWith(PROVIDER_ID, { routing: ROUTING_DEFAULTS })
  })
})
