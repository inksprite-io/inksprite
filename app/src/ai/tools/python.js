/**
 * @module ai/tools/python
 * @description `run_python`: Python the model runs code in, to work out sums,
 * odds, statistics, simulations and tables rather than do them in its head.
 *
 * In the desktop app only, in a session for each chat that keeps what its
 * runs define, fenced from the writer's data and the network
 * (platform/python.js, and `app/electron/src/sandbox.js` behind it). The
 * standard library, numpy and pandas, and nothing else.
 *
 * The chat's project is at `/project`, read-only, as the chat's model sees
 * it and only when it sees it at all (`projectForPython`): the code reads a
 * table from there rather than having it copied into the code. A file's text,
 * a PDF's, is beside it, and a file still only on the sync server is fetched
 * when the code reads it. A script kept in the project is run by its path
 * (`file`).
 *
 * Opted into, as the web is (web/config.js says why): a chat runs Python
 * while the Python extension is on and either the chat chose it
 * (`Chat.python`) or, until it does, its profile is one the extension lists.
 * See `pythonForChat`.
 *
 * Design: `.llm/code_sandbox_design.md`.
 */

import { fetchElsewhere, fileElsewhere } from '@/cloud/onDemand.js'
import { inPreview } from '@/config/preview.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { showsAsText } from '@/files/inspect.js'
import { hasPython, runPython } from '@/platform/python.js'
import { storage } from '@/storage/index.js'
import { useChatsStore } from '@/stores/chatsStore.js'
import { DEFAULT_PROFILE_ID } from '../profiles/index.js'
import { documentForChat, documentsForChat } from './documents.js'
import { toolRegistry } from './registry.js'

/** @typedef {import('@/platform/python.js').PythonProjectEntry} PythonProjectEntry */
/** @typedef {import('@/types/models.js').Document} Document */

/** The group the tool is switched by, and the extension's id. */
export const PYTHON_GROUP = 'python'

/** The tool's name. */
export const RUN_PYTHON = 'run_python'

/**
 * The time limits a writer can give a run, in seconds; 0 is none. Research
 * runs long, so the default is generous, and the chat's Stop stops a run
 * whatever its limit.
 */
export const PYTHON_TIME_LIMITS = [
  { label: '1 minute', seconds: 60 },
  { label: '10 minutes', seconds: 600 },
  { label: '1 hour', seconds: 3600 },
  { label: 'No limit', seconds: 0 },
]

/** What the call adds to the run's limit: Python starting, with time to spare. */
const START_MS = 60000

/**
 * How long a run may take, as the writer set it, or null for as long as it
 * takes.
 *
 * @returns {number|null} Milliseconds
 */
export function pythonTimeLimit() {
  const seconds = useApplicationState().pythonTimeLimit.value
  return seconds > 0 ? seconds * 1000 : null
}

/**
 * How long a call may take: the run's limit and Python starting. The run is
 * stopped at its own limit first, and says so. Infinity for none.
 *
 * @returns {number}
 */
export function pythonCallTimeout() {
  const limit = pythonTimeLimit()
  return limit === null ? Infinity : limit + START_MS
}

/** What the model is told when Python had to start again. */
const RESTARTED = 'Python started again: nothing the earlier runs defined is still there.'

/** Where Python finds the project. */
export const PROJECT_FOLDER = '/project'

/**
 * Tool definition in OpenAI format
 * @type {import('./registry.js').ToolDefinition}
 */
