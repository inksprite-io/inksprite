/**
 * @module apps/tools
 * @description The tools a connected app is offered, and a call to one run.
 *
 * They are the document tools a chat's model has (`ai/tools/documents.js`),
 * by their names, each taking the project as well, since an app has several
 * where a chat has one, and `list_projects` for what those are. An app is
 * offered all of them, or only those that read, where its connection only
 * reads.
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
 * - **Documents handed over as files**: `export_document` makes a document
 *   or a folder ready and answers with a link the app's own shell fetches,
 *   each text stamped with the document it came from (`./exports.js`), and
 *   a document is reached by the id its stamp carries, written `id:<id>`
 *   where a path goes, whatever it has been renamed since: a document of the
 *   project named that the app sees, and no other.
 * - **A revision on every read and write, and what changed since one**
 *   (`./revisions.js`): what a chat's model is told on every turn of the
 *   documents it read, an app asks for.
 * - **A connection is who its comments are by**: its posts are a model's
 *   under the connection's name, which the Comments tab and other readers
 *   show.
 * - **A suggestion is asked for, call by call.** In a chat, whether edits
 *   wait is the chat's setting. Here it is how the app's own assistant was
 *   asked to work, so the three tools that change a document's text take
 *   `suggest`, true or false: the change is then laid out in the text, for
 *   the writer to accept or reject, as a chat that asks first has its. A
 *   plain document holds no such marks, and a suggestion to one is refused.
 * - **The suggestions waiting are listed where an app reads**, as they are
 *   for a chat: after a document's comments and among a list of them, its
 *   own and everyone else's, with what was said on each
 *   (`ai/tools/commentReads.js`). A chat's is said to be the assistant's,
 *   without the chat's title.
 *
 * Hidden documents are not in an app's project, as they are not in a
 * chat's: hiding keeps a document from models. Nor is anything of the
 * writer's outside the projects ticked: their chats, their skills.
 */

import { toolRegistry } from '@/ai/tools/index.js'
import { documentForChat, pathInProject } from '@/ai/tools/documents.js'
import { findProject, inProject, projectsOf } from './projects.js'
import { exportFor } from './exports.js'
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
const CHANGES_SINCE = 'changes_since'

/** The tool that hands a document or a folder over as files. */
const EXPORT_DOCUMENT = 'export_document'

/** What comes before a document's id where a path goes: an exported file's stamp has the id. */
const BY_ID = 'id:'

/**
 * The document tools that read. `explore_documents` is left out: it runs a
 * job on a model the writer pays for.
 */
const READING = ['list_documents', 'read_document', 'describe_document', 'search_documents']

/** Those that change the documents, for a connection that writes. */
const EDITING = [
  'create_document',
  'create_folder',
  'update_document',
  'edit_document',
  'append_document',
  'move_document',
  'delete_document',
]

/** The one that reads the comments. */
const LIST_COMMENTS = 'list_comments'

/** Those that say something on them, for a connection that writes. */
const COMMENTING = ['add_comment', 'reply_comment', 'resolve_comment']

/** Those that change nothing. */
const READ_ONLY = new Set([...READING, LIST_COMMENTS])

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

/** Those that change the text of a document that is there: what can be suggested instead. */
const CHANGES_TEXT = new Set(['update_document', 'edit_document', 'append_document'])

/** The argument that has a change to a document's text suggested, not made. */
const SUGGEST = {
  type: 'boolean',
  description:
    'Suggest the change instead of making it, for when the user asks for suggestions: it is laid out in the document for them to accept or reject there, and changes nothing until they do.',
}

/** What a call is told when its `suggest` is neither true nor false. */
const SUGGEST_IS_A_BOOLEAN =
  '"suggest" is true or false: true has the change suggested to the user, and false, or leaving it out, has it made. Nothing was changed.'

/**
 * A tool's parameters with `suggest` among them.
 * @param {Record<string, any>} parameters
 */
