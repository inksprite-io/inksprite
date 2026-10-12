import { describe, it, expect, vi } from 'vitest'
import {
  THINKING_FORMAT,
  RefusalError,
  claudeTraits,
  createStreamReader,
  modelInfo,
  reasoningFor,
  toAnthropicMessages,
  toAnthropicRequest,
} from '@/ai/anthropic.js'
import { resolveAISettings } from '@/ai/defaults.js'

/** A model that thinks how much it likes and can stop, as the Models API lists the current ones. */
const ADAPTIVE = {
  maxTokens: 128000,
  thinking: { adaptive: true, enabled: false, disabled: true },
  effort: ['low', 'medium', 'high', 'xhigh', 'max'],
  samplers: false,
  fallbacks: false,
}
/** One that always thinks, and has a model to fall back on. */
const ALWAYS = {
  ...ADAPTIVE,
  thinking: { adaptive: true, enabled: false, disabled: false },
  fallbacks: true,
}
/** An older one that takes a thinking budget. */
const BUDGET = {
  maxTokens: 64000,
  thinking: { adaptive: false, enabled: true, disabled: true },
  effort: [],
  samplers: true,
  fallbacks: false,
}

const thought = (index, text = 'mm', signature = 'sig') => ({
  type: 'reasoning.text',
  text,
  signature,
  format: THINKING_FORMAT,
  index,
})

const call = (id, name, args = '{}') => ({
  id,
  type: 'function',
  function: { name, arguments: args },
})

describe('modelInfo', () => {
  it('reads what a model can do from the Models API', () => {
    const info = modelInfo({
      id: 'claude-sonnet-5-5',
      display_name: 'Claude Sonnet 5.5',
      max_tokens: 128000,
      allowed_fallback_models: ['claude-sonnet-5'],
      capabilities: {
        thinking: {
          supported: true,
          types: {
            enabled: { supported: false },
            adaptive: { supported: true },
            disabled: { supported: false },
          },
        },
        effort: {
          supported: true,
          low: { supported: true },
          medium: { supported: true },
          high: { supported: true },
          xhigh: { supported: false },
          max: { supported: true },
        },
      },
    })

    expect(info).toEqual({
      id: 'claude-sonnet-5-5',
      name: 'Claude Sonnet 5.5',
      maxTokens: 128000,
      thinking: { adaptive: true, enabled: false, disabled: false },
      effort: ['low', 'medium', 'high', 'max'],
      samplers: false,
      fallbacks: true,
    })
  })

  it('takes the samplers to be on the models that take a thinking budget', () => {
    // The Models API doesn't say; the newest models refuse every sampler, and
    // the ones before them take one while they aren't thinking.
    const budget = modelInfo({
      id: 'm',
      capabilities: { thinking: { supported: true, types: { enabled: { supported: true } } } },
    })
    const plain = modelInfo({ id: 'm', capabilities: { thinking: { supported: false } } })

    expect(budget.samplers).toBe(true)
    expect(plain.samplers).toBe(true)
  })

  it('says a model that does not think does not', () => {
    const info = modelInfo({ id: 'm', capabilities: { thinking: { supported: false } } })

    expect(info.thinking).toBeNull()
    expect(info.effort).toEqual([])
    expect(info.fallbacks).toBe(false)
  })
})