export const runPythonDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: RUN_PYTHON,
    description:
      'Run Python code and get back what it printed and the value of its last line. Use it for anything that has to be worked out: arithmetic, probabilities, statistics, simulations, tables, dates. Run the numbers here rather than reasoning them out, and answer from what comes back. There is the standard library, numpy and pandas, and nothing else, and no network. The project is at /project, read-only, by the paths list_documents gives: a text document as its Markdown, an imported file as the file itself (a CSV as the CSV). A file whose text was read out of it, such as a PDF, has that text beside it, at its path with .txt added, each PDF page under a [p.N] line. A document that holds others is a directory there, with the document in it under its own name, and a file’s text beside it in there too. A file not yet on this device is downloaded when it is read; an I/O error reading it means it couldn’t be. Read data from there rather than copying it into the code; make or change a document with the document tools. What a run defines (variables, functions, imports) stays for later runs in this chat, until a run is stopped. A run that goes past the time limit the writer set is stopped, and loses what it defined; memory is 4 GB at most. When the cases are few enough to count, count them exactly (itertools.product, fractions.Fraction); otherwise simulate with numpy, and say how many trials. A script worth running again can be kept in the project: create_document with a title ending in .py keeps it as written, and file runs it.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'Python 3 code. print() what you want to read; the value of the last line comes back too.',
        },
        file: {
          type: 'string',
          description:
            'Instead of code: the path of a Python script in the project, as list_documents gives it (e.g. "Simulations/d20.py"), run as it is now.',
        },
      },
    },
  },
}

/**
 * Whether Python is there to be offered: in the desktop app, with the AI on
 * and the extension switched on.
 *
 * @returns {boolean}
 */
export function pythonOffered() {
  if (!inPreview('python') || !hasPython()) return false
  const { aiEnabled, extensionOn } = useApplicationState()
  return aiEnabled.value && extensionOn(PYTHON_GROUP) === true
}

/**
 * The profiles whose chats run Python until they choose: as the writer chose
 * them, or Default alone.
 *
 * @returns {string[]}
 */
export function pythonProfiles() {
  return useApplicationState().pythonProfiles.value ?? [DEFAULT_PROFILE_ID]
}

/**
 * Run Python in chats on this profile, or stop.
 *
 * @param {string} profileId
 * @param {boolean} on
 */
export function setPythonProfile(profileId, on) {
  const others = pythonProfiles().filter(id => id !== profileId)
  useApplicationState().setPythonProfiles(on ? [...others, profileId] : others)
}

/**
 * Whether a chat runs Python: Python is offered, and the chat chose it, or,
 * until it chooses, its profile is one the extension lists.
 *
 * @param {{python?: boolean}|null|undefined} chat
 * @param {string} profileId - The chat's profile, the default resolved
 * @returns {boolean}
 */
export function pythonForChat(chat, profileId) {
  if (!pythonOffered()) return false
  return typeof chat?.python === 'boolean' ? chat.python : pythonProfiles().includes(profileId)
}

/**
 * What a run comes back to the model as: only the parts there are.
 *
 * @typedef {Object} PythonResult
 * @property {string} [stdout]
 * @property {string} [stderr]
 * @property {string} [value] - The `repr` of the last line's value
 * @property {string} [error] - The traceback, or why the run was stopped
 * @property {string} [restarted] - Said when what earlier runs defined is gone
 * @property {string} [note] - Where a path of the project the code was refused
 *   is, when it took it as the tools give it
 */

/**
 * A title as a name in Python's file system: without a slash, which would
 * make it two, and not a name that means a folder already.
 *
 * @param {string} title
 */
const nameOf = title => {
  const name = title.replace(/[/\0]/g, '_')
  return name === '.' || name === '..' ? '_' : name
}

/**
 * Whether a chat's model sees the project: whether it is offered any of the
 * document tools. Python sees what the model would, and nothing when the
 * model sees nothing.
 *
 * @param {string|null|undefined} chatId
 */
function seesProject(chatId) {
  const chat = chatId ? useChatsStore().getChatById(chatId) : null
  return toolRegistry
    .getEnabledDefinitions({
      disabledTools: chat?.disabledTools,
      disabledGroups: chat?.disabledToolGroups,
    })
    .some(definition => toolRegistry.groupOf(definition.function.name) === 'documents')
}

