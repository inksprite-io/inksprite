import { describe, it, expect, beforeEach, vi } from 'vitest'

const listAnthropicModels = vi.hoisted(() => vi.fn())
vi.mock('@/ai/anthropic.js', () => ({ listAnthropicModels }))
const askProps = vi.hoisted(() => vi.fn())
vi.mock('@/ai/llamacpp.js', () => ({ askProps }))

const {
  contextOf,
  listModels,
  listSpeechModels,
  nanoGptProvidersOf,
  nanoGptTraits,
  openRouterTraits,
  plainModelId,
  traitsOf,
} = await import('@/ai/models.js')

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

/** A connection to NanoGPT no earlier test has asked about. */
const freshNanoGpt = () => ({ id: `provider_nano_${next++}`, name: 'NanoGPT', type: 'nanogpt' })

/** One entry of NanoGPT's detailed list, made up, of the shape it has. */
const KIMI = {
  id: 'moonshotai/kimi-latest',
  object: 'model',
  owned_by: 'moonshotai',
  name: 'Kimi Latest',
  context_length: 1048576,
  max_output_tokens: 131072,
  capabilities: { vision: true, reasoning: true, tool_calling: true, structured_output: true },
  reasoning_efforts: ['low', 'high', 'max'],
  pricing: { prompt: 2, completion: 10, currency: 'USD', unit: 'per_million_tokens' },
  subscription: { included: false },
}

describe('nanoGptProvidersOf', () => {
  it('names the providers serving a model now, by name, with their prices per token', () => {
    const listed = nanoGptProvidersOf({
      supportsProviderSelection: true,
      providers: [
        {
          provider: 'zeta',
          displayName: 'Zeta',
          available: true,
          pricing: { inputPer1kTokens: 0.001, outputPer1kTokens: 0.003 },
          privacy: { classification: 'zdr' },
        },
        { provider: 'alpha', available: true, privacy: { classification: 'no_training' } },
        { provider: 'down', displayName: 'Down', available: false },
        { displayName: 'No id', available: true },
      ],
    })

    expect(listed).toEqual({
      selectable: true,
      providers: [
        { slug: 'alpha', name: 'alpha', zdr: false },
        {
          slug: 'zeta',
          name: 'Zeta',
          zdr: true,
          pricing: { prompt: 0.000001, completion: 0.000003 },
        },
      ],
    })
  })

  it('says a model on a fixed route can’t be chosen for', () => {
    expect(nanoGptProvidersOf({ supportsProviderSelection: false, providerDetails: [] })).toEqual({
      selectable: false,
      providers: [],
    })
    expect(nanoGptProvidersOf(null)).toEqual({ selectable: false, providers: [] })
  })
})

describe('nanoGptTraits', () => {
  it('reads how a model reasons: whether it can stop, and its levels lowest first', () => {
    expect(nanoGptTraits(KIMI).reasoning).toEqual({
      optional: false,
      levels: ['low', 'high', 'max'],
    })
    expect(
      nanoGptTraits({ ...KIMI, reasoning_efforts: ['none', 'minimal', 'xhigh', 'turbo'] }).reasoning
    ).toEqual({ optional: true, levels: ['minimal', 'xhigh'] })
  })

  it('reads whether it calls tools, and how much it reads', () => {
    expect(nanoGptTraits(KIMI)).toMatchObject({ tools: true, contextLength: 1048576 })
    expect(
      nanoGptTraits({ ...KIMI, capabilities: { reasoning: false, tool_calling: false } })
    ).toEqual({ reasoning: null, tools: false, contextLength: 1048576 })
  })

  it('says nothing of samplers, which NanoGPT passes on, or of reasoning it lists no levels of', () => {
    const traits = nanoGptTraits({ ...KIMI, reasoning_efforts: undefined })

    expect(traits).not.toHaveProperty('samplers')
    expect(traits).not.toHaveProperty('reasoning')
  })
})

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