describe('toAnthropicMessages', () => {
  it('lifts the system prompt out, marked for the cache', () => {
    const { system, messages } = toAnthropicMessages([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Hi' },
    ])

    expect(system).toEqual([
      { type: 'text', text: 'Be brief.', cache_control: { type: 'ephemeral' } },
    ])
    expect(messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }])
  })

  it('starts on the assistant when the conversation does, as a card greeting does', () => {
    const { messages } = toAnthropicMessages([
      { role: 'system', content: 'Play the innkeeper.' },
      { role: 'assistant', content: 'Welcome, traveller.' },
      { role: 'user', content: 'A room, please.' },
    ])

    expect(messages.map(m => m.role)).toEqual(['assistant', 'user'])
  })

  it('puts a turn’s thinking back where it sat, among its words and calls', () => {
    const { messages } = toAnthropicMessages([
      { role: 'user', content: 'Go' },
      {
        role: 'assistant',
        content: 'Checking.',
        tool_calls: [call('toolu_1', 'read_document', '{"path":"A"}')],
        reasoning_details: [thought(0, 'first')],
      },
    ])

    expect(messages[1].content).toEqual([
      { type: 'thinking', thinking: 'first', signature: 'sig' },
      { type: 'text', text: 'Checking.' },
      { type: 'tool_use', id: 'toolu_1', name: 'read_document', input: { path: 'A' } },
    ])
  })

  it('keeps thinking that came between calls between them', () => {
    const { messages } = toAnthropicMessages([
      { role: 'user', content: 'Go' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [call('a', 'one'), call('b', 'two')],
        reasoning_details: [thought(0, 'before'), thought(2, 'between', 'sig2')],
      },
    ])

    expect(messages[1].content.map(block => block.thinking ?? block.id)).toEqual([
      'before',
      'a',
      'between',
      'b',
    ])
  })

  it('puts thinking with no place of its own first, as OpenRouter numbers it', () => {
    const { messages } = toAnthropicMessages([
      { role: 'user', content: 'Go' },
      {
        role: 'assistant',
        content: 'Done.',
        reasoning_details: [{ ...thought(undefined, 'unplaced') }],
      },
    ])

    expect(messages[1].content.map(block => block.type)).toEqual(['thinking', 'text'])
  })

  it('hands back only Claude’s own signed thinking, encrypted or not', () => {
    const { messages } = toAnthropicMessages([
      { role: 'user', content: 'Go' },
      {
        role: 'assistant',
        content: 'Done.',
        reasoning_details: [
          { type: 'reasoning.text', text: 'no signature', format: THINKING_FORMAT, index: 0 },
          { type: 'reasoning.text', text: 'other model', signature: 's', format: 'openai-v1' },
          { type: 'reasoning.encrypted', data: 'opaque', format: THINKING_FORMAT, index: 0 },
        ],
      },
    ])

    expect(messages[1].content).toEqual([
      { type: 'redacted_thinking', data: 'opaque' },
      { type: 'text', text: 'Done.' },
    ])
  })

  it('leaves the thinking out of a request that asks for none', () => {
    const { messages } = toAnthropicMessages(
      [
        { role: 'user', content: 'Go' },
        { role: 'assistant', content: 'Done.', reasoning_details: [thought(0)] },
      ],
      { thinking: false }
    )

    expect(messages[1].content).toEqual([{ type: 'text', text: 'Done.' }])
  })

  it('gives one round’s results back in one message, under ids Anthropic takes', () => {
    const { messages } = toAnthropicMessages([
      { role: 'user', content: 'Go' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [call('functions.read:0', 'read'), call('call_2', 'list')],
      },
      { role: 'tool', tool_call_id: 'functions.read:0', content: 'text' },
      { role: 'tool', tool_call_id: 'call_2', content: '' },
      { role: 'user', content: 'And?' },
    ])

    expect(messages[1].content.map(block => block.id)).toEqual(['functions_read_0', 'call_2'])
    expect(messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'functions_read_0', content: 'text' },
        // An empty result is sent with no content rather than an empty one.
        // The round is the turn before the latest message, so it is cached.
        { type: 'tool_result', tool_use_id: 'call_2', cache_control: { type: 'ephemeral' } },
      ],
    })
    expect(messages[3].content).toEqual([{ type: 'text', text: 'And?' }])
  })

  it('sends a call cut off mid-arguments as a call with none', () => {
    const { messages } = toAnthropicMessages([
      { role: 'user', content: 'Go' },
      { role: 'assistant', content: null, tool_calls: [call('a', 'write', '{"text": "half')] },
    ])

    expect(messages[1].content[0].input).toEqual({})
  })

  it('leaves out messages with nothing in them, since an empty block is refused', () => {
    const { messages } = toAnthropicMessages([
      { role: 'user', content: 'Go' },
      { role: 'assistant', content: '   ' },
      { role: 'user', content: '' },
      { role: 'user', content: 'Again' },
    ])

    expect(messages.map(m => m.content[0].text)).toEqual(['Go', 'Again'])
  })

  it('caches up to the turn before the latest message, and to the last result mid-turn', () => {
    const { messages } = toAnthropicMessages([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'Earlier' },
      { role: 'assistant', content: 'Reply', reasoning_details: [thought(1)] },
      { role: 'user', content: 'Latest, with the volatile project block' },
      { role: 'assistant', content: null, tool_calls: [call('a', 'read')] },
      { role: 'tool', tool_call_id: 'a', content: 'result' },
    ])

    const marked = messages.flatMap((m, i) =>
      m.content.filter(block => block.cache_control).map(block => [i, block.type])
    )
    // Not on the thinking, which can't carry the mark, and not on the latest
    // message, which changes by the next turn.
    expect(marked).toEqual([
      [1, 'text'],
      [4, 'tool_result'],
    ])
  })
})

