/**
 * @module harness/gm
 * @description Architectures that separate the Game Master's planning and
 * tool calls from its narration, run headless against a fixture.
 *
 * The single-pass Game Master reasons, calls tools, and narrates in one turn,
 * and the harness has shown what that costs on a thinking model: the
 * pre-tool sentence fused to the prose, the oracle phrased in the reasoning
 * and answered there, once a whole scene written into the reasoning channel
 * with nothing left for the player. Each architecture here gives the machinery
 * a call of its own and the narration a call with no tools at all.
 *
 * - `single`: one call with tools, the control. Same wire, same notes.
 * - `planner`: a planner with tools settles what is open and writes a beat;
 *   a narrator with no tools writes the turn from the beat.
 * - `questions`: a questioner with no tools lists the yes/no questions the
 *   turn hinges on; the runner asks the oracle itself; the narrator writes
 *   from the answers. No model ever calls a tool.
 * - `referee`: the Game Master drafts with no tools; a referee with the oracle
 *   rules on every decision the draft made that the notes did not settle; the
 *   Game Master revises to the rulings, or the draft ships as it was.
 *
 * The notes ride in every system prompt whole, so no role has to read them,
 * and the roles' prompts live in `gm/`, one file each. The rpg tools are the
 * app's own, executed through its registry.
 *
 * @example
 * npm run gm -- --arch planner --runs 3 --endpoint openrouter --model z-ai/glm-4.7
 * npm run gm -- --arch single --thinking off
 */

import './environment.js'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveEndpoint } from './endpoints.js'
import { complete } from './wire.js'
import { executeTool, getToolDefinitionsFor } from '@/ai/tools/index.js'
import { LIKELIHOOD_TARGETS, executeOracle } from '@/ai/tools/rpg.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The resolution tools a Game Master has at the table; the document tools are not needed with the notes inline. */
const GM_TOOLS = ['oracle', 'roll_dice', 'generate_names', 'roll_table']

export const ARCHITECTURES = /** @type {const} */ (['single', 'planner', 'questions', 'referee'])

/** Round trips a role gets with tools before it has to answer. */
const MAX_TOOL_ROUNDS = 6

/** @typedef {(typeof ARCHITECTURES)[number]} Architecture */

/**
 * @typedef {Object} Options
 * @property {Architecture} arch
 * @property {number} runs
 * @property {string} [endpoint]
 * @property {string} [model]
 * @property {string} scenario
 * @property {boolean} thinking
 * @property {string} out
 */

/**
 * @param {string[]} argv
 * @returns {Options}
 */
function parseArgs(argv) {
  /** @type {Options} */
  const options = {
    arch: 'planner',
    runs: 1,
    scenario: 'adventure-plain',
    thinking: true,
    out: join(HERE, 'runs'),
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next === undefined) throw new Error(`${arg} needs a value`)
      return next
    }
    switch (arg) {
      case '--arch':
      case '-a': {
        const arch = value()
        if (!ARCHITECTURES.includes(/** @type {Architecture} */ (arch))) {
          throw new Error(`Unknown architecture ${arch}. Known: ${ARCHITECTURES.join(', ')}`)
        }
        options.arch = /** @type {Architecture} */ (arch)
        break
      }
      case '--runs':
      case '-n':
        options.runs = Number.parseInt(value(), 10)
        break
      case '--endpoint':
      case '-e':
        options.endpoint = value()
        break
      case '--model':
      case '-m':
        options.model = value()
        break
      case '--scenario':
      case '-s':
        options.scenario = value()
        break
      case '--thinking':
        options.thinking = value() !== 'off'
        break
      case '--out':
      case '-o':
        options.out = resolve(value())
        break
      case '--help':
      case '-h':
        console.log(USAGE)
        process.exit(0)
        break
      default:
        throw new Error(`Unknown argument ${arg}\n${USAGE}`)
    }
  }
  return options
}

const USAGE = `
Usage: npm run gm -- [options]

  -a, --arch <name>           single, planner, questions, or referee (default: planner)
  -n, --runs <n>              How many times to run it (default: 1)
  -e, --endpoint <name>       Endpoint from scripts/endpoints.local.json (default: the first)
  -m, --model <id>            Model to run, overriding the endpoint's
  -s, --scenario <name>       Scenario under harness/scenarios/ (default: adventure-plain)
      --thinking on|off       Whether the model may think (default: on)
  -o, --out <dir>             Where to write the batch (default: harness/runs)
`

