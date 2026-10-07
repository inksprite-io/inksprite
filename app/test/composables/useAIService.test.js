/* global TextEncoder */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAIService } from '@/composables/useAIService'

const provider = {
  id: 'provider_1',
  name: 'Local',
  type: 'generic',
  endpoint: 'http://localhost:1234/v1/',
  apiKey: null,
}

vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ getProvider: () => provider }),
}))

/**
 * Serve `deltas` as a single SSE body from a stubbed fetch, mirroring what a
 * provider streams back.
 * @param {Array<Object>} deltas - `choices[0].delta` payloads
 */
function streamDeltas(deltas) {
  streamEvents(deltas.map(delta => ({ choices: [{ delta }] })))
}

/**
 * Serve `events` as a single SSE body from a stubbed fetch, for the payloads
 * that are not completion deltas.
 * @param {Array<Object>} events - Whole SSE payloads
 */
function streamEvents(events) {
  const body = events.map(event => `data: ${JSON.stringify(event)}\n`).join('') + 'data: [DONE]\n'

  let sent = false
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (sent) return { done: true, value: undefined }
            sent = true
            return { done: false, value: new TextEncoder().encode(body) }
          },
          cancel: async () => {},
        }),
      },
    })
  )
}

/** Run a completion over `deltas` and return the chunks the callback saw. */
async function chunksFrom(deltas) {
  streamDeltas(deltas)
  const seen = []
  await useAIService().generateChatCompletion(
    [{ role: 'user', content: 'hi' }],
    { providerId: provider.id, model: 'local-model' },
    chunk => seen.push(chunk)
  )
  return seen
}

describe('tool call progress', () => {
  it('hands the callback every call so far, each time one grows', async () => {
    const chunks = await chunksFrom([
      {
        tool_calls: [
          { index: 0, id: 'call_1', function: { name: 'edit_document', arguments: '{"path":"a"' } },
        ],
      },
      { tool_calls: [{ index: 0, function: { arguments: ',"new":"Snow' } }] },
      { content: 'Done.' },
    ])

    const progress = chunks.filter(chunk => chunk.toolCalls)
    expect(progress.map(chunk => chunk.toolCalls)).toEqual([
      [{ id: 'call_1', name: 'edit_document', arguments: '{"path":"a"' }],
      [{ id: 'call_1', name: 'edit_document', arguments: '{"path":"a","new":"Snow' }],
    ])
    // Progress carries no words of its own.
    expect(progress.every(chunk => chunk.content === '' && chunk.reasoning === null)).toBe(true)
    expect(chunks.at(-1)).toEqual({ content: 'Done.', reasoning: null })
  })
})

/** Run a completion over `deltas` and return the reasoning it assembled. */
async function detailsFrom(deltas) {
  streamDeltas(deltas)
  const result = await useAIService().generateChatCompletion(
    [{ role: 'user', content: 'hi' }],
    { providerId: provider.id, model: 'local-model' },
    () => {}
  )
  return result.reasoningDetails
}

describe('useAIService streaming', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('accumulates content deltas', async () => {
    const chunks = await chunksFrom([{ content: 'Hello ' }, { content: 'world' }])

    expect(chunks.map(c => c.content).join('')).toBe('Hello world')
  })

  it('reads reasoning from the `reasoning` field', async () => {
    // OpenRouter and current vLLM.
    const chunks = await chunksFrom([{ reasoning: 'Thinking...' }, { content: 'Answer' }])

    expect(chunks[0].reasoning).toBe('Thinking...')
    expect(chunks[1].content).toBe('Answer')
  })

  it('reads reasoning from the `reasoning_content` field', async () => {
    // DeepSeek's shape, which LM Studio and lmdeploy follow. Without this the
    // thinking is dropped and the reply looks like it arrived out of nowhere.
    const chunks = await chunksFrom([{ reasoning_content: 'Thinking...' }, { content: 'Answer' }])

    expect(chunks[0].reasoning).toBe('Thinking...')
    expect(chunks[1].content).toBe('Answer')
  })

  it('prefers `reasoning` when a provider sends both', async () => {
    const chunks = await chunksFrom([{ reasoning: 'primary', reasoning_content: 'secondary' }])

    expect(chunks[0].reasoning).toBe('primary')
  })

  it('emits nothing for deltas carrying neither', async () => {
    const chunks = await chunksFrom([{ role: 'assistant' }, { content: 'Answer' }])

    expect(chunks).toHaveLength(1)
  })
})