describe('claudeTraits', () => {
  it('offers the efforts a model lists, and Disabled where it can stop', () => {
    expect(claudeTraits(ADAPTIVE)).toEqual({
      samplers: [],
      reasoning: {
        optional: true,
        levels: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultLevel: 'high',
      },
    })
    expect(claudeTraits(ALWAYS).reasoning.optional).toBe(false)
  })

  it('offers a model on a budget the three levels a budget is set from', () => {
    expect(claudeTraits(BUDGET)).toEqual({
      samplers: ['temperature', 'topP', 'topK'],
      reasoning: { optional: true, levels: ['low', 'medium', 'high'], defaultLevel: 'medium' },
    })
  })

  it('says a model that does not think does not', () => {
    expect(claudeTraits({ ...BUDGET, thinking: null }).reasoning).toBeNull()
  })
})

describe('reasoningFor', () => {
  const settings = overrides => resolveAISettings(overrides)

  it('stops a model that can stop', () => {
    expect(reasoningFor(settings({ reasoningEffort: 'disabled' }), ADAPTIVE, 1000)).toEqual({
      thinking: { type: 'disabled' },
    })
  })

  it('asks nothing of a model that can never stop, which is never sent Disabled', () => {
    // Fitting has made it the lowest effort by now; see toAnthropicRequest.
    expect(reasoningFor(settings({ reasoningEffort: 'disabled' }), ALWAYS, 1000)).toEqual({})
  })

  it('leaves the amount to the model when thinking is only Enabled', () => {
    expect(reasoningFor(settings({ reasoningEffort: 'enabled' }), ADAPTIVE, 1000)).toEqual({
      thinking: { type: 'adaptive', display: 'summarized' },
      effort: undefined,
    })
  })

  it('names a level as an effort, if the model takes that one', () => {
    expect(reasoningFor(settings({ reasoningEffort: 'high' }), ADAPTIVE, 1000).effort).toBe('high')
    expect(
      reasoningFor(settings({ reasoningEffort: 'high' }), { ...ADAPTIVE, effort: ['low'] }, 1000)
        .effort
    ).toBeUndefined()
  })

  it('asks for the thinking to be left out of the answer when it is not shown', () => {
    const { thinking } = reasoningFor(
      settings({ reasoningEffort: 'medium', showModelReasoning: false }),
      ADAPTIVE,
      1000
    )

    expect(thinking.display).toBe('omitted')
  })

  it('gives an older model a budget for its level, under the answer’s cap', () => {
    expect(reasoningFor(settings({ reasoningEffort: 'high' }), BUDGET, 64000)).toEqual({
      thinking: { type: 'enabled', budget_tokens: 24576 },
      effort: undefined,
    })
    expect(
      reasoningFor(settings({ reasoningEffort: 'high' }), BUDGET, 5000).thinking.budget_tokens
    ).toBe(4999)
    // No room to think in at all.
    expect(reasoningFor(settings({ reasoningEffort: 'high' }), BUDGET, 1000)).toEqual({})
  })

  it('asks nothing of a model that does not think', () => {
    expect(
      reasoningFor(settings({ reasoningEffort: 'high' }), { ...ADAPTIVE, thinking: null }, 1000)
    ).toEqual({})
  })
})

