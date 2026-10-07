/**
 * @module harness/run
 * @description Chat as the app runs it, from the terminal, written to files.
 *
 * A scenario names a fixture project and what the writer says. Each run
 * builds the project fresh, opens a chat on the prompt under test, sends the
 * messages through the same `useAIChat` the composer sends them through, and
 * writes what came back: the transcript to read, the messages as stored, the
 * requests the app made, and everything it logged on the way.
 *
 * @example
 * npm run transcripts -- --scenario riley-noah-argument --runs 5
 * npm run transcripts -- --scenario riley-noah-argument --endpoint lmstudio --prompt harness/prompts/minimal.md
 */

import './environment.js'
import { requests, requestsSettled, resetRequests } from './environment.js'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'node:util'
import { resolveEndpoint } from './endpoints.js'
import { seedProject, seedSkills } from './seed.js'
import { renderTranscript, wordCount } from './transcript.js'
import { useAIProvidersStore } from '@/stores/aiProvidersStore.js'
import { useAIPresetStore } from '@/stores/aiPresetStore.js'
import { useApplicationState } from '@/composables/useApplicationState.js'
import { useChats } from '@/composables/useChats.js'
import { useChatsStore } from '@/stores/chatsStore.js'
import { useDocuments } from '@/composables/useDocuments.js'
import { useDocumentsStore } from '@/stores/documentsStore.js'
import { useProfiles } from '@/composables/useProfiles.js'
import { useAIChat } from '@/composables/useAIChat.js'
import { CHAT_PROMPT_ID, DEFAULT_CHAT_PROMPT, isBuiltInPromptId } from '@/ai/prompts/index.js'
import { isBuiltInProfileId } from '@/ai/profiles/index.js'
import { resolveRouting } from '@/ai/routing.js'
import '@/ai/tools/index.js'
import { toolRegistry } from '@/ai/tools/registry.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * @typedef {Object} Options
 * @property {string} [scenario] - Scenario name under scenarios/, or a path
 * @property {number} runs
 * @property {string} [endpoint] - Name in scripts/endpoints.local.json
 * @property {string} [model] - Overrides the endpoint's model
 * @property {string} [prompt] - Built-in prompt or profile id, or a path to a markdown file
 * @property {string} [descriptions] - A JSON file of tool descriptions to run under,
 *   tool name to description, in place of the ones in the code
 * @property {string} out - Where batches are written
 * @property {boolean} tools - Whether the model is offered tools
 */

/**
 * @param {string[]} argv
 * @returns {Options}
 */
function parseArgs(argv) {
  /** @type {Options} */
  const options = { runs: 1, out: join(HERE, 'runs'), tools: true }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next === undefined) throw new Error(`${arg} needs a value`)
      return next
    }

    switch (arg) {
      case '--scenario':
      case '-s':
        options.scenario = value()
        break
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
      case '--prompt':
      case '-p':
        options.prompt = value()
        break
      case '--descriptions':
      case '-d':
        options.descriptions = resolve(value())
        break
      case '--out':
      case '-o':
        options.out = resolve(value())
        break
      case '--no-tools':
        options.tools = false
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

  if (!options.scenario) throw new Error(`--scenario is required\n${USAGE}`)
  if (!Number.isInteger(options.runs) || options.runs < 1) {
    throw new Error('--runs must be a whole number of at least 1')
  }
  return options
}

const USAGE = `
Usage: npm run transcripts -- --scenario <name> [options]

  -s, --scenario <name|path>  Scenario under harness/scenarios/, or a path to one
  -n, --runs <n>              How many times to run it (default: 1)
  -e, --endpoint <name>       Endpoint from scripts/endpoints.local.json (default: the first)
  -m, --model <id>            Model to run, overriding the endpoint's
  -p, --prompt <id|path>      System prompt: builtin_chat, builtin_roleplay, a built-in profile
                              such as builtin_profile_roleplay, or a markdown file
                              (default: the built-in chat prompt)
  -d, --descriptions <file>   JSON of tool name to description, to run the tools under
                              other descriptions than the code's (see harness/descriptions/)
  -o, --out <dir>             Where to write the batch (default: harness/runs)
      --no-tools              Offer the model no tools
`

