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
 * What is true of each is a row of one table (`TOOLS`): whether it changes
 * anything, what its answer carries, and how it is worded for an app. What a
 * connection is offered, the hints a client is given, the `suggest` argument
 * and how a call is run are all read from it, so a tool more is a row more.
 *
 * A chat's model gets more than its tools: the project block on every turn,
 * and a conversation the app can see. An app's gets only what a call
 * answers, so a few things differ here, and what the tools say to a chat is
 * left as it is, their wording having been tuned for the chat:
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
 * - **Several edits in a call.** An app pays a round trip for each call, so
 *   it is offered what `edit_document` takes beyond what a chat is told of:
 *   `edits`, a list made in order as one write or not at all, and `all`, for
 *   every place a passage appears.
 * - **How the text was stored**, where that isn't how it was sent
 *   (`./writes.js`).
 * - **Files brought in**: `import_document` answers with a link the app's
 *   own shell sends a file to, which then comes in as the writer's own
 *   import brings one in, so its bytes never pass through the app's model
 *   (`./imports.js`).
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
 * - **What was typed up to the call is what the call reads.** A chat's turn
 *   starts from a message the writer sent; an app calls while they type. The
 *   editor is written out before a call runs, whichever tool it is.
 *
 * Hidden documents are not in an app's project, as they are not in a
 * chat's: hiding keeps a document from models. Nor is anything of the
 * writer's outside the projects ticked: their chats, their skills.
 */

import { toolRegistry } from '@/ai/tools/index.js'
import { pathInProject } from '@/ai/tools/documents.js'
import { useEditor } from '@/composables/useEditor.js'
import { findProject, inProject, projectsOf } from './projects.js'
import { exportFor } from './exports.js'
import { importFor } from './imports.js'
import { withStored } from './writes.js'
import { changesSince, stateAt, unchangedAt, withRevision } from './revisions.js'

/** @typedef {import('@/platform/apps.js').AskingApp} AskingApp */
/** @typedef {import('@/ai/tools/registry.js').ToolContext} ToolContext */

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

/**
 * Who is asking, and in which project: what a tool is run with. The
 * connection's own id is where a chat's goes, and no chat is found by it, so
 * only what is hidden outright is left out. Its name is who its comments and
 * suggestions are by.
 *
 * @typedef {{storyId: string, chatId: string, postsAs: string, signal: AbortSignal}} Asking
 */

/**
 * What is true of a tool an app can call: a row of `TOOLS`.
 *
 * @typedef {Object} ToolRow
 * @property {string} name
 * @property {true} [writes] - It changes something: only a connection that
 *   writes is offered it. A client is told the rest change nothing
 * @property {true} [adds] - What it changes it only adds to, and takes
 *   nothing away
 * @property {true} [revision] - It reads or writes one document, and its
 *   answer has the document's revision
 * @property {true} [text] - It writes a document's text, and its answer says
 *   how the text was stored
 * @property {true} [suggest] - Its change can be suggested and not made: it
 *   takes `suggest`
 * @property {(chat: {description: string, parameters: Record<string, any>}) => {description?: string, parameters?: Record<string, any>}} [said] -
 *   What it says of itself to an app, where what it says to a chat's model
 *   wouldn't be true there: given the tool as the chat has it, the
 *   description or the parameters that differ
 * @property {{description: string, inputSchema: Record<string, any>}} [own] -
 *   For a tool that is an app's alone, and no chat's: what it says of itself
 * @property {(app: AskingApp, asking: Asking, args: Record<string, any>) => Promise<Record<string, any>>} [run] -
 *   How one of an app's own is run, in the project the call names.
 *   `list_projects` names none, and `callTool` answers it before any is found
 */

/** The tool that names an app's projects: the one that takes none. */
export const LIST_PROJECTS = 'list_projects'

/** What comes before a document's id where a path goes: an exported file's stamp has the id. */
const BY_ID = 'id:'

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
 * A text with a sentence taken out of it.
 * @param {string} text
 * @param {string} sentence
 */
const without = (text, sentence) => text.replace(`${sentence} `, '').replace(sentence, '')

