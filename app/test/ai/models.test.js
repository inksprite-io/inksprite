import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/ai/anthropic.js', () => ({ listAnthropicModels: vi.fn() }))
const askProps = vi.hoisted(() => vi.fn())
vi.mock('@/ai/llamacpp.js', () => ({ askProps }))

const { contextOf, listModels, listSpeechModels, openRouterTraits, traitsOf } = await import(
  '@/ai/models.js'
)

/** Answer every fetch with this list, as `/models` does. */
const serve = data =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) }))

let next = 0
/** A connection no earlier test has asked about, so nothing is kept for it. */
const freshOpenRouter = () => ({
  id: `provider_or_${next++}`,
  name: 'OpenRouter',
  type: 'openrouter',
})

const GLM = {
  id: 'z-ai/glm',
  name: 'GLM',
  supported_parameters: ['max_tokens', 'temperature', 'top_k', 'min_p', 'reasoning', 'tools'],
  reasoning: {
    mandatory: false,
    default_enabled: true,
    supported_efforts: ['xhigh', 'high'],
    default_effort: 'high',
  },
}

describe('openRouterTraits', () => {
  it('reads the samplers a model takes off its parameters, in the settings’ names', () => {
    expect(openRouterTraits(GLM).samplers).toEqual(['temperature', 'topK', 'minP'])
  })

  it('reads how it reasons: whether it can stop, its levels lowest first, its default', () => {
    expect(openRouterTraits(GLM).reasoning).toEqual({
      optional: true,
      levels: ['high', 'xhigh'],
      defaultLevel: 'high',
    })
  })

  it('reads how long a context it takes, where the list says', () => {
    expect(openRouterTraits({ ...GLM, context_length: 131072 }).contextLength).toBe(131072)
    expect(openRouterTraits(GLM)).not.toHaveProperty('contextLength')
  })

  it('leaves out an effort the settings have no word for', () => {
    const traits = openRouterTraits({
      ...GLM,
      reasoning: { mandatory: false, supported_efforts: ['none', 'low', 'ultra'] },
    })

    expect(traits.reasoning.levels).toEqual(['low'])
    expect(traits.reasoning.defaultLevel).toBeUndefined()
  })

  it('gives a model reasoning on a token budget the levels OpenRouter sets one from', () => {
    const traits = openRouterTraits({
      ...GLM,
      reasoning: { mandatory: false, supports_max_tokens: true },
    })

    expect(traits.reasoning.levels).toEqual(['low', 'medium', 'high'])
  })

  it('says a model whose list says nothing of reasoning does not reason', () => {
    const traits = openRouterTraits({ id: 'm', supported_parameters: ['temperature'] })

    expect(traits.reasoning).toBeNull()
  })

  it('says nothing where the list says nothing', () => {
    expect(openRouterTraits({ id: 'openrouter/auto', reasoning: null })).toEqual({})
  })
})

describe('listModels', () => {
  it('keeps what OpenRouter says of each model, and nothing for anyone else', async () => {
    serve([GLM])
    const [fromOpenRouter] = await listModels(freshOpenRouter())
    serve([GLM])
    const [fromLocal] = await listModels({
      id: 'local',
      name: 'Local',
      type: 'generic',
      endpoint: 'http://box:1234/v1',
    })

    expect(fromOpenRouter.traits.samplers).toEqual(['temperature', 'topK', 'minP'])
    expect(fromLocal).toEqual({ id: 'z-ai/glm', name: 'GLM' })
  })
})