/**
 * @typedef {Object} Scenario
 * @property {string} name
 * @property {string} fixture - Fixture folder name under fixtures/, or a path
 * @property {Array<string|Turn>} messages - What the writer says, one turn each:
 *   the words, or the words with what the turn is expected to do, which
 *   `tools.js` checks afterwards
 * @property {string} [prompt] - Prompt or profile under test, when the scenario names one
 * @property {ChatSettings} [chat] - Settings put on the chat before the first turn
 * @property {string[]} [skills] - Skills to put in the writer's library before the
 *   first run: folder names under skills/, or paths relative to the scenario,
 *   each holding a SKILL.md and its files. See seedSkills in seed.js.
 *
 * @typedef {Object} Turn
 * @property {string} text - What the writer says
 * @property {{edit?: {path: string, old: string, new: string}, pin?: string[]}} [before] - What
 *   the writer does before saying it: `edit`, one passage of a document
 *   replaced as if typed in the editor, which has to be there to replace; `pin`,
 *   documents pinned for the chat from the outline
 * @property {boolean} [noWrites] - The turn should change nothing
 * @property {string[]} [findsAny] - At least one of these should be read or found
 * @property {string[]} [mentions] - Regex sources the reply should match
 * @property {string[]} [reads] - Documents the turn should have to hand
 * @property {string[]} [readsAgain] - Documents the turn should read now
 * @property {string[]} [notRead] - Documents the turn should not read
 * @property {boolean} [noRereads] - The turn should read nothing it already has
 * @property {string[]} [calls] - Tools the turn should call
 * @property {string[]} [finds] - Documents the turn should read or turn up in a search
 * @property {string[]} [pins] - Documents that should be pinned once the turn is done
 * @property {string[]} [pinnedAtEnd] - The whole pinned set once the turn is done
 * @property {{path: string, contains: string[]}} [document] - What a document should hold afterwards
 * @property {{path: string, patterns: string[]}} [notContains] - What it should not
 * @property {{path: string, contains: string[]}} [summary] - What its summary should say
 *
 * @typedef {Object} ChatSettings
 * @property {boolean} [directorEnabled] - Consult the Director before the assistant writes
 * @property {string[]} [disabledTools] - Tool names withheld from the chat
 * @property {string[]} [disabledToolGroups] - Group ids withheld: documents, rpg, skills
 * @property {boolean} [projectContextEnabled] - Whether the project block rides at the tail
 */

/**
 * @param {string} ref - Name under scenarios/, or a path
 * @returns {Promise<Scenario & {fixtureDir: string, skillDirs: string[]}>}
 */
async function loadScenario(ref) {
  const file = ref.endsWith('.json') ? resolve(ref) : join(HERE, 'scenarios', `${ref}.json`)
  const scenario = JSON.parse(await readFile(file, 'utf8'))
  if (!scenario.fixture) throw new Error(`${file} names no fixture`)
  if (!Array.isArray(scenario.messages) || scenario.messages.length === 0) {
    throw new Error(`${file} has no messages`)
  }
  const fixtureDir = scenario.fixture.includes('/')
    ? resolve(dirname(file), scenario.fixture)
    : join(HERE, 'fixtures', scenario.fixture)
  const skillDirs = (scenario.skills || []).map((/** @type {string} */ skill) =>
    skill.includes('/') ? resolve(dirname(file), skill) : join(HERE, 'skills', skill)
  )
  return { name: basename(file, '.json'), ...scenario, fixtureDir, skillDirs }
}

/**
 * @typedef {Object} PromptUnderTest
 * @property {string|null} id - Profile to start the chat on; null starts it on
 *   the project's default, the way a chat opened in the app starts
 * @property {string} source - Where it came from, for the record
 * @property {string} content
 */

/**
 * The system prompt the chat runs on.
 *
 * A prompt belongs to a profile, so a file is saved as a profile of the
 * writer's own with that prompt and nothing else on it — what a saved prompt
 * became when the library became profiles — and the chat starts on it like any
 * other. A built-in prompt id names the profile built around it, and a profile
 * id names that profile, tool switches and rules included.
 *
 * @param {string} [ref] - Built-in prompt or profile id, or a path to a markdown file
 * @returns {Promise<PromptUnderTest>}
 */
