import { describe, it, expect } from 'vitest'
import {
  PROVIDER_TYPES,
  DEFAULT_PROVIDER_TYPE,
  BUILT_IN_PROVIDERS,
  providerLabel,
  knownAddress,
  needsEndpoint,
  needsKey,
  takesChatTemplateKwargs,
  takesReasoningEffort,
  connectionGap,
  presetProblem,
  canListModels,
  servesChat,
  inMenuOrder,
  providerDoes,
} from '@/ai/providers.js'

describe('provider types', () => {
  it('offers generic, and offers it last', () => {
    // The fallback, and the honest answer for a server nothing here knows
    // anything more about.
    expect(PROVIDER_TYPES.map(entry => entry.id)).toContain(DEFAULT_PROVIDER_TYPE)
    expect(PROVIDER_TYPES.at(-1).id).toBe(DEFAULT_PROVIDER_TYPE)
  })

  it('gives every type both a short name and a longer one', () => {
    for (const entry of PROVIDER_TYPES) {
      expect(entry.label).toBeTruthy()
      expect(entry.menu).toBeTruthy()
    }
  })

  it('names a type it has never heard of rather than showing a blank', () => {
    // A type saved before it was known here, or after it stopped being. A
    // connection with nothing in front of it reads as broken.
    expect(providerLabel('vllm')).toBe('Generic')
    expect(providerLabel(undefined)).toBe('Generic')
    expect(providerLabel('llamacpp')).toBe('llama.cpp')
  })

  it('asks for an address from everything but the hosted services', () => {
    // Naming the types one at a time is how the next one gets forgotten and
    // saves with nowhere to go.
    const hosted = ['openrouter', 'anthropic', 'openai', 'gemini']
    for (const entry of PROVIDER_TYPES) {
      expect(needsEndpoint(entry.id)).toBe(!hosted.includes(entry.id))
    }
    expect(knownAddress('openai')).toBe('https://api.openai.com/v1/')
    expect(knownAddress('generic')).toBeUndefined()
    // A type nothing here knows is a server someone runs.
    expect(needsEndpoint('vllm')).toBe(true)
  })

  it('wants a key from the hosted services only', () => {
    expect(needsKey('openrouter')).toBe(true)
    expect(needsKey('anthropic')).toBe(true)
    expect(needsKey('openai')).toBe(true)
    expect(needsKey('gemini')).toBe(true)
    expect(needsKey('llamacpp')).toBe(false)
    expect(needsKey('generic')).toBe(false)
    expect(needsKey(undefined)).toBe(false)
  })

  it('names a reasoning effort only to the services that take one as reasoning_effort', () => {
    expect(takesReasoningEffort('gemini')).toBe(true)
    // gpt-4.1 refuses it, and gpt-5.4 refuses it beside tools.
    expect(takesReasoningEffort('openai')).toBe(false)
    // OpenRouter says it in `reasoning`; a local server may know no such key.
    expect(takesReasoningEffort('openrouter')).toBe(false)
    expect(takesReasoningEffort('generic')).toBe(false)
  })

  it('offers the chat template only to a server known to render one', () => {
    // A generic server could be anything, and an argument it does not expect
    // is a 400 on a request that would otherwise have worked.
    expect(takesChatTemplateKwargs('llamacpp')).toBe(true)
    expect(takesChatTemplateKwargs('generic')).toBe(false)
    expect(takesChatTemplateKwargs('openrouter')).toBe(false)
  })
})