/** What is added to a file's path for the text read out of it. */
export const TEXT_BESIDE = '.txt'

/**
 * What a document is to Python: its text, or the file it was imported as,
 * where that is on the disk, or by its size where it is still only on the
 * sync server, to be fetched when it is read; a file of text whose bytes
 * aren't here, its text. Null for a file that is none of these.
 *
 * @param {Document} document
 * @param {string} path
 * @returns {Promise<PythonProjectEntry|null>}
 */
async function entryOf(document, path) {
  if (document.type === 'folder') return { path, folder: true }
  const { id } = document
  const text = { path, id, text: document.content || '' }
  if (document.type === 'text') return text
  const ofText = showsAsText(document.mime || '')
  if (await fileElsewhere(id)) {
    if (ofText) return text
    return typeof document.size === 'number'
      ? { path, id, size: document.size, onServer: true }
      : null
  }
  const file = await storage.filePath(id)
  if (file) return { path, id, file }
  return ofText ? text : null
}

/**
 * The text read out of an imported file that isn't text itself, a PDF's
 * page by page, as Python finds it beside the file; null for one with none.
 *
 * @param {Document} document
 * @param {string} path - The file's
 * @returns {PythonProjectEntry|null}
 */
function textBeside(document, path) {
  if (document.type !== 'file' || showsAsText(document.mime || '') || !document.content) return null
  return { path: path + TEXT_BESIDE, id: document.id + TEXT_BESIDE, text: document.content }
}

/**
 * The project as a chat's Python reads it at `/project`: what the chat's
 * model sees of it, by the same paths, or null when it sees none of it. A
 * document that holds others is a directory there, as it is in the library,
 * with the document in it under its own name, so that every path below it
 * is the one the tools give. A file's text is beside it unless a document
 * of the project is there.
 *
 * @param {import('./registry.js').ToolContext} [context]
 * @returns {Promise<PythonProjectEntry[]|null>}
 */
export async function projectForPython(context) {
  if (!context?.storyId || !seesProject(context.chatId)) return null
  const listed = (await documentsForChat(context.storyId, context.chatId)).filter(
    ({ titles }) => titles.length > 0
  )
  const holding = new Set(listed.map(({ document }) => document.parentId))
  const seen = listed.map(({ document, titles }) => {
    const path = titles.map(nameOf).join('/')
    const holds = document.type !== 'folder' && holding.has(document.id)
    return { document, path: holds ? `${path}/${nameOf(titles[titles.length - 1])}` : path }
  })
  const taken = new Set(seen.map(({ path }) => path))
  const entries = await Promise.all(
    seen.map(async ({ document, path }) => {
      const beside = textBeside(document, path)
      return [await entryOf(document, path), beside && !taken.has(beside.path) ? beside : null]
    })
  )
  return entries.flat().filter(entry => entry !== null)
}

/**
 * Where a path of the project is that the code was refused, as no file or
 * as a directory, when it took a document's path as the tools give it: one
 * that holds others is a directory here, with the document, and the text
 * read out of it, in it under its own name; and a text has no extension.
 * Null when the run names no such path.
 *
 * @param {string} error - The run's traceback, or what it printed
 * @param {PythonProjectEntry[]} project
 * @returns {string|null}
 */
