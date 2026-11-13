import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reactive, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import SetupWizard from '@/components/writer/connections/SetupWizard.vue'
import { BUILT_IN_PROFILES } from '@/ai/profiles/index.js'

const openRouter = { id: 'provider_openrouter_default', name: 'OpenRouter', type: 'openrouter' }
vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ getProvider: id => (id === openRouter.id ? openRouter : null) }),
}))

const setWorkflow = vi.fn()
vi.mock('@/composables/useApplicationState', () => ({
  useApplicationState: () => ({ setWorkflow }),
}))

const setModel = vi.fn()
vi.mock('@/composables/useChatSettings', () => ({ useChatSettings: () => ({ setModel }) }))

const setProfileChoices = vi.fn()
vi.mock('@/composables/useProfiles', () => ({ useProfiles: () => ({ setProfileChoices }) }))

const state = ref(/** @type {string|null} */ (null))
const check = vi.fn(async () => ({ state: 'connected', message: '', freeTier: true }))
vi.mock('@/composables/useConnections.js', () => ({
  useConnections: () => ({ stateOf: () => state.value, check, connectionsFor: () => [] }),
}))

/** OpenRouter's list, as it is asked for. */
const lists = reactive(new Map())
const load = vi.fn(async id => {
  lists.set(id, {
    loading: false,
    models: [
      { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
      {
        id: 'z-ai/glm-4.5-air:free',
        name: 'GLM 4.5 Air (free)',
        free: true,
        traits: { tools: true },
      },
    ],
  })
  return lists.get(id).models
})
vi.mock('@/composables/useModelLists', () => ({
  useModelLists: () => ({ listOf: id => lists.get(id), load }),
}))

/** The model page's list, as the wizard has it chosen. */
const ModelList = {
  name: 'ModelList',
  props: ['providerIds', 'choice'],
  emits: ['update:choice', 'use'],
  template: '<div data-model-list />',
}

/** The connect page, as the form tells the wizard what it is on. */
const ConnectionForm = {
  name: 'ConnectionForm',
  emits: ['shown', 'connected'],
  template: '<div data-form />',
}

const mountWizard = () =>
  mount(SetupWizard, {
    props: { visible: true, storyId: 'story_1', chatId: 'chat_1' },
    global: {
      plugins: [PrimeVue],
      stubs: {
        ConnectionForm,
        ModelList,
        Dialog: { template: '<div><slot /><slot name="footer" /></div>' },
      },
    },
  })

const button = (wrapper, action) => wrapper.find(`[data-action="${action}"]`)

describe('SetupWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.value = null
    lists.clear()
  })

  it('goes on only once the connection shown has answered', async () => {
    const wrapper = mountWizard()
    wrapper.findComponent(ConnectionForm).vm.$emit('shown', openRouter.id)
    await flushPromises()
    expect(button(wrapper, 'next').attributes('disabled')).toBeDefined()

    state.value = 'connected'
    await flushPromises()
    expect(button(wrapper, 'next').attributes('disabled')).toBeUndefined()
  })

  it('lists the models with one picked: free for an account that never bought credits', async () => {
    state.value = 'connected'
    const wrapper = mountWizard()
    const form = wrapper.findComponent(ConnectionForm)
    form.vm.$emit('shown', openRouter.id)
    form.vm.$emit('connected', { providerId: openRouter.id, freeTier: true })
    await flushPromises()
    await button(wrapper, 'next').trigger('click')
    await flushPromises()

    expect(load).toHaveBeenCalledWith(openRouter.id)
    expect(check).not.toHaveBeenCalled()
    expect(wrapper.findComponent(ModelList).props('choice')).toMatchObject({
      model: 'z-ai/glm-4.5-air:free',
    })
  })

  it('asks OpenRouter about the account when it was connected before', async () => {
    state.value = 'connected'
    const wrapper = mountWizard()
    wrapper.findComponent(ConnectionForm).vm.$emit('shown', openRouter.id)
    await flushPromises()
    await button(wrapper, 'next').trigger('click')
    await flushPromises()

    expect(check).toHaveBeenCalledWith(openRouter.id)
  })

  it('puts the chat, every built-in profile and Convert on the model chosen', async () => {
    state.value = 'connected'
    const wrapper = mountWizard()
    const form = wrapper.findComponent(ConnectionForm)
    form.vm.$emit('shown', openRouter.id)
    form.vm.$emit('connected', { providerId: openRouter.id, freeTier: false })
    await flushPromises()
    await button(wrapper, 'next').trigger('click')
    await flushPromises()
    await button(wrapper, 'done').trigger('click')

    // No settings kept for it: the model runs on its own until they're changed.
    const model = 'anthropic/claude-sonnet-4.5'
    expect(setModel).toHaveBeenCalledWith(openRouter.id, model)
    for (const profile of BUILT_IN_PROFILES) {
      expect(setProfileChoices).toHaveBeenCalledWith(profile.id, {
        providerId: openRouter.id,
        model,
      })
    }
    expect(setWorkflow).toHaveBeenCalledWith('convert', { providerId: openRouter.id, model })
    expect(wrapper.emitted('update:visible')?.at(-1)).toEqual([false])
    expect(wrapper.emitted('done')).toHaveLength(1)
  })
})
