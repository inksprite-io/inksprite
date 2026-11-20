/**
 * @module apps/tools
 * @description The tools a connected app is offered, and a call to one run.
 *
 * They are the document tools a chat's model has (`ai/tools/documents.js`),
 * by their names, each taking the project as well, since an app has several
 * where a chat has one, and `list_projects` for what those are. Which an app
 * is offered is its connection's to say, by what the tools do with the
 * documents, as a profile says it: it reads them always, edits them where
 * the connection edits, and comments on them where it comments.
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
 *   project block, the chat, or tools an app isn't offered, the app is given
 *   another.
 * - **Several edits in a call, and how the text was stored** (`./writes.js`).
 * - **A revision on every read and write, and what changed since one**
 *   (`./revisions.js`): what a chat's model is told on every turn of the
 *   documents it read, an app asks for.
 * - **A connection is who its comments are by**: its posts are a model's
 *   under the connection's name, which the Comments tab and other readers
 *   show.
 *
 * - **Suggesting is of text.** A connection that suggests has its changes
 *   to a document's text laid out in the text, each for the writer to accept
 *   or reject, as a chat that asks first has its. What such a chat proposes
 *   in the chat, an app has no chat for: a new document, a delete, a move, a
 *   rename, a change to a plain document and a comment all go ahead in
 *   either mode. The trash and a document's versions take them back.
 *
 * Hidden documents are not in an app's project, as they are not in a
 * chat's: hiding keeps a document from models.
 */

import { toolRegistry } from '@/ai/tools/index.js'
import { SUGGESTED_NOTE, documentForChat } from '@/ai/tools/documents.js'
import { findProject, inProject, projectsOf } from './projects.js'
import { answeringStored, editMany } from './writes.js'
import { changesSince, unchangedAt, withRevision } from './revisions.js'

/** @typedef {import('@/platform/apps.js').AskingApp} AskingApp */

/**
 * A tool as MCP lists it.
 *
 * @typedef {Object} AppTool
 * @property {string} name
 * @property {string} description
 * @property {Record<string, any>} inputSchema
 * @property {{readOnlyHint?: boolean, destructiveHint?: boolean}} [annotations]
 */

/**
 * What a call answers with, as MCP has it: text, in parts, and whether it is
 * an error for the app's model to read.
 *
 * @typedef {{content: Array<{type: 'text', text: string}>, isError?: true}} AppToolResult
 */

/** The tool that names an app's projects. */
export const LIST_PROJECTS = 'list_projects'

/** The tool that says what changed since a revision an app holds. */
export const CHANGES_SINCE = 'changes_since'

/**
 * The document tools that read. `explore_documents` is left out: it runs a
 * job on a model the writer pays for.
 */
const READING = ['list_documents', 'read_document', 'describe_document', 'search_documents']

/** Those that change the documents, for a connection that edits. */
const EDITING = [
  'create_document',
  'create_folder',
  'update_document',
  'edit_document',
  'append_document',
  'move_document',
  'delete_document',
]

/** Those that comment, for a connection that comments. */
const COMMENTING = ['list_comments', 'add_comment', 'reply_comment', 'resolve_comment']

/** Those that change nothing. */
const READ_ONLY = new Set([...READING, 'list_comments'])

/** Those that only add, and take nothing away. */
const ADDING = new Set([
  'create_document',
  'create_folder',
  'append_document',
  'add_comment',
  'reply_comment',
])

/** Those that write a document's text, whose answer says how it was stored. */
const WRITES_TEXT = new Set([
  'create_document',
  'update_document',
  'edit_document',
  'append_document',
])

/** Those that say something on a document's comments. */
const SAYS = new Set(['add_comment', 'reply_comment', 'resolve_comment'])

/** Those that change the text of a document that is there: what a connection that suggests suggests. */
const CHANGES_TEXT = new Set(['update_document', 'edit_document', 'append_document'])

/**
 * What a suggestion's answer says to a connection that doesn't comment, and
 * so has no way to say why on it.
 */
const SUGGESTED_NOTE_NO_COMMENT = SUGGESTED_NOTE.replace(
  ' To say why, reply_comment on its id.',
  ''
)

/**
 * A text with a sentence taken out of it.
 * @param {string} text
 * @param {string} sentence
 */
const without = (text, sentence) => text.replace(`${sentence} `, '').replace(sentence, '')