describe('built-in providers', () => {
  it('starts every install with the hosted services and the usual local servers', () => {
    expect(BUILT_IN_PROVIDERS.map(entry => entry.name)).toEqual([
      'OpenRouter',
      'Anthropic',
      'OpenAI',
      'LM Studio',
      'Ollama',
      'llama.cpp',
      'vLLM',
      'KoboldCpp',
      'Kokoro',
    ])
    // Presets point at OpenRouter's id from before there were others.
    expect(BUILT_IN_PROVIDERS[0].id).toBe('provider_openrouter_default')
  })

  it('gives each one a type it knows and everything it needs but a key', () => {
    for (const entry of BUILT_IN_PROVIDERS) {
      expect(PROVIDER_TYPES.some(type => type.id === entry.type)).toBe(true)
      expect(connectionGap({ ...entry, apiKey: 'sk-1' })).toBeNull()
    }
    expect(new Set(BUILT_IN_PROVIDERS.map(entry => entry.id)).size).toBe(BUILT_IN_PROVIDERS.length)
  })

  it('has none of a type not offered yet', () => {
    const hidden = PROVIDER_TYPES.filter(type => type.hidden).map(type => type.id)

    expect(hidden).toContain('gemini')
    expect(BUILT_IN_PROVIDERS.filter(entry => hidden.includes(entry.type))).toEqual([])
  })

  it('lists them first, in their own order, and the writer’s after in the order given', () => {
    const mine = [{ id: 'provider_b' }, { id: 'provider_a' }]
    const ordered = inMenuOrder([
      mine[0],
      { id: 'provider_vllm_default' },
      mine[1],
      { id: 'provider_openrouter_default' },
    ])

    expect(ordered.map(p => p.id)).toEqual([
      'provider_openrouter_default',
      'provider_vllm_default',
      'provider_b',
      'provider_a',
    ])
  })

  it('lists none of a type not offered yet, though an install may have one', () => {
    const ordered = inMenuOrder([
      { id: 'provider_gemini_default', type: 'gemini' },
      { id: 'provider_openrouter_default', type: 'openrouter' },
    ])

    expect(ordered.map(p => p.id)).toEqual(['provider_openrouter_default'])
  })
})

describe('servesChat', () => {
  it('leaves out what OpenAI lists that a chat cannot use', () => {
    for (const id of [
      'text-embedding-3-large',
      'tts-1',
      'whisper-1',
      'gpt-4o-transcribe',
      'dall-e-3',
      'gpt-image-1',
      'omni-moderation-latest',
      'gpt-realtime',
      'gpt-4o-audio-preview',
      'gpt-3.5-turbo-instruct',
      'o3-pro',
      'gpt-5-codex',
    ]) {
      expect(servesChat('openai', id), id).toBe(false)
    }
    for (const id of ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'o4-mini', 'chatgpt-4o-latest']) {
      expect(servesChat('openai', id), id).toBe(true)
    }
  })

  it('leaves out what Gemini lists that a chat cannot use', () => {
    for (const id of ['gemini-embedding-001', 'imagen-4.0-generate-001', 'veo-3.0-generate-001']) {
      expect(servesChat('gemini', id), id).toBe(false)
    }
    expect(servesChat('gemini', 'gemini-2.5-pro')).toBe(true)
  })

  it('takes every model a server someone runs lists', () => {
    // Its list is what it has loaded, and an embedding model named there is
    // one the writer chose to load.
    expect(servesChat('generic', 'nomic-embed-text')).toBe(true)
    expect(servesChat('openrouter', 'openai/gpt-5-pro')).toBe(true)
  })
})

describe('connectionGap', () => {
  it('wants a key from a hosted service and an address from a server someone runs', () => {
    expect(connectionGap({ type: 'openrouter', apiKey: '' })).toBe('key')
    expect(connectionGap({ type: 'openai' })).toBe('key')
    expect(connectionGap({ type: 'gemini', apiKey: '' })).toBe('key')
    expect(connectionGap({ type: 'llamacpp', endpoint: '' })).toBe('endpoint')
    expect(connectionGap({ type: 'generic' })).toBe('endpoint')
  })

  it('is satisfied by what each type needs, and nothing more', () => {
    expect(connectionGap({ type: 'openrouter', apiKey: 'sk-1' })).toBeNull()
    expect(connectionGap({ type: 'llamacpp', endpoint: 'http://localhost:8080/v1' })).toBeNull()
    // A key is optional for a self-hosted server.
    expect(connectionGap({ type: 'generic', endpoint: 'http://h/v1', apiKey: '' })).toBeNull()
  })

  it('has nothing to say about no connection at all', () => {
    expect(connectionGap(null)).toBeNull()
    expect(connectionGap(undefined)).toBeNull()
  })
})