/**
 * The fixture as one block of notes, path headings and all.
 *
 * @param {string} dir - Fixture folder
 * @returns {Promise<{title: string, notes: string}>}
 */
async function loadNotes(dir) {
  const project = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8'))
  const parts = [`# ${project.title}`, '', project.summary || '']
  for (const doc of project.documents || []) {
    if (!doc.file) continue
    parts.push('', `## ${doc.path}`, '', (await readFile(join(dir, doc.file), 'utf8')).trim())
  }
  return { title: project.title, notes: parts.join('\n') }
}

/**
 * @param {string} ref - Scenario name under scenarios/, or a path
 * @returns {Promise<{name: string, fixtureDir: string, messages: string[]}>}
 */
async function loadScenario(ref) {
  const file = ref.endsWith('.json') ? resolve(ref) : join(HERE, 'scenarios', `${ref}.json`)
  const scenario = JSON.parse(await readFile(file, 'utf8'))
  const fixtureDir = scenario.fixture.includes('/')
    ? resolve(dirname(file), scenario.fixture)
    : join(HERE, 'fixtures', scenario.fixture)
  return { name: basename(file, '.json'), fixtureDir, messages: scenario.messages }
}

/** @param {string} name - Prompt file under gm/, without extension */
const loadRole = async name => (await readFile(join(HERE, 'gm', `${name}.md`), 'utf8')).trim()

/**
 * @typedef {Object} Exchange
 * @property {string} action - What the player said
 * @property {string} narration - What the Game Master answered
 */

/**
 * The game so far as a transcript, for a role that reads rather than plays.
 *
 * @param {Exchange[]} history
 * @param {string} action - What the player has just said
 * @returns {string}
 */
function transcriptFor(history, action) {
  const lines = []
  for (const turn of history) {
    lines.push(`Player: ${turn.action}`, '', `Game Master: ${turn.narration}`, '')
  }
  lines.push(`Player now: ${action}`)
  return lines.join('\n')
}

/**
 * The game so far as messages, for the role that writes the next one.
 *
 * @param {Exchange[]} history
 * @param {string} last - The final user message
 * @returns {Array<{role: string, content: string}>}
 */
function messagesFor(history, last) {
  const messages = []
  for (const turn of history) {
    messages.push({ role: 'user', content: turn.action })
    messages.push({ role: 'assistant', content: turn.narration })
  }
  messages.push({ role: 'user', content: last })
  return messages
}

/**
 * @typedef {Object} Call
 * @property {string} name
 * @property {string} args
 * @property {string} result
 */

/**
 * @typedef {Object} Stage
 * @property {string} role
 * @property {string} content - What the role said, after any tool rounds
 * @property {string} reasoning
 * @property {string} preamble - Content emitted in rounds that ended in tool calls
 * @property {Call[]} calls
 * @property {number} rounds
 * @property {string} finish
 * @property {number} ms
 * @property {{prompt: number, completion: number}} usage
 * @property {string[]} providers - Which upstream served each round, when the server says
 */

/**
 * One role's call, with whatever tool rounds it takes.
 *
 * @param {Object} args
 * @param {string} args.role - For the record
 * @param {import('./endpoints.js').Endpoint} args.endpoint
 * @param {string} args.model
 * @param {string} args.system
 * @param {Array<{role: string, content: string}>} args.messages
 * @param {string[]} [args.tools] - Tool names to offer; none by default
 * @param {boolean} args.thinking
 * @returns {Promise<Stage>}
 */
