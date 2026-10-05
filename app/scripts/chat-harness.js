/**
 * @module scripts/chat-harness
 * @description A turn of chat, run against a real endpoint from the terminal.
 *
 * The browser is a bad place to answer a question about a request. What
 * reaches the model is decided by fields the panel never shows, and the
 * interesting ones are conditional: what a turn sends itself back after a tool
 * call, whether a message with no text goes out as `null` or `""`, what a
 * backend renames on the way in. Changing one of those and reading the story
 * that comes out is not a measurement.
 *
 * So this runs the same turn loop `composables/useAIChat.js` runs, over the
 * real tool definitions, building the request with the same `ai/wire.js` the
 * app builds it with, and then prints what each round trip actually contained.
 * `--echo` and `--content` vary exactly the fields under suspicion, so two runs
 * differ in one thing and the difference means something.
 *
 * Endpoints live in `scripts/endpoints.local.json`, which is not committed
 * because it holds keys. Copy `endpoints.example.json` to start; the file is
 * read by `harness/endpoints.js`, shared with the transcript harness.
 *
 * @example
 * npm run harness -- --models
 * npm run harness -- --endpoint lmstudio --compare
 * npm run harness -- --endpoint runpod --template
 * npm run harness -- --endpoint lmstudio --chat
 */

import { createInterface } from 'node:readline/promises'

import { loadEndpoints } from '../harness/endpoints.js'
import { AI_DEFAULTS, resolveAISettings } from '@/ai/defaults.js'
import {
  ATTRIBUTION_HEADERS,
  buildCompletionBody,
  baseUrl,
  chatCompletionsUrl,
  modelsUrl,
} from '@/ai/wire.js'
import { getEnabledToolDefinitions, getToolDefinitionsFor, executeTool } from '@/ai/tools/index.js'
import { SKILL_MAX_ROUNDS } from '@/ai/skills/index.js'
import ADVENTURE_PROMPT from '@/ai/prompts/adventure.md?raw'

/**
 * How a turn says its own thinking back to itself after a tool call.
 *
 * `field` is what the app does. The other two are the alternatives worth
 * measuring against it: `inline` puts the thinking where the model originally
 * emitted it, in the content, which every chat template renders whether or not
 * it has heard of a reasoning field; `none` is the behaviour before any of
 * this, kept as the control that says whether the fix did anything at all.
 */
const ECHO_MODES = /** @type {const} */ (['field', 'inline', 'none'])

/** Tools the harness can actually run. Documents need a database behind them. */
const DEFAULT_DISABLED_GROUPS = ['documents']

const DEFAULT_PROMPT = 'Let us begin. I am a courier arriving at the last town before the pass.'

const ESC = String.fromCharCode(27)
const colour = process.stdout.isTTY
  ? { dim: s => `${ESC}[2m${s}${ESC}[0m`, bold: s => `${ESC}[1m${s}${ESC}[0m` }
  : { dim: s => String(s), bold: s => String(s) }

/**
 * @typedef {Object} Options
 * @property {string} [endpoint] - Named endpoint, or a base URL
 * @property {string} [model] - Substring matched against the served model list
 * @property {string} prompt - What the player says
 * @property {'field'|'inline'|'none'} echo
 * @property {'null'|'empty'} content - What an assistant message with no text sends
 * @property {number} rounds - Cap on round trips in one turn
 * @property {number} repeat - Samples per condition, because the answer is a rate
 * @property {boolean} compare - Run every echo mode and tabulate
 * @property {boolean} template - Ask the server to render the prompt and print it
 * @property {boolean} chat - Keep the conversation open for more turns
 * @property {boolean} models - List models and exit
 * @property {boolean} raw - Print the request body and every streamed delta
 */

/**
 * @param {string[]} argv
 * @returns {Options}
 */