/** What `edit_document` says of itself to an app, which may send several edits. */
const EDIT_OUTSIDE =
  "Change passages of a document, leaving the rest exactly as it is. Give a passage as it reads now (`old`) and what it should read instead (`new`); for several changes, give them as `edits`, which are made in order and all together or not at all. This is how to revise: it sends only what changes, so prefer it over update_document for anything short of a rewrite. A passage has to match the document exactly and exactly once, so quote it as read_document gave it and include enough of it to be unique; with `all`, every place it appears is changed, as for a term renamed. The writer's comment markup can be left out. A comment whose highlighted words an edit changes is resolved with it, and the result lists any it resolved; a comment whose words come through unchanged stays on them."

/**
 * What a tool says of itself to an app, where what it says to a chat's model
 * wouldn't be true there: given the tool as the chat has it, the description
 * or the parameters that differ.
 * @type {Record<string, (chat: {description: string, parameters: Record<string, any>}) => {description?: string, parameters?: Record<string, any>}>}
 */
const SAID_OUTSIDE = {
  list_documents: ({ description }) => ({
    description: description.replace(
      'a description written for you from its text by explore_documents',
      'a description written from its text'
    ),
  }),
  read_document: ({ parameters }) => ({
    description:
      'Read a document. Its text comes after what is said about it, as it is written: Markdown. A document up to about 7,000 words comes whole; a longer one comes one slice at a time, with `next` for the offset to go on from and its top sections with their links. For a long document, look at its sections with describe_document first and read the ones you need with `section`, rather than paging through it. The open comments on what was read are listed after it, each with the passage it is on. The user may be writing in it: what a read gives is the text as it stood then, and its `revision`, which changes_since takes to say what has changed since. A source file in a repository comes with its line numbers, and is read by line with `line` and `until`.',
    parameters: {
      ...parameters,
      properties: {
        ...parameters.properties,
        revision: {
          type: 'string',
          description:
            'The revision you hold of the document, from an earlier read or write. When it is still at that revision, the answer says so and the text is not sent again.',
        },
      },
    },
  }),
  describe_document: ({ description }) => ({
    description: description.replace(
      'Where explore_documents wrote a description of the document from its text',
      'Where a description of the document has been written from its text'
    ),
  }),
  edit_document: ({ parameters }) => {
    const { path, old, new: becomes } = parameters.properties
    const all = {
      type: 'boolean',
      description:
        'Change every place the passage appears, not only one: for a term renamed. Without it, a passage that appears more than once is refused.',
    }
    return {
      description: EDIT_OUTSIDE,
      parameters: {
        type: 'object',
        properties: {
          path,
          old,
          new: becomes,
          all,
          edits: {
            type: 'array',
            description:
              'Several changes in one call, in place of `old` and `new`: each made to the text the ones before it left, and all of them or none.',
            items: {
              type: 'object',
              properties: { old, new: becomes, all },
              required: ['old', 'new'],
            },
          },
        },
        required: ['path'],
      },
    }
  },
  append_document: ({ parameters }) => ({
    parameters: {
      ...parameters,
      properties: {
        ...parameters.properties,
        text: { type: 'string', description: 'The text to add, in Markdown.' },
      },
    },
  }),
  move_document: ({ description }) => ({
    description: without(
      description,
      'When the writer approves changes first, the call proposes the move instead, and nothing moves until they accept it in the chat; the result says which it was.'
    ),
  }),
  delete_document: ({ description }) => ({
    description: without(
      description,
      'When the writer approves changes first, the call proposes the delete instead, and nothing is deleted until they accept it in the chat; the result says which it was.'
    ),
  }),
  add_comment: ({ description }) => ({
    description: description.replace(
      'Anything else goes in the chat, or is the edit itself.',
      'Anything else goes in what you tell the user, or is the edit itself.'
    ),
  }),
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

/** @type {AppTool} */
const CHANGES_SINCE_TOOL = {
  name: CHANGES_SINCE,
  description:
    'What has changed in a document since a revision you hold: its text as a diff, what has been said on its comments, and which of your suggestions the user accepted or rejected. Every read and write of a document answers with its `revision`; give the one you have. Use it when the user has had time with a document, in place of reading it again. Given a folder, or "/" for the whole project, it names the documents you have read that have changed since, each with the revision you had. Where no record is kept of a revision, it says so, and the document is to be read again.',
  inputSchema: {
    type: 'object',
    properties: {
      project: PROJECT,
      path: {
        type: 'string',
        description: 'The document\'s path from the project root, or a folder\'s. Default "/".',
      },
      revision: {
        type: 'string',
        description: 'The revision you hold of the document. Not needed for a folder.',
      },
    },
  },
  annotations: { readOnlyHint: true },
}

/**
 * The document tools an app is offered, by name: those that read, and those
 * of what else its connection may do.
 *
 * @param {AskingApp} app
 * @returns {string[]}
 */
const offered = app => [
  ...READING,
  ...(app.edit === 'off' ? [] : EDITING),
  ...(app.comment ? COMMENTING : []),
]

/**
 * Whether a call's change is suggested in the text, not made: a change to
 * the text of a document that can hold the marks, by a connection that
 * suggests. A plain document holds none, and a chat would be asked about
 * it in the chat, which an app hasn't: there the change is made.
 *
 * @param {AskingApp} app
 * @param {string} name
 * @param {Record<string, any>} args
 * @param {{storyId: string, chatId: string}} context
 * @returns {Promise<boolean>}
 */
async function suggests(app, name, args, context) {
  if (app.edit !== 'suggesting' || !CHANGES_TEXT.has(name)) return false
  const found = await documentForChat(context.storyId, context.chatId, String(args.path ?? ''))
  return found?.document.type === 'text' && !found.document.plain
}

/**
 * The tools an app is offered.
 *
 * @param {AskingApp} app
 * @returns {AppTool[]}
 */
export function toolsFor(app) {
  const documents = toolRegistry.getDefinitionsFor(offered(app)).map(definition => {
    const chat = definition.function
    const outside = SAID_OUTSIDE[chat.name]?.({
      description: chat.description,
      parameters: /** @type {Record<string, any>} */ (chat.parameters),
    })
    const schema = /** @type {Record<string, any>} */ (outside?.parameters ?? chat.parameters)
    return {
      name: chat.name,
      description: outside?.description ?? chat.description,
      inputSchema: { ...schema, properties: { project: PROJECT, ...schema.properties } },
      annotations: READ_ONLY.has(chat.name)
        ? { readOnlyHint: true }
        : { readOnlyHint: false, destructiveHint: !ADDING.has(chat.name) },
    }
  })
  // What changed since, after the tools that read: it stands in for a read.
  return [
    LIST_PROJECTS_TOOL,
    ...documents.slice(0, READING.length),
    CHANGES_SINCE_TOOL,
    ...documents.slice(READING.length),
  ]
}

/**
 * Whether a read's answer sent the document's whole text, and not a slice,
 * a section or some lines of it.
 * @param {Record<string, any>} answer
 */
const sendsAll = answer =>
  typeof answer.content === 'string' &&
  !('section' in answer) &&
  !('from' in answer) &&
  !('line' in answer)

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
  // How a write was stored, as it reads: to quote from, as a read's text is.
  if (typeof answer.stored === 'string') {
    const { stored, ...about } = answer
    return { content: [said(JSON.stringify(about)), said(stored)] }
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

  // The connection's own id where a chat's goes: no chat is found by it, so
  // only what is hidden outright is left out. Its name is who its comments
  // and suggestions are by.
  const asking = { storyId: project.id, chatId: `app:${app.id}`, postsAs: app.name, signal }
  const tool = toolRegistry.tools.get(name)
  if (name !== CHANGES_SINCE && (!tool || !offered(app).includes(name))) {
    return { result: toResult({ error: `Unknown tool: ${name}` }) }
  }
  const ran = await inProject(project.id, async () => {
    try {
      if (name === CHANGES_SINCE || !tool) return await changesSince(app, asking, rest)
      const path = typeof rest.path === 'string' ? rest.path : ''
      if (name === 'read_document') {
        // Still at the revision the app holds: said, and nothing sent.
        const same = await unchangedAt(app, asking, path, rest.revision)
        if (same) return same
        return await withRevision(app, asking, path, () => tool.execute(rest, asking), sendsAll)
      }

      const context = { ...asking, propose: await suggests(app, name, rest, asking) }
      const run = () =>
        name === 'edit_document' && (Array.isArray(rest.edits) || rest.all === true)
          ? editMany(rest, context)
          : tool.execute(rest, context)
      const write = () =>
        WRITES_TEXT.has(name) ? answeringStored(name, rest, context, run) : run()
      const answer =
        WRITES_TEXT.has(name) || SAYS.has(name)
          ? await withRevision(app, asking, name === 'create_document' ? '' : path, write)
          : await write()
      return answer?.note === SUGGESTED_NOTE && !app.comment
        ? { ...answer, note: SUGGESTED_NOTE_NO_COMMENT }
        : answer
    } catch (error) {
      console.error(`${name} failed for a connected app:`, error)
      return { error: `${name} couldn't be run.` }
    }
  })
  return 'pass' in ran ? ran : { result: toResult(ran.value) }
}