describe('presetProblem', () => {
  const proxy = {
    id: 'p',
    name: 'Team proxy',
    type: 'generic',
    endpoint: 'http://127.0.0.1:4100/v1',
  }
  const find = connections => id => connections.find(connection => connection.id === id)

  it('is nothing for a preset on a connection that has what it needs', () => {
    expect(presetProblem({ providerId: 'p', model: 'house-large' }, find([proxy]))).toBeNull()
  })

  it('says no provider is connected without a preset or its connection', () => {
    for (const [preset, connections] of [
      [null, [proxy]],
      [{ model: 'm' }, [proxy]],
      [{ providerId: 'gone', model: 'm' }, [proxy]],
    ]) {
      const problem = presetProblem(preset, find(connections))
      expect(problem?.name).toBe('ProviderNotConfiguredError')
      expect(problem?.message).toBe('No AI provider is connected.')
    }
  })

  it('says what the preset or its connection still lacks', () => {
    const openRouter = { id: 'o', name: 'OpenRouter', type: 'openrouter' }
    const anthropic = { id: 'a', name: 'Anthropic', type: 'anthropic' }
    const server = { id: 's', name: 'Box', type: 'generic' }
    const all = find([proxy, openRouter, anthropic, server])

    expect(presetProblem({ providerId: 'p', model: '' }, all)?.message).toBe(
      'Pick a model in Settings › AI.'
    )
    const connect = presetProblem({ providerId: 'o', model: 'm' }, all)
    expect(connect?.name).toBe('ProviderNotConfiguredError')
    expect(connect?.message).toBe('Connect OpenRouter in Settings › AI.')
    expect(presetProblem({ providerId: 'a', model: 'm' }, all)?.message).toBe(
      'Add your Anthropic key in Settings › AI.'
    )
    expect(presetProblem({ providerId: 's', model: 'm' }, all)?.message).toBe(
      'Add the server address in Settings › AI.'
    )
  })
})

describe('canListModels', () => {
  it('asks a server with an address, and a service with a key', () => {
    expect(canListModels({ type: 'generic', endpoint: 'http://h/v1' })).toBe(true)
    expect(canListModels({ type: 'generic', endpoint: '' })).toBe(false)
    expect(canListModels({ type: 'openai', apiKey: 'sk-1' })).toBe(true)
    expect(canListModels({ type: 'openai' })).toBe(false)
  })

  it('asks OpenRouter without a key, since its list is public', () => {
    expect(canListModels({ type: 'openrouter' })).toBe(true)
  })

  it('asks nothing of no connection', () => {
    expect(canListModels(null)).toBe(false)
  })
})

describe('providerDoes', () => {
  /** What each built-in connection is offered for. */
  const kinds = id => {
    const provider = BUILT_IN_PROVIDERS.find(entry => entry.id === id)
    return ['chat', 'speech'].filter(kind => providerDoes(provider, kind))
  }

  it('offers each built-in connection for what its server does', () => {
    expect(kinds('provider_openrouter_default')).toEqual(['chat', 'speech'])
    expect(kinds('provider_openai_default')).toEqual(['chat', 'speech'])
    expect(kinds('provider_anthropic_default')).toEqual(['chat'])
    expect(kinds('provider_lmstudio_default')).toEqual(['chat'])
    expect(kinds('provider_ollama_default')).toEqual(['chat'])
    expect(kinds('provider_llamacpp_default')).toEqual(['chat'])
    expect(kinds('provider_vllm_default')).toEqual(['chat'])
    expect(kinds('provider_koboldcpp_default')).toEqual(['chat'])
    expect(kinds('provider_kokoro_default')).toEqual(['speech'])
  })

  it("offers a server the writer adds for both, since nothing's known of it", () => {
    const own = { id: 'provider_own', type: 'generic' }
    expect(providerDoes(own, 'chat')).toBe(true)
    expect(providerDoes(own, 'speech')).toBe(true)
    // A type no longer known reads as generic.
    expect(providerDoes({ id: 'provider_old', type: 'retired' }, 'speech')).toBe(true)
    expect(providerDoes({ id: 'provider_ls', type: 'llamacpp' }, 'speech')).toBe(false)
  })

  it('offers nothing for no connection', () => {
    expect(providerDoes(null, 'chat')).toBe(false)
  })
})