function parseArgs(argv) {
  /** @type {Options} */
  const options = {
    prompt: DEFAULT_PROMPT,
    echo: 'field',
    content: 'null',
    rounds: 4,
    repeat: 1,
    compare: false,
    template: false,
    chat: false,
    models: false,
    raw: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next === undefined) throw new Error(`${arg} needs a value`)
      return next
    }

    switch (arg) {
      case '--endpoint':
      case '-e':
        options.endpoint = value()
        break
      case '--model':
      case '-m':
        options.model = value()
        break
      case '--prompt':
      case '-p':
        options.prompt = value()
        break
      case '--echo': {
        const mode = value()
        if (!ECHO_MODES.includes(/** @type {any} */ (mode))) {
          throw new Error(`--echo must be one of ${ECHO_MODES.join(', ')}`)
        }
        options.echo = /** @type {any} */ (mode)
        break
      }
      case '--content': {
        const mode = value()
        if (mode !== 'null' && mode !== 'empty') throw new Error('--content must be null or empty')
        options.content = mode
        break
      }
      case '--rounds':
        options.rounds = Number(value())
        break
      case '--repeat':
        options.repeat = Number(value())
        break
      case '--compare':
        options.compare = true
        break
      case '--template':
        options.template = true
        break
      case '--chat':
        options.chat = true
        break
      case '--models':
        options.models = true
        break
      case '--raw':
        options.raw = true
        break
      case '--help':
      case '-h':
        console.log(USAGE)
        process.exit(0)
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

const USAGE = `
${colour.bold('chat-harness')} - run one turn against a real endpoint and report what crossed the wire

  npm run harness -- [options]

  -e, --endpoint <name|url>  Endpoint from scripts/endpoints.local.json, or a base URL
  -m, --model <substring>    Model to use; matched against the served list
  -p, --prompt <text>        What the player says
      --echo <mode>          How a turn echoes its own thinking after a tool call:
                             ${ECHO_MODES.join(' | ')}  (default: field, what the app does)
      --content <mode>       What an assistant message with no text sends:
                             null | empty  (default: null, what the app does)
      --rounds <n>           Cap on round trips in one turn (default: 4)
      --repeat <n>           Samples per condition (default: 1). Whether a model
                             thinks again is a coin it flips, so one run of each
                             is an anecdote; a rate over several is an answer.
      --compare              Run every echo mode over the same opening and tabulate
      --template             Print the prompt the server renders (llama.cpp only)
      --chat                 Keep the conversation open for more turns
      --models               List what the endpoint serves, and exit
      --raw                  Print the request body and every streamed delta
`

/**
 * @param {Options} options
 * @returns {Promise<any>} An AIProvider the app's own request builder accepts
 */
async function resolveProvider(options) {
  const named = await loadEndpoints()

  if (options.endpoint?.startsWith('http')) {
    return { type: 'generic', name: options.endpoint, endpoint: options.endpoint }
  }

  const key = options.endpoint || Object.keys(named)[0]
  if (!key) {
    throw new Error(
      'No endpoint. Pass a URL to --endpoint, or copy scripts/endpoints.example.json to scripts/endpoints.local.json.'
    )
  }
  const entry = named[key]
  if (!entry) {
    throw new Error(`Unknown endpoint "${key}". Known: ${Object.keys(named).join(', ') || 'none'}`)
  }

  return { type: 'generic', name: key, ...entry }
}

/**
 * @param {any} provider
 * @returns {Record<string, string>}
 */
function headersFor(provider) {
  /** @type {Record<string, string>} */
  const headers = {
    'Content-Type': 'application/json',
    ...ATTRIBUTION_HEADERS,
    Accept: 'text/event-stream',
  }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`
  return headers
}

/**
 * @param {any} provider
 * @returns {Promise<string[]>}
 */
async function listModels(provider) {
  const response = await fetch(modelsUrl(provider), { headers: headersFor(provider) })
  if (!response.ok) throw new Error(`GET models: HTTP ${response.status}`)
  const data = await response.json()
  return (data.data || []).map(model => model.id)
}

/**
 * @param {any} provider
 * @param {string} [wanted] - Substring to match, or nothing to take the first served
 * @returns {Promise<string>}
 */
async function resolveModel(provider, wanted) {
  const models = await listModels(provider)
  if (models.length === 0) throw new Error('The endpoint serves no models')
  if (!wanted) return models[0]

  const match = models.find(id => id.toLowerCase().includes(wanted.toLowerCase()))
  if (!match) throw new Error(`No model matching "${wanted}". Served: ${models.join(', ')}`)
  return match
}

/**
 * @typedef {Object} RoundTrip
 * @property {string} content
 * @property {string} reasoning - Whatever the backend streamed on its thinking channel
 * @property {string[]} reasoningKeys - Which field names carried it, as sent
 * @property {any[]} toolCalls
 * @property {any[]} reasoningDetails
 * @property {string|null} finishReason
 * @property {any} usage
 * @property {string[]} unknownKeys - Delta fields nothing here reads
 */

/** Delta fields the app knows about. Anything else is worth being told about. */
const KNOWN_DELTA_KEYS = new Set([
  'role',
  'content',
  'reasoning',
  'reasoning_content',
  'reasoning_details',
  'tool_calls',
  'refusal',
  'function_call',
])

/**
 * One round trip, read the way the app reads it, plus a note of anything in
 * the stream it would have thrown away without noticing.
 *
 * @param {any} provider
 * @param {any} body
 * @param {boolean} raw
 * @returns {Promise<RoundTrip>}
 */
async function stream(provider, body, raw) {
  const response = await fetch(chatCompletionsUrl(provider), {
    method: 'POST',
    headers: headersFor(provider),
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 2000)}`)
  }

  /** @type {RoundTrip} */
  const trip = {
    content: '',
    reasoning: '',
    reasoningKeys: [],
    toolCalls: [],
    reasoningDetails: [],
    finishReason: null,
    usage: null,
    unknownKeys: [],
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') continue
      if (raw) console.log(colour.dim(`  . ${data.slice(0, 400)}`))

      let parsed
      try {
        parsed = JSON.parse(data)
      } catch {
        continue
      }
      if (parsed.error) throw new Error(JSON.stringify(parsed.error))

      const delta = parsed.choices?.[0]?.delta || {}

      for (const key of Object.keys(delta)) {
        if (!KNOWN_DELTA_KEYS.has(key) && !trip.unknownKeys.includes(key)) {
          trip.unknownKeys.push(key)
        }
      }

      if (delta.content) trip.content += delta.content

      // Two names in the wild for the same channel, and which one arrives is
      // half the question this harness exists to answer.
      for (const key of ['reasoning', 'reasoning_content']) {
        if (!delta[key]) continue
        trip.reasoning += delta[key]
        if (!trip.reasoningKeys.includes(key)) trip.reasoningKeys.push(key)
      }

      if (delta.reasoning_details?.length) trip.reasoningDetails.push(...delta.reasoning_details)

      for (const call of delta.tool_calls || []) {
        const index = call.index ?? 0
        if (!trip.toolCalls[index]) {
          trip.toolCalls[index] = {
            id: '',
            type: 'function',
            function: { name: '', arguments: '' },
          }
        }
        if (call.id) trip.toolCalls[index].id = call.id
        if (call.function?.name) trip.toolCalls[index].function.name += call.function.name
        if (call.function?.arguments) {
          trip.toolCalls[index].function.arguments += call.function.arguments
        }
      }

      if (parsed.choices?.[0]?.finish_reason) trip.finishReason = parsed.choices[0].finish_reason
      if (parsed.usage) trip.usage = parsed.usage
    }
  }

  trip.toolCalls = trip.toolCalls.filter(Boolean)
  return trip
}

