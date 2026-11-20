/**
 * @module apps/tools
 * @description The tools a connected app is offered, and a call to one run.
 *
 * They are the document tools a chat's model has (`ai/tools/documents.js`),
 * by their names, each taking the project as well, since an app has several
 * where a chat has one, and `list_projects` for what those are. So far the
 * reading ones: listing, reading, describing and searching.
 *
 * A chat's model gets more than its tools: the project block on every turn,
 * and a conversation the app can see. An app's gets only what a call
 * answers, so a few things differ here, and the tools themselves are left
 * as they are, their wording having been tuned for the chat:
 *
 * - **A read always sends the text.** The app's context is its own, cut down
 *   and split among subagents out of our sight, so no call is handed the
 *   conversation, and none says a read is "still above".
 * - **The text comes as it is written**, in a part of the answer to itself
 *   after what is said about it, not as a string inside JSON: an edit quotes
 *   it exactly, and escaped line breaks and quotes get in the way of that.
 * - **Words written for outside.** Where a tool's description speaks of the
 *   project block or of tools an app isn't offered, the app is given another.
 *
 * Hidden documents are not in an app's project, as they are not in a
 * chat's: hiding keeps a document from models.
 */

import { toolRegistry } from '@/ai/tools/index.js'
import { findProject, inProject, projectsOf } from './projects.js'

/** @typedef {import('@/platform/apps.js').AskingApp} AskingApp */

/**
 * A tool as MCP lists it.
 *
 * @typedef {Object} AppTool
 * @property {string} name
 * @property {string} description
 * @property {Record<string, any>} inputSchema
 * @property {{readOnlyHint?: boolean}} [annotations]
 */

/**
 * What a call answers with, as MCP has it: text, in parts, and whether it is
 * an error for the app's model to read.
 *
 * @typedef {{content: Array<{type: 'text', text: string}>, isError?: true}} AppToolResult
 */

/** The tool that names an app's projects. */
export const LIST_PROJECTS = 'list_projects'

/**
 * The document tools that read. `explore_documents` is left out: it runs a
 * job on a model the writer pays for.
 */
const READING = ['list_documents', 'read_document', 'describe_document', 'search_documents']

/**
 * What a tool says of itself to an app, where what it says to a chat's model
 * wouldn't be true there: given what it says to the chat.
 * @type {Record<string, (chat: string) => string>}
 */
const SAID_OUTSIDE = {
  list_documents: chat =>
    chat.replace(
      'a description written for you from its text by explore_documents',
      'a description written from its text'
    ),
  read_document: () =>
    'Read a document. Its text comes after what is said about it, as it is written: Markdown. A document up to about 7,000 words comes whole; a longer one comes one slice at a time, with `next` for the offset to go on from and its top sections with their links. For a long document, look at its sections with describe_document first and read the ones you need with `section`, rather than paging through it. The open comments on what was read are listed after it, each with the passage it is on. The user may be writing in it: what a read gives is the text as it stood then. A source file in a repository comes with its line numbers, and is read by line with `line` and `until`.',
  describe_document: chat =>
    chat.replace(
      'Where explore_documents wrote a description of the document from its text',
      'Where a description of the document has been written from its text'
    ),
}

/** The argument every document tool takes of an app. */
const PROJECT = {
  type: 'string',
  description:
    'The project, by its name as list_projects gives it. Can be left out when there is only one.',
}

/** @type {AppTool} */
const LIST_PROJECTS_TOOL = {
  name: LIST_PROJECTS,
  description:
    'The projects in inksprite you can work in, each with its name and what the user says it is about. Every other tool takes a project by its name, as `project`.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
}

/**
 * The tools an app is offered.
 *
 * @param {AskingApp} _app - What it may do decides, once there is more than reading
 * @returns {AppTool[]}
 */
export function toolsFor(_app) {
  const reading = toolRegistry.getDefinitionsFor(READING).map(definition => {
    const { name, description, parameters } = definition.function
    const schema = /** @type {Record<string, any>} */ (parameters)
    return {
      name,
      description: SAID_OUTSIDE[name]?.(description) ?? description,
      inputSchema: { ...schema, properties: { project: PROJECT, ...schema.properties } },
      annotations: { readOnlyHint: true },
    }
  })
  return [LIST_PROJECTS_TOOL, ...reading]
}

/** @param {string} text */
const said = text => ({ type: /** @type {const} */ ('text'), text })

/**
 * What a tool returned, as an app is answered. Text is sent as it is. A
 * document's text is a part to itself, after what is said about it and
 * before its comments. What went wrong is marked as an error, for the app's
 * model to read and act on.
 *
 * @param {unknown} value
 * @returns {AppToolResult}
 */
export function toResult(value) {
  if (typeof value === 'string') return { content: [said(value)] }
  if (!value || typeof value !== 'object') return { content: [said(JSON.stringify(value ?? null))] }

  const answer = /** @type {Record<string, any>} */ (value)
  if (typeof answer.error === 'string') {
    const alone = Object.keys(answer).length === 1
    return { content: [said(alone ? answer.error : JSON.stringify(answer))], isError: true }
  }
  if (typeof answer.content === 'string') {
    const { content, comments, ...about } = answer
    return {
      content: [
        said(JSON.stringify(about)),
        said(content),
        ...(comments ? [said(JSON.stringify({ comments }))] : []),
      ],
    }
  }
  return { content: [said(JSON.stringify(answer))] }
}

/**
 * Run an app's call to a tool.
 *
 * @param {AskingApp} app
 * @param {string} name - One of `toolsFor(app)`
 * @param {Record<string, any>} args
 * @param {AbortSignal} signal - Aborted when the app gives up on the call
 * @returns {Promise<{result: AppToolResult}|{pass: 'elsewhere'|'behind'}>} The
 *   answer, or that another window is to run it: the one that has the project
 */
export async function callTool(app, name, args, signal) {
  if (name === LIST_PROJECTS) {
    const projects = await projectsOf(app)
    return {
      result: toResult({
        projects: projects.map(({ name: project, summary }) => ({
          name: project,
          ...(summary ? { summary } : {}),
        })),
      }),
    }
  }

  const { project: named, ...rest } = args
  const project = await findProject(app, named)
  if ('error' in project) return { result: toResult(project) }

  const tool = toolRegistry.tools.get(name)
  if (!tool) return { result: toResult({ error: `Unknown tool: ${name}` }) }
  const ran = await inProject(project.id, async () => {
    try {
      // The connection's own id where a chat's goes: no chat is found by
      // it, so only what is hidden outright is left out.
      return await tool.execute(rest, { storyId: project.id, chatId: `app:${app.id}`, signal })
    } catch (error) {
      console.error(`${name} failed for a connected app:`, error)
      return { error: `${name} couldn't be run.` }
    }
  })
  return 'pass' in ran ? ran : { result: toResult(ran.value) }
}