const suggesting = parameters => ({
  ...parameters,
  properties: { ...parameters.properties, suggest: SUGGEST },
})

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
    description: description
      .replace(
        'a description written for you from its text by explore_documents',
        'a description written from its text'
      )
      .replace('how many comments the user left on it', 'how many open comments are on it'),
  }),
  read_document: ({ parameters }) => ({
    description:
      'Read a document. Its text comes after what is said about it, as it is written: Markdown. A document up to about 7,000 words comes whole; a longer one comes one slice at a time, with `next` for the offset to go on from and its top sections with their links. For a long document, look at its sections with describe_document first and read the ones you need with `section`, rather than paging through it. The open comments on what was read are listed after it, each with the passage it is on, and with them, under `suggestions`, the changes suggested there that the user has not yet accepted or rejected: each with its id, who suggested it, the words as they stand without it (`from`) and with it (`to`), and what has been said on it. Yours (`by` is `you`) are already made in the text you read; the others are not. Only the user accepts or rejects a suggestion: no tool does. The user may be writing in it: what a read gives is the text as it stood then, and its `revision`, which changes_since takes to say what has changed since. A source file in a repository comes with its line numbers, and is read by line with `line` and `until`.',
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
          suggest: SUGGEST,
        },
        required: ['path'],
      },
    }
  },
  append_document: ({ parameters }) => ({
    parameters: suggesting({
      ...parameters,
      properties: {
        ...parameters.properties,
        text: { type: 'string', description: 'The text to add, in Markdown.' },
      },
    }),
  }),
  update_document: ({ parameters }) => ({ parameters: suggesting(parameters) }),
  create_folder: ({ description }) => ({
    description: description.replace(
      'the folders a project starts with are usually the right ones',
      'the folders the project has are usually the right ones'
    ),
  }),
  // The comments there are the user's, inksprite's own assistant's and the
  // app's: "by the writer and by you" is a chat's.
  list_comments: ({ description }) => ({
    description: description
      .replace(', by the writer and by you:', ':')
      .replace(
        '(`you`, or `model` for another chat, named under `chat`)',
        "(`you`, `model` for inksprite's own assistant, or a name)"
      ),
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
    'What has changed in a document since a revision you hold: its text as a diff, what has been said on its comments, and which of your suggestions the user accepted or rejected, with what they said on them. Every read and write of a document answers with its `revision`; give the one you have. Use it when the user has had time with a document, in place of reading it again. Given a folder, or "/" for the whole project, it names the documents you have read that have changed since, each with the revision you had. Where no record is kept of a revision, it says so, and the document is to be read again.',
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

/** @type {AppTool} */
const EXPORT_DOCUMENT_TOOL = {
  name: EXPORT_DOCUMENT,
  description:
    'Get a document, or a folder with everything in it, as files: for putting a finished design into a repository, or anywhere else on your side. Each text is Markdown as it stands, without comments or suggestions, stamped in its front matter with the document it came from; its `id` there reaches the document from any tool here, as the path `id:<that id>`. The answer is a link and the command that fetches it, to run in your shell where the files should go: the link works once, for five minutes. One document comes as its file. A folder ("/" is the whole project), or a document with pictures, comes as a tar archive of files and directories by the documents\' names, a folder as a directory of its name. A repository imported into the project is left out. Change documents here, not the exported files, and export again.',
  inputSchema: {
    type: 'object',
    properties: {
      project: PROJECT,
      path: {
        type: 'string',
        description: 'The document\'s path from the project root, or a folder\'s. Default "/".',
      },
    },
  },
  annotations: { readOnlyHint: true },
}

/** The tools that are an app's alone, by name. */
const OWN = new Map(
  [LIST_PROJECTS_TOOL, CHANGES_SINCE_TOOL, EXPORT_DOCUMENT_TOOL].map(tool => [tool.name, tool])
)

/**
 * The tools an app is offered, by name, in the order it is told of them:
 * those that read, and, for a connection that writes, the rest. What changed
 * since comes after the tools that read, since it stands in for a read, and
 * the export after it: it changes nothing here, so every connection has it.
 *
 * @param {AskingApp} app
 * @returns {string[]}
 */
const offered = app => [
  LIST_PROJECTS,
  ...READING,
  CHANGES_SINCE,
  EXPORT_DOCUMENT,
  ...(app.readOnly ? [] : EDITING),
  LIST_COMMENTS,
  ...(app.readOnly ? [] : COMMENTING),
]

/**
 * A document tool as an app is told of it.
 *
 * @param {import('@/ai/tools/registry.js').ToolDefinition} definition - As a chat has it
 * @returns {AppTool}
 */
function outside(definition) {
  const chat = definition.function
  const said = SAID_OUTSIDE[chat.name]?.({
    description: chat.description,
    parameters: /** @type {Record<string, any>} */ (chat.parameters),
  })
  const schema = /** @type {Record<string, any>} */ (said?.parameters ?? chat.parameters)
  return {
    name: chat.name,
    description: said?.description ?? chat.description,
    inputSchema: { ...schema, properties: { project: PROJECT, ...schema.properties } },
    annotations: READ_ONLY.has(chat.name)
      ? { readOnlyHint: true }
      : { readOnlyHint: false, destructiveHint: !ADDING.has(chat.name) },
  }
}

/**
 * The tools an app is offered.
 *
 * @param {AskingApp} app
 * @returns {AppTool[]}
 */
export function toolsFor(app) {
  return offered(app).flatMap(name => {
    const own = OWN.get(name)
    if (own) return [own]
    const tool = toolRegistry.tools.get(name)
    return tool ? [outside(tool.definition)] : []
  })
}

/**
 * Why a change to a document's text can't be suggested, or null where it
 * can: a plain document is kept as typed, and holds no marks for one. A path
 * with nothing at it is the tool's to turn down.
 *
 * @param {{storyId: string, chatId: string}} asking
 * @param {string} path
 * @returns {Promise<{error: string}|null>}
 */
async function unsuggestable(asking, path) {
  const found = await documentForChat(asking.storyId, asking.chatId, path)
  if (found?.document.type !== 'text' || !found.document.plain) return null
  return {
    error: `A change to "${found.path}" can't be suggested: it is kept exactly as typed, with nowhere for a suggestion to go. Without \`suggest\`, the change is made.`,
  }
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
    const { content, comments, suggestions, moreSuggestions, ...about } = answer
    const after = {
      ...(comments ? { comments } : {}),
      ...(suggestions ? { suggestions } : {}),
      ...(moreSuggestions ? { moreSuggestions } : {}),
    }
    return {
      content: [
        said(JSON.stringify(about)),
        said(content),
        ...(Object.keys(after).length > 0 ? [said(JSON.stringify(after))] : []),
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
  if (!offered(app).includes(name) || (!tool && !OWN.has(name))) {
    return { result: toResult({ error: `Unknown tool: ${name}` }) }
  }
  const ran = await inProject(project.id, async () => {
    try {
      // A document named by its id, as an exported file's stamp has it: one
      // of this project that the app sees. Any other id, a document's
      // elsewhere or one hidden since, is answered as one nobody has.
      if (typeof rest.path === 'string' && rest.path.startsWith(BY_ID)) {
        const id = rest.path.slice(BY_ID.length).trim()
        const found = await pathInProject(asking, id)
        if (!found) {
          return {
            error: `No document with the id "${id}" in "${project.name}". list_documents shows what the project holds.`,
          }
        }
        rest.path = found
      }
      if (name === EXPORT_DOCUMENT) return await exportFor(app, asking, rest)
      if (name === CHANGES_SINCE || !tool) return await changesSince(app, asking, rest)
      const path = typeof rest.path === 'string' ? rest.path : ''
      if (name === 'read_document') {
        // Still at the revision the app holds: said, and nothing sent.
        const same = await unchangedAt(app, asking, path, rest.revision)
        if (same) return same
        return await withRevision(app, asking, path, () => tool.execute(rest, asking), sendsAll)
      }

      // Suggested, where the call asks for that: laid out in the text for
      // the writer to settle, as a chat that asks first has its changes.
      // Asked for with anything but true or false, a "true" in quotes or a
      // 1, the call is refused: taken for a no, the change would be made
      // where the user had asked for a suggestion.
      const asked = CHANGES_TEXT.has(name) ? rest.suggest : undefined
      if (asked !== undefined && typeof asked !== 'boolean') return { error: SUGGEST_IS_A_BOOLEAN }
      const suggested = asked === true
      if (CHANGES_TEXT.has(name)) delete rest.suggest
      const refused = suggested ? await unsuggestable(asking, path) : null
      if (refused) return refused
      const context = { ...asking, propose: suggested }
      const run = () =>
        name === 'edit_document' && (Array.isArray(rest.edits) || rest.all === true)
          ? editMany(rest, context)
          : tool.execute(rest, context)
      const write = () =>
        WRITES_TEXT.has(name) ? answeringStored(name, rest, context, run) : run()
      return WRITES_TEXT.has(name) || COMMENTING.includes(name)
        ? await withRevision(app, asking, name === 'create_document' ? '' : path, write)
        : await write()
    } catch (error) {
      console.error(`${name} failed for a connected app:`, error)
      return { error: `${name} couldn't be run.` }
    }
  })
  return 'pass' in ran ? ran : { result: toResult(ran.value) }
}
