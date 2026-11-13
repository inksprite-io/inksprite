import { describe, it, expect } from 'vitest'
import {
  attributionHeaders,
  buildCompletionBody,
  toWireMessages,
  chatCompletionsUrl,
  modelsUrl,
  audioModelsUrl,
} from '@/ai/wire.js'
import { AI_DEFAULTS, TITLE_DEFAULTS, resolveAISettings } from '@/ai/defaults.js'

const SAMPLER_KEYS = [
  'temperature',
  'top_p',
  'frequency_penalty',
  'presence_penalty',
  'min_p',
  'top_k',
  'top_a',
  'repetition_penalty',
]

const local = { type: 'generic', endpoint: 'http://localhost:1234/v1' }
const openrouter = { type: 'openrouter', endpoint: 'ignored' }
const llamacpp = { type: 'llamacpp', endpoint: 'http://localhost:8080/v1' }
const openai = { type: 'openai' }
const gemini = { type: 'gemini' }
// The address on the row is for apps that don't know NanoGPT.
const nanogpt = { type: 'nanogpt', endpoint: 'https://elsewhere.example/v1' }

describe('endpoint addressing', () => {
  it('joins a base URL whether or not it ends in a slash', () => {
    expect(chatCompletionsUrl(local)).toBe('http://localhost:1234/v1/chat/completions')
    expect(chatCompletionsUrl({ type: 'generic', endpoint: 'http://localhost:1234/v1/' })).toBe(
      'http://localhost:1234/v1/chat/completions'
    )
    expect(modelsUrl(local)).toBe('http://localhost:1234/v1/models')
  })

  it('knows where the hosted services are without being told', () => {
    expect(chatCompletionsUrl(openrouter)).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(chatCompletionsUrl(openai)).toBe('https://api.openai.com/v1/chat/completions')
    expect(modelsUrl(gemini)).toBe('https://generativelanguage.googleapis.com/v1beta/openai/models')
    expect(chatCompletionsUrl(nanogpt)).toBe('https://api.nano-gpt.com/api/v1/chat/completions')
    expect(audioModelsUrl(nanogpt)).toBe('https://api.nano-gpt.com/api/v1/audio-models')
  })
})

describe('attributionHeaders', () => {
  it('names the app to OpenRouter, which ranks apps by it, and to nobody else', () => {
    expect(attributionHeaders(openrouter)).toEqual({
      'HTTP-Referer': 'https://inksprite.io',
      'X-Title': 'inksprite',
    })
    // Gemini turns a browser away over a header it has not heard of.
    expect(attributionHeaders(gemini)).toEqual({})
    // NanoGPT takes them, and does nothing with them.
    expect(attributionHeaders(nanogpt)).toEqual({})
    expect(attributionHeaders(local)).toEqual({})
  })
})

describe('toWireMessages', () => {
  it('translates reasoning before stripping what is ours', () => {
    // Order matters: `_reasoning` has to become a field the provider knows
    // before the pass that drops every leading underscore runs.
    const [message] = toWireMessages(
      [{ role: 'assistant', content: null, _reasoning: 'mm' }],
      local
    )

    expect(message).toEqual({ role: 'assistant', content: null, reasoning_content: 'mm' })
  })

  it('gives NanoGPT back the details it sent, and the thinking where it sent none', () => {
    const details = [{ type: 'reasoning.text', text: 'mm', signature: 'sig' }]
    const [signed, plain] = toWireMessages(
      [
        { role: 'assistant', content: null, reasoning_details: details, _reasoning: 'mm' },
        { role: 'assistant', content: null, _reasoning: 'hm' },
      ],
      nanogpt
    )

    expect(signed).toEqual({ role: 'assistant', content: null, reasoning_details: details })
    expect(plain).toEqual({ role: 'assistant', content: null, reasoning_content: 'hm' })
  })

  it('marks no cache breakpoints for NanoGPT, which places its own', () => {
    const wire = toWireMessages(
      [
        { role: 'system', content: 's' },
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
      ],
      nanogpt
    )

    expect(wire.some(message => 'cache_control' in message)).toBe(false)
  })

  it('keeps our own notes off the wire', () => {
    const [message] = toWireMessages([{ role: 'tool', content: '{}', _document: 'doc_1' }], local)

    expect(message).toEqual({ role: 'tool', content: '{}' })
  })
})