/**
 * The conversation as a reader who made none of these tool calls should see
 * it: the flattening `ai/context/build.js` does for a skill, in miniature.
 *
 * The calls it goes on to make itself are appended to what comes back, the
 * same way `consult` does it in the app.
 *
 * @param {any[]} messages
 * @param {string} systemPrompt
 * @returns {any[]}
 */
function flattenForSkill(messages, systemPrompt) {
  const out = [{ role: 'system', content: systemPrompt }]
  for (const message of messages) {
    if (message.role === 'user') out.push({ role: 'user', content: message.content })
    if (message.role === 'assistant' && message.content) {
      out.push({ role: 'assistant', content: message.content })
    }
  }
  return out
}

/**
 * Whether a round trip thought at all, by either route: with `--echo inline` a
 * backend that has stopped parsing thinking out hands it back inside content.
 *
 * @param {RoundTrip} trip
 * @returns {boolean}
 */
function thought(trip) {
  return trip.reasoning.length > 0 || /<think>/i.test(trip.content)
}

/**
 * @param {string} text
 * @param {number} [limit]
 * @returns {string}
 */
function oneLine(text, limit = 140) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}...` : flat
}

/**
 * Run a turn: request, tool calls, request again, until the model stops asking
 * for tools. The same sequence as `runCompletionLoop`, with the echo and
 * content decisions pulled out where they can be varied.
 *
 * @param {Object} args
 * @param {any} args.provider
 * @param {string} args.model
 * @param {any[]} args.messages - Mutated: the turn is appended to it
 * @param {any[]} args.tools
 * @param {Options} args.options
 * @param {boolean} [args.quiet] - Report only the shape of each round, not its text
 * @returns {Promise<RoundTrip[]>} One entry per round trip
 */
async function runTurn({ provider, model, messages, tools, options, quiet = false }) {
  const settings = resolveAISettings()
  /** @type {RoundTrip[]} */
  const trips = []

  for (let round = 1; round <= options.rounds; round++) {
    const { body } = buildCompletionBody({ messages, model, provider, settings, tools })
    if (options.raw) {
      console.log(colour.dim(`\n  request ${round}:`))
      console.log(colour.dim(JSON.stringify(body.messages, null, 2)))
    }

    const trip = await stream(provider, body, options.raw)
    trips.push(trip)

    const names = trip.toolCalls.map(call => call.function.name)
    if (!quiet)
      console.log(
        `  ${colour.bold(`round ${round}`)}  ` +
          `thinking ${String(trip.reasoning.length).padStart(5)}  ` +
          `text ${String(trip.content.length).padStart(5)}  ` +
          `tools [${names.join(', ')}]  ` +
          `finish ${trip.finishReason}` +
          (trip.reasoningKeys.length ? `  via ${trip.reasoningKeys.join('+')}` : '')
      )
    if (!quiet) {
      if (trip.reasoning) console.log(colour.dim(`         thought: ${oneLine(trip.reasoning)}`))
      if (trip.content) console.log(colour.dim(`         said:    ${oneLine(trip.content)}`))
      if (trip.unknownKeys.length) {
        console.log(colour.dim(`         unread delta fields: ${trip.unknownKeys.join(', ')}`))
      }
    }

    if (trip.toolCalls.length === 0) {
      if (trip.content) messages.push({ role: 'assistant', content: trip.content })
      break
    }

    // The assistant entry for this round. `content || null` is the app's; the
    // other half of `--content` is the thing to try when a backend drops a
    // message whose content is null.
    /** @type {any} */
    const assistant = {
      role: 'assistant',
      content: trip.content || (options.content === 'empty' ? '' : null),
      tool_calls: trip.toolCalls,
    }
    if (trip.reasoningDetails.length) assistant.reasoning_details = trip.reasoningDetails

    if (trip.reasoning && options.echo === 'field') {
      // Ours. `ai/wire.js` renames it to whatever this backend calls the field.
      assistant._reasoning = trip.reasoning
    }
    if (trip.reasoning && options.echo === 'inline') {
      // Where the model put it before the backend parsed it out. No template
      // has to know a field name for this one to survive.
      assistant.content = `<think>\n${trip.reasoning}\n</think>\n\n${trip.content || ''}`.trim()
    }

    messages.push(assistant)

    /** @type {(systemPrompt: string, toolNames?: string[], depth?: number) => Promise<string>} */
    const consult = async (systemPrompt, toolNames = [], depth = 1) => {
      const consulted = flattenForSkill(messages, systemPrompt)
      const skillTools = getToolDefinitionsFor(toolNames, depth)
      // One skill may reach another, so indent by how deep this one is.
      const pad = ' '.repeat(7 + depth * 2)

      for (let skillRound = 1; skillRound <= SKILL_MAX_ROUNDS; skillRound++) {
        const { body: consultBody } = buildCompletionBody({
          messages: consulted,
          model,
          provider,
          settings,
          tools: skillTools,
        })
        const answer = await stream(provider, consultBody, options.raw)
        const asked = answer.toolCalls.map(call => call.function.name)
        if (!quiet) {
          console.log(
            colour.dim(
              `${pad}consulted ${skillRound} (thinking ${answer.reasoning.length}, text ${answer.content.length})` +
                `${asked.length ? ` [${asked.join(', ')}]` : ''}: ${oneLine(answer.content, 100)}`
            )
          )
        }

        if (answer.toolCalls.length === 0) {
          return answer.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
        }

        /** @type {any} */
        const said = {
          role: 'assistant',
          content: answer.content || (options.content === 'empty' ? '' : null),
          tool_calls: answer.toolCalls,
        }
        if (answer.reasoning && options.echo === 'field') said._reasoning = answer.reasoning
        consulted.push(said)

        for (const skillCall of answer.toolCalls) {
          const skillResult = await executeTool(skillCall, {
            consult: (prompt, names) => consult(prompt, names, depth + 1),
          })
          consulted.push({
            role: 'tool',
            tool_call_id: skillResult.tool_call_id,
            content: skillResult.content,
          })
          if (!quiet) {
            console.log(
              colour.dim(`${pad}  ${skillCall.function.name}: ${oneLine(skillResult.content, 100)}`)
            )
          }
        }
      }

      // Out of rounds and still calling tools: the app treats that as silence.
      if (!quiet) console.log(colour.dim(`${pad}consulted: no answer in ${SKILL_MAX_ROUNDS}`))
      return ''
    }

    for (const call of trip.toolCalls) {
      const result = await executeTool(call, { consult })
      messages.push({ role: 'tool', tool_call_id: result.tool_call_id, content: result.content })
      if (!quiet) {
        console.log(colour.dim(`         ${call.function.name}: ${oneLine(result.content, 100)}`))
      }
    }
  }

  return trips
}

/**
 * Print the prompt the server actually builds from these messages.
 *
 * This is the only way to see whether a chat template renders the reasoning
 * field at all. A template that has never heard of it drops it in silence, and
 * from the client side that looks exactly like a model that chose not to think
 * again. llama.cpp answers; LM Studio does not expose it.
 *
 * @param {any} provider
 * @param {any[]} messages
 * @param {any[]} tools
 */
async function showRenderedTemplate(provider, messages, tools) {
  const url = new URL('/apply-template', baseUrl(provider)).toString()
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...headersFor(provider), Accept: 'application/json' },
    body: JSON.stringify({ messages, tools }),
  })

  if (!response.ok) {
    console.log(
      colour.dim(
        `\n  ${url}: HTTP ${response.status}. Only llama.cpp serves this; on anything else, turn the server's own prompt logging up instead.`
      )
    )
    return
  }

  const data = await response.json()
  console.log(`\n${colour.bold('rendered prompt')}\n`)
  console.log(data.prompt ?? JSON.stringify(data, null, 2))
}