describe('useAIService provider routing', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    provider.type = 'openrouter'
  })

  afterEach(() => {
    provider.type = 'generic'
    delete provider.routing
  })

  /** Run a completion and return the request body the service sent. */
  async function sentBody() {
    streamDeltas([{ content: 'ok' }])
    await useAIService().generateChatCompletion(
      [{ role: 'user', content: 'hi' }],
      { providerId: provider.id, model: 'some-model' },
      () => {}
    )
    return JSON.parse(fetch.mock.calls[0][1].body)
  }

  it('sends the configured routing policy', async () => {
    provider.routing = { zdr: true, quantizations: ['fp8'] }

    expect(await sentBody()).toMatchObject({ provider: { zdr: true, quantizations: ['fp8'] } })
  })

  it('sends the privacy floor when routing is unconfigured', async () => {
    // A connection nobody has configured still denies data collection and
    // routes only to zero-data-retention endpoints; that is the default, not
    // something the panel adds.
    expect(await sentBody()).toMatchObject({ provider: { data_collection: 'deny', zdr: true } })
  })

  it('omits the field for a non-OpenRouter provider', async () => {
    provider.type = 'generic'
    provider.routing = { zdr: true }

    expect(await sentBody()).not.toHaveProperty('provider')
  })

  it('routes only to the providers the preset allows for its model', async () => {
    streamDeltas([{ content: 'ok' }])
    await useAIService().generateChatCompletion(
      [{ role: 'user', content: 'hi' }],
      { providerId: provider.id, model: 'some-model', allowedProviders: ['deepinfra'] },
      () => {}
    )

    expect(JSON.parse(fetch.mock.calls[0][1].body).provider.only).toEqual(['deepinfra'])
  })
})

describe('useAIService reasoning request', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    provider.type = 'openrouter'
  })

  afterEach(() => {
    provider.type = 'generic'
  })

  /** Run a completion under `overrides` and return the request body sent. */
  async function reasoningFor(overrides) {
    streamDeltas([{ content: 'ok' }])
    await useAIService().generateChatCompletion(
      [{ role: 'user', content: 'hi' }],
      { providerId: provider.id, model: 'some-model' },
      () => {},
      { overrides }
    )
    return JSON.parse(fetch.mock.calls[0][1].body).reasoning
  }

  it('asks for the effort level it was given', async () => {
    expect(await reasoningFor({ reasoningEffort: 'high' })).toEqual({
      effort: 'high',
      exclude: false,
    })
  })

  it('asks for thinking without a level when the level is Enabled', async () => {
    // A model whose thinking is a switch refuses an effort outright — DeepSeek
    // answers "thinking mode openai_effort is not supported".
    expect(await reasoningFor({ reasoningEffort: 'enabled' })).toEqual({
      enabled: true,
      exclude: false,
    })
  })

  it('says so when reasoning is disabled, rather than saying nothing', async () => {
    // Omitting the key leaves the model's own default in place, and a model
    // that thinks by default goes on thinking.
    expect(await reasoningFor({ reasoningEffort: 'disabled' })).toEqual({ enabled: false })
  })

  it('honours Show Reasoning either way', async () => {
    expect(await reasoningFor({ reasoningEffort: 'enabled', showModelReasoning: false })).toEqual({
      enabled: true,
      exclude: true,
    })
  })
})

describe('useAIService reasoning details', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('joins the pieces of one block', async () => {
    const details = await detailsFrom([
      { reasoning_details: [{ type: 'reasoning.text', text: 'Let me ', index: 0 }] },
      { reasoning_details: [{ text: 'think.', index: 0 }] },
    ])

    expect(details).toEqual([{ type: 'reasoning.text', text: 'Let me think.', index: 0 }])
  })

  it('keeps fields it does not recognise', async () => {
    // Summarized and encrypted blocks carry their payload under names we have
    // no list of. Keeping only the fields we know gutted the block, and the
    // provider rejected the continuation several tool calls later.
    const details = await detailsFrom([
      {
        reasoning_details: [
          { type: 'reasoning.encrypted', data: 'opaque-blob', id: 'rs_1', index: 0 },
        ],
      },
    ])

    expect(details).toEqual([
      { type: 'reasoning.encrypted', data: 'opaque-blob', id: 'rs_1', index: 0 },
    ])
  })

  it('takes the later value for everything but the text', async () => {
    const details = await detailsFrom([
      { reasoning_details: [{ type: 'reasoning.text', text: 'Half', index: 0 }] },
      { reasoning_details: [{ signature: 'sig-abc', format: 'anthropic-claude-v1', index: 0 }] },
    ])

    expect(details).toEqual([
      {
        type: 'reasoning.text',
        text: 'Half',
        signature: 'sig-abc',
        format: 'anthropic-claude-v1',
        index: 0,
      },
    ])
  })

  it('leaves no holes when a provider numbers from one', async () => {
    // The array is written by index, and a hole becomes a null the next
    // request would have to carry back.
    const details = await detailsFrom([
      { reasoning_details: [{ type: 'reasoning.text', text: 'Only block', index: 1 }] },
    ])

    expect(details).toEqual([{ type: 'reasoning.text', text: 'Only block', index: 1 }])
  })
})

