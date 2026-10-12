import { describe, it, expect } from 'vitest'
import {
  blockedBy,
  capabilitiesOf,
  fitEffort,
  fitSettings,
  samplersAt,
  serverOf,
} from '@/ai/capabilities.js'
import { AI_DEFAULTS, resolveAISettings } from '@/ai/defaults.js'

const openrouter = { id: 'provider_openrouter_default', type: 'openrouter' }
const anthropic = { id: 'provider_anthropic_default', type: 'anthropic' }
const openai = { id: 'provider_openai_default', type: 'openai' }

/** A model that always reasons, at the levels given. */
const always = (levels, defaultLevel) => ({
  reasoning: { optional: false, levels, defaultLevel },
})

describe('serverOf', () => {
  it('knows a built-in generic connection by which built-in it is', () => {
    expect(serverOf({ id: 'provider_lmstudio_default', type: 'generic' })).toBe('lmstudio')
    expect(serverOf({ id: 'provider_ollama_default', type: 'generic' })).toBe('ollama')
    expect(serverOf({ id: 'provider_llamacpp_default', type: 'llamacpp' })).toBe('llamacpp')
  })

  it('takes the writer’s own connection to be its type, or a server we know nothing of', () => {
    expect(serverOf({ id: 'provider_mine', type: 'generic' })).toBe('generic')
    expect(serverOf({ id: 'provider_mine', type: 'llamacpp' })).toBe('llamacpp')
    expect(serverOf({ id: 'provider_mine', type: 'retired' })).toBe('generic')
    expect(serverOf({})).toBe('generic')
  })
})

describe('capabilitiesOf', () => {
  it('offers an undescribed OpenRouter model everything, as before', () => {
    const capabilities = capabilitiesOf(openrouter, 'some/model')

    expect(capabilities.samplers.size).toBe(9)
    expect(capabilities.efforts).toEqual(['disabled', 'enabled', 'low', 'medium', 'high'])
    expect(capabilities.reasoningDisplay).toBe(true)
  })

  it('offers a model the samplers and efforts its list says it takes', () => {
    const capabilities = capabilitiesOf(openrouter, 'some/model', {
      samplers: ['temperature', 'seed'],
      ...always(['high', 'xhigh'], 'high'),
    })

    expect([...capabilities.samplers]).toEqual(['temperature', 'seed'])
    expect(capabilities.efforts).toEqual(['high', 'xhigh'])
    expect(capabilities.defaultEffort).toBe('high')
  })

  it('offers Disabled only to a model that can stop, and Enabled to one with no levels', () => {
    const optional = { reasoning: { optional: true, levels: [] } }

    expect(capabilitiesOf(openrouter, 'm', optional).efforts).toEqual(['disabled', 'enabled'])
    expect(capabilitiesOf(openrouter, 'm', always([])).efforts).toEqual(['enabled'])
  })

  it('offers nothing of reasoning for a model that does not reason', () => {
    const capabilities = capabilitiesOf(openrouter, 'm', { reasoning: null })

    expect(capabilities.efforts).toEqual([])
    expect(capabilities.reasons).toBe(false)
  })

  it('offers OpenAI’s samplers only to the models that take them', () => {
    // What each answered: the pre-reasoning models and GPT-5.1, 5.2 and 5.4
    // take a temperature; the rest refuse anything but their defaults.
    for (const model of [
      'gpt-4.1-mini',
      'gpt-4o',
      'gpt-5.1',
      'gpt-5.4-mini',
      'gpt-5.2-2025-12-11',
    ]) {
      expect(capabilitiesOf(openai, model).samplers.has('temperature')).toBe(true)
    }
    for (const model of ['gpt-5', 'gpt-5-mini', 'gpt-5.5', 'gpt-6-sol', 'o3', 'chat-latest']) {
      expect([...capabilitiesOf(openai, model).samplers]).toEqual(['seed'])
    }
    // No OpenAI model takes these.
    expect(capabilitiesOf(openai, 'gpt-4.1').samplers.has('topK')).toBe(false)
    expect(capabilitiesOf(openai, 'gpt-4.1').efforts).toEqual([])
  })

  it('offers each server someone runs the samplers it reads', () => {
    const samplers = id => capabilitiesOf({ id, type: 'generic' }).samplers

    expect(samplers('provider_ollama_default').has('topK')).toBe(false)
    expect(samplers('provider_ollama_default').has('temperature')).toBe(true)
    expect(samplers('provider_koboldcpp_default').has('topA')).toBe(true)
    expect(samplers('provider_koboldcpp_default').has('frequencyPenalty')).toBe(false)
    expect(samplers('provider_lmstudio_default').has('minP')).toBe(false)
    expect(samplers('provider_vllm_default').has('minP')).toBe(true)
    expect(samplers('provider_mine').size).toBe(9)
    expect(capabilitiesOf({ type: 'llamacpp' }).samplers.has('topA')).toBe(false)
  })

  it('renames the repetition penalty for the servers that read it as repeat_penalty', () => {
    expect(capabilitiesOf({ type: 'llamacpp' }).names.repetitionPenalty).toBe('repeat_penalty')
    expect(
      capabilitiesOf({ id: 'provider_lmstudio_default', type: 'generic' }).names.repetitionPenalty
    ).toBe('repeat_penalty')
    expect(capabilitiesOf({ type: 'generic' }).names).toEqual({})
  })

  it('tells a server that hears nothing of reasoning nothing, but lets llama-server switch it', () => {
    expect(capabilitiesOf({ type: 'generic' }).efforts).toEqual([])
    expect(capabilitiesOf({ type: 'llamacpp' }).efforts).toEqual(['disabled', 'enabled'])
  })
})

