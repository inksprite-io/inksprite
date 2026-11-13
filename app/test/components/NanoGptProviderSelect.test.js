import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import MultiSelect from 'primevue/multiselect'
import NanoGptProviderSelect from '@/components/writer/settings/ai/NanoGptProviderSelect.vue'

/** What NanoGPT says of a model's providers. */
const listNanoGptProviders = vi.fn()
vi.mock('@/composables/useAIService', () => ({
  useAIService: () => ({ listNanoGptProviders }),
}))

/** The providers serving the model: two that keep nothing, and one that keeps. */
const SERVING = [
  {
    slug: 'alder',
    name: 'Alder Compute',
    zdr: true,
    pricing: { prompt: 0.000001, completion: 0.000003 },
  },
  { slug: 'birch', name: 'Birch', zdr: false, pricing: { prompt: 0, completion: 0 } },
  { slug: 'cedar', name: 'Cedar Cloud', zdr: true },
]

/** @param {Record<string, any>} [props] */
const mountSelect = async (props = {}) => {
  const wrapper = mount(NanoGptProviderSelect, {
    props: { modelValue: [], model: 'z/glm', label: 'Preferred providers', ...props },
    global: { plugins: [PrimeVue] },
  })
  await flushPromises()
  return wrapper
}

const select = wrapper => wrapper.findComponent(MultiSelect)
const offered = wrapper => select(wrapper).props('options')
const said = wrapper => wrapper.findAll('[role="alert"], .p-message').map(one => one.text())

describe('NanoGptProviderSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listNanoGptProviders.mockResolvedValue({ selectable: true, providers: SERVING })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('offers the providers serving the model by name, kept by id, each with its price', async () => {
    const wrapper = await mountSelect()

    expect(listNanoGptProviders).toHaveBeenCalledWith('z/glm')
    expect(offered(wrapper)).toEqual([
      { slug: 'alder', name: 'Alder Compute', price: '$1 / $3' },
      { slug: 'birch', name: 'Birch', price: 'Free' },
      // One NanoGPT lists no price for.
      { slug: 'cedar', name: 'Cedar Cloud', price: '' },
    ])
    expect(select(wrapper).props()).toMatchObject({
      optionLabel: 'name',
      optionValue: 'slug',
      placeholder: 'None',
      ariaLabel: 'Preferred providers',
      loading: false,
    })
    expect(said(wrapper)).toEqual([])
  })

  it('offers only those keeping nothing while the connection asks for zero data retention', async () => {
    const wrapper = await mountSelect({ zdrOnly: true })
    expect(offered(wrapper).map(one => one.slug)).toEqual(['alder', 'cedar'])

    await wrapper.setProps({ zdrOnly: false })
    expect(offered(wrapper).map(one => one.slug)).toEqual(['alder', 'birch', 'cedar'])
  })

  it('emits the ids picked, and an empty list for one cleared', async () => {
    const wrapper = await mountSelect({ modelValue: ['alder'] })

    select(wrapper).vm.$emit('update:modelValue', ['alder', 'cedar'])
    select(wrapper).vm.$emit('update:modelValue', null)

    expect(wrapper.emitted('update:modelValue')).toEqual([[['alder', 'cedar']], [[]]])
  })

  it('keeps a chosen id it doesn’t offer chosen, and says it doesn’t serve the model', async () => {
    const wrapper = await mountSelect({ modelValue: ['alder', 'gone'] })

    expect(select(wrapper).props('modelValue')).toEqual(['alder', 'gone'])
    // Listed, so the next edit doesn't drop it; by its id, there being no name.
    expect(offered(wrapper).at(-1)).toEqual({ slug: 'gone', name: 'gone', price: '' })
    expect(said(wrapper)).toEqual(["gone doesn't serve this model."])
  })

  it('says so of several at once', async () => {
    const wrapper = await mountSelect({ modelValue: ['gone', 'lost'] })
    expect(said(wrapper)).toEqual(["gone and lost don't serve this model."])
  })

  it('says a chosen one that keeps data doesn’t serve it with zero data retention, by its name', async () => {
    const wrapper = await mountSelect({ modelValue: ['birch'], zdrOnly: true })

    expect(offered(wrapper).map(one => one.name)).toEqual(['Alder Compute', 'Cedar Cloud', 'Birch'])
    expect(said(wrapper)).toEqual(["Birch doesn't serve this model with zero data retention."])
  })

  it('says nothing of the chosen ones until NanoGPT has answered', async () => {
    let answer
    listNanoGptProviders.mockReturnValue(new Promise(resolve => (answer = resolve)))
    const wrapper = await mountSelect({ modelValue: ['alder'] })

    expect(select(wrapper).props('loading')).toBe(true)
    expect(said(wrapper)).toEqual([])
    // Still shown as chosen meanwhile.
    expect(offered(wrapper)).toEqual([{ slug: 'alder', name: 'alder', price: '' }])

    answer({ selectable: true, providers: SERVING })
    await flushPromises()
    expect(select(wrapper).props('loading')).toBe(false)
    expect(said(wrapper)).toEqual([])
  })

  it('says the list couldn’t be loaded, and blames no chosen provider for it', async () => {
    listNanoGptProviders.mockRejectedValue(new Error('HTTP 500'))
    const wrapper = await mountSelect({ modelValue: ['alder'] })

    expect(said(wrapper)).toEqual(["Couldn't load the provider list."])
    expect(select(wrapper).props('modelValue')).toEqual(['alder'])
    expect(select(wrapper).props('loading')).toBe(false)
  })

  it('asks again for another model', async () => {
    const wrapper = await mountSelect()
    listNanoGptProviders.mockResolvedValue({ selectable: true, providers: [SERVING[1]] })

    await wrapper.setProps({ model: 'made-up/other' })
    await flushPromises()

    expect(listNanoGptProviders).toHaveBeenLastCalledWith('made-up/other')
    expect(offered(wrapper).map(one => one.slug)).toEqual(['birch'])
  })
})