describe('toAnthropicRequest', () => {
  const base = { messages: [{ role: 'user', content: 'Hi' }], model: 'claude-x' }

  it('caps an Unlimited answer at the model’s own longest', () => {
    const settings = resolveAISettings({ maxTokens: 0 })

    expect(toAnthropicRequest({ ...base, info: ADAPTIVE, settings }).params.max_tokens).toBe(128000)
    expect(
      toAnthropicRequest({ ...base, info: { ...ADAPTIVE, maxTokens: undefined }, settings }).params
        .max_tokens
    ).toBe(32000)
    expect(
      toAnthropicRequest({
        ...base,
        info: ADAPTIVE,
        settings: resolveAISettings({ maxTokens: 500 }),
      }).params.max_tokens
    ).toBe(500)
  })

  it('drops thinking that no longer fits its conversation rather than refusing the turn', () => {
    const { params, betas } = toAnthropicRequest({
      ...base,
      info: ADAPTIVE,
      settings: resolveAISettings({ reasoningEffort: 'medium' }),
    })

    expect(params.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
      block_binding: { prefix_mismatch_behavior: 'drop_block' },
    })
    expect(params.output_config).toEqual({ effort: 'medium' })
    expect(betas).toContain('thinking-binding-controls-2026-08-01')
  })

  it('says nothing of thinking that is off, and sends none back', () => {
    const { params, betas } = toAnthropicRequest({
      messages: [
        { role: 'user', content: 'Go' },
        { role: 'assistant', content: 'Done.', reasoning_details: [thought(0)] },
        { role: 'user', content: 'Again' },
      ],
      model: 'claude-x',
      info: ADAPTIVE,
      settings: resolveAISettings({ reasoningEffort: 'disabled' }),
    })

    expect(params.thinking).toEqual({ type: 'disabled' })
    expect(betas).not.toContain('thinking-binding-controls-2026-08-01')
    expect(params.messages[1].content.map(block => block.type)).toEqual(['text'])
  })

  it('has a model that always thinks think as little as it can when Disabled', () => {
    const { params } = toAnthropicRequest({
      ...base,
      info: ALWAYS,
      settings: resolveAISettings({ reasoningEffort: 'disabled' }),
    })

    expect(params.thinking).toMatchObject({ type: 'adaptive' })
    expect(params.output_config).toEqual({ effort: 'low' })
  })

  it('sends the nearest effort the model has to one it lacks', () => {
    const { params } = toAnthropicRequest({
      ...base,
      info: { ...ADAPTIVE, effort: ['high', 'max'] },
      settings: resolveAISettings({ reasoningEffort: 'low' }),
    })

    expect(params.output_config).toEqual({ effort: 'high' })
  })

  const tuned = resolveAISettings({
    reasoningEffort: 'disabled',
    seed: 3,
    parameters: { temperature: 0.4, topK: 40, minP: 0.1, presencePenalty: 0.5 },
  })

  it('sends only the samplers Claude has, and only off neutral', () => {
    const neutral = toAnthropicRequest({
      ...base,
      info: BUDGET,
      settings: resolveAISettings({ reasoningEffort: 'disabled' }),
    })
    for (const key of ['temperature', 'top_p', 'top_k', 'min_p', 'seed']) {
      expect(neutral.params).not.toHaveProperty(key)
    }

    const { params } = toAnthropicRequest({ ...base, info: BUDGET, settings: tuned })
    expect(params).toMatchObject({ temperature: 0.4, top_k: 40 })
    for (const key of ['min_p', 'presence_penalty', 'seed']) expect(params).not.toHaveProperty(key)
  })

  it('sends no samplers to the newest models, which refuse them', () => {
    const { params } = toAnthropicRequest({ ...base, info: ADAPTIVE, settings: tuned })

    for (const key of ['temperature', 'top_p', 'top_k']) expect(params).not.toHaveProperty(key)
  })

  it('sends an older model no samplers while it thinks', () => {
    const { params } = toAnthropicRequest({
      ...base,
      info: BUDGET,
      settings: { ...tuned, reasoningEffort: 'medium' },
    })

    expect(params.thinking).toMatchObject({ type: 'enabled' })
    for (const key of ['temperature', 'top_p', 'top_k']) expect(params).not.toHaveProperty(key)
  })

  it('sends a temperature rather than a top-p, which Claude takes only one of', () => {
    const { params } = toAnthropicRequest({
      ...base,
      info: BUDGET,
      settings: resolveAISettings({
        reasoningEffort: 'disabled',
        parameters: { temperature: 0.4, topP: 0.9 },
      }),
    })

    expect(params.temperature).toBe(0.4)
    expect(params).not.toHaveProperty('top_p')
  })

  it('declares the tools so their arguments stream as they are written', () => {
    const { params } = toAnthropicRequest({
      ...base,
      info: ADAPTIVE,
      settings: resolveAISettings(),
      tools: [
        {
          type: 'function',
          function: {
            name: 'read',
            description: 'Read one.',
            parameters: { type: 'object', properties: { path: { type: 'string' } } },
          },
        },
        { type: 'function', function: { name: 'list', description: 'List them.' } },
      ],
      toolChoice: 'none',
    })

    expect(params.tools).toEqual([
      {
        name: 'read',
        description: 'Read one.',
        input_schema: { type: 'object', properties: { path: { type: 'string' } } },
        eager_input_streaming: true,
      },
      {
        name: 'list',
        description: 'List them.',
        input_schema: { type: 'object', properties: {} },
        eager_input_streaming: true,
      },
    ])
    expect(params.tool_choice).toEqual({ type: 'none' })
  })

  it('lets another model answer when this one declines, if it has one to fall back on', () => {
    const settings = resolveAISettings()

    const asked = toAnthropicRequest({ ...base, info: ALWAYS, settings })
    expect(asked.params.fallbacks).toBe('default')
    expect(asked.betas).toContain('server-side-fallback-2026-07-01')

    const alone = toAnthropicRequest({ ...base, info: ADAPTIVE, settings })
    expect(alone.params).not.toHaveProperty('fallbacks')
    expect(alone.betas).not.toContain('server-side-fallback-2026-07-01')
  })
})