async function resolvePrompt(ref) {
  if (!ref) {
    return {
      id: null,
      source: `${CHAT_PROMPT_ID} (src/ai/prompts/chat.md)`,
      content: DEFAULT_CHAT_PROMPT,
    }
  }
  const profiles = useProfiles()
  await profiles.ready()
  if (isBuiltInPromptId(ref) || isBuiltInProfileId(ref)) {
    const id = isBuiltInProfileId(ref) ? ref : `builtin_profile_${ref.slice('builtin_'.length)}`
    const profile = profiles.getProfile(id)
    if (!profile) throw new Error(`No built-in prompt or profile ${ref}`)
    return { id: profile.id, source: ref, content: profile.settings.prompt }
  }
  const file = resolve(ref)
  const content = (await readFile(file, 'utf8')).trim()
  const saved = profiles.saveProfile(`harness: ${basename(file)}`, { prompt: content })
  return { id: saved.id, source: file, content }
}

/**
 * The connection and preset the chat sends through, made active.
 *
 * @param {import('./endpoints.js').Endpoint} endpoint
 * @param {string} model
 * @param {boolean} toolsEnabled
 */
async function configurePreset(endpoint, model, toolsEnabled) {
  const providers = useAIProvidersStore()
  const presets = useAIPresetStore()
  const provider = providers.createProvider({
    id: 'provider_harness',
    name: endpoint.name,
    type: endpoint.type,
    endpoint: endpoint.endpoint,
    apiKey: endpoint.apiKey,
    // Resolved by the app on every request, so an entry with no routing block
    // still sends the privacy floor.
    routing: endpoint.routing ? resolveRouting(endpoint.routing) : undefined,
  })
  const preset = presets.createPreset({
    id: 'profile_harness',
    name: `${endpoint.name} ${model}`,
    providerId: provider.id,
    model,
    allowedProviders: endpoint.allowedProviders,
    toolsEnabled,
  })
  useApplicationState().setActiveAIPresetId(preset.id)
}

/**
 * Send the app's console into a list for the run's log, and hand back the
 * way to put it back.
 *
 * @param {string[]} lines
 * @returns {() => void}
 */
function captureConsole(lines) {
  const levels = /** @type {const} */ (['log', 'info', 'debug', 'warn', 'error'])
  const original = Object.fromEntries(levels.map(level => [level, console[level]]))
  const started = Date.now()
  for (const level of levels) {
    console[level] = (/** @type {any[]} */ ...args) => {
      const at = String(Date.now() - started).padStart(6)
      lines.push(`[${at}ms] [${level}] ${format(...args)}`)
    }
  }
  return () => Object.assign(console, original)
}

/** @param {string} text */
const say = text => process.stdout.write(`${text}\n`)

/**
 * @param {import('@/types/models.js').Message[]} messages
 * @returns {{promptTokens: number, completionTokens: number, requests: number}}
 */
function totalUsage(messages) {
  const total = { promptTokens: 0, completionTokens: 0, requests: 0 }
  for (const message of messages) {
    const usage = message.metadata?.usage
    if (!usage) continue
    total.promptTokens += usage.promptTokens || 0
    total.completionTokens += usage.completionTokens || 0
    total.requests += usage.requests || 0
  }
  return total
}

/** @param {number} ms */
const seconds = ms => `${(ms / 1000).toFixed(1)}s`

/**
 * Run the tools under other descriptions than the code's.
 *
 * A description is the one text that reaches the model under every profile,
 * and it is code, so trying a different one has meant a commit per variant.
 * A file of tool name to description is applied to the registry before the
 * first turn, and the batch records which file and its hash.
 *
 * @param {string} file
 * @returns {Promise<{source: string, sha256: string, tools: string[]}>}
 */