/** What `edit_document` says of itself to an app, which may send several edits. */
const EDIT_OUTSIDE =
  "Change passages of a document, leaving the rest exactly as it is. Give a passage as it reads now (`old`) and what it should read instead (`new`); for several changes, give them as `edits`, which are made in order and all together or not at all. This is how to revise: it sends only what changes, so prefer it over update_document for anything short of a rewrite. A passage has to match the document exactly and exactly once, so quote it as read_document gave it and include enough of it to be unique; with `all`, every place it appears is changed, as for a term renamed. The writer's comment markup can be left out. A comment whose highlighted words an edit changes is resolved with it, and the result lists any it resolved; a comment whose words come through unchanged stays on them."

/** The argument every tool but `list_projects` takes of an app. */
const PROJECT = {
  type: 'string',
  description:
    'The project, by its name as list_projects gives it. Can be left out when there is only one.',
}

/** A document's path, or a folder's, for the tools of an app's own that take either. */
const PATH_OR_FOLDER = {
  type: 'string',
  description: 'The document\'s path from the project root, or a folder\'s. Default "/".',
}

/**
 * The tools an app can call, in the order it is told of them: those that
 * read, and, for a connection that writes, the rest. What changed since
 * comes after the tools that read, since it stands in for a read, and the
 * export after it: it changes nothing here, so every connection has it.
 * `explore_documents` is left out: it runs a job on a model the writer pays
 * for.
 *
 * @type {ToolRow[]}
 */
