/**
 * A stand-in for OpenRouter, Anthropic, LM Studio and Kokoro, so the guide's
 * screenshots never need an account, a key or a model, and come out the same
 * on every run.
 *
 * It answers on one local port: OpenRouter's API under `/openrouter/api/v1`,
 * Anthropic's under `/anthropic/v1`, LM Studio's under `/lmstudio/v1` and
 * Kokoro-FastAPI's under `/kokoro/v1`. The page never knows: `fetchShim`
 * rewrites the addresses the app asks for (`https://openrouter.ai/api/…`,
 * `https://api.anthropic.com/…`, `http://localhost:1234/…`,
 * `http://localhost:8880/…`) to this server's, so the app's settings show the
 * addresses a reader will type.
 *
 * Chat replies are scripted. `script({ match, steps, title })` says what the
 * model does when the writer's latest message contains `match`: each step is
 * one reply, a text, a tool call, or words and the calls they lead into, and
 * the step to give is how many replies the model has made since that
 * message. A script with `system` answers instead a request whose system
 * prompt contains it, as a skill's does, whatever the conversation says.
 * `title` is what it names the chat. Replies stream a few words at a time,
 * so a video shows them arriving.
 *
 * Speech is silence, as long as the words would take to say, so the player
 * shows a track of the right length.
 */

import http from 'node:http'

/** The models OpenRouter offers, as its list gives them (the app reads `id` and `name`). */
const OPENROUTER_MODELS = [
  { id: '~anthropic/claude-sonnet-latest', name: 'Anthropic: Claude Sonnet Latest' },
  { id: 'anthropic/claude-opus-5.5', name: 'Anthropic: Claude Opus 5.5' },
  { id: 'deepseek/deepseek-v4', name: 'DeepSeek: DeepSeek V4' },
  { id: 'google/gemini-3-pro', name: 'Google: Gemini 3 Pro' },
  { id: 'moonshotai/kimi-k3', name: 'MoonshotAI: Kimi K3' },
  { id: 'z-ai/glm-5.2', name: 'Z.ai: GLM 5.2' },
]

/**
 * The models Anthropic lists, as its Models API gives them, with what the app
 * reads of each: what it can think and how hard.
 */
