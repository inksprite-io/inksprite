import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import MultiSelect from 'primevue/multiselect'
import Message from 'primevue/message'
import OpenRouterProviderSelect from '@/components/writer/settings/ai/OpenRouterProviderSelect.vue'

const listOpenRouterProviders = vi.fn()
const listModelProviders = vi.fn()

vi.mock('@/composables/useAIService', () => ({
  useAIService: () => ({ listOpenRouterProviders, listModelProviders }),
}))

/**
 * @param {string[]} modelValue
 * @param {string} [model]
 */
async function mountSelect(modelValue = [], model) {
  const wrapper = mount(OpenRouterProviderSelect, {
    props: { modelValue, ...(model ? { model } : {}) },
    global: { plugins: [PrimeVue] },
  })
  await flushPromises()
  return wrapper
}

/** @param {import('@vue/test-utils').VueWrapper} wrapper */
const optionSlugs = wrapper =>
  wrapper
    .findComponent(MultiSelect)
    .props('options')
    .map(option => option.slug)

describe('OpenRouterProviderSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listOpenRouterProviders.mockResolvedValue([
      { slug: 'anthropic', name: 'Anthropic' },
      { slug: 'deepinfra', name: 'DeepInfra' },
      { slug: 'novita', name: 'Novita' },
    ])
    listModelProviders.mockResolvedValue([
      { slug: 'novita', name: 'Novita' },
      { slug: 'deepinfra', name: 'DeepInfra' },
    ])
  })

  it('offers the directory by display name', async () => {
    const wrapper = await mountSelect()

    expect(wrapper.findComponent(MultiSelect).props('options')).toEqual([
      { slug: 'anthropic', name: 'Anthropic' },
      { slug: 'deepinfra', name: 'DeepInfra' },
      { slug: 'novita', name: 'Novita' },
    ])
    expect(listModelProviders).not.toHaveBeenCalled()
  })

  it('offers only the providers serving the model, by name', async () => {
    const wrapper = await mountSelect([], 'z-ai/glm-5.2')

    expect(listModelProviders).toHaveBeenCalledWith('z-ai/glm-5.2')
    expect(optionSlugs(wrapper)).toEqual(['deepinfra', 'novita'])
  })

  it('names a provider the directory has not listed yet the way OpenRouter does', async () => {
    listModelProviders.mockResolvedValue([{ slug: 'newcomer', name: 'Newcomer' }])
    const wrapper = await mountSelect([], 'z-ai/glm-5.2')

    expect(wrapper.findComponent(MultiSelect).props('options')).toEqual([
      { slug: 'newcomer', name: 'Newcomer' },
    ])
  })

  it('keeps a chosen provider that does not serve the model, and says so', async () => {
    // The list was chosen for a model, and the model can change under it.
    const wrapper = await mountSelect(['anthropic', 'novita'], 'z-ai/glm-5.2')

    expect(wrapper.findComponent(MultiSelect).props('options')).toContainEqual({
      slug: 'anthropic',
      name: 'Anthropic',
    })
    const warning = wrapper.findAllComponents(Message).map(message => message.text())
    expect(warning).toEqual(["Anthropic doesn't serve this model."])
  })

  it('names every chosen provider that does not serve the model', async () => {
    listModelProviders.mockResolvedValue([{ slug: 'together', name: 'Together' }])
    const wrapper = await mountSelect(['anthropic', 'novita'], 'z-ai/glm-5.2')

    expect(wrapper.text()).toContain("Anthropic and Novita don't serve this model.")
  })

  it('counts a variant as its provider', async () => {
    const wrapper = await mountSelect(['deepinfra/turbo'], 'z-ai/glm-5.2')

    expect(wrapper.text()).not.toContain('serve this model')
  })

  it('offers every provider for a model OpenRouter lists no endpoints for', async () => {
    // A router model has none of its own; that is not "nobody serves it".
    listModelProviders.mockResolvedValue([])
    const wrapper = await mountSelect(['anthropic'], 'openrouter/auto')

    expect(optionSlugs(wrapper)).toEqual(['anthropic', 'deepinfra', 'novita'])
    expect(wrapper.text()).not.toContain('serve this model')
  })

  it('offers every provider, and says why, when the model lookup fails', async () => {
    listModelProviders.mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await mountSelect([], 'z-ai/glm-5.2')

    expect(optionSlugs(wrapper)).toEqual(['anthropic', 'deepinfra', 'novita'])
    expect(wrapper.text()).toContain("Couldn't load which providers serve this model")
  })

  it('follows the model it is given', async () => {
    const wrapper = await mountSelect([], 'z-ai/glm-5.2')
    listModelProviders.mockResolvedValue([{ slug: 'anthropic', name: 'Anthropic' }])

    await wrapper.setProps({ model: 'anthropic/claude-sonnet-5' })
    await flushPromises()
    expect(optionSlugs(wrapper)).toEqual(['anthropic'])

    await wrapper.setProps({ model: '' })
    await flushPromises()
    expect(optionSlugs(wrapper)).toEqual(['anthropic', 'deepinfra', 'novita'])
    expect(wrapper.findComponent(MultiSelect).props('loading')).toBe(false)
  })

  it('keeps the answer for the model it is on when an older one arrives late', async () => {
    /** @type {(value: any) => void} */
    let answerFirst = () => {}
    listModelProviders.mockImplementationOnce(() => new Promise(resolve => (answerFirst = resolve)))
    const wrapper = await mountSelect([], 'z-ai/glm-5.2')
    listModelProviders.mockResolvedValue([{ slug: 'anthropic', name: 'Anthropic' }])
    await wrapper.setProps({ model: 'anthropic/claude-sonnet-5' })
    await flushPromises()

    answerFirst([{ slug: 'novita', name: 'Novita' }])
    await flushPromises()

    expect(optionSlugs(wrapper)).toEqual(['anthropic'])
  })

  it('offers a chosen slug the directory does not list', async () => {
    // Sub-provider variants like `deepinfra/turbo` aren't in the directory.
    // Without them in the options the MultiSelect renders the stored choice as
    // unselected and drops it on the next edit.
    const wrapper = await mountSelect(['deepinfra/turbo'])

    expect(wrapper.findComponent(MultiSelect).props('options')).toContainEqual({
      slug: 'deepinfra/turbo',
      name: 'deepinfra/turbo',
    })
  })

  it('emits a cleared list as an empty one', async () => {
    // PrimeVue's clear affordance emits null, which would otherwise land in
    // storage and be read back as junk.
    const wrapper = await mountSelect(['deepinfra'])

    wrapper.findComponent(MultiSelect).vm.$emit('update:modelValue', null)

    expect(wrapper.emitted('update:modelValue')).toEqual([[[]]])
  })

  it('warns but keeps what is chosen when the directory fetch fails', async () => {
    listOpenRouterProviders.mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const wrapper = await mountSelect(['anthropic'])

    expect(wrapper.text()).toContain("Couldn't load the provider list")
    expect(wrapper.findComponent(MultiSelect).props('options')).toEqual([
      { slug: 'anthropic', name: 'anthropic' },
    ])
  })

  it('names a chosen provider from the model lookup when the directory fails', async () => {
    listOpenRouterProviders.mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const wrapper = await mountSelect(['novita'], 'z-ai/glm-5.2')

    expect(wrapper.findComponent(MultiSelect).props('options')).toEqual([
      { slug: 'deepinfra', name: 'DeepInfra' },
      { slug: 'novita', name: 'Novita' },
    ])
  })
})