/**
 * Run one condition several times and report how often the turn kept thinking.
 *
 * Once is not enough. At the temperature the app actually runs at, whether a
 * model thinks again after a tool result is partly its own coin flip, and a
 * single run of each condition will happily report whichever way it landed.
 *
 * @param {Object} args
 * @param {any} args.provider
 * @param {string} args.model
 * @param {any[]} args.tools
 * @param {Options} args.options
 * @param {'field'|'inline'|'none'} args.echo
 * @param {() => any[]} args.opening - A fresh conversation for each sample
 * @returns {Promise<{echo: string, thought: number, of: number, continuations: number[]}>}
 */
async function sample({ provider, model, tools, options, echo, opening }) {
  const quiet = options.repeat > 1
  let thoughtAgain = 0
  /** @type {number[]} How much each sample thought after its first tool call */
  const continuations = []

  for (let run = 1; run <= options.repeat; run++) {
    const trips = await runTurn({
      provider,
      model,
      messages: opening(),
      tools,
      options: { ...options, echo },
      quiet,
    })

    const after = trips.slice(1)
    const kept = after.some(thought)
    if (kept) thoughtAgain++
    continuations.push(after.reduce((total, trip) => total + trip.reasoning.length, 0))

    if (quiet) {
      console.log(
        `  ${echo.padEnd(7)} run ${run}/${options.repeat}  ` +
          `${kept ? 'thought again' : 'went quiet   '}  ` +
          `by round: ${trips.map(trip => trip.reasoning.length).join(', ')}`
      )
    }
  }

  return { echo, thought: thoughtAgain, of: options.repeat, continuations }
}