const ANTHROPIC_MODELS = [
  ['claude-haiku-5-5', 'Claude Haiku 5.5'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
  ['claude-opus-5-5', 'Claude Opus 5.5'],
].map(([id, name]) => ({
  type: 'model',
  id,
  display_name: name,
  created_at: '2026-09-28T00:00:00Z',
  max_input_tokens: 1000000,
  max_tokens: 128000,
  capabilities: {
    effort: {
      supported: true,
      ...Object.fromEntries(
        ['low', 'medium', 'high', 'xhigh', 'max'].map(l => [l, { supported: true }])
      ),
    },
    thinking: {
      supported: true,
      types: {
        enabled: { supported: false },
        adaptive: { supported: true },
        disabled: { supported: false },
      },
    },
  },
}))

/** The models loaded in LM Studio. Its list carries ids only. */
const LMSTUDIO_MODELS = ['google/gemma-4-12b', 'qwen/qwen3-14b']

/**
 * The voices Kokoro-FastAPI has (v0.9.0), so a reader sees the count and the
 * names a real one gives. It lists each as `{ id, name }`.
 */
const KOKORO_VOICES = `
  af_alloy af_amelia_inno af_aoede af_bella af_goodall_inno af_heart af_jadzia af_jessica af_kore af_nicole af_nova af_river af_sarah af_sky af_v0 af_v0bella af_v0irulan af_v0nicole af_v0sarah af_v0sky
  am_adam am_echo am_eric am_fenrir am_liam am_michael am_onyx am_price_inno am_puck am_santa am_v0adam am_v0gurney am_v0michael
  bf_alice bf_emma bf_isabella bf_lily bf_v0emma bf_v0isabella
  bm_atten_inno bm_daniel bm_fable bm_george bm_lewis bm_v0george bm_v0lewis
  ef_dora
  em_alex em_santa
  ff_siwis
  hf_alpha hf_beta
  hm_omega hm_psi
  if_sara
  im_nicola
  jf_alpha jf_gongitsune jf_nezumi jf_tebukuro
  jm_kumo
  pf_dora
  pm_alex pm_santa
  zf_xiaobei zf_xiaoni zf_xiaoxiao zf_xiaoyi
  zm_yunjian zm_yunxi zm_yunxia zm_yunyang
`
  .trim()
  .split(/\s+/)

/**
 * How fast the stand-in's voices speak at speed 1, in characters a second:
 * about as fast as Kokoro, so a track runs as long as a real one would.
 */
const CHARACTERS_A_SECOND = 13.25

/** The key a made-up sign-in hands back. */
export const DEMO_KEY = 'sk-or-v1-made-up-for-the-guide'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

/** @param {number} ms */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * @typedef {{ tool: string, args: object }} Call
 * @typedef {{ input: number, output: number }} Usage
 * @typedef {({ text: string } | Call | { text?: string, calls: Call[] }) & { usage?: Usage }} Step
 * @typedef {{ match?: string, system?: string, steps: Step[], title?: string }} Script
 * @typedef {{ system: string, said: string, all: string, replies: number, tools: boolean }} Asked
 *   What a request asks, whatever API it came in: its system prompt, the
 *   writer's latest message, every message's words, how many replies the
 *   model has made since the writer's, and whether it offers tools
 */

/** What a reply says it cost, when its step does not say. */
const USAGE = { input: 8400, output: 120 }

/**
 * A step as the words it says and the calls it makes, either of which may be
 * missing.
 *
 * @param {Step} step
 * @returns {{ text: string, calls: Call[] }}
 */
function partsOf(step) {
  if ('calls' in step) return { text: step.text || '', calls: step.calls }
  if ('tool' in step) return { text: '', calls: [step] }
  return { text: step.text, calls: [] }
}

/**
 * Start the stand-in.
 *
 * @param {{ wordDelay?: number, speechDelay?: number, log?: (line: string) => void }} [options]
 *   `wordDelay` is the pause between streamed chunks, and `speechDelay` the
 *   time a speech request takes, in milliseconds.
 * @returns {Promise<{
 *   origin: string,
 *   script: (script: Script) => void,
 *   requests: Array<{ method: string, path: string, body?: any }>,
 *   close: () => Promise<void>,
 * }>}
 */
export async function startStandIn({ wordDelay = 35, speechDelay = 250, log = () => {} } = {}) {
  /** @type {Script[]} */
  const scripts = []
  /** @type {Array<{ method: string, path: string, body?: any }>} */
  const requests = []

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS).end()
      return
    }
    const body = req.method === 'POST' ? await readJson(req) : undefined
    const path = (req.url || '').split('?')[0]
    requests.push({ method: req.method || '', path, body })

    const json = (/** @type {any} */ data, status = 200) => {
      res.writeHead(status, { ...CORS, 'content-type': 'application/json' })
      res.end(JSON.stringify(data))
    }

    if (path === '/openrouter/api/v1/auth/keys') return json({ key: DEMO_KEY })
    if (path === '/openrouter/api/v1/auth/key') {
      return json({ data: { label: 'inksprite', usage: 0, limit: null, is_free_tier: false } })
    }
    if (path === '/openrouter/api/v1/models') return json({ data: OPENROUTER_MODELS })
    if (path === '/openrouter/api/v1/providers') return json({ data: [] })
    if (/^\/openrouter\/api\/v1\/models\/.+\/endpoints$/.test(path)) {
      return json({ data: { endpoints: [] } })
    }
    if (path === '/lmstudio/v1/models') {
      return json({ object: 'list', data: LMSTUDIO_MODELS.map(id => ({ id, object: 'model' })) })
    }
    if (path === '/kokoro/v1/models') {
      // One model, under its own name and the three OpenAI clients ask for.
      const ids = ['tts-1', 'tts-1-hd', 'kokoro', 'gpt-4o-mini-tts']
      return json({
        object: 'list',
        data: ids.map(id => ({ id, object: 'model', owned_by: 'kokoro' })),
      })
    }
    if (path === '/kokoro/v1/audio/voices') {
      return json({
        voices: KOKORO_VOICES.map(id => ({ id, name: id })),
        default_voice: 'af_heart',
      })
    }
    if (path === '/kokoro/v1/audio/speech') {
      await sleep(speechDelay)
      const seconds = String(body?.input || '').length / CHARACTERS_A_SECOND / (body?.speed || 1)
      res.writeHead(200, { ...CORS, 'content-type': 'audio/wav' })
      res.end(silence(seconds))
      return
    }
    if (
      path === '/openrouter/api/v1/chat/completions' ||
      path === '/lmstudio/v1/chat/completions'
    ) {
      return reply(res, body, scripts, wordDelay, log)
    }
    if (path === '/anthropic/v1/models') {
      const ids = ANTHROPIC_MODELS.map(model => model.id)
      return json({
        data: ANTHROPIC_MODELS,
        has_more: false,
        first_id: ids[0],
        last_id: ids.at(-1),
      })
    }
    if (path.startsWith('/anthropic/v1/models/')) {
      const model = ANTHROPIC_MODELS.find(one => path.endsWith(`/${one.id}`))
      if (model) return json(model)
    }
    if (path === '/anthropic/v1/messages') {
      return replyAnthropic(res, body, scripts, wordDelay, log)
    }

    log(`stand-in: nothing answers ${req.method} ${path}`)
    json({ error: { message: `The stand-in has no ${path}` } }, 404)
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)))
  const address = /** @type {import('node:net').AddressInfo} */ (server.address())

  return {
    origin: `http://127.0.0.1:${address.port}`,
    script: script => scripts.push(script),
    requests,
    close: () => new Promise(resolve => server.close(() => resolve(undefined))),
  }
}