describe('buildCompletionBody', () => {
  const base = { messages: [{ role: 'user', content: 'hi' }], model: 'gemma', provider: local }

  it('leaves sampler keys out at their sentinel values', () => {
    const { body } = buildCompletionBody({ ...base, settings: AI_DEFAULTS })

    // A backend that has never heard of the key rejects the request, one that
    // has may read the neutral value as a deliberate override, and Claude
    // refuses a temperature and a top-p together.
    for (const key of SAMPLER_KEYS) expect(body).not.toHaveProperty(key)
    expect(body).not.toHaveProperty('max_tokens')
    expect(body).not.toHaveProperty('seed')
    expect(body).not.toHaveProperty('tools')
  })

  it('asks for a title without a sampler key a strict server could refuse', () => {
    const { body } = buildCompletionBody({ ...base, settings: resolveAISettings(TITLE_DEFAULTS) })

    for (const key of SAMPLER_KEYS) expect(body).not.toHaveProperty(key)
  })

  it('sends the sampler keys that were actually set', () => {
    const { body } = buildCompletionBody({
      ...base,
      settings: resolveAISettings({
        maxTokens: 100,
        seed: 7,
        parameters: { temperature: 0, minP: 0.1, topK: 40, presencePenalty: 0.5 },
      }),
    })

    expect(body).toMatchObject({
      max_tokens: 100,
      seed: 7,
      temperature: 0,
      min_p: 0.1,
      top_k: 40,
      presence_penalty: 0.5,
    })
    expect(body).not.toHaveProperty('top_p')
  })

  const tuned = resolveAISettings({
    seed: 7,
    parameters: { temperature: 0.7, topK: 40, minP: 0.1, repetitionPenalty: 1.1 },
  })

  it('sends a server only the samplers it reads', () => {
    const ollama = { id: 'provider_ollama_default', type: 'generic', endpoint: 'http://x/v1' }

    const { body } = buildCompletionBody({ ...base, provider: ollama, settings: tuned })

    expect(body).toMatchObject({ temperature: 0.7, seed: 7 })
    for (const key of ['top_k', 'min_p', 'repetition_penalty']) expect(body).not.toHaveProperty(key)
  })

  it('names the repetition penalty the way llama-server and LM Studio read it', () => {
    const lmstudio = { id: 'provider_lmstudio_default', type: 'generic', endpoint: 'http://x/v1' }

    for (const provider of [llamacpp, lmstudio]) {
      const { body } = buildCompletionBody({ ...base, provider, settings: tuned })
      expect(body.repeat_penalty).toBe(1.1)
      expect(body).not.toHaveProperty('repetition_penalty')
    }
    expect(buildCompletionBody({ ...base, settings: tuned }).body.repetition_penalty).toBe(1.1)
  })

  it('sends OpenAI no sampler it refuses', () => {
    // top-k and min-p are refused by every model there, a temperature by the
    // ones that always reason.
    const older = buildCompletionBody({
      ...base,
      provider: openai,
      model: 'gpt-4.1',
      settings: tuned,
    })
    const newer = buildCompletionBody({
      ...base,
      provider: openai,
      model: 'gpt-5.5',
      settings: tuned,
    })

    expect(older.body).toMatchObject({ temperature: 0.7, seed: 7 })
    expect(older.body).not.toHaveProperty('top_k')
    expect(newer.body).not.toHaveProperty('temperature')
    expect(newer.body.seed).toBe(7)
  })

  it('fits an OpenRouter request to what the list says of its model', () => {
    const { body } = buildCompletionBody({
      ...base,
      provider: openrouter,
      settings: resolveAISettings({ ...tuned, reasoningEffort: 'medium' }),
      traits: {
        samplers: ['temperature'],
        reasoning: { optional: true, levels: ['high', 'xhigh'], defaultLevel: 'high' },
      },
    })

    expect(body.temperature).toBe(0.7)
    expect(body).not.toHaveProperty('top_k')
    expect(body.reasoning).toEqual({ effort: 'high', exclude: false })
  })

  it('says nothing of reasoning to an OpenRouter model that does not reason', () => {
    const { body, askedForEffort } = buildCompletionBody({
      ...base,
      provider: openrouter,
      settings: resolveAISettings({ reasoningEffort: 'high' }),
      traits: { reasoning: null },
    })

    expect(body).not.toHaveProperty('reasoning')
    expect(askedForEffort).toBe(false)
  })

  it('says not to call the tools when asked, and keeps them declared', () => {
    const tools = [{ type: 'function', function: { name: 'roll_dice' } }]

    const { body } = buildCompletionBody({
      ...base,
      settings: AI_DEFAULTS,
      tools,
      toolChoice: 'none',
    })

    expect(body.tools).toEqual(tools)
    expect(body.tool_choice).toBe('none')
    // No tools, nothing to choose among.
    expect(
      buildCompletionBody({ ...base, settings: AI_DEFAULTS, toolChoice: 'none' }).body
    ).not.toHaveProperty('tool_choice')
  })

  it('caps an OpenAI reply under the name its reasoning models take', () => {
    const settings = resolveAISettings({ maxTokens: 100 })

    const { body } = buildCompletionBody({ ...base, provider: openai, settings })

    expect(body.max_completion_tokens).toBe(100)
    expect(body).not.toHaveProperty('max_tokens')
    expect(buildCompletionBody({ ...base, provider: gemini, settings }).body.max_tokens).toBe(100)
  })

  it('names no level to OpenAI, which refuses one on some models and beside tools on others', () => {
    const { body, askedForEffort } = buildCompletionBody({
      ...base,
      provider: openai,
      settings: resolveAISettings({ reasoningEffort: 'high' }),
      tools: [{ type: 'function', function: { name: 'roll_dice' } }],
    })

    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('reasoning')
    expect(askedForEffort).toBe(false)
  })

  it('names a level to Gemini as reasoning_effort, and only a level', () => {
    for (const provider of [gemini]) {
      const asked = buildCompletionBody({
        ...base,
        provider,
        settings: resolveAISettings({ reasoningEffort: 'low' }),
      })
      expect(asked.body.reasoning_effort).toBe('low')
      expect(asked.askedForEffort).toBe(true)
      expect(asked.body).not.toHaveProperty('reasoning')

      // Enabled leaves it to the model.
      const enabled = buildCompletionBody({
        ...base,
        provider,
        settings: resolveAISettings({ reasoningEffort: 'enabled' }),
      })
      expect(enabled.body).not.toHaveProperty('reasoning_effort')
      expect(enabled.askedForEffort).toBe(false)

      // Their word for off is refused by the models that always think, so
      // there is no Disabled, and one stored is as little as it can.
      const disabled = buildCompletionBody({
        ...base,
        provider,
        settings: resolveAISettings({ reasoningEffort: 'disabled' }),
      })
      expect(disabled.body.reasoning_effort).toBe('low')
    }
  })

  it('asks a generic provider for no reasoning level at all', () => {
    const { body, askedForEffort } = buildCompletionBody({
      ...base,
      settings: resolveAISettings({ reasoningEffort: 'high' }),
    })

    // `reasoning` is OpenRouter's; a local server answers a stray key with a 400.
    expect(body).not.toHaveProperty('reasoning')
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(askedForEffort).toBe(false)
  })

  it('asks OpenRouter to think without naming a level when the level is a switch', () => {
    const asked = buildCompletionBody({
      ...base,
      provider: openrouter,
      settings: resolveAISettings({ reasoningEffort: 'high' }),
    })
    const switched = buildCompletionBody({
      ...base,
      provider: openrouter,
      settings: resolveAISettings({ reasoningEffort: 'enabled' }),
    })

    expect(asked.body.reasoning).toEqual({ effort: 'high', exclude: false })
    expect(asked.askedForEffort).toBe(true)
    expect(switched.body.reasoning).toEqual({ enabled: true, exclude: false })
    expect(switched.askedForEffort).toBe(false)
  })

  it('turns llama.cpp thinking off through the chat template', () => {
    // `reasoning` is OpenRouter's word. llama-server hears the same intent as
    // an argument to the template it renders, which is where a Qwen3-shaped
    // model's thinking is actually switched.
    const { body } = buildCompletionBody({
      ...base,
      provider: llamacpp,
      settings: resolveAISettings({ reasoningEffort: 'disabled' }),
    })

    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
    expect(body).not.toHaveProperty('reasoning')
  })

  it('says nothing to llama.cpp when thinking is wanted', () => {
    // Thinking is what the template does already, and there is no level to
    // ask it for. Silence is the request.
    for (const reasoningEffort of ['enabled', 'high']) {
      const { body } = buildCompletionBody({
        ...base,
        provider: llamacpp,
        settings: resolveAISettings({ reasoningEffort }),
      })

      expect(body).not.toHaveProperty('chat_template_kwargs')
      expect(body).not.toHaveProperty('reasoning')
    }
  })

  it('never sends a generic server a key it might refuse', () => {
    // It could be anything. The subset everyone implements is all it gets.
    const { body } = buildCompletionBody({
      ...base,
      settings: resolveAISettings({ reasoningEffort: 'disabled' }),
    })

    expect(body).not.toHaveProperty('chat_template_kwargs')
    expect(body).not.toHaveProperty('reasoning')
  })

  it('tells OpenRouter to stop thinking rather than not mentioning it', () => {
    // Omitting the key leaves the model's own default in place, and for a
    // thinking model that default is to think — so a setting that reads as a
    // switch did nothing at all.
    const { body, askedForEffort } = buildCompletionBody({
      ...base,
      provider: openrouter,
      settings: resolveAISettings({ reasoningEffort: 'disabled' }),
    })

    expect(body.reasoning).toEqual({ enabled: false })
    expect(askedForEffort).toBe(false)
  })

  it('reports when the request carries reasoning a provider could refuse', () => {
    const { sentReasoning } = buildCompletionBody({
      ...base,
      provider: openrouter,
      messages: [
        { role: 'assistant', content: 'x', reasoning_details: [{ type: 'reasoning.text' }] },
      ],
      settings: AI_DEFAULTS,
    })

    expect(sentReasoning).toBe(true)
  })

  it('tells NanoGPT about reasoning as OpenRouter is told', () => {
    const levelled = buildCompletionBody({
      ...base,
      provider: nanogpt,
      settings: resolveAISettings({ reasoningEffort: 'high' }),
      traits: { reasoning: { optional: true, levels: ['low', 'high', 'max'] } },
    })
    expect(levelled.body.reasoning).toEqual({ effort: 'high', exclude: false })
    expect(levelled.askedForEffort).toBe(true)
    expect(levelled.body).not.toHaveProperty('reasoning_effort')

    // Some of its models think only when asked, so Enabled has to be said.
    const enabled = buildCompletionBody({
      ...base,
      provider: nanogpt,
      settings: resolveAISettings({ reasoningEffort: 'enabled', showModelReasoning: false }),
    })
    expect(enabled.body.reasoning).toEqual({ enabled: true, exclude: true })

    const off = buildCompletionBody({
      ...base,
      provider: nanogpt,
      settings: resolveAISettings({ reasoningEffort: 'disabled' }),
    })
    expect(off.body.reasoning).toEqual({ enabled: false })
  })

  it('asks a NanoGPT model that always thinks to think as little as it can, not to stop', () => {
    const { body } = buildCompletionBody({
      ...base,
      provider: nanogpt,
      settings: resolveAISettings({ reasoningEffort: 'disabled' }),
      traits: { reasoning: { optional: false, levels: ['low', 'high', 'max'] } },
    })

    expect(body.reasoning).toEqual({ effort: 'low', exclude: false })
  })

  it('asks NanoGPT to cache Claude’s prompt, and nobody else’s', () => {
    const claude = buildCompletionBody({
      ...base,
      provider: nanogpt,
      model: 'anthropic/claude-sonnet-latest',
      settings: AI_DEFAULTS,
    })
    expect(claude.body.prompt_caching).toEqual({ enabled: true })

    // Asking moves a request off a subscription, which covers this one.
    const glm = buildCompletionBody({
      ...base,
      provider: nanogpt,
      model: 'z-ai/glm-latest',
      settings: AI_DEFAULTS,
    })
    expect(glm.body).not.toHaveProperty('prompt_caching')

    const elsewhere = buildCompletionBody({
      ...base,
      provider: openrouter,
      model: 'anthropic/claude-sonnet-latest',
      settings: AI_DEFAULTS,
    })
    expect(elsewhere.body).not.toHaveProperty('prompt_caching')
  })

  it('sends NanoGPT the samplers, which it passes on, and its routing', () => {
    const { body } = buildCompletionBody({
      ...base,
      provider: nanogpt,
      settings: resolveAISettings({ parameters: { topK: 40, minP: 0.05 } }),
      traits: { reasoning: null },
      upstreams: { allowedProviders: ['novita'], ignoredProviders: ['uomi'] },
    })

    expect(body.top_k).toBe(40)
    expect(body.min_p).toBe(0.05)
    expect(body.provider).toEqual({ only: ['novita'], ignore: ['uomi'], zdr: true })
    expect(body).not.toHaveProperty('max_completion_tokens')
  })

  it('sends NanoGPT no routing once its zero data retention is off', () => {
    const { body } = buildCompletionBody({
      ...base,
      provider: { ...nanogpt, routing: { zdr: false } },
      settings: resolveAISettings(),
      traits: { reasoning: null },
    })

    expect(body).not.toHaveProperty('provider')
  })
})
