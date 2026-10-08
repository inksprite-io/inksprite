import { describe, it, expect } from 'vitest'
import { buildCompletionBody, toWireMessages, chatCompletionsUrl, modelsUrl } from '@/ai/wire.js'
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

describe('endpoint addressing', () => {
  it('joins a base URL whether or not it ends in a slash', () => {
    expect(chatCompletionsUrl(local)).toBe('http://localhost:1234/v1/chat/completions')
    expect(chatCompletionsUrl({ type: 'generic', endpoint: 'http://localhost:1234/v1/' })).toBe(
      'http://localhost:1234/v1/chat/completions'
    )
    expect(modelsUrl(local)).toBe('http://localhost:1234/v1/models')
  })

  it('knows where OpenRouter is without being told', () => {
    expect(chatCompletionsUrl(openrouter)).toBe('https://openrouter.ai/api/v1/chat/completions')
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

  it('asks a generic provider for no reasoning level at all', () => {
    const { body, askedForEffort } = buildCompletionBody({
      ...base,
      settings: resolveAISettings({ reasoningEffort: 'high' }),
    })

    // `reasoning` is OpenRouter's; a local server answers a stray key with a 400.
    expect(body).not.toHaveProperty('reasoning')
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
})