/**
 * Answer a chat completion from the scripts, streamed when the app asks for
 * a stream (chat always does), whole when it does not.
 *
 * @param {http.ServerResponse} res
 * @param {any} body
 * @param {Script[]} scripts
 * @param {number} wordDelay
 * @param {(line: string) => void} log
 */
async function reply(res, body, scripts, wordDelay, log) {
  const step = pickStep(askedOpenAI(body), scripts, log)
  const { text, calls } = partsOf(step)
  const { input, output } = step.usage || USAGE
  const usage = { prompt_tokens: input, completion_tokens: output, total_tokens: input + output }
  const model = body?.model || 'stand-in'
  const ending = calls.length > 0 ? 'tool_calls' : 'stop'

  if (!body?.stream) {
    res.writeHead(200, { ...CORS, 'content-type': 'application/json' })
    const message = {
      role: 'assistant',
      content: text || null,
      ...(calls.length > 0 ? { tool_calls: calls.map(toolCall) } : {}),
    }
    res.end(
      JSON.stringify({
        id: 'stand-in',
        model,
        choices: [{ index: 0, message, finish_reason: ending }],
        usage,
      })
    )
    return
  }

  res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const send = (/** @type {object} */ delta, finish = null, usage = undefined) =>
    res.write(
      `data: ${JSON.stringify({
        id: 'stand-in',
        object: 'chat.completion.chunk',
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
        ...(usage ? { usage } : {}),
      })}\n\n`
    )

  await sleep(400) // the wait before the first token
  send({ role: 'assistant', content: '' })
  for (const piece of words(text, 3)) {
    await sleep(wordDelay)
    send({ content: piece })
  }
  for (const [index, step] of calls.entries()) {
    const call = toolCall(step, index)
    send({
      tool_calls: [{ index, ...call, function: { name: call.function.name, arguments: '' } }],
    })
    for (const piece of chunks(call.function.arguments, 40)) {
      await sleep(wordDelay)
      send({ tool_calls: [{ index, function: { arguments: piece } }] })
    }
  }
  send({}, ending, usage)
  res.end('data: [DONE]\n\n')
}