describe('useAIService reasoning compatibility', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    provider.type = 'generic'
  })

  /** Run a completion carrying reasoning and return the messages it sent. */
  async function sentMessages() {
    streamDeltas([{ content: 'ok' }])
    await useAIService().generateChatCompletion(
      [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1' }],
          reasoning_details: [{ type: 'reasoning.text', text: 'hm', index: 0 }],
        },
      ],
      { providerId: provider.id, model: 'some-model' },
      () => {}
    )
    return JSON.parse(fetch.mock.calls[0][1].body).messages
  }

  it('sends reasoning back to OpenRouter, which knows what to do with it', async () => {
    provider.type = 'openrouter'

    expect((await sentMessages())[1]).toHaveProperty('reasoning_details')
  })

  /** Run a completion carrying `_reasoning` and return the messages it sent. */
  async function sentThinking() {
    streamDeltas([{ content: 'ok' }])
    await useAIService().generateChatCompletion(
      [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1' }],
          _reasoning: 'the door is probably locked',
        },
      ],
      { providerId: provider.id, model: 'some-model' },
      () => {}
    )
    return JSON.parse(fetch.mock.calls[0][1].body).messages
  }

  it('says a turn its own thinking back in the field its backend uses', async () => {
    // Without this the continuation shows a model that reached for a tool and
    // never had a thought, and it carries on in kind.
    const messages = await sentThinking()

    expect(messages[1].reasoning_content).toBe('the door is probably locked')
    expect(messages[1]).not.toHaveProperty('_reasoning')
  })

  it('leaves OpenRouter its own structured form instead', async () => {
    provider.type = 'openrouter'

    const messages = await sentThinking()

    // reasoning_details is the richer shape and the only one carrying
    // Anthropic's signatures; two representations of the same thinking would
    // be one more than OpenRouter asked for.
    expect(messages[1]).not.toHaveProperty('reasoning_content')
    expect(messages[1]).not.toHaveProperty('_reasoning')
  })

  it('never sends the private name', async () => {
    expect(JSON.stringify(await sentThinking())).not.toContain('_reasoning')
  })

  it('keeps our own notes off the wire', async () => {
    // `_document` says which document a result put in front of the model, for
    // the context builder to keep current. It rides the same object the API is
    // handed, and a strict server answers an unknown field with a 400 — on
    // every tool-using turn, which is the only place it appears.
    streamDeltas([{ content: 'ok' }])
    await useAIService().generateChatCompletion(
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_1' }] },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: '{"title":"Orizon"}',
          _document: 'doc_orizon',
        },
      ],
      { providerId: provider.id, model: 'some-model' },
      () => {}
    )

    const sent = JSON.parse(fetch.mock.calls[0][1].body).messages
    expect(sent[2]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: '{"title":"Orizon"}',
    })
  })

  it('keeps reasoning away from a backend that never asked for it', async () => {
    // `reasoning_details` is OpenRouter's own shape. A strict OpenAI-compatible
    // server answers the unknown field with a 400, and it would do so on every
    // tool-using turn.
    const messages = await sentMessages()

    expect(messages[1]).not.toHaveProperty('reasoning_details')
    expect(messages[1].tool_calls).toEqual([{ id: 'call_1' }])
  })
})