describe('fitEffort', () => {
  const levels = (efforts, defaultEffort) => ({ efforts, defaultEffort })

  it('keeps an effort the model takes', () => {
    expect(fitEffort('low', levels(['disabled', 'low', 'high']))).toBe('low')
  })

  it('has a model that always reasons reason as little as it can for Disabled', () => {
    expect(fitEffort('disabled', levels(['low', 'medium', 'high']))).toBe('low')
    expect(fitEffort('disabled', levels(['enabled']))).toBe('enabled')
  })

  it('takes Enabled on a model with levels to be the level it reasons at untold', () => {
    expect(fitEffort('enabled', levels(['low', 'medium', 'high'], 'high'))).toBe('high')
    expect(fitEffort('enabled', levels(['low', 'medium', 'high']))).toBe('medium')
  })

  it('takes a level on a model that only switches to be on', () => {
    expect(fitEffort('high', levels(['disabled', 'enabled']))).toBe('enabled')
  })

  it('takes a level a model lacks to be its nearest, the higher of two as near', () => {
    expect(fitEffort('medium', levels(['high', 'xhigh']))).toBe('high')
    expect(fitEffort('max', levels(['low', 'medium', 'high']))).toBe('high')
    expect(fitEffort('medium', levels(['low', 'high']))).toBe('high')
    expect(fitEffort('minimal', levels(['disabled', 'low', 'high']))).toBe('low')
  })

  it('leaves an effort alone where nothing is said of reasoning', () => {
    expect(fitEffort('medium', levels([]))).toBe('medium')
  })
})

describe('samplersAt', () => {
  it('takes no samplers from an older Claude while it thinks', () => {
    const capabilities = capabilitiesOf(anthropic, 'claude-haiku-4-5', {
      samplers: ['temperature', 'topP', 'topK'],
      reasoning: { optional: true, levels: ['low', 'medium', 'high'] },
    })

    expect(samplersAt(capabilities, 'medium').size).toBe(0)
    expect([...samplersAt(capabilities, 'disabled')]).toEqual(['temperature', 'topP', 'topK'])
  })

  it('takes them while a model reasons everywhere else', () => {
    const capabilities = capabilitiesOf(openrouter, 'm', { samplers: ['temperature'] })

    expect([...samplersAt(capabilities, 'high')]).toEqual(['temperature'])
  })
})

describe('blockedBy', () => {
  const claude = capabilitiesOf(anthropic, 'claude-haiku-4-5', {
    samplers: ['temperature', 'topP', 'topK'],
    reasoning: { optional: true, levels: [] },
  })

  it('blocks Claude’s top-p while a temperature is set, and not the other way', () => {
    const settings = resolveAISettings({ parameters: { temperature: 0.5, topP: 0.9 } })

    expect(blockedBy(claude, 'topP', settings)).toBe('temperature')
    expect(blockedBy(claude, 'temperature', settings)).toBeUndefined()
    expect(blockedBy(claude, 'topP', resolveAISettings())).toBeUndefined()
  })

  it('blocks nothing on a provider that takes both', () => {
    const settings = resolveAISettings({ parameters: { temperature: 0.5 } })

    expect(blockedBy(capabilitiesOf(openrouter, 'm'), 'topP', settings)).toBeUndefined()
  })
})

describe('fitSettings', () => {
  it('puts what the model can’t take back at the value that leaves it out', () => {
    const capabilities = capabilitiesOf({ id: 'provider_ollama_default', type: 'generic' })
    const fitted = fitSettings(
      resolveAISettings({ seed: 4, parameters: { temperature: 0.7, topK: 40, minP: 0.1 } }),
      capabilities
    )

    expect(fitted.parameters.temperature).toBe(0.7)
    expect(fitted.parameters.topK).toBe(AI_DEFAULTS.parameters.topK)
    expect(fitted.parameters.minP).toBe(AI_DEFAULTS.parameters.minP)
    expect(fitted.seed).toBe(4)
  })

  it('fits the effort, and the samplers to the effort it fitted', () => {
    const capabilities = capabilitiesOf(anthropic, 'claude-haiku-4-5', {
      samplers: ['temperature', 'topP', 'topK'],
      reasoning: { optional: true, levels: ['low', 'medium', 'high'] },
    })
    const fitted = fitSettings(
      resolveAISettings({ reasoningEffort: 'xhigh', parameters: { temperature: 0.7 } }),
      capabilities
    )

    expect(fitted.reasoningEffort).toBe('high')
    expect(fitted.parameters.temperature).toBe(1.0)
  })

  it('sends a temperature rather than a top-p where only one is taken', () => {
    const capabilities = capabilitiesOf(anthropic, 'claude-haiku-4-5', {
      samplers: ['temperature', 'topP', 'topK'],
      reasoning: null,
    })
    const both = resolveAISettings({ parameters: { temperature: 0.7, topP: 0.9 } })

    expect(fitSettings(both, capabilities).parameters).toMatchObject({
      temperature: 0.7,
      topP: 1.0,
    })
  })

  it('lets a top-p through when the temperature it pairs with is one the model can’t take', () => {
    const capabilities = capabilitiesOf(anthropic, 'm', { samplers: ['topP'], reasoning: null })
    const both = resolveAISettings({ parameters: { temperature: 0.7, topP: 0.9 } })

    expect(fitSettings(both, capabilities).parameters).toMatchObject({
      temperature: 1.0,
      topP: 0.9,
    })
  })

  it('leaves the stored settings as they were', () => {
    const settings = resolveAISettings({ reasoningEffort: 'medium', parameters: { topK: 40 } })
    fitSettings(settings, capabilitiesOf(openrouter, 'm', { samplers: [], ...always(['high']) }))

    expect(settings.reasoningEffort).toBe('medium')
    expect(settings.parameters.topK).toBe(40)
  })
})