describe('createStreamReader', () => {
  /** Run events through a reader; return what it said along the way and at the end. */
  function read(events, options) {
    const chunks = []
    const reader = createStreamReader(chunk => chunks.push(chunk), options)
    for (const event of events) reader.push(event)
    return { chunks, result: () => reader.finish() }
  }

  const start = (index, content_block) => ({ type: 'content_block_start', index, content_block })
  const delta = (index, d) => ({ type: 'content_block_delta', index, delta: d })
  const stop = (stop_reason, usage = { output_tokens: 9 }, stop_details) => ({
    type: 'message_delta',
    delta: { stop_reason, ...(stop_details !== undefined ? { stop_details } : {}) },
    usage,
  })
  const begin = usage => ({
    type: 'message_start',
    message: { model: 'claude-x', usage: { input_tokens: 5, output_tokens: 1, ...usage } },
  })

  it('streams the words and the thinking, and keeps the thinking signed for next time', () => {
    const { chunks, result } = read([
      begin({ cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }),
      start(0, { type: 'thinking', thinking: '', signature: '' }),
      delta(0, { type: 'thinking_delta', thinking: 'Hm.' }),
      delta(0, { type: 'signature_delta', signature: 'abc' }),
      start(1, { type: 'text', text: '' }),
      delta(1, { type: 'text_delta', text: 'Hello' }),
      stop('end_turn'),
    ])

    expect(chunks).toEqual([
      { content: '', reasoning: 'Hm.' },
      { content: 'Hello', reasoning: null },
    ])
    expect(result()).toEqual({
      usage: { prompt_tokens: 125, completion_tokens: 9, total_tokens: 134 },
      toolCalls: undefined,
      reasoningDetails: [
        {
          type: 'reasoning.text',
          text: 'Hm.',
          signature: 'abc',
          format: THINKING_FORMAT,
          index: 0,
        },
      ],
      finishReason: 'stop',
      servedBy: 'claude-x',
    })
  })

  it('keeps the thinking out of the chunks when it is not to be shown', () => {
    const { chunks } = read(
      [
        start(0, { type: 'thinking', thinking: '', signature: '' }),
        delta(0, { type: 'thinking_delta', thinking: 'Hm.' }),
      ],
      { showReasoning: false }
    )

    expect(chunks).toEqual([])
  })

  it('shows a call as its arguments arrive, and ends with them as JSON text', () => {
    const { chunks, result } = read([
      begin(),
      start(0, { type: 'tool_use', id: 'toolu_1', name: 'write', input: {} }),
      delta(0, { type: 'input_json_delta', partial_json: '{"text":' }),
      delta(0, { type: 'input_json_delta', partial_json: '"rain"}' }),
      stop('tool_use'),
    ])

    expect(chunks.at(-1).toolCalls).toEqual([
      { id: 'toolu_1', name: 'write', arguments: '{"text":"rain"}' },
    ])
    expect(result().toolCalls).toEqual([
      {
        id: 'toolu_1',
        type: 'function',
        function: { name: 'write', arguments: '{"text":"rain"}' },
      },
    ])
    expect(result().finishReason).toBe('tool_calls')
  })

  it('numbers the thinking where it sat, the way the next request puts it back', () => {
    const { result } = read([
      start(0, { type: 'thinking', thinking: '', signature: 's1' }),
      start(1, { type: 'tool_use', id: 'a', name: 'one' }),
      start(2, { type: 'redacted_thinking', data: 'opaque' }),
      start(3, { type: 'tool_use', id: 'b', name: 'two' }),
      stop('tool_use'),
    ])

    expect(result().reasoningDetails.map(d => [d.type, d.index])).toEqual([
      ['reasoning.text', 0],
      ['reasoning.encrypted', 2],
    ])
    // And back, in the same order.
    const { messages } = toAnthropicMessages([
      { role: 'user', content: 'Go' },
      {
        role: 'assistant',
        content: null,
        tool_calls: result().toolCalls,
        reasoning_details: result().reasoningDetails,
      },
    ])
    expect(messages[1].content.map(block => block.type)).toEqual([
      'thinking',
      'tool_use',
      'redacted_thinking',
      'tool_use',
    ])
  })

  it('lets go of a call cut off by the answer’s length', () => {
    const { result } = read([
      start(0, { type: 'tool_use', id: 'a', name: 'read' }),
      delta(0, { type: 'input_json_delta', partial_json: '{"path":"A"}' }),
      start(1, { type: 'tool_use', id: 'b', name: 'write' }),
      delta(1, { type: 'input_json_delta', partial_json: '{"text":"half' }),
      stop('max_tokens'),
    ])

    expect(result().toolCalls.map(c => c.id)).toEqual(['a'])
    expect(result().finishReason).toBe('length')
  })

  it('says what the model declined over when nothing answered instead', () => {
    const { result } = read([begin(), stop('refusal', {}, { category: 'general_harms' })])

    expect(() => result()).toThrow(RefusalError)
    expect(() => result()).toThrow('Claude declined to answer this (general harms).')
  })

  it('keeps what was said before another model took over, and lets the rest go', () => {
    const { chunks, result } = read([
      start(0, { type: 'thinking', thinking: 'first model', signature: 's' }),
      start(1, { type: 'text', text: '' }),
      delta(1, { type: 'text_delta', text: 'Part one. ' }),
      start(2, { type: 'tool_use', id: 'a', name: 'read' }),
      start(3, { type: 'fallback', from: { model: 'claude-x' }, to: { model: 'claude-y' } }),
      start(4, { type: 'text', text: '' }),
      delta(4, { type: 'text_delta', text: 'Part two.' }),
      stop('end_turn'),
    ])

    // The call the first model was making is no longer coming.
    expect(chunks.find(chunk => chunk.toolCalls?.length === 0)).toBeTruthy()
    const { toolCalls, reasoningDetails } = result()
    expect(toolCalls).toBeUndefined()
    expect(reasoningDetails).toBeUndefined()
    expect(chunks.map(chunk => chunk.content).join('')).toBe('Part one. Part two.')
  })
})

describe('streamAnthropic', () => {
  it('turns the SDK’s error back into what the API said', async () => {
    vi.resetModules()
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        beta = {
          models: { retrieve: async () => ({ id: 'claude-x', capabilities: {} }) },
          messages: {
            // A stream that fails as it opens, the way the SDK reports a 400.
            stream: () => ({
              [Symbol.asyncIterator]: () => ({
                next: async () => {
                  const error = new Error('400 {"type":"error"}')
                  error.status = 400
                  error.error = { error: { message: 'max_tokens: too large' } }
                  throw error
                },
              }),
            }),
          },
        }
      },
    }))
    const { streamAnthropic } = await import('@/ai/anthropic.js')

    await expect(
      streamAnthropic({
        provider: { id: 'p', type: 'anthropic', apiKey: 'k' },
        model: 'claude-x',
        messages: [{ role: 'user', content: 'Hi' }],
        settings: resolveAISettings(),
        onChunk: () => {},
      })
    ).rejects.toThrow(/^max_tokens: too large$/)
    vi.doUnmock('@anthropic-ai/sdk')
  })
})