async function runRole({ role, endpoint, model, system, messages, tools = [], thinking }) {
  const definitions = tools.length > 0 ? getToolDefinitionsFor(tools, 0) : []
  /** @type {any[]} */
  const wire = [{ role: 'system', content: system }, ...messages]
  /** @type {Call[]} */
  const calls = []
  const preamble = []
  /** @type {string[]} */
  const providers = []
  const usage = { prompt: 0, completion: 0 }
  let ms = 0
  let rounds = 0
  /** @type {import('./wire.js').Completion} */
  let last = { content: '', reasoning: '', toolCalls: [], finish: 'none', usage, ms: 0 }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    last = await complete({ endpoint, model, messages: wire, tools: definitions, thinking })
    rounds++
    ms += last.ms
    usage.prompt += last.usage.prompt
    usage.completion += last.usage.completion
    if (last.provider) providers.push(last.provider)
    if (last.toolCalls.length === 0) break

    if (last.content) preamble.push(last.content)
    /** @type {any} */
    const assistant = { role: 'assistant', content: last.content || '', tool_calls: last.toolCalls }
    if (last.reasoningDetails) assistant.reasoning_details = last.reasoningDetails
    wire.push(assistant)
    for (const call of last.toolCalls) {
      const executed = await executeTool(call, {})
      calls.push({
        name: call.function.name,
        args: call.function.arguments,
        result: executed.content,
      })
      wire.push({ role: 'tool', tool_call_id: call.id, content: executed.content })
    }
  }

  return {
    role,
    content: last.toolCalls.length > 0 ? '' : last.content,
    reasoning: last.reasoning,
    preamble: preamble.join('\n'),
    calls,
    rounds,
    finish: last.finish,
    ms,
    usage,
    providers,
  }
}

/**
 * @typedef {Object} TurnRecord
 * @property {number} n
 * @property {string} action
 * @property {Stage[]} stages - In the order they ran
 * @property {string} narration - What the player sees
 * @property {number} ms
 */

/**
 * @typedef {Object} Table
 * @property {import('./endpoints.js').Endpoint} endpoint
 * @property {string} model
 * @property {boolean} thinking
 * @property {string} notes
 * @property {Record<string, string>} roles - Prompt text by role name
 */

/**
 * @param {Table} table
 * @param {string} role
 * @returns {string}
 */
const systemFor = (table, role) => `${table.roles[role]}\n\n# Notes\n\n${table.notes}`

/**
 * The plan, as the narrator reads it: tagged at both ends so it cannot be
 * mistaken for something the player said. The same shape the app uses for the
 * Director's note.
 *
 * @param {string} plan
 * @returns {string}
 */
const planBlock = plan => `<plan>\n${plan.trim()}\n</plan>`

/**
 * @param {Table} table
 * @param {Exchange[]} history
 * @param {string} action
 * @returns {Promise<{stages: Stage[], narration: string}>}
 */
async function turnSingle(table, history, action) {
  const gm = await runRole({
    role: 'game_master',
    endpoint: table.endpoint,
    model: table.model,
    system: systemFor(table, 'single'),
    messages: messagesFor(history, action),
    tools: GM_TOOLS,
    thinking: table.thinking,
  })
  return { stages: [gm], narration: gm.content }
}

/**
 * @param {Table} table
 * @param {Exchange[]} history
 * @param {string} action
 * @returns {Promise<{stages: Stage[], narration: string}>}
 */
async function turnPlanner(table, history, action) {
  const planner = await runRole({
    role: 'planner',
    endpoint: table.endpoint,
    model: table.model,
    system: systemFor(table, 'planner'),
    messages: [{ role: 'user', content: transcriptFor(history, action) }],
    tools: GM_TOOLS,
    thinking: table.thinking,
  })
  const narrator = await runRole({
    role: 'narrator',
    endpoint: table.endpoint,
    model: table.model,
    system: systemFor(table, 'narrator'),
    messages: messagesFor(history, `${action}\n\n${planBlock(planner.content || '(no plan)')}`),
    thinking: table.thinking,
  })
  return { stages: [planner, narrator], narration: narrator.content }
}

/**
 * The questions a questioner listed, as far as they can be read. A model
 * asked for a JSON array wraps it in fences or prose often enough that the
 * first array in the text is taken, and anything that is not a question with
 * a known likelihood is dropped rather than asked.
 *
 * @param {string} text
 * @returns {Array<{question: string, likelihood: string}>}
 */
export function parseQuestions(text) {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      item =>
        item &&
        typeof item.question === 'string' &&
        item.question.trim() &&
        Object.hasOwn(LIKELIHOOD_TARGETS, item.likelihood)
    )
  } catch {
    return []
  }
}

/**
 * @param {Table} table
 * @param {Exchange[]} history
 * @param {string} action
 * @returns {Promise<{stages: Stage[], narration: string}>}
 */
