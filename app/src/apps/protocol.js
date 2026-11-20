/**
 * @module apps/protocol
 * @description What a connected app asks, answered: MCP's requests, as far
 * as tools go. The desktop app's native side is the door
 * (`app/electron/src/appServer.js`): it knows who is asking, and hands the
 * request here whole, as the app sent it.
 *
 * There are four to answer: `initialize`, `ping`, `tools/list` and
 * `tools/call`. No resources, prompts or sampling, no stream and no session:
 * a connection is told apart by its token alone, which the door has checked.
 */

import { callTool, toolsFor } from './tools.js'

/** @typedef {import('@/platform/apps.js').AskingApp} AskingApp */
/** @typedef {import('@/platform/apps.js').AppAnswer} AppAnswer */

/**
 * The versions of the protocol spoken, the newest first: those that have
 * HTTP as it is served here.
 */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']

/** JSON-RPC's codes. */
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

/**
 * What an app's model is told as it connects: what a chat's model would have
 * from the project block and its prompt, as far as the connection goes.
 *
 * @param {AskingApp} app
 * @returns {string}
 */
export function instructionsFor(app) {
  const edits = app.edit !== 'off'
  return [
    `inksprite is a writing app. This server gives you the projects its user has opened to you, to ${edits ? 'read and write' : 'list, search and read'} their documents. The tools call the user the writer.`,
    '- A project is a tree of documents and folders. list_projects names the projects, and every other tool takes one as `project`.',
    '- A document is addressed by its path from the top of its project, as list_documents gives it: "Designs/Sync". A path has no file extension.',
    '- Documents are Markdown. A link from one to another is the path from the linking document, ending in .md.',
    '- The user may be writing while you work. Every read and write of a document answers with its `revision`: before relying on what you read earlier, changes_since with the revision you hold shows what has changed since, without reading it all again.',
    ...(edits
      ? [
          app.edit === 'suggesting'
            ? "- A change you make to a document's text is suggested to the user in the document, who accepts or rejects each one there: until they do, you read the document with your suggestions made and everyone else reads it without. A new document, a move and a delete are made at once. edit_document changes passages and leaves the rest; append_document adds to the end; update_document rewrites the whole."
            : '- What you write is in the document at once, where the user sees it, and inksprite keeps a version of the text from before. edit_document changes passages and leaves the rest; append_document adds to the end; update_document rewrites the whole.',
        ]
      : []),
    '- A file exported from inksprite names its document in its front matter. Give its `id` there as a path, written `id:<the id>`, to reach the document whatever it is called now, and change the document, not the file.',
    ...(edits
      ? [
          '- export_project writes the project into the folder the user linked to it, as Markdown files: for putting a finished design into a repository.',
        ]
      : []),
    ...(app.comment
      ? [
          "- A comment is on a passage, for the user to read beside it: add_comment for what you have to say about a document, reply_comment and resolve_comment for comments that are there. On a comment, `writer` is the user, `model` is inksprite's own assistant, and what you say carries this connection's name.",
        ]
      : []),
  ].join('\n')
}

/**
 * @param {unknown} id
 * @param {object} result
 */
const result = (id, result) => ({ response: { jsonrpc: '2.0', id, result } })

/**
 * @param {unknown} id
 * @param {number} code
 * @param {string} message
 */
const failure = (id, code, message) => ({
  response: { jsonrpc: '2.0', id, error: { code, message } },
})

/**
 * Answer a request an app made.
 *
 * @param {any} message - The request: a method, an id, and what it asks
 * @param {{app: AskingApp, signal: AbortSignal}} asking
 * @returns {Promise<AppAnswer>} The answer to send back, or that another
 *   window is to be asked: the one that has the project the call is in
 */
export async function answerRequest(message, { app, signal }) {
  const { id, method, params } = message
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion
      return result(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'inksprite', version: import.meta.env.VITE_APP_VERSION || 'dev' },
        instructions: instructionsFor(app),
      })
    }
    case 'ping':
      return result(id, {})
    case 'tools/list':
      return result(id, { tools: toolsFor(app) })
    case 'tools/call': {
      const name = params?.name
      if (typeof name !== 'string' || !toolsFor(app).some(tool => tool.name === name)) {
        return failure(id, INVALID_PARAMS, `Unknown tool: ${String(name)}`)
      }
      const args = params?.arguments
      const called = await callTool(
        app,
        name,
        args && typeof args === 'object' && !Array.isArray(args) ? args : {},
        signal
      )
      return 'pass' in called ? called : result(id, called.result)
    }
    default:
      return failure(id, METHOD_NOT_FOUND, `Method not found: ${String(method)}`)
  }
}
