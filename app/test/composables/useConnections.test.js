import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAIConfig } from '@/composables/useAIConfig'
import {
  useConnections,
  stateOfError,
  hostOf,
  describeFailure,
} from '@/composables/useConnections.js'
import { kindOf, CONNECTION_KINDS } from '@/ai/providers.js'
import { useProfiles } from '@/composables/useProfiles'
import { CHAT_PROFILE_ID } from '@/ai/profiles/index.js'
import db from '@/stores/db'

vi.mock('@/stores/db', () => ({
  default: {
    aiProfiles: { toArray: vi.fn().mockResolvedValue([]) },
    aiProviders: { toArray: vi.fn().mockResolvedValue([]) },
    chatProfiles: { toArray: vi.fn().mockResolvedValue([]) },
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

const checkOpenRouterKey = vi.fn(async () => ({ freeTier: false }))
const checkNanoGptKey = vi.fn(async () => ({ balance: 5 }))
const listModels = vi.fn(async () => [{ id: 'qwen', name: 'Qwen' }])
vi.mock('@/composables/useAIService', () => ({
  useAIService: () => ({ checkOpenRouterKey, checkNanoGptKey, listModels }),
}))
vi.mock('@/composables/useAIService.js', () => ({
  useAIService: () => ({ checkOpenRouterKey, checkNanoGptKey, listModels }),
}))

/** A network failure, as fetch reports one. */
const offline = () => new TypeError('Failed to fetch')

describe('useConnections', () => {
  /** @type {ReturnType<typeof useAIConfig>} */
  let aiConfig
  /** @type {ReturnType<typeof useConnections>} */
  let connections

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    vi.clearAllMocks()
    aiConfig = useAIConfig()
    await aiConfig.init()
    connections = useConnections()
    // What one test kept of how a connection answered, the next starts without.
    for (const { builtInId } of CONNECTION_KINDS)
      if (builtInId) connections.setState(builtInId, null)
  })

  it('starts a new install with none, and makes none of its own', () => {
    expect(aiConfig.providers.value).toEqual([])
    expect(connections.hasChatConnection.value).toBe(false)
  })

  it('hides a built-in left from before with nothing of the writer’s in it', async () => {
    setActivePinia(createPinia())
    db.aiProviders.toArray.mockResolvedValueOnce([
      { id: 'provider_openrouter_default', name: 'OpenRouter', type: 'openrouter' },
      { id: 'provider_anthropic_default', name: 'Anthropic', type: 'anthropic', apiKey: 'sk-a' },
      {
        id: 'provider_lmstudio_default',
        name: 'LM Studio',
        type: 'generic',
        endpoint: 'http://localhost:1234/v1',
      },
      {
        id: 'provider_ollama_default',
        name: 'Ollama',
        type: 'generic',
        endpoint: 'http://localhost:11434/v1',
      },
      { id: 'provider_mine', name: 'Box', type: 'generic', endpoint: 'http://box:8000/v1' },
    ])
    aiConfig = useAIConfig()
    await aiConfig.init()
    // A preset on Ollama, which needs nothing more to run; and the Default
    // preset on OpenRouter, which has no key and so counts for nothing.
    aiConfig.changeModelSettings('provider_ollama_default', 'llama', { toolsEnabled: true })
    connections = useConnections()

    expect(connections.connections.value.map(one => one.name)).toEqual([
      'Anthropic',
      'Ollama',
      'Box',
    ])
  })

  it('adds the first of a kind in its built-in’s place, and numbers the next', () => {
    const first = connections.addConnection('lmstudio', {})
    const second = connections.addConnection('lmstudio', { endpoint: 'http://box:1234/v1' })

    expect(first).toMatchObject({
      id: 'provider_lmstudio_default',
      name: 'LM Studio',
      endpoint: 'http://localhost:1234/v1',
      added: true,
    })
    expect(second).toMatchObject({ name: 'LM Studio (2)', server: 'lmstudio', added: true })
    expect(second.id).not.toBe(first.id)
    expect(kindOf(second).id).toBe('lmstudio')
    // Added at its own address with nothing else in it, it is still the writer's.
    expect(connections.connections.value.map(one => one.id)).toEqual([first.id, second.id])
  })

  it('fills in the built-in left from before rather than making another', async () => {
    setActivePinia(createPinia())
    db.aiProviders.toArray.mockResolvedValueOnce([
      { id: 'provider_openrouter_default', name: 'OpenRouter', type: 'openrouter' },
    ])
    aiConfig = useAIConfig()
    await aiConfig.init()
    connections = useConnections()

    expect(connections.forKind('openrouter')?.id).toBe('provider_openrouter_default')
    connections.addConnection('openrouter', { apiKey: 'sk-or' })

    expect(aiConfig.providers.value).toHaveLength(1)
    expect(aiConfig.getProvider('provider_openrouter_default')).toMatchObject({
      apiKey: 'sk-or',
      added: true,
    })
  })

  it('is set up once the model new chats start on can answer, not merely once a connection is there', () => {
    // New chats start on Sonnet, on an OpenRouter never connected.
    expect(connections.canChat.value).toBe(false)

    const box = connections.addConnection('lmstudio', {})
    expect(connections.hasChatConnection.value).toBe(true)
    expect(connections.canChat.value).toBe(false)

    useProfiles().setProfileChoices(CHAT_PROFILE_ID, { providerId: box.id, model: 'qwen' })
    expect(connections.canChat.value).toBe(true)
  })

  it('offers every kind setup lists, a server at home where it listens', () => {
    expect(CONNECTION_KINDS.map(kind => kind.name)).toEqual([
      'OpenRouter',
      'Anthropic',
      'OpenAI',
      'NanoGPT',
      'LM Studio',
      'Ollama',
      'llama.cpp',
      'vLLM',
      'KoboldCpp',
      'Kokoro',
      'OpenAI-compatible',
    ])
  })

  describe('check', () => {
    it('asks OpenRouter about its key, and keeps that it answered', async () => {
      checkOpenRouterKey.mockResolvedValueOnce({ freeTier: true })
      const { id } = connections.addConnection('openrouter', { apiKey: 'sk-or' })

      expect(await connections.check(id)).toEqual({
        state: 'connected',
        message: 'Connected to OpenRouter.',
        freeTier: true,
      })
      expect(checkOpenRouterKey).toHaveBeenCalledWith('sk-or')
      expect(connections.stateOf(id)).toBe('connected')
    })

    it('says a refused key was refused', async () => {
      checkOpenRouterKey.mockRejectedValueOnce(
        Object.assign(new Error('User not found.'), { status: 401 })
      )
      const { id } = connections.addConnection('openrouter', { apiKey: 'sk-wrong' })

      expect(await connections.check(id)).toEqual({
        state: 'key',
        message: "OpenRouter didn't accept the key.",
      })
      expect(connections.stateOf(id)).toBe('key')
    })

    it('asks NanoGPT its balance, since its list is anyone’s', async () => {
      const { id } = connections.addConnection('nanogpt', { apiKey: 'sk-nano-x' })

      expect(await connections.check(id)).toEqual({
        state: 'connected',
        message: 'Connected to NanoGPT.',
      })
      expect(checkNanoGptKey).toHaveBeenCalledWith('sk-nano-x')
      expect(connections.stateOf(id)).toBe('connected')

      checkNanoGptKey.mockRejectedValueOnce(
        Object.assign(new Error('Incorrect API key.'), { status: 401 })
      )
      expect(await connections.check(id)).toEqual({
        state: 'key',
        message: "NanoGPT didn't accept the key.",
      })
    })

    it('offers the sign-in where a service has one, and asks for its key', async () => {
      const { id } = connections.addConnection('nanogpt', {})

      expect(await connections.check(id)).toEqual({
        state: null,
        message: 'Enter a key, or sign in with NanoGPT.',
      })
      expect(checkNanoGptKey).not.toHaveBeenCalled()
    })

    it('asks a server for its models, and says where it couldn’t be reached', async () => {
      const { id } = connections.addConnection('lmstudio', {})
      listModels.mockRejectedValueOnce(offline())

      expect(await connections.check(id)).toEqual({
        state: 'unreachable',
        message: "Couldn't reach LM Studio at localhost:1234.",
      })

      expect((await connections.check(id)).state).toBe('connected')
      expect(listModels).toHaveBeenLastCalledWith(id, 'chat')
    })

    it('asks for what is missing before asking anything', async () => {
      const { id } = connections.addConnection('anthropic', {})

      expect(await connections.check(id)).toEqual({
        state: null,
        message: 'Enter your Anthropic key.',
      })
      expect(listModels).not.toHaveBeenCalled()
    })

    it('passes on a server’s own sentence, and keeps no state for it', async () => {
      const { id } = connections.addConnection('lmstudio', {})
      listModels.mockRejectedValueOnce(
        Object.assign(new Error('No models loaded.'), { status: 400 })
      )

      expect(await connections.check(id)).toEqual({ state: null, message: 'No models loaded.' })
      expect(connections.stateOf(id)).toBeNull()
    })
  })

  it('makes a NanoGPT connection of its own, with its address kept on the row', () => {
    const provider = connections.addConnection('nanogpt', { apiKey: 'sk-nano-x' })

    expect(provider).toMatchObject({
      name: 'NanoGPT',
      type: 'nanogpt',
      endpoint: 'https://api.nano-gpt.com/api/v1',
      apiKey: 'sk-nano-x',
      added: true,
    })
    expect(provider.id).not.toMatch(/_default$/)
    expect(kindOf(provider).id).toBe('nanogpt')
    expect(connections.addConnection('nanogpt', {}).name).toBe('NanoGPT (2)')
  })

  it('removes any connection, a built-in’s place among them', () => {
    const { id } = connections.addConnection('openrouter', { apiKey: 'sk-or' })
    connections.setState(id, 'connected')

    connections.remove(id)

    expect(aiConfig.getProvider(id)).toBeNull()
    expect(connections.stateOf(id)).toBeNull()
  })
})

describe('stateOfError', () => {
  it('reads a refused key, a server not there, and neither', () => {
    expect(stateOfError({ status: 401 })).toBe('key')
    expect(stateOfError({ status: 403 })).toBe('key')
    expect(stateOfError(offline())).toBe('unreachable')
    expect(stateOfError(new Error('Load failed'))).toBe('unreachable')
    expect(stateOfError({ status: 500, message: 'Load failed' })).toBeNull()
    expect(stateOfError(new Error('No models loaded.'))).toBeNull()
  })
})

describe('hostOf', () => {
  it('says where a server is as the writer would', () => {
    expect(hostOf('http://localhost:1234/v1')).toBe('localhost:1234')
    expect(hostOf('https://openrouter.ai/api/v1/')).toBe('openrouter.ai')
    expect(hostOf('not an address')).toBe('not an address')
  })
})

describe('describeFailure', () => {
  const openRouter = { id: 'p_or', name: 'OpenRouter', type: 'openrouter' }
  const lmStudio = {
    id: 'p_lm',
    name: 'LM Studio',
    type: 'generic',
    endpoint: 'http://localhost:1234/v1',
  }

  it('offers the connection’s settings for a refused key or a server not there', () => {
    expect(describeFailure({ status: 401, message: 'User not found.' }, openRouter, 'm')).toEqual({
      text: "OpenRouter didn't accept the key.",
      state: 'key',
      fix: { kind: 'connection', providerId: 'p_or' },
    })
    expect(describeFailure(offline(), lmStudio, 'qwen')).toEqual({
      text: "Couldn't reach LM Studio at localhost:1234.",
      state: 'unreachable',
      fix: { kind: 'connection', providerId: 'p_lm' },
    })
  })

  it('offers credits for an OpenRouter account that has none', () => {
    expect(
      describeFailure({ status: 402, message: 'Insufficient credits' }, openRouter, 'm')
    ).toEqual({
      text: 'Your OpenRouter account is out of credits.',
      state: null,
      fix: { kind: 'credits', providerId: 'p_or', url: 'https://openrouter.ai/settings/credits' },
    })
    const nanoGpt = { id: 'p_nano', name: 'NanoGPT', type: 'nanogpt' }
    expect(describeFailure({ status: 402, message: 'Insufficient balance' }, nanoGpt, 'm')).toEqual(
      {
        text: 'Your NanoGPT account is out of credits.',
        state: null,
        fix: { kind: 'credits', providerId: 'p_nano', url: 'https://nano-gpt.com/balance' },
      }
    )
    // A server at home doesn't sell anything.
    expect(describeFailure({ status: 402, message: 'Pay up' }, lmStudio, 'm').fix).toBeUndefined()
  })

  it('offers another model where a service no longer offers this one, not a server at home', () => {
    const gone =
      'z-ai/glm-5.2 is no longer available on OpenRouter: no provider serves this model anymore.'
    expect(describeFailure({ status: 404, message: gone }, openRouter, 'z-ai/glm-5.2')).toEqual({
      text: 'OpenRouter no longer offers z-ai/glm-5.2.',
      state: null,
      fix: { kind: 'model', providerId: 'p_or' },
    })
    expect(describeFailure({ status: 404, message: 'Not Found' }, lmStudio, 'qwen')).toEqual({
      text: 'Not Found',
      state: null,
    })
  })

  it('offers the connection where its provider routing left the model no provider', () => {
    // On by default, so the writer may never have seen it: not a model gone.
    for (const routingStep of [
      'Filter by Data Policy',
      'Filter by Quantization',
      'Filter by Ignored Providers',
    ]) {
      const error = { status: 404, routingStep, message: 'No endpoints found' }
      expect(describeFailure(error, openRouter, 'z-ai/glm-5.2')).toEqual({
        text: "OpenRouter's provider routing leaves no provider for z-ai/glm-5.2.",
        state: null,
        fix: { kind: 'connection', providerId: 'p_or' },
      })
    }
  })

  it('offers another model where the providers chosen for it, or tools, left it none', () => {
    const limited = { status: 404, routingStep: 'Filter by Allowed Providers', message: 'x' }
    expect(describeFailure(limited, openRouter, 'z-ai/glm-5.2')).toEqual({
      text: 'None of the providers chosen for z-ai/glm-5.2 serve it.',
      state: null,
      fix: { kind: 'model', providerId: 'p_or' },
    })
    const tools = { status: 404, routingStep: 'Filter by Tool Compatibility', message: 'x' }
    expect(describeFailure(tools, openRouter, 'some/model')).toEqual({
      text: "some/model can't use tools on OpenRouter.",
      state: null,
      fix: { kind: 'model', providerId: 'p_or' },
    })
  })

  it("takes a routing step it doesn't know for a model gone, as before", () => {
    const error = { status: 404, routingStep: 'Filter by Something New', message: 'x' }
    expect(describeFailure(error, openRouter, 'm').text).toBe('OpenRouter no longer offers m.')
  })

  it('offers another model where NanoGPT can serve this one only by keeping data', () => {
    const nanoGpt = { id: 'p_nano', name: 'NanoGPT', type: 'nanogpt' }
    // Whatever its status, it isn't the key that was refused.
    const error = { status: 403, code: 'zdr_provider_required', message: 'No eligible route' }
    expect(describeFailure(error, nanoGpt, 'anthropic/claude-sonnet-5.5')).toEqual({
      text: "NanoGPT can't serve anthropic/claude-sonnet-5.5 with zero data retention.",
      state: null,
      fix: { kind: 'model', providerId: 'p_nano' },
    })
  })

  it('offers another model where NanoGPT refuses the providers chosen for it', () => {
    const nanoGpt = { id: 'p_nano', name: 'NanoGPT', type: 'nanogpt' }
    for (const code of ['no_allowed_provider_for_model', 'provider_unknown_provider']) {
      expect(describeFailure({ status: 403, code, message: 'x' }, nanoGpt, 'z-ai/glm-5')).toEqual({
        text: 'None of the providers chosen for z-ai/glm-5 serve it.',
        state: null,
        fix: { kind: 'model', providerId: 'p_nano' },
      })
    }
    for (const code of ['provider_selection_not_available', 'provider_selected']) {
      expect(describeFailure({ status: 400, code, message: 'x' }, nanoGpt, 'z-ai/glm-5')).toEqual({
        text: "NanoGPT doesn't let a subscription choose providers while paid models are off for its API.",
        state: null,
        fix: { kind: 'model', providerId: 'p_nano' },
      })
    }
  })

  it('says anything else as the server said it', () => {
    expect(describeFailure(new Error('No models loaded.'), lmStudio, 'qwen')).toEqual({
      text: 'No models loaded.',
      state: null,
    })
  })
})