async function turnQuestions(table, history, action) {
  const questioner = await runRole({
    role: 'questioner',
    endpoint: table.endpoint,
    model: table.model,
    system: systemFor(table, 'questioner'),
    messages: [{ role: 'user', content: transcriptFor(history, action) }],
    thinking: table.thinking,
  })
  // The runner asks. No model decides whether to call, and none writes the
  // answer itself, because none is offered the tool.
  const settled = []
  for (const question of parseQuestions(questioner.content)) {
    const answer = await executeOracle(question)
    questioner.calls.push({
      name: 'oracle',
      args: JSON.stringify(question),
      result: JSON.stringify(answer),
    })
    settled.push(`- ${question.question} (${question.likelihood}) — ${answer}`)
  }
  const plan =
    settled.length > 0 ? `SETTLED:\n${settled.join('\n')}` : 'SETTLED:\n- nothing was open'
  const narrator = await runRole({
    role: 'narrator',
    endpoint: table.endpoint,
    model: table.model,
    system: systemFor(table, 'narrator'),
    messages: messagesFor(history, `${action}\n\n${planBlock(plan)}`),
    thinking: table.thinking,
  })
  return { stages: [questioner, narrator], narration: narrator.content }
}

/**
 * Whether a referee's reply asked for nothing.
 *
 * @param {string} verdicts
 * @returns {boolean}
 */
export function noChanges(verdicts) {
  const changes = verdicts.split(/CHANGES:/i)[1]
  if (changes === undefined) return true
  return /^\s*-?\s*none\b/i.test(changes.trim()) || changes.trim() === ''
}

/**
 * @param {Table} table
 * @param {Exchange[]} history
 * @param {string} action
 * @returns {Promise<{stages: Stage[], narration: string}>}
 */
async function turnReferee(table, history, action) {
  const draft = await runRole({
    role: 'draft',
    endpoint: table.endpoint,
    model: table.model,
    system: systemFor(table, 'draft'),
    messages: messagesFor(history, action),
    thinking: table.thinking,
  })
  const referee = await runRole({
    role: 'referee',
    endpoint: table.endpoint,
    model: table.model,
    system: systemFor(table, 'referee'),
    messages: [
      {
        role: 'user',
        content: `${transcriptFor(history, action)}\n\nDRAFT:\n${draft.content}`,
      },
    ],
    tools: ['oracle'],
    thinking: table.thinking,
  })
  if (noChanges(referee.content)) {
    return { stages: [draft, referee], narration: draft.content }
  }
  const reviser = await runRole({
    role: 'reviser',
    endpoint: table.endpoint,
    model: table.model,
    system: systemFor(table, 'reviser'),
    messages: [
      {
        role: 'user',
        content: `${transcriptFor(history, action)}\n\nDRAFT:\n${draft.content}\n\nRULINGS:\n${referee.content}`,
      },
    ],
    thinking: table.thinking,
  })
  return { stages: [draft, referee, reviser], narration: reviser.content }
}

const TURNS = {
  single: turnSingle,
  planner: turnPlanner,
  questions: turnQuestions,
  referee: turnReferee,
}

/** @param {string} text */
const words = text => text.trim().split(/\s+/).filter(Boolean).length

/** @param {number} ms */
const seconds = ms => `${(ms / 1000).toFixed(1)}s`

/**
 * @param {TurnRecord[]} turns
 * @param {{title: string, lines: string[]}} head
 * @returns {string}
 */