/**
 * Answer a Messages request from the scripts, as the events Anthropic streams
 * (the app always streams): a text block a few words at a time, then each
 * call as a tool_use block with its input in pieces.
 *
 * @param {http.ServerResponse} res
 * @param {any} body
 * @param {Script[]} scripts
 * @param {number} wordDelay
 * @param {(line: string) => void} log
 */
async function replyAnthropic(res, body, scripts, wordDelay, log) {
  const step = pickStep(askedAnthropic(body), scripts, log)
  const { text, calls } = partsOf(step)
  const { input, output } = step.usage || USAGE

  res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const send = (/** @type {string} */ type, /** @type {object} */ data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)

  await sleep(400) // the wait before the first token
  send('message_start', {
    message: {
      id: `msg_stand_in_${++made}`,
      type: 'message',
      role: 'assistant',
      model: body?.model || 'stand-in',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: input, output_tokens: 1 },
    },
  })
  let index = 0
  if (text) {
    send('content_block_start', { index, content_block: { type: 'text', text: '' } })
    for (const piece of words(text, 3)) {
      await sleep(wordDelay)
      send('content_block_delta', { index, delta: { type: 'text_delta', text: piece } })
    }
    send('content_block_stop', { index })
    index++
  }
  for (const [at, step] of calls.entries()) {
    const call = toolCall(step, at)
    send('content_block_start', {
      index,
      content_block: { type: 'tool_use', id: call.id, name: call.function.name, input: {} },
    })
    for (const piece of chunks(call.function.arguments, 40)) {
      await sleep(wordDelay)
      send('content_block_delta', {
        index,
        delta: { type: 'input_json_delta', partial_json: piece },
      })
    }
    send('content_block_stop', { index })
    index++
  }
  send('message_delta', {
    delta: { stop_reason: calls.length > 0 ? 'tool_use' : 'end_turn', stop_sequence: null },
    usage: { output_tokens: output },
  })
  send('message_stop', {})
  res.end()
}

/**
 * What an OpenAI-shaped request asks.
 *
 * @param {any} body
 * @returns {Asked}
 */
function askedOpenAI(body) {
  const messages = body?.messages || []
  const lastUser = messages.findLastIndex((/** @type {any} */ m) => m.role === 'user')
  return {
    system: messages
      .filter((/** @type {any} */ m) => m.role === 'system')
      .map((/** @type {any} */ m) => textOf(m.content))
      .join('\n'),
    said: textOf(messages[lastUser]?.content),
    all: messages.map((/** @type {any} */ m) => textOf(m.content)).join('\n'),
    replies: messages.slice(lastUser + 1).filter((/** @type {any} */ m) => m.role === 'assistant')
      .length,
    tools: (body?.tools || []).length > 0,
  }
}

/**
 * What a Messages request asks. A tool's answer comes back in a message of
 * the user's, so the writer's latest is the last of theirs with words in it.
 *
 * @param {any} body
 * @returns {Asked}
 */
function askedAnthropic(body) {
  const messages = body?.messages || []
  const words = (/** @type {any} */ m) =>
    typeof m.content === 'string'
      ? m.content
      : (m.content || [])
          .filter((/** @type {any} */ block) => block.type === 'text')
          .map((/** @type {any} */ block) => block.text)
          .join('')
  const lastUser = messages.findLastIndex(
    (/** @type {any} */ m) => m.role === 'user' && words(m).trim() !== ''
  )
  return {
    system: textOf(body?.system),
    said: lastUser < 0 ? '' : words(messages[lastUser]),
    all: messages.map(words).join('\n'),
    replies: messages.slice(lastUser + 1).filter((/** @type {any} */ m) => m.role === 'assistant')
      .length,
    tools: (body?.tools || []).length > 0,
  }
}