async function applyDescriptions(file) {
  const text = await readFile(file, 'utf8')
  /** @type {Record<string, string>} */
  const overrides = JSON.parse(text)
  const applied = []
  for (const [name, description] of Object.entries(overrides)) {
    const tool = toolRegistry.tools.get(name)
    if (!tool) throw new Error(`${file} describes a tool the app does not have: ${name}`)
    tool.definition.function.description = description
    applied.push(name)
  }
  return {
    source: file,
    sha256: createHash('sha256').update(text).digest('hex').slice(0, 12),
    tools: applied,
  }
}

/** The commit the code under test is at, for the batch's record. */
function currentCommit() {
  try {
    const dirty = execSync('git status --porcelain', { cwd: HERE, encoding: 'utf8' }).trim()
    const hash = execSync('git rev-parse --short HEAD', { cwd: HERE, encoding: 'utf8' }).trim()
    return dirty ? `${hash}+` : hash
  } catch {
    return undefined
  }
}

/**
 * The project and the chat's pins as they stand, for `tools.js` to check
 * what a turn did to them. Every text document, by path.
 *
 * @param {string} storyId
 * @param {string} chatId
 */
function snapshot(storyId, chatId) {
  const api = useDocuments(storyId)
  const store = useDocumentsStore()
  const chat = useChatsStore().getChatById(chatId)
  /** @type {Record<string, {content: string, summary: string}>} */
  const documents = {}
  for (const document of store.documents.values()) {
    if (document.storyId !== storyId || document.type === 'folder') continue
    documents[api.pathOf(document.id)] = {
      content: document.content || '',
      summary: document.summary || '',
    }
  }
  return {
    pinned: (chat?.pinnedIds || []).map(id => api.pathOf(id)).filter(Boolean),
    documents,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const scenario = await loadScenario(options.scenario)
  const endpoint = await resolveEndpoint(options.endpoint)
  const model = options.model || endpoint.model
  if (!model) throw new Error(`Endpoint ${endpoint.name} names no model; pass --model`)
  const prompt = await resolvePrompt(options.prompt || scenario.prompt)
  const descriptions = options.descriptions ? await applyDescriptions(options.descriptions) : null
  // Before the descriptions are read off the registry by anything: a skill
  // the model can load changes what `use_skill` says.
  const skills = await seedSkills(scenario.skillDirs)
  await configurePreset(endpoint, model, options.tools)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outDir = join(options.out, `${stamp}-${scenario.name}`)
  await mkdir(outDir, { recursive: true })

  const meta = {
    scenario: scenario.name,
    fixture: basename(scenario.fixtureDir),
    endpoint: endpoint.name,
    model,
    tools: options.tools,
    prompt: {
      source: prompt.source,
      sha256: createHash('sha256').update(prompt.content).digest('hex').slice(0, 12),
    },
    // The tool definitions are code, so the commit says what they were —
    // unless a descriptions file stood in for some of them.
    commit: currentCommit(),
    ...(descriptions ? { descriptions } : {}),
    ...(skills.length ? { skills } : {}),
    messages: scenario.messages,
    started: new Date().toISOString(),
    /** @type {any[]} */
    runs: [],
  }

  say(`${scenario.name} on ${endpoint.name} / ${model}`)
  say(`prompt ${meta.prompt.source} (${meta.prompt.sha256}), tools ${options.tools ? 'on' : 'off'}`)
  if (descriptions) {
    say(
      `descriptions ${descriptions.source} (${descriptions.sha256}): ${descriptions.tools.join(', ')}`
    )
  }
  if (skills.length) say(`library ${skills.map(skill => skill.name).join(', ')}`)
  say(`writing to ${outDir}`)
  say('')

  for (let n = 1; n <= options.runs; n++) {
    /** @type {string[]} */
    const log = []
    const restore = captureConsole(log)
    const started = Date.now()
    /** @type {any} */
    const record = { n, started: new Date().toISOString() }

    try {
      const { storyId } = await seedProject(scenario.fixtureDir)
      const chatsApi = useChats(storyId)
      await chatsApi.init()
      // Stamped from the profile under test, the way the app stamps one, so
      // a profile's tool switches and rules arrive with its prompt.
      const chat = chatsApi.createChat(undefined, prompt.id || undefined)
      if (!chat) throw new Error('Failed to create a chat')
      // Whatever else the scenario puts on the chat: the Director, the tool
      // switches. Everything a writer sets in the chat's own settings is a
      // variable of the experiment, not a fixed part of it.
      const settings = { ...(scenario.chat || {}) }
      if (Object.keys(settings).length > 0) chatsApi.updateChat(chat.id, settings)

      resetRequests()
      const ai = useAIChat(storyId, chat.id)
      /** @type {any[]} The project after each turn */
      const states = []
      for (const message of scenario.messages) {
        // The writer's own change to a document between turns, so a later
        // turn is working from a project that moved under it.
        const edit = typeof message === 'string' ? undefined : message.before?.edit
        if (edit) {
          const api = useDocuments(storyId)
          const target = [...useDocumentsStore().documents.values()].find(
            document => document.storyId === storyId && api.pathOf(document.id) === edit.path
          )
          if (!target) throw new Error(`No document at ${edit.path} to edit before the turn`)
          const { applied } = api.replaceText(target.id, edit.old, edit.new)
          if (!applied) throw new Error(`The writer's edit to ${edit.path} did not apply`)
        }
        // The writer's pins, made from the outline before saying it.
        const pins = typeof message === 'string' ? undefined : message.before?.pin
        if (pins?.length) {
          const api = useDocuments(storyId)
          const ids = pins.map(path => {
            const target = [...useDocumentsStore().documents.values()].find(
              document => document.storyId === storyId && api.pathOf(document.id) === path
            )
            if (!target) throw new Error(`No document at ${path} to pin before the turn`)
            return target.id
          })
          const current = chatsApi.getChatById(chat.id)?.pinnedIds || []
          chatsApi.updateChat(chat.id, { pinnedIds: [...new Set([...current, ...ids])] })
        }
        await ai.sendMessage(typeof message === 'string' ? message : message.text)
        states.push(snapshot(storyId, chat.id))
      }
      await writeFile(join(outDir, `state-${n}.json`), JSON.stringify(states, null, 2))
      await requestsSettled()

      const messages = chatsApi.getMessagesForChat(chat.id)?.value || []
      const last = [...messages].reverse().find(message => message.role === 'assistant')
      const usage = totalUsage(messages)
      const durationMs = Date.now() - started
      // Counted off the wire rather than the stored trajectory, because a
      // consultation's calls are never stored: the last request of a turn
      // carries every tool result the turn produced.
      const calls = requests.reduce(
        (most, request) =>
          Math.max(
            most,
            (request.body?.messages || []).filter(message => message.role === 'tool').length
          ),
        0
      )

      await writeFile(
        join(outDir, `run-${n}.md`),
        renderTranscript(messages, {
          title: `${scenario.name} — run ${n}`,
          lines: [
            `${endpoint.name} / ${model} · prompt ${meta.prompt.sha256} · ${seconds(durationMs)}`,
          ],
        })
      )
      await writeFile(join(outDir, `run-${n}.json`), JSON.stringify(messages, null, 2))
      await writeFile(join(outDir, `requests-${n}.json`), JSON.stringify(requests, null, 2))

      // Which upstream served each request, in order. A run whose provider
      // changed between its title call and its turn is worth knowing about.
      const providers = requests.map(request => request.provider || '?')
      Object.assign(record, {
        chatId: chat.id,
        durationMs,
        usage,
        toolCalls: calls,
        words: wordCount(last?.content || ''),
        providers,
      })
      say(
        `run ${n}/${options.runs}  ${seconds(durationMs).padStart(7)}  ${String(calls).padStart(2)} tool calls  ${String(record.words).padStart(5)} words  ${usage.promptTokens}+${usage.completionTokens} tokens  ${[...new Set(providers)].join('/')}`
      )
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error)
      record.durationMs = Date.now() - started
      say(`run ${n}/${options.runs}  failed after ${seconds(record.durationMs)}: ${record.error}`)
    } finally {
      restore()
      await writeFile(join(outDir, `log-${n}.txt`), log.join('\n'))
      meta.runs.push(record)
      await writeFile(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2))
    }
  }

  say('')
  say(`${meta.runs.filter(run => !run.error).length}/${options.runs} runs written to ${outDir}`)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    process.stderr.write(`${error.stack || error}\n`)
    process.exit(1)
  })