/**
 * @param {Array<{echo: string, thought: number, of: number, continuations: number[]}>} results
 */
function report(results) {
  console.log(`\n${colour.bold('summary')}\n`)
  console.log('  echo     thought again after a tool call   thinking chars, per sample')
  for (const result of results) {
    console.log(
      `  ${result.echo.padEnd(8)} ${`${result.thought}/${result.of}`.padEnd(33)}` +
        `${result.continuations.join(', ')}`
    )
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const provider = await resolveProvider(options)

  if (options.models) {
    const models = await listModels(provider)
    console.log(models.join('\n'))
    return
  }

  const model = await resolveModel(provider, options.model)
  const tools = getEnabledToolDefinitions({ disabledGroups: DEFAULT_DISABLED_GROUPS })

  console.log(
    `${colour.bold(provider.name)}  ${baseUrl(provider)}\n` +
      `model    ${model}\n` +
      `tools    ${tools.map(tool => tool.function.name).join(', ')}\n` +
      `settings temp=${AI_DEFAULTS.parameters.temperature}, reasoningEffort=${AI_DEFAULTS.reasoningEffort} (OpenRouter only)`
  )

  const opening = () => [
    { role: 'system', content: ADVENTURE_PROMPT },
    { role: 'user', content: options.prompt },
  ]

  if (options.template) {
    // Run a turn first, so what gets rendered is a conversation that has been
    // through a tool call, which is the only kind with anything to render.
    const messages = opening()
    console.log(`\n${colour.bold('turn')}  (to build a history worth rendering)\n`)
    await runTurn({ provider, model, messages, tools, options })
    const { body } = buildCompletionBody({
      messages,
      model,
      provider,
      settings: resolveAISettings(),
      tools,
    })
    await showRenderedTemplate(provider, body.messages, tools)
    return
  }

  if (options.compare) {
    /** @type {Array<{echo: string, thought: number, of: number, continuations: number[]}>} */
    const results = []
    for (const echo of ECHO_MODES) {
      console.log(`\n${colour.bold(`echo=${echo}`)}  content=${options.content}\n`)
      results.push(await sample({ provider, model, tools, options, echo, opening }))
    }
    report(results)
    return
  }

  const messages = opening()
  console.log(
    `\n${colour.bold('turn')}  echo=${options.echo} content=${options.content}` +
      (options.repeat > 1 ? ` repeat=${options.repeat}` : '') +
      '\n'
  )

  if (options.repeat > 1) {
    report([await sample({ provider, model, tools, options, echo: options.echo, opening })])
    return
  }

  const trips = await runTurn({ provider, model, messages, tools, options })

  console.log(
    `\n  ${colour.bold('interleaved thinking:')} ` +
      (trips.length < 2
        ? 'untested. The model never called a tool, so nothing was continued.'
        : trips.slice(1).some(thought)
          ? 'YES. It thought again after a tool result.'
          : 'NO. Every round after the first came back with no thinking.') +
      (options.repeat === 1 ? colour.dim('  (one sample; use --repeat for a rate)') : '')
  )

  if (!options.chat) return

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  while (true) {
    const said = await rl.question('\n> ')
    if (!said.trim() || said.trim() === '/quit') break
    messages.push({ role: 'user', content: said })
    console.log('')
    await runTurn({ provider, model, messages, tools, options })
  }
  rl.close()
}

main().catch(error => {
  console.error(`\n${error.message}`)
  process.exit(1)
})