/**
 * The step a request is at: the script whose `system` its system prompt
 * contains, or else the one whose `match` the writer's latest message
 * contains, at the number of replies the model has made since that message.
 *
 * @param {Asked} asked
 * @param {Script[]} scripts
 * @param {(line: string) => void} log
 * @returns {Step}
 */
function pickStep({ system, said, all, replies, tools }, scripts, log) {
  const at = (/** @type {Script} */ script) =>
    script.steps[Math.min(replies, script.steps.length - 1)]

  const skill = scripts.find(s => s.system && system.includes(s.system))
  if (skill) return at(skill)

  // Naming the chat: a request with no tools whose last message asks for a title.
  if (!tools && /title/i.test(said)) {
    const named = scripts.find(s => s.match && all.includes(s.match))
    return { text: named?.title || 'A new chat' }
  }

  const script = scripts.find(s => s.match && said.includes(s.match))
  if (!script) {
    log(`stand-in: no script for “${said.slice(0, 80)}”`)
    return { text: 'Okay.' }
  }
  return at(script)
}

/** How many calls and messages the stand-in has made, so that no two share an id. */
let made = 0

/**
 * @param {Call} step
 * @param {number} [index] - Its place among the calls one reply makes
 */
function toolCall(step, index = 0) {
  return {
    id: `call_${step.tool}_${++made}_${index}`,
    type: 'function',
    function: { name: step.tool, arguments: JSON.stringify(step.args) },
  }
}

/** @param {any} content */
function textOf(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(part => part?.text || '').join('')
  return ''
}

/**
 * A text cut into runs of `n` words, spaces kept, so joining them gives it back.
 *
 * @param {string} text
 * @param {number} n
 */
function words(text, n) {
  const parts = text.match(/\S+\s*|\s+/g) || []
  const out = []
  for (let i = 0; i < parts.length; i += n) out.push(parts.slice(i, i + n).join(''))
  return out
}

/**
 * @param {string} text
 * @param {number} size
 */
function chunks(text, size) {
  const out = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

/**
 * A WAV file of silence, as Kokoro sends: 24 kHz, mono, 16-bit.
 *
 * @param {number} seconds
 */
function silence(seconds) {
  const rate = 24000
  const data = Math.round(seconds * rate) * 2
  const wav = Buffer.alloc(44 + data)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + data, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20) // PCM
  wav.writeUInt16LE(1, 22) // mono
  wav.writeUInt32LE(rate, 24)
  wav.writeUInt32LE(rate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(data, 40)
  return wav
}

/** @param {http.IncomingMessage} req */
async function readJson(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/**
 * The script every page runs before anything else: it sends the app's
 * requests for OpenRouter's and Anthropic's APIs, LM Studio and Kokoro to the stand-in. Pages on other
 * sites (OpenRouter's own, when its sign-in is captured) are left alone. Run
 * with `addInitScript(fetchShim, { app, origin })`.
 *
 * Where a page is gets asked at each request, not once: a tab the app opens
 * starts as about:blank and keeps that window when it lands on the app, so
 * this runs only while it is still blank.
 *
 * @param {{ app: string, origin: string }} origins - The app's, and the stand-in's
 */
export function fetchShim({ app, origin }) {
  const routes = [
    ['https://openrouter.ai/api/', `${origin}/openrouter/api/`],
    ['https://api.anthropic.com/', `${origin}/anthropic/`],
    ['http://localhost:1234/', `${origin}/lmstudio/`],
    ['http://localhost:8880/', `${origin}/kokoro/`],
  ]
  const original = window.fetch.bind(window)
  window.fetch = (input, init) => {
    if (location.origin !== app) return original(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    for (const [from, to] of routes) {
      if (!url.startsWith(from)) continue
      const moved = to + url.slice(from.length)
      return original(input instanceof Request ? new Request(moved, input) : moved, init)
    }
    return original(input, init)
  }
}