export function pathNote(error, project) {
  const refused = [
    ...error.matchAll(/(?:No such file or directory|Is a directory): (['"])\/project\/(.+?)\1/g),
  ].pop()
  if (!refused) return null
  const asked = refused[2]
  const folders = new Set(project.filter(entry => 'folder' in entry).map(({ path }) => path))
  const there = new Set(project.map(({ path }) => path))
  /** Where a document that holds others is, under its own name in its directory. */
  const inside = (/** @type {string} */ path) =>
    folders.has(path) ? null : `${path}/${path.slice(path.lastIndexOf('/') + 1)}`
  const bare = asked.replace(/\.md$/, '')
  const held = inside(bare)
  if (held && there.has(held)) {
    return `/project/${bare} is a directory, since that document holds others: the document itself is /project/${held}.`
  }
  if (asked.endsWith(TEXT_BESIDE)) {
    const file = inside(asked.slice(0, -TEXT_BESIDE.length))
    if (file && there.has(file + TEXT_BESIDE)) {
      return `That text is /project/${file}${TEXT_BESIDE}: the file holds others, so it and its text are in a directory of its name.`
    }
  }
  if (bare !== asked && there.has(bare)) {
    return `A text has no extension here: it is /project/${bare}.`
  }
  return null
}

/**
 * Bring a file of the project still only on the sync server into the
 * library, as a run reads it, and say where it is there: null when it
 * couldn't be fetched.
 *
 * @param {string} id - The file document's
 * @returns {Promise<string|null>}
 */
export async function fetchForPython(id) {
  try {
    await fetchElsewhere(id)
  } catch {
    return null
  }
  return storage.filePath(id)
}

/**
 * The script a run names: its text as the chat reads it, and what its
 * traceback calls it.
 *
 * @param {string} path - As list_documents gives it, or under `/project`
 * @param {import('./registry.js').ToolContext} context
 * @returns {Promise<{code: string, filename: string}|{error: string}>}
 */
async function scriptAt(path, context) {
  const asked = path.replace(new RegExp(`^${PROJECT_FOLDER}/`), '')
  const found = context.storyId
    ? await documentForChat(context.storyId, context.chatId, asked)
    : null
  const document = found?.document
  if (!found || !document || document.type === 'folder') {
    return { error: `There is no script at ${path}.` }
  }
  if (document.type === 'file' && !showsAsText(document.mime || '')) {
    return { error: `${found.path} isn’t text.` }
  }
  return { code: document.content || '', filename: `${PROJECT_FOLDER}/${found.path}` }
}

/**
 * Run the model's code, or a script of the project's, in the chat's Python,
 * with the project at `/project`.
 *
 * @param {{code?: unknown, file?: unknown}} args
 * @param {import('./registry.js').ToolContext} [context]
 * @returns {Promise<PythonResult>}
 */
export async function executeRunPython(args, context) {
  const code = typeof args?.code === 'string' && args.code.trim() ? args.code : ''
  const file = typeof args?.file === 'string' ? args.file.trim() : ''
  if (code && file) return { error: 'Give code or a file to run, not both.' }
  if (!code && !file) return { error: 'There is no code to run.' }
  if (!hasPython()) return { error: 'Python runs only in the desktop app.' }

  const project = await projectForPython(context)
  /** @type {{code: string, filename: string|null}} */
  let script = { code, filename: null }
  if (file) {
    if (!project || !context) return { error: 'This chat doesn’t see the project.' }
    const found = await scriptAt(file, context)
    if ('error' in found) return found
    script = found
  }

  let ran
  try {
    ran = await runPython(context?.chatId || 'chat', script.code, {
      signal: context?.signal,
      timeoutMs: pythonTimeLimit(),
      project,
      filename: script.filename,
      fetchFile: fetchForPython,
    })
  } catch (error) {
    return { error: `Python couldn't be reached. ${error.message}` }
  }

  /** @type {PythonResult} */
  const result = {}
  if (ran.stdout) result.stdout = ran.stdout
  if (ran.stderr) result.stderr = ran.stderr
  if (ran.value !== null) result.value = ran.value
  if (ran.error !== null) result.error = ran.error
  // Refused in what it printed as well, where the code caught the error.
  const said = [ran.error, ran.stdout, ran.stderr].filter(Boolean).join('\n')
  const note = said && project ? pathNote(said, project) : null
  if (note) result.note = note
  if (ran.restarted) result.restarted = RESTARTED
  return Object.keys(result).length > 0 ? result : { stdout: '' }
}
