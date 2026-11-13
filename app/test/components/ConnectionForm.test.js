/* global MessageEvent */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reactive } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ConnectionForm from '@/components/writer/connections/ConnectionForm.vue'

/** The connections there are, by id. */
const rows = reactive(new Map())
const updateProvider = vi.fn((id, changes) => rows.set(id, { ...rows.get(id), ...changes }))
vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ getProvider: id => rows.get(id) ?? null, updateProvider }),
}))

const states = reactive({})
const check = vi.fn(async id => {
  states[id] = 'connected'
  return { state: 'connected', message: `Connected to ${rows.get(id).name}.`, freeTier: false }
})
const addConnection = vi.fn((kindId, fields) => {
  const row = {
    id: `provider_${kindId}`,
    kind: kindId,
    type: kindId === 'lmstudio' ? 'generic' : kindId,
    ...fields,
  }
  rows.set(row.id, row)
  return row
})
vi.mock('@/composables/useConnections.js', () => ({
  STATE_LABELS: { connected: 'Connected', key: 'Key not accepted', unreachable: "Can't reach it" },
  useConnections: () => ({
    forKind: kindId => [...rows.values()].find(row => row.kind === kindId) ?? null,
    nameFor: kind => kind.name,
    addConnection,
    check,
    stateOf: id => (id ? (states[id] ?? null) : null),
    setState: vi.fn(),
    missing: provider =>
      provider.type === 'anthropic' && !provider.apiKey ? 'Enter your Anthropic key.' : null,
  }),
}))
vi.mock('@/composables/useModelLists', () => ({ useModelLists: () => ({ forget: vi.fn() }) }))
/** A sign-in started: the service's type, then what it was started with. */
const start = vi.fn(async () => {})
vi.mock('@/composables/useSignIn.js', () => ({
  useSignIn: type => ({ start: options => start(type, options) }),
}))
const toast = { success: vi.fn(), error: vi.fn() }
vi.mock('@/composables/useToast.js', () => ({ useToast: () => toast }))
const reloadProvider = vi.fn(async () => {})
vi.mock('@/stores/aiProvidersStore', () => ({ useAIProvidersStore: () => ({ reloadProvider }) }))

/** @param {Record<string, any>} props */
const mountForm = props =>
  mount(ConnectionForm, { props, global: { plugins: [PrimeVue] }, attachTo: document.body })

const field = (wrapper, name) => wrapper.find(`[data-field="${name}"]`)
const kindSelect = wrapper => wrapper.findComponent('[data-field="kind"]')