describe('useAIService failure reporting', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    provider.type = 'openrouter'
  })

  afterEach(() => {
    provider.type = 'generic'
  })

  /** Fail the request outright, the way a provider rejects a bad body. */
  function failWith(status, payload) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status, json: async () => payload })
    )
  }

  const withReasoning = [
    { role: 'user', content: 'hi' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1' }],
      reasoning_details: [{ type: 'reasoning.text', text: 'hm', signature: 'sig', index: 0 }],
    },
  ]

  /** Run a completion and return the error it raised. */
  async function failureFrom(messages) {
    return useAIService()
      .generateChatCompletion(messages, { providerId: provider.id, model: 'some-model' }, () => {})
      .then(
        () => null,
        error => error
      )
  }

  it('names the reasoning when that is what was rejected', async () => {
    // Otherwise this reads as a turn that died halfway through, quoting a
    // field the writer has never heard of.
    failWith(400, { error: { message: 'Invalid signature for thinking block' } })

    const error = await failureFrom(withReasoning)

    expect(error.message).toContain('Invalid signature for thinking block')
    expect(error.message).toContain('Reasoning Effort')
  })

  it('says where the routing policy lives when it excluded every endpoint', async () => {
    // The floor is the default, so the writer never set the filter OpenRouter
    // is naming; the message has to say which panel to open.
    provider.type = 'openrouter'
    failWith(404, {
      error: { message: 'No endpoints found for the request with quantization: fp32.' },
    })

    const error = await failureFrom([{ role: 'user', content: 'hi' }])

    expect(error.message).toContain('No endpoints found')
    expect(error.message).toContain('Allowed Providers')
    expect(error.message).toContain('Provider Routing')
  })

  it('leaves a no-endpoints error alone when this request carried no routing', async () => {
    // A generic connection sends no provider field, so the filter is not ours.
    provider.type = 'generic'
    failWith(404, { error: { message: 'No endpoints found for the request.' } })

    const error = await failureFrom([{ role: 'user', content: 'hi' }])

    expect(error.message).toBe('No endpoints found for the request.')
  })

  it('names the effort level when that is what the model refused', async () => {
    // Fails on the first request of a turn, before any reasoning has been
    // echoed back, so the signature advice would be the wrong advice.
    failWith(400, { error: { message: 'thinking mode openai_effort is not supported' } })

    const error = await failureFrom([{ role: 'user', content: 'hi' }])

    expect(error.message).toContain('thinking mode openai_effort is not supported')
    expect(error.message).toContain('does not take one')
    expect(error.message).toContain('Enabled')
  })

  it('leaves an unrelated failure to speak for itself', async () => {
    failWith(400, { error: { message: 'max_tokens exceeds the context window' } })

    const error = await failureFrom(withReasoning)

    expect(error.message).toBe('max_tokens exceeds the context window')
  })

  it('does not blame reasoning a request never sent', async () => {
    failWith(400, { error: { message: 'Invalid signature' } })

    const error = await failureFrom([{ role: 'user', content: 'hi' }])

    expect(error.message).toBe('Invalid signature')
  })

  it('raises an error the provider sent part-way through the stream', async () => {
    // Reported as an event, after the headers said 200. Nothing read it, so
    // the turn ended with no content and nothing said about why.
    streamEvents([
      { choices: [{ delta: { content: 'Once upon' } }] },
      { error: { message: 'Invalid signature for thinking block' } },
    ])

    const error = await failureFrom(withReasoning)

    expect(error.message).toContain('Invalid signature for thinking block')
    expect(error.message).toContain('Reasoning Effort')
  })
})

describe('useAIService providers serving a model', () => {
  // The lookups are cached for the page, module-wide, so each test asks
  // about a model of its own.
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** @param {any} body @param {number} [status] */
  const answerWith = (body, status = 200) =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body })
    )

  it('names each provider once, by the slug routing takes', async () => {
    answerWith({
      data: {
        endpoints: [
          { tag: 'baseten/fp8', provider_name: 'BaseTen' },
          { tag: 'baseten/fast', provider_name: 'BaseTen' },
          { tag: 'together', provider_name: 'Together' },
          { tag: '', provider_name: 'Nameless' },
        ],
      },
    })

    const providers = await useAIService().listModelProviders('z-ai/one-model')

    expect(providers).toEqual([
      { slug: 'baseten', name: 'BaseTen' },
      { slug: 'together', name: 'Together' },
    ])
    expect(fetch.mock.calls[0][0]).toBe(
      'https://openrouter.ai/api/v1/models/z-ai/one-model/endpoints'
    )
  })

  it('keeps the slash in a model id and escapes the rest', async () => {
    answerWith({ data: { endpoints: [] } })

    await useAIService().listModelProviders('openai/two-model:free')

    expect(fetch.mock.calls[0][0]).toBe(
      'https://openrouter.ai/api/v1/models/openai/two-model%3Afree/endpoints'
    )
  })

  it('asks once per model, and again after a failure', async () => {
    answerWith({}, 404)
    await expect(useAIService().listModelProviders('z-ai/three-model')).rejects.toThrow('404')

    answerWith({ data: { endpoints: [{ tag: 'novita/fp8', provider_name: 'Novita' }] } })
    await useAIService().listModelProviders('z-ai/three-model')
    await useAIService().listModelProviders('z-ai/three-model')

    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