describe('traitsOf', () => {
  beforeEach(() => serve([GLM]))

  it('asks OpenRouter once for its list, and finds the model in it', async () => {
    const provider = freshOpenRouter()

    expect((await traitsOf(provider, 'z-ai/glm')).reasoning.levels).toEqual(['high', 'xhigh'])
    await traitsOf(provider, 'z-ai/glm')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('asks nothing when a picker has asked already', async () => {
    const provider = freshOpenRouter()
    await listModels(provider)
    fetch.mockClear()

    expect(await traitsOf(provider, 'z-ai/glm')).toBeDefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('finds a variant OpenRouter routes by under its model', async () => {
    expect(await traitsOf(freshOpenRouter(), 'z-ai/glm:nitro')).toBeDefined()
  })

  it('knows nothing of a model the list lacks', async () => {
    expect(await traitsOf(freshOpenRouter(), 'someone/else')).toBeUndefined()
  })

  it('asks again next time when the list could not be had', async () => {
    const provider = freshOpenRouter()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetch.mockRejectedValueOnce(new TypeError('Load failed'))

    expect(await traitsOf(provider, 'z-ai/glm')).toBeUndefined()
    expect(await traitsOf(provider, 'z-ai/glm')).toBeDefined()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('asks nothing of a connection whose list says nothing a request needs', async () => {
    expect(await traitsOf({ id: 'local', type: 'generic' }, 'qwen')).toBeUndefined()
    expect(await traitsOf({ id: 'anthropic', type: 'anthropic' }, 'claude')).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('listSpeechModels', () => {
  it("asks OpenRouter for its speech models apart, with each one's voices and limit", async () => {
    serve([
      {
        id: 'hexgrad/kokoro-82m',
        name: 'Kokoro 82M',
        supported_voices: ['af_heart', 'bm_george'],
        context_length: 4096,
      },
      { id: 'acme/voice', name: 'Acme Voice', supported_voices: [] },
    ])
    const models = await listSpeechModels(freshOpenRouter())

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'https://openrouter.ai/api/v1/models?output_modalities=speech'
    )
    expect(models).toEqual([
      { id: 'acme/voice', name: 'Acme Voice' },
      {
        id: 'hexgrad/kokoro-82m',
        name: 'Kokoro 82M',
        voices: ['af_heart', 'bm_george'],
        inputLimit: 4096,
      },
    ])
  })

  it("keeps OpenAI's speech models out of its list, with the voices each reads in", async () => {
    serve([{ id: 'gpt-5' }, { id: 'tts-1' }, { id: 'gpt-4o-mini-tts' }, { id: 'whisper-1' }])
    const models = await listSpeechModels({ id: 'o', name: 'OpenAI', type: 'openai', apiKey: 'k' })

    expect(models.map(model => model.id)).toEqual(['gpt-4o-mini-tts', 'tts-1'])
    expect(models[0].voices).toContain('marin')
    expect(models[1].voices).not.toContain('marin')
    expect(models[1].voices).toContain('alloy')
    expect(models.every(model => model.inputLimit === 4096)).toBe(true)
  })

  it("shows Kokoro-FastAPI's one model once, not under OpenAI's names too", async () => {
    serve([{ id: 'tts-1' }, { id: 'tts-1-hd' }, { id: 'kokoro' }, { id: 'gpt-4o-mini-tts' }])
    const kokoro = {
      id: 'provider_kokoro_default',
      name: 'Kokoro',
      type: 'generic',
      endpoint: 'http://localhost:8880/v1',
    }
    expect(await listSpeechModels(kokoro)).toEqual([{ id: 'kokoro', name: 'kokoro' }])
  })

  it('lists what a server the writer added lists', async () => {
    serve([{ id: 'piper' }, { id: 'chatterbox' }])
    const own = { id: 'own', name: 'Own', type: 'generic', endpoint: 'http://box:8000/v1' }
    expect((await listSpeechModels(own)).map(model => model.id)).toEqual(['chatterbox', 'piper'])
  })

  it('asks nothing of a connection that does not speak', async () => {
    vi.stubGlobal('fetch', vi.fn())
    expect(await listSpeechModels({ id: 'a', name: 'Anthropic', type: 'anthropic' })).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('contextOf', () => {
  it('reads it off OpenRouter’s list, and from what llama.cpp says a slot holds', async () => {
    serve([{ ...GLM, context_length: 202752 }])
    expect(await contextOf(freshOpenRouter(), 'z-ai/glm')).toBe(202752)

    askProps.mockResolvedValue({ slots: 1, context: 8192 })
    expect(await contextOf(/** @type {any} */ ({ id: 'l', type: 'llamacpp' }), 'any')).toBe(8192)
  })

  it('knows nothing of any other connection’s', async () => {
    expect(
      await contextOf(/** @type {any} */ ({ id: 'x', type: 'generic' }), 'any')
    ).toBeUndefined()
  })
})