describe('ConnectionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rows.clear()
    for (const id of Object.keys(states)) delete states[id]
  })

  it('offers the providers that chat, OpenRouter first, and asks it for a key or a sign-in', () => {
    const wrapper = mountForm({ mode: 'setup', does: 'chat' })

    const names = kindSelect(wrapper)
      .props('options')
      .map(kind => kind.name)
    expect(names[0]).toBe('OpenRouter')
    expect(names).not.toContain('Kokoro')
    expect(names).toContain('OpenAI-compatible')
    expect(field(wrapper, 'name').element.value).toBe('OpenRouter')
    expect(field(wrapper, 'key').exists()).toBe(true)
    expect(field(wrapper, 'address').exists()).toBe(false)
    expect(wrapper.find('[data-action="sign-in"]').exists()).toBe(true)
  })

  it('asks a server at home for its address, filled in with where it listens', async () => {
    const wrapper = mountForm({ mode: 'setup', does: 'chat' })
    await kindSelect(wrapper).vm.$emit('update:modelValue', 'lmstudio')

    expect(field(wrapper, 'name').element.value).toBe('LM Studio')
    expect(field(wrapper, 'address').element.value).toBe('http://localhost:1234/v1')
    // A server at home can be started with a key of its own.
    expect(wrapper.find(`label[for="${field(wrapper, 'key').attributes('id')}"]`).text()).toBe(
      'API key (optional)'
    )
    expect(wrapper.find('[data-action="sign-in"]').exists()).toBe(false)
  })

  it('makes the connection on Connect, asks it, and says it answered, in place and as a toast', async () => {
    const wrapper = mountForm({ mode: 'setup', does: 'chat' })
    await field(wrapper, 'key').setValue('sk-or-1')
    await wrapper.find('[data-action="connect"]').trigger('click')
    await flushPromises()

    expect(addConnection).toHaveBeenCalledWith('openrouter', {
      name: 'OpenRouter',
      apiKey: 'sk-or-1',
    })
    expect(check).toHaveBeenCalledWith('provider_openrouter')
    expect(toast.success).toHaveBeenCalledWith('Connected to OpenRouter.')
    expect(wrapper.find('[data-connection-state]').text()).toBe('Connected')
    expect(wrapper.emitted('connected')?.[0]).toEqual([
      { providerId: 'provider_openrouter', freeTier: false },
    ])
  })

  it('says what is missing in place, asking nothing', async () => {
    const wrapper = mountForm({ mode: 'setup', does: 'chat' })
    await kindSelect(wrapper).vm.$emit('update:modelValue', 'anthropic')
    await wrapper.find('[data-action="connect"]').trigger('click')

    expect(wrapper.find('[data-connection-problem]').text()).toBe('Enter your Anthropic key.')
    expect(addConnection).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows the writer’s connection of a kind, with its own status', async () => {
    rows.set('provider_or', {
      id: 'provider_or',
      name: 'OpenRouter',
      type: 'openrouter',
      kind: 'openrouter',
      apiKey: 'sk-1',
    })
    states.provider_or = 'connected'
    const wrapper = mountForm({ mode: 'setup', does: 'chat' })

    expect(wrapper.emitted('shown')?.at(-1)).toEqual(['provider_or'])
    expect(wrapper.find('[data-connection-state]').text()).toBe('Connected')

    // A look at another kind leaves OpenRouter as it was.
    await kindSelect(wrapper).vm.$emit('update:modelValue', 'anthropic')
    expect(wrapper.find('[data-connection-state]').exists()).toBe(false)
    await kindSelect(wrapper).vm.$emit('update:modelValue', 'openrouter')
    expect(wrapper.find('[data-connection-state]').text()).toBe('Connected')
  })

  it('says a refused key was refused, both in place and as a toast', async () => {
    check.mockImplementationOnce(async id => {
      states[id] = 'key'
      return { state: 'key', message: "OpenRouter didn't accept the key." }
    })
    const wrapper = mountForm({ mode: 'setup', does: 'chat' })
    await field(wrapper, 'key').setValue('sk-wrong')
    await wrapper.find('[data-action="connect"]').trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith("OpenRouter didn't accept the key.")
    expect(wrapper.find('[data-connection-state]').text()).toBe('Key not accepted')
    expect(wrapper.emitted('connected')).toBeUndefined()
  })

  it('keeps a connection’s fields as they are left, in its settings', async () => {
    rows.set('provider_box', {
      id: 'provider_box',
      name: 'Box',
      type: 'generic',
      endpoint: 'http://box:1/v1',
    })
    const wrapper = mountForm({ mode: 'edit', providerId: 'provider_box' })

    expect(kindSelect(wrapper).exists()).toBe(false)
    await field(wrapper, 'address').setValue('http://box:2/v1')
    await field(wrapper, 'address').trigger('blur')

    expect(updateProvider).toHaveBeenCalledWith('provider_box', {
      name: 'Box',
      endpoint: 'http://box:2/v1',
      apiKey: '',
    })
  })

  it('connects by itself once the sign-in sends the key back', async () => {
    rows.set('provider_openrouter_default', {
      id: 'provider_openrouter_default',
      name: 'OpenRouter',
      type: 'openrouter',
      kind: 'openrouter',
    })
    const wrapper = mountForm({ mode: 'setup', does: 'chat' })
    await wrapper.find('[data-action="sign-in"]').trigger('click')
    expect(start).toHaveBeenCalled()

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: 'oauth-success',
          provider: 'openrouter',
          providerId: 'provider_openrouter_default',
        },
      })
    )
    await flushPromises()

    expect(reloadProvider).toHaveBeenCalledWith('provider_openrouter_default')
    expect(check).toHaveBeenCalledWith('provider_openrouter_default')
    expect(wrapper.emitted('connected')).toHaveLength(1)
    wrapper.unmount()
  })

  it('says nothing beside Connect of how it answered, where its holder says so itself', async () => {
    rows.set('provider_box', {
      id: 'provider_box',
      name: 'Box',
      type: 'generic',
      endpoint: 'http://box:1/v1',
    })
    states.provider_box = 'unreachable'
    const inCard = mountForm({ mode: 'edit', providerId: 'provider_box', showState: false })
    expect(inCard.find('[data-connection-state]').exists()).toBe(false)

    const alone = mountForm({ mode: 'edit', providerId: 'provider_box' })
    expect(alone.find('[data-connection-state]').text()).toBe("Can't reach it")
    expect(alone.find('[data-connection-state]').attributes('data-state')).toBe('unreachable')
  })

  describe('signing in', () => {
    /** Tell the page a sign-in is done, as the tab the service sent back does. */
    const signedIn = async (provider, providerId, origin = window.location.origin) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin,
          data: { type: 'oauth-success', provider, providerId },
        })
      )
      await flushPromises()
    }

    const nanoGpt = () =>
      rows.set('provider_nano', {
        id: 'provider_nano',
        name: 'NanoGPT',
        type: 'nanogpt',
        kind: 'nanogpt',
      })

    it('is offered for NanoGPT and OpenRouter, each by its name, and for none of the rest', async () => {
      const wrapper = mountForm({ mode: 'setup', does: 'chat' })
      const offered = {}
      for (const kind of kindSelect(wrapper).props('options')) {
        await kindSelect(wrapper).vm.$emit('update:modelValue', kind.id)
        const button = wrapper.find('[data-action="sign-in"]')
        if (button.exists()) offered[kind.id] = button.text()
      }

      expect(offered).toEqual({
        openrouter: 'Sign in with OpenRouter',
        nanogpt: 'Sign in with NanoGPT',
      })
      wrapper.unmount()
    })

    it('starts NanoGPT’s for the connection shown', async () => {
      nanoGpt()
      const wrapper = mountForm({ mode: 'edit', providerId: 'provider_nano' })

      await wrapper.find('[data-action="sign-in"]').trigger('click')

      expect(start).toHaveBeenCalledWith('nanogpt', { providerId: 'provider_nano' })
      wrapper.unmount()
    })

    it('starts it for no connection where there is none yet', async () => {
      const wrapper = mountForm({ mode: 'setup', does: 'chat', kindId: 'nanogpt' })

      await wrapper.find('[data-action="sign-in"]').trigger('click')

      expect(start).toHaveBeenCalledWith('nanogpt', { providerId: undefined })
      wrapper.unmount()
    })

    it('connects NanoGPT by itself once its sign-in sends the key back', async () => {
      nanoGpt()
      const wrapper = mountForm({ mode: 'setup', does: 'chat', kindId: 'nanogpt' })

      await signedIn('nanogpt', 'provider_nano')

      expect(reloadProvider).toHaveBeenCalledWith('provider_nano')
      expect(check).toHaveBeenCalledWith('provider_nano')
      expect(toast.success).toHaveBeenCalledWith('Connected to NanoGPT.')
      expect(wrapper.emitted('connected')).toEqual([
        [{ providerId: 'provider_nano', freeTier: false }],
      ])
      wrapper.unmount()
    })

    it('leaves another service’s sign-in, and one from another page, alone', async () => {
      nanoGpt()
      const wrapper = mountForm({ mode: 'setup', does: 'chat', kindId: 'nanogpt' })

      await signedIn('openrouter', 'provider_nano')
      await signedIn('nanogpt', 'provider_nano', 'https://elsewhere.example')

      expect(reloadProvider).not.toHaveBeenCalled()
      expect(check).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    it('shows the connection a sign-in made, in place of the new one’s form', async () => {
      const wrapper = mountForm({ mode: 'add', kindId: 'nanogpt' })
      expect(kindSelect(wrapper).exists()).toBe(true)
      // As the sign-in keeps it, before it says it is done.
      reloadProvider.mockImplementationOnce(async () => nanoGpt())

      await signedIn('nanogpt', 'provider_nano')

      expect(wrapper.emitted('shown')?.at(-1)).toEqual(['provider_nano'])
      expect(kindSelect(wrapper).exists()).toBe(false)
      expect(check).toHaveBeenCalledWith('provider_nano')
      wrapper.unmount()
    })

    it('stops listening once it is gone', async () => {
      nanoGpt()
      const wrapper = mountForm({ mode: 'setup', does: 'chat', kindId: 'nanogpt' })
      wrapper.unmount()

      await signedIn('nanogpt', 'provider_nano')

      expect(check).not.toHaveBeenCalled()
    })

    it('says a sign-in couldn’t start, and why', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      start.mockRejectedValueOnce(new Error('Connecting took too long. Start it again.'))
      const wrapper = mountForm({ mode: 'setup', does: 'chat', kindId: 'nanogpt' })

      await wrapper.find('[data-action="sign-in"]').trigger('click')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith(
        "The sign-in couldn't start. Connecting took too long. Start it again."
      )
      wrapper.unmount()
    })
  })
})