function render(turns, head) {
  const out = [`# ${head.title}`, '', ...head.lines, '']
  for (const turn of turns) {
    out.push('## Player', '', turn.action, '')
    for (const stage of turn.stages) {
      const isProse =
        stage.role === 'narrator' || stage.role === 'game_master' || stage.role === 'reviser'
      if (stage.role === 'draft') {
        out.push('## Draft', '', stage.content || '_(nothing)_', '')
      } else if (!isProse) {
        out.push(`## ${stage.role[0].toUpperCase()}${stage.role.slice(1)}`, '')
        if (stage.reasoning) {
          out.push(
            '<details><summary>Reasoning</summary>',
            '',
            stage.reasoning,
            '',
            '</details>',
            ''
          )
        }
        out.push(stage.content || '_(nothing)_', '')
      }
      if (stage.calls.length > 0) {
        out.push(`**Tools (${stage.role})**`, '')
        for (const call of stage.calls)
          out.push(`- \`${call.name}(${call.args})\` → ${call.result}`)
        out.push('')
      }
      if (stage.preamble)
        out.push(`_${stage.role} said before its tool calls: "${stage.preamble}"_`, '')
    }
    out.push('## Game Master', '', turn.narration || '_(no narration)_', '')
    out.push(
      `_${turn.stages.map(stage => `${stage.role} ${seconds(stage.ms)}${stage.finish !== 'stop' ? ` (${stage.finish})` : ''}${stage.providers.length ? ` via ${[...new Set(stage.providers)].join('/')}` : ''}`).join(' · ')} · ${words(turn.narration)} words_`,
      ''
    )
  }
  return out.join('\n')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const scenario = await loadScenario(options.scenario)
  const endpoint = await resolveEndpoint(options.endpoint)
  const model = options.model || endpoint.model
  if (!model) throw new Error(`Endpoint ${endpoint.name} names no model; pass --model`)
  const { notes } = await loadNotes(scenario.fixtureDir)

  /** @type {Record<string, string>} */
  const roles = {}
  for (const name of [
    'single',
    'planner',
    'narrator',
    'questioner',
    'draft',
    'referee',
    'reviser',
  ]) {
    roles[name] = await loadRole(name)
  }
  /** @type {Table} */
  const table = { endpoint, model, thinking: options.thinking, notes, roles }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outDir = join(options.out, `${stamp}-gm-${options.arch}`)
  await mkdir(outDir, { recursive: true })

  const meta = {
    arch: options.arch,
    scenario: scenario.name,
    fixture: basename(scenario.fixtureDir),
    endpoint: endpoint.name,
    model,
    thinking: options.thinking,
    rolesSha: createHash('sha256').update(JSON.stringify(roles)).digest('hex').slice(0, 12),
    started: new Date().toISOString(),
    /** @type {any[]} */
    runs: [],
  }

  process.stdout.write(
    `gm ${options.arch} on ${endpoint.name} / ${model}, thinking ${options.thinking ? 'on' : 'off'}\n`
  )
  process.stdout.write(`writing to ${outDir}\n\n`)

  for (let n = 1; n <= options.runs; n++) {
    const started = Date.now()
    /** @type {any} */
    const record = { n, started: new Date().toISOString(), turns: [] }
    /** @type {Exchange[]} */
    const history = []
    /** @type {TurnRecord[]} */
    const turns = []
    try {
      for (const [index, action] of scenario.messages.entries()) {
        const turnStarted = Date.now()
        const { stages, narration } = await TURNS[options.arch](table, history, action)
        const turn = { n: index + 1, action, stages, narration, ms: Date.now() - turnStarted }
        turns.push(turn)
        history.push({ action, narration })
        record.turns.push({
          n: turn.n,
          ms: turn.ms,
          words: words(narration),
          stages: stages.map(stage => ({
            role: stage.role,
            ms: stage.ms,
            rounds: stage.rounds,
            finish: stage.finish,
            usage: stage.usage,
            calls: stage.calls.map(call => call.name),
            preamble: Boolean(stage.preamble),
            empty: !stage.content,
            providers: stage.providers,
          })),
        })
        const calls = stages.flatMap(stage => stage.calls.map(call => call.name))
        const served = [...new Set(stages.flatMap(stage => stage.providers))]
        process.stdout.write(
          `  run ${n} turn ${turn.n}  ${seconds(turn.ms).padStart(7)}  ${String(words(narration)).padStart(4)} words  ${calls.length ? calls.join(', ') : 'no tools'}  ${served.join('/') || '?'}\n`
        )
      }
      record.durationMs = Date.now() - started
      await writeFile(
        join(outDir, `run-${n}.md`),
        render(turns, {
          title: `gm-${options.arch} — run ${n}`,
          lines: [
            `${endpoint.name} / ${model} · ${options.arch} · thinking ${options.thinking ? 'on' : 'off'} · ${seconds(record.durationMs)}`,
          ],
        })
      )
      await writeFile(join(outDir, `run-${n}.json`), JSON.stringify(turns, null, 2))
      process.stdout.write(`run ${n}/${options.runs}  ${seconds(record.durationMs)}\n`)
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error)
      record.durationMs = Date.now() - started
      process.stdout.write(
        `run ${n}/${options.runs}  failed after ${seconds(record.durationMs)}: ${record.error}\n`
      )
    } finally {
      meta.runs.push(record)
      await writeFile(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2))
    }
  }
  process.stdout.write(
    `\n${meta.runs.filter(run => !run.error).length}/${options.runs} runs written to ${outDir}\n`
  )
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    process.stderr.write(`${error.stack || error}\n`)
    process.exit(1)
  })