describe('NanoGPT’s list', () => {
  it('asks for what it says of each model, and prices it by the token', async () => {
    serve([KIMI])
    const [kimi] = await listModels(freshNanoGpt())

    expect(fetch).toHaveBeenCalledWith(
      'https://api.nano-gpt.com/api/v1/models?detailed=true',
      expect.anything()
    )
    expect(kimi.name).toBe('Kimi Latest')
    expect(kimi.traits.reasoning.levels).toEqual(['low', 'high', 'max'])
    expect(kimi.pricing.prompt).toBeCloseTo(0.000002, 12)
    expect(kimi.pricing.completion).toBeCloseTo(0.00001, 12)
    // NanoGPT's free models aren't OpenRouter's free tier.
    expect(kimi).not.toHaveProperty('free')
  })

  it('is what a request is fitted to, asked once', async () => {
    serve([KIMI])
    const provider = freshNanoGpt()

    expect(await contextOf(provider, 'moonshotai/kimi-latest')).toBe(1048576)
    expect((await traitsOf(provider, 'moonshotai/kimi-latest:online')).tools).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('prices for Anthropic’s and OpenAI’s models', () => {
  /** OpenRouter's public list, as the maker's prices are read off it. */
  const PUBLIC = [
    { id: 'anthropic/claude-sonnet-4.5', pricing: { prompt: '0.000003', completion: '0.000015' } },
    { id: 'openai/gpt-6.1-sol', pricing: { prompt: '0.000002', completion: '0.000008' } },
    { id: 'openai/gpt-6.1-sol:batch', pricing: { prompt: '0.000001', completion: '0.000004' } },
  ]

  it('names a model plainly, without its maker, its date or how its version is written', () => {
    expect(plainModelId('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5')
    expect(plainModelId('anthropic/claude-sonnet-4.5')).toBe('claude-sonnet-4-5')
    expect(plainModelId('gpt-6.1-sol-2026-09-29')).toBe('gpt-6-1-sol')
  })

  it('gives each the price OpenRouter lists it at, and none where it lists none', async () => {
    serve(PUBLIC)
    listAnthropicModels.mockResolvedValueOnce([
      { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
      { id: 'claude-unlisted', name: 'Unlisted' },
    ])

    const [sonnet, unlisted] = await listModels({
      id: 'a',
      name: 'Anthropic',
      type: 'anthropic',
      apiKey: 'k',
    })

    expect(sonnet.pricing).toEqual({ prompt: 0.000003, completion: 0.000015 })
    expect(unlisted).not.toHaveProperty('pricing')
  })

  it('prices OpenAI’s list the same way, its batch prices aside', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async url => ({
        ok: true,
        json: async () => ({
          data: String(url).startsWith('https://openrouter.ai') ? PUBLIC : [{ id: 'gpt-6.1-sol' }],
        }),
      }))
    )

    const [sol] = await listModels({ id: 'o', name: 'OpenAI', type: 'openai', apiKey: 'k' })

    expect(sol.pricing).toEqual({ prompt: 0.000002, completion: 0.000008 })
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

  it("lists NanoGPT's models that speak, apart, with their voices and limit", async () => {
    serve([
      {
        id: 'some-tts',
        name: 'Some TTS',
        capabilities: { text_to_speech: true },
        supported_parameters: { voices: ['ana', 'ben'], max_chars: 4000 },
      },
      { id: 'quiet-tts', capabilities: { text_to_speech: true } },
      { id: 'some-music', capabilities: { text_to_music: true } },
      { id: 'some-stt', capabilities: { speech_to_text: true } },
    ])

    const models = await listSpeechModels(freshNanoGpt())

    expect(fetch).toHaveBeenCalledWith(
      'https://api.nano-gpt.com/api/v1/audio-models',
      expect.anything()
    )
    expect(models).toEqual([
      { id: 'quiet-tts', name: 'quiet-tts' },
      { id: 'some-tts', name: 'Some TTS', voices: ['ana', 'ben'], inputLimit: 4000 },
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