const TOOLS = [
  {
    name: LIST_PROJECTS,
    own: {
      description:
        'The projects in inksprite you can work in, each with its name and what the user says it is about. Every other tool takes a project by its name, as `project`.',
      inputSchema: { type: 'object', properties: {} },
    },
  },
  {
    name: 'list_documents',
    said: ({ description }) => ({
      description: description
        .replace(
          'a description written for you from its text by explore_documents',
          'a description written from its text'
        )
        .replace('how many comments the user left on it', 'how many open comments are on it'),
    }),
  },
  {
    name: 'read_document',
    revision: true,
    said: ({ parameters }) => ({
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
  },
  {
    name: 'describe_document',
    said: ({ description }) => ({
      description: description.replace(
        'Where explore_documents wrote a description of the document from its text',
        'Where a description of the document has been written from its text'
      ),
    }),
  },
  { name: 'search_documents' },
  {
    name: 'changes_since',
    own: {
      description:
        'What has changed in a document since a revision you hold: its text as a diff, what has been said on its comments, and which of your suggestions the user accepted or rejected, with what they said on them. Every read and write of a document answers with its `revision`; give the one you have. Use it when the user has had time with a document, in place of reading it again. Given a folder, or "/" for the whole project, it names the documents you have read that have changed since, each with the revision you had. Where no record is kept of a revision, it says so, and the document is to be read again.',
      inputSchema: {
        type: 'object',
        properties: {
          project: PROJECT,
          path: PATH_OR_FOLDER,
          revision: {
            type: 'string',
            description: 'The revision you hold of the document. Not needed for a folder.',
          },
        },
      },
    },
    run: (app, asking, args) => changesSince(app, asking, args),
  },
  {
    name: 'export_document',
    own: {
      description:
        'Get a document, or a folder with everything in it, as files: for putting a finished design into a repository, or anywhere else on your side. Each text is Markdown as it stands, without comments or suggestions, stamped in its front matter with the document it came from; its `id` there reaches the document from any tool here, as the path `id:<that id>`. The answer is a link and the command that fetches it, to run in your shell where the files should go: the link works once, for five minutes. One document comes as its file. A folder ("/" is the whole project), or a document with pictures, comes as a tar archive of files and directories by the documents\' names, a folder as a directory of its name. A repository imported into the project is left out. Change documents here, not the exported files, and export again.',
      inputSchema: { type: 'object', properties: { project: PROJECT, path: PATH_OR_FOLDER } },
    },
    run: (app, asking, args) => exportFor(app, asking, args),
  },
  { name: 'create_document', writes: true, adds: true, revision: true, text: true },
  {
    name: 'create_folder',
    writes: true,
    adds: true,
    said: ({ description }) => ({
      description: description.replace(
        'the folders a project starts with are usually the right ones',
        'the folders the project has are usually the right ones'
      ),
    }),
  },
  {
    name: 'import_document',
    writes: true,
    adds: true,
    own: {
      description:
        'Bring a file from your side into the project, sent by your shell: to copy a file in exactly as it is, without writing its text out. The answer is a link and the command that sends the file to it, to run in your shell; the command prints what the file became. A Markdown file (.md) or a Word file (.docx) becomes a document to edit, and plain text (.txt) a document kept exactly as written; anything else, a script, a table, a PDF or a picture, is kept as the file it is, its text read with read_document.',
      inputSchema: {
        type: 'object',
        properties: {
          project: PROJECT,
          path: {
            type: 'string',
            description:
              'Where it goes and what it is called: a folder that exists, then the file\'s name with its extension (e.g. "Research/Notes.md", "Prompts/system.txt"). A Markdown or Word file\'s document is named without the extension.',
          },
        },
        required: ['path'],
      },
    },
    run: (app, asking, args) => importFor(app, asking, args),
  },
  { name: 'update_document', writes: true, revision: true, text: true, suggest: true },
  {
    name: 'edit_document',
    writes: true,
    revision: true,
    text: true,
    suggest: true,
    said: ({ parameters }) => {
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
  },
  {
    name: 'append_document',
    writes: true,
    adds: true,
    revision: true,
    text: true,
    suggest: true,
    said: ({ parameters }) => ({
      parameters: {
        ...parameters,
        properties: {
          ...parameters.properties,
          text: { type: 'string', description: 'The text to add, in Markdown.' },
        },
      },
    }),
  },
  {
    name: 'move_document',
    writes: true,
    said: ({ description }) => ({
      description: without(
        description,
        'When the writer approves changes first, the call proposes the move instead, and nothing moves until they accept it in the chat; the result says which it was.'
      ),
    }),
  },
  {
    name: 'delete_document',
    writes: true,
    said: ({ description }) => ({
      description: without(
        description,
        'When the writer approves changes first, the call proposes the delete instead, and nothing is deleted until they accept it in the chat; the result says which it was.'
      ),
    }),
  },
  {
    name: 'list_comments',
    // The comments there are the user's, inksprite's own assistant's and the
    // app's: "by the writer and by you" is a chat's.
    said: ({ description }) => ({
      description: description
        .replace(', by the writer and by you:', ':')
        .replace(
          '(`you`, `writer`, `model` for another chat, named under `chat`, or someone else by name)',
          "(`you`, `writer` for the user, `model` for inksprite's own assistant, or someone else by name)"
        ),
    }),
  },
  {
    name: 'add_comment',
    writes: true,
    adds: true,
    revision: true,
    said: ({ description }) => ({
      description: description.replace(
        'Anything else goes in the chat, or is the edit itself.',
        'Anything else goes in what you tell the user, or is the edit itself.'
      ),
    }),
  },
  { name: 'reply_comment', writes: true, adds: true, revision: true },
  { name: 'resolve_comment', writes: true, revision: true },
]

/**
 * The tools a connection is offered: all of them, or those that change
 * nothing where it only reads.
 *
 * @param {AskingApp} app
 * @returns {ToolRow[]}
 */
const offered = app => TOOLS.filter(tool => !tool.writes || !app.readOnly)

/**
 * A tool as an app is told of it, or nothing for a row whose tool the chat's
 * registry doesn't have.
 *
 * @param {ToolRow} tool
 * @returns {AppTool|null}
 */
function outside(tool) {
  const { name, own } = tool
  // What a client may let through unasked, and what it should ask about.
  const annotations = tool.writes
    ? { readOnlyHint: false, destructiveHint: !tool.adds }
    : { readOnlyHint: true }
  if (own) return { name, description: own.description, inputSchema: own.inputSchema, annotations }

  const chat = toolRegistry.tools.get(name)?.definition.function
  if (!chat) return null
  const said = tool.said?.({
    description: chat.description,
    parameters: /** @type {Record<string, any>} */ (chat.parameters),
  })
  const schema = /** @type {Record<string, any>} */ (said?.parameters ?? chat.parameters)
  return {
    name,
    description: said?.description ?? chat.description,
    inputSchema: {
      ...schema,
      properties: {
        project: PROJECT,
        ...schema.properties,
        ...(tool.suggest ? { suggest: SUGGEST } : {}),
      },
    },
    annotations,
  }
}

/**
 * The tools an app is offered.
 *
 * @param {AskingApp} app
 * @returns {AppTool[]}
 */
export function toolsFor(app) {
  return offered(app).flatMap(tool => outside(tool) ?? [])
}

/**
 * How a tool is run in a project: one of an app's own its own way, and a
 * chat's as the chat's registry runs it. Nothing for a row with neither.
 *
 * @param {ToolRow} tool
 * @returns {((app: AskingApp, context: ToolContext & Asking, args: Record<string, any>) => Promise<any>)|null}
 */
function runnerOf(tool) {
  if (tool.run) return tool.run
  const chat = toolRegistry.tools.get(tool.name)
  return chat ? (_app, context, args) => chat.execute(args, context) : null
}

/**
 * Whether a read's answer sent the document's whole text, and not a slice,
 * a section or some lines of it.
 * @param {any} answer
 */
const sendsAll = answer =>
  typeof answer?.content === 'string' &&
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
  // How a write was stored, as it reads, or how it differs from what was
  // sent: to quote from, as a read's text is.
  for (const part of ['stored', 'rewritten']) {
    if (typeof answer[part] !== 'string') continue
    const { [part]: text, ...about } = answer
    return { content: [said(JSON.stringify(about)), said(text)] }
  }
  return { content: [said(JSON.stringify(answer))] }
}

/**
 * Run a call that reads or writes one document. The document as the
 * connection reads it is taken once before the call and once after, and
 * what the adapter adds to the tool's answer is said from the two: the
 * document's revision, and for a write how its text was stored.
 *
 * Two calls are answered from the document as it is before, with the tool
 * not run: a read of a document still at the revision the app holds, and a
 * suggestion to a plain document, which is kept as typed and has no marks
 * for one.
 *
 * @param {AskingApp} app
 * @param {ToolRow} tool
 * @param {Record<string, any>} args
 * @param {ToolContext & Asking} context
 * @param {() => Promise<any>} run - Runs the tool
 * @returns {Promise<any>}
 */
async function onDocument(app, tool, args, context, run) {
  const path = typeof args.path === 'string' ? args.path : ''
  const before = path ? await stateAt(context, path) : null
  if (!tool.writes) {
    const same = await unchangedAt(app, before, args.revision)
    if (same) return same
  }
  if (context.propose && before?.plain) {
    return {
      error: `A change to "${before.seen.path}" can't be suggested: it is kept exactly as typed, with nowhere for a suggestion to go. Without \`suggest\`, the change is made.`,
    }
  }

  const answer = await run()
  // Wherever the call left the document: one it made, or moved.
  const after = await stateAt(context, answer?.document?.path ?? answer?.path ?? path)
  const states = { before, after }
  return withRevision(
    app,
    states,
    tool.text ? withStored(tool.name, args, states, answer) : answer,
    !tool.writes && sendsAll(answer)
  )
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

  const tool = offered(app).find(row => row.name === name)
  const run = tool && runnerOf(tool)
  if (!tool || !run) return { result: toResult({ error: `Unknown tool: ${name}` }) }
  /** @type {Asking} */
  const asking = { storyId: project.id, chatId: `app:${app.id}`, postsAs: app.name, signal }
  const ran = await inProject(project.id, async () => {
    try {
      // What was just typed is in the editor until a pause: have it written
      // out, for whatever the call reads.
      useEditor().flush()

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

      // Suggested, where the call asks for that: laid out in the text for
      // the writer to settle, as a chat that asks first has its changes.
      // Asked for with anything but true or false, a "true" in quotes or a
      // 1, the call is refused: taken for a no, the change would be made
      // where the user had asked for a suggestion.
      const asked = tool.suggest ? rest.suggest : undefined
      if (asked !== undefined && typeof asked !== 'boolean') return { error: SUGGEST_IS_A_BOOLEAN }
      if (tool.suggest) delete rest.suggest
      const context = { ...asking, propose: asked === true }
      return tool.revision
        ? await onDocument(app, tool, rest, context, () => run(app, context, rest))
        : await run(app, context, rest)
    } catch (error) {
      console.error(`${name} failed for a connected app:`, error)
      return { error: `${name} couldn't be run.` }
    }
  })
  return 'pass' in ran ? ran : { result: toResult(ran.value) }
}
