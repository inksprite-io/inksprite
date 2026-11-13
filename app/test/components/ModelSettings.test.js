import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ModelSettings from '@/components/writer/models/ModelSettings.vue'

/** The connections there are, by id. */
const connections = {
  p_or: { id: 'p_or', name: 'OpenRouter', type: 'openrouter' },
  p_nano: { id: 'p_nano', name: 'NanoGPT', type: 'nanogpt' },
  p_nano_kept: { id: 'p_nano_kept', name: 'NanoGPT', type: 'nanogpt', routing: { zdr: false } },
  p_box: { id: 'p_box', name: 'Box', type: 'generic', endpoint: 'http://box:1234/v1' },
}
/** The writer's changes to a model's settings, by connection and model. */
const changes = {}
const changeModelSettings = vi.fn()
vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({
    getProvider: id => connections[id] ?? null,
    runOn: (providerId, model) => ({ providerId, model, ...changes[`${providerId}/${model}`] }),
    settingsOf: (providerId, model) => changes[`${providerId}/${model}`] ?? null,
    changeModelSettings,
  }),
}))

/** What NanoGPT says of a model's providers. */
const listNanoGptProviders = vi.fn()
vi.mock('@/composables/useAIService', () => ({
  useAIService: () => ({ listNanoGptProviders }),
}))

const group = name => ({
  name,
  props: ['providerId', 'model'],
  template: '<div />',
})
const AiModelUpstreams = {
  name: 'AiModelUpstreams',
  props: ['upstreams', 'stored', 'model', 'service', 'zdrOnly'],
  emits: ['update'],
  template: '<div data-upstreams />',
}
const ExpandableSection = {
  name: 'ExpandableSection',
  props: ['title'],
  template: '<div :data-fold="title"><slot /></div>',
}

const mountSettings = async (providerId, model) => {
  const wrapper = mount(ModelSettings, {
    props: { providerId, model },
    global: {
      stubs: {
        AiGenerationGroup: group('AiGenerationGroup'),
        AiSamplingGroup: group('AiSamplingGroup'),
        AiModelUpstreams,
        ExpandableSection,
      },
    },
  })
  await flushPromises()
  return wrapper
}

const upstreams = wrapper => wrapper.findComponent(AiModelUpstreams)

describe('ModelSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(changes)) delete changes[key]
    listNanoGptProviders.mockResolvedValue({ selectable: true, providers: [] })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('has how the model writes and its samplers, for the model on its connection', async () => {
    const wrapper = await mountSettings('p_box', 'local')

    for (const name of ['AiGenerationGroup', 'AiSamplingGroup']) {
      expect(wrapper.findComponent({ name }).props()).toEqual({
        providerId: 'p_box',
        model: 'local',
      })
    }
  })

  it('has no Providers for a model nothing routes', async () => {
    const wrapper = await mountSettings('p_box', 'local')

    expect(wrapper.find('[data-fold="Providers"]').exists()).toBe(false)
    expect(listNanoGptProviders).not.toHaveBeenCalled()
  })

  it('has Providers for an OpenRouter model, on what it runs with and what the writer changed', async () => {
    changes['p_or/z/glm'] = { allowedProviders: ['deepinfra'] }
    const wrapper = await mountSettings('p_or', 'z/glm')

    expect(wrapper.find('[data-fold="Providers"]').exists()).toBe(true)
    expect(upstreams(wrapper).props()).toEqual({
      upstreams: { providerId: 'p_or', model: 'z/glm', allowedProviders: ['deepinfra'] },
      stored: { allowedProviders: ['deepinfra'] },
      model: 'z/glm',
      service: 'openrouter',
      zdrOnly: false,
    })
    // OpenRouter's are always the writer's to choose: nothing to ask.
    expect(listNanoGptProviders).not.toHaveBeenCalled()
  })

  it('keeps a change to them on the model', async () => {
    const wrapper = await mountSettings('p_or', 'z/glm')

    await upstreams(wrapper).vm.$emit('update', { ignoredProviders: ['novita'] })

    expect(changeModelSettings).toHaveBeenCalledWith('p_or', 'z/glm', {
      ignoredProviders: ['novita'],
    })
  })

  it('has Providers for a NanoGPT model only once NanoGPT says they can be chosen', async () => {
    let answer
    listNanoGptProviders.mockReturnValue(new Promise(resolve => (answer = resolve)))
    const wrapper = await mountSettings('p_nano', 'z/glm')

    expect(listNanoGptProviders).toHaveBeenCalledWith('z/glm')
    expect(wrapper.find('[data-fold="Providers"]').exists()).toBe(false)

    answer({ selectable: true, providers: [] })
    await flushPromises()

    expect(wrapper.find('[data-fold="Providers"]').exists()).toBe(true)
    // Zero data retention is on until the connection says otherwise.
    expect(upstreams(wrapper).props()).toMatchObject({ service: 'nanogpt', zdrOnly: true })
  })

  it('has none for a NanoGPT model whose providers can’t be chosen', async () => {
    listNanoGptProviders.mockResolvedValue({ selectable: false, providers: [] })
    const wrapper = await mountSettings('p_nano', 'made-up/closed')

    expect(wrapper.find('[data-fold="Providers"]').exists()).toBe(false)
  })

  it('has none where NanoGPT couldn’t be asked, and says so on the console alone', async () => {
    listNanoGptProviders.mockRejectedValue(new Error('HTTP 500'))
    const wrapper = await mountSettings('p_nano', 'z/glm')

    expect(wrapper.find('[data-fold="Providers"]').exists()).toBe(false)
    expect(console.error).toHaveBeenCalled()
  })

  it('offers every provider on a NanoGPT connection that keeps data', async () => {
    const wrapper = await mountSettings('p_nano_kept', 'z/glm')
    expect(upstreams(wrapper).props('zdrOnly')).toBe(false)
  })

  it('asks again for another model, and takes only that one’s answer', async () => {
    const answers = {}
    listNanoGptProviders.mockImplementation(
      model => new Promise(resolve => (answers[model] = resolve))
    )
    const wrapper = await mountSettings('p_nano', 'first')
    await wrapper.setProps({ model: 'second' })

    // The first one's answer comes late, for a model no longer shown.
    answers.first({ selectable: true, providers: [] })
    await flushPromises()
    expect(wrapper.find('[data-fold="Providers"]').exists()).toBe(false)

    answers.second({ selectable: true, providers: [] })
    await flushPromises()
    expect(upstreams(wrapper).props('model')).toBe('second')
  })
})
