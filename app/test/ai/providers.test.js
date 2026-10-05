import { describe, it, expect } from 'vitest'
import {
  PROVIDER_TYPES,
  DEFAULT_PROVIDER_TYPE,
  providerLabel,
  needsEndpoint,
  takesChatTemplateKwargs,
  connectionGap,
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

  it('asks for an address from everything but OpenRouter', () => {
    // Naming the types one at a time is how the next one gets forgotten and
    // saves with nowhere to go.
    expect(needsEndpoint('openrouter')).toBe(false)
    for (const entry of PROVIDER_TYPES.filter(e => e.id !== 'openrouter')) {
      expect(needsEndpoint(entry.id)).toBe(true)
    }
  })

  it('offers the chat template only to a server known to render one', () => {
    // A generic server could be anything, and an argument it does not expect
    // is a 400 on a request that would otherwise have worked.
    expect(takesChatTemplateKwargs('llamacpp')).toBe(true)
    expect(takesChatTemplateKwargs('generic')).toBe(false)
    expect(takesChatTemplateKwargs('openrouter')).toBe(false)
  })
})

describe('connectionGap', () => {
  it('wants a key from OpenRouter and an address from a server someone runs', () => {
    expect(connectionGap({ type: 'openrouter', apiKey: '' })).toBe('key')
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
