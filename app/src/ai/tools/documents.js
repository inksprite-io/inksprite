/**
 * @module ai/tools/documents
 * @description Tools for reading and writing the project's document tree.
 *
 * A lore entry and a chapter are the same kind of thing, so the model gets one
 * set of verbs for both — and can create a chapter, which it never could when
 * the only writable thing was a lore entry.
 *
 * These are the model's only view of the project. The project block on every
 * turn says only its name, its overview, how much is in it, and the documents
 * the writer pinned (`projectOverview` and `pinnedDocuments` below); the rest
 * the model finds with `list_documents` and reads with `read_document`. A
 * turn's calls to these tools stay in the conversation, results and all, until
 * a summary stands in for them, and the block says which reads have changed
 * since (ai/context/reads.js). See .llm/project_context_design.md.
 *
 * Only the writer pins. The model has no keep: what it read stays in the
 * conversation, which is all a keep was for.
 *
 * A document is addressed by its path, and only by its path — the same string
 * `list_documents` gives for everything in the project. Nothing here takes a
 * title or an id.
 *
 * Content crosses this boundary as markdown, which is what a document holds.
 * The model reads back exactly what it wrote, and what the writer typed is
 * what the model sees — headings, emphasis, and all.
 *
 * A document the chat cannot see is not in the model's project: hidden
 * outright, or hidden in this chat. See utils/visibility.js. It is left out of
 * the listing, a folder read does not name it, search does not look in it,
 * and its path resolves to nothing — the model was never shown the path, so a
 * path it guesses right has to read the same as one it guesses wrong. The one
 * place the whole tree is consulted is `resolveNewPath`, so that a document is
 * never created on top of one the model cannot see.
 *
 * A chat can ask the writer before anything changes. Then a writing tool
 * checks what it would do, records it as proposed, and tells the model so;
 * `applyProposal` is what the writer's Accept runs. Title changes
 * still go straight in — they are the listing, not the prose.
 */

import { nanoid } from 'nanoid'
import { useDocumentsStore } from '@/stores/documentsStore.js'
import { useChatsStore } from '@/stores/chatsStore.js'
import { READ_BUDGET, isLong, offsetOfPage, pageAt, sectionsOfText, sliceAt } from './slices.js'
import { findSection, sectionIndexAt, sectionPath, sectionTree, slugOf } from '@/utils/sections.js'
import { useDocuments } from '@/composables/useDocuments.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { documentPath } from '@/utils/documentPath.js'
import { diffAppend, diffEdit } from '@/utils/edits.js'
import { chatVisibility } from '@/utils/visibility.js'
import { readInView, textHash } from '@/ai/context/reads.js'
import { skillWithFile } from './useSkill.js'

/**
 * The answer for a path nothing is at. When the path is one of the files of a
 * skill the model loads, it says how that is read: told only that there is no
 * such document, a model asked to read a skill's file goes on looking among
 * the project's.
 *
 * @param {string} path
 * @returns {{error: string}}
 */
function noDocument(path) {
  const owner = skillWithFile(path)
  return {
    error: owner
      ? `No document at "${path}". It is one of the ${owner} skill's files, not a document: read it with use_skill(name: "${owner}", file: "${path}").`
      : `No document at "${path}". list_documents shows what the project holds.`,
  }
}

/** @typedef {import('./registry.js').ToolDefinition} ToolDefinition */
/** @typedef {import('./registry.js').ToolContext} ToolContext */
/** @typedef {import('@/types/models.js').Document} Document */
/** @typedef {ReturnType<typeof useDocuments>} DocumentsApi */

/** @param {string} s */
const norm = s => (s || '').trim().toLowerCase()

/** @typedef {import('@/types/models.js').DocumentEdit} DocumentEdit */

/**
 * Tell the turn what a tool changed, when the turn is keeping a record. Each
 * change gets a name, so a decision the writer makes on it while the turn is
 * still writing can be told apart from the turn's own copy.
 * @param {ToolContext} context
 * @param {Omit<DocumentEdit, 'id'>} edit
 */
const record = (context, edit) => context?.edits?.push({ id: nanoid(), ...edit })

/**
 * What the model is told when it tries to write into a file.
 *
 * A file's text is what was read out of the file — a paper's pages — and a
 * model rewriting it would be rewriting the paper. Its title is
 * the listing's and can change; what it says is the file's.
 *
 * @param {string} path
 * @returns {string}
 */
const fileIsNotWritten = path =>
  `"${path}" is a file. Its text is what was read out of the file and is not written to; put what you have to say in a document of its own.`

/** What the model is told when a change waits on the writer. */
export const PROPOSED_NOTE =
  'Proposed to the writer, who will accept or reject it in the chat. Do not call further tools on this document this turn; tell the writer what you proposed and why.'

/**
 * Record a change as proposed rather than making it, and say so.
 * @param {ToolContext} context
 * @param {Omit<DocumentEdit, 'id'|'status'>} edit - With the tool's own arguments as `old` and `new`
 */
function propose(context, edit) {
  record(context, { ...edit, status: 'proposed' })
  return { proposed: true, document: { path: edit.path }, note: PROPOSED_NOTE }
}

/**
 * What a write changed, as the smallest pair that can undo it and make it
 * again. An append's is what arrived at the end; see diffAppend.
 * @param {string} tool
 * @param {string} before
 * @param {string} after
 */
const pairOf = (tool, before, after) =>
  tool === 'append_document' ? diffAppend(before, after) : diffEdit(before, after)

/**
 * Run a write and record what it changed as the smallest reversible pair.
 * @param {ToolContext} context
 * @param {DocumentsApi} api
 * @param {Document} document
 * @param {string} tool
 * @param {() => void} write
 */
function recording(context, api, document, tool, write) {
  const before = api.currentContent(document.id)
  write()
  const pair = pairOf(tool, before, api.currentContent(document.id))
  if (pair) {
    record(context, { documentId: document.id, path: pathOf(api, document), tool, ...pair })
  }
}

/** @typedef {import('@/utils/visibility.js').ChatMarks} ChatMarks */

/**
 * Load a story's tree and hand back the pieces the tools need, with how the
 * chat asking reads it.
 *
 * @param {string} storyId
 * @param {ChatMarks|string|null} [chat] - The chat, or its id. Without one only
 *   what is hidden outright is left out, which is what the writer's own Accept
 *   reads by.
 */
async function open(storyId, chat) {
  const api = useDocuments(storyId)
  await api.init()
  const marks = typeof chat === 'string' ? useChatsStore().getChatById(chat) : chat
  const { sees, markFor } = chatVisibility(marks, api.get)
  return { api, store: useDocumentsStore(), sees, markFor, marks }
}

/**
 * The documents in a story, the root first, depth first.
 *
 * The root is included because it is addressable: its title is the story's
 * name and its summary is the overview, both of which appear in every listing.
 * A name the model can read but not resolve would be a trap.
 *
 * @param {DocumentsApi} api
 * @param {string} storyId
 * @param {(document: Document) => boolean} include - Whether a document is
 *   listed. A folder it refuses is still walked into: a chat can hide a folder
 *   and show one thing in it.
 * @returns {Document[]}
 */
function collectDocuments(api, storyId, include) {
  /** @type {Document[]} */
  const out = []
  const root = api.get(rootIdFor(storyId))
  if (root) out.push(root)

  const walk = (/** @type {string} */ parentId) => {
    for (const child of api.childrenOf(parentId)) {
      if (include(child)) out.push(child)
      if (child.type === 'folder') walk(child.id)
    }
  }
  walk(rootIdFor(storyId))
  return out
}

/**
 * Every document in a story, hidden or not.
 *
 * Not the model's view — `visibleDocuments` is — and used only where the whole
 * tree has to be consulted, which is whether a path is free.
 *
 * @param {DocumentsApi} api
 * @param {string} storyId
 * @returns {Document[]}
 */
const allDocuments = (api, storyId) => collectDocuments(api, storyId, () => true)

/**
 * The project as the model in one chat may see it.
 *
 * @param {DocumentsApi} api
 * @param {string} storyId
 * @param {(document: Document) => boolean} sees
 * @returns {Document[]}
 */
const visibleDocuments = (api, storyId, sees) => collectDocuments(api, storyId, sees)

/**
 * Where a document sits, as a slash path.
 *
 * Paths are relative to the project root, so a chapter is
 * "manuscript/Chapter 1" rather than "My Story/manuscript/Chapter 1" — the
 * story's name in front of every path would be noise, and renaming the
 * project would move every document in it.
 *
 * That leaves the root itself with no name, so it is "/". It used to be the
 * story's title, which read fine on its own but was not a path: it prefixed
 * nothing below it, and it was not what `create_document` wanted for the top
 * level. One name for the root, and it is the one the model is shown.
 *
 * @param {DocumentsApi} api
 * @param {Document} document
 * @returns {string}
 */
function pathOf(api, document) {
  // Spelled in one place, so that what the writer copies from the outline
  // and what the model is shown are the same string. The document is taken
  // as passed: a record names it as it was when the change was made.
  return documentPath(api.get, document)
}

/**
 * Find one document by its path.
 *
 * The path is the only address. It is the one the model always has — every
 * listing it sees is built from `pathOf` — and it is the only one that is
 * unique: a bare title took the first match in tree order, so with a "Notes"
 * in two folders the second was unreachable and nothing said so. Ids were
 * worse than redundant, since the project block deliberately withholds them.
 *
 * A leading slash is ignored and matching is case-insensitive. Neither is a
 * second way of addressing anything — they are the same path, written the way
 * a model shown a root of "/" will write it.
 *
 * A document the chat cannot see is not found, unless `sees` is left out to
 * ask for the whole tree. That is for `resolveNewPath` and nothing the model
 * calls: to it, a hidden path is not there.
 *
 * @param {DocumentsApi} api
 * @param {string} storyId
 * @param {string} path
 * @param {(document: Document) => boolean} [sees] - Absent for every document
 * @returns {Document|null}
 */
function findByPath(api, storyId, path, sees) {
  const trimmed = norm(path)
  if (!trimmed) return null

  const needle = trimmed.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!needle) return api.get(rootIdFor(storyId))

  const documents = sees ? visibleDocuments(api, storyId, sees) : allDocuments(api, storyId)
  return documents.find(document => norm(pathOf(api, document)) === needle) || null
}

/**
 * Resolve the path a new document should be created at.
 *
 * The last segment is its title and everything before it is the folder it goes
 * in, which has to exist already. A model that writes "note/Elara" for
 * "notes/Elara" is told so, rather than getting a second folder one letter from
 * the first and no sign that anything went wrong — the same reason this has
 * never invented a parent. `create_folder` is how a folder comes to exist.
 *
 * A path that is already taken is refused too. When the path is the address,
 * two documents sharing one makes the second unreachable. That includes a
 * path held by a document the model cannot see: a hidden one still holds its
 * place in the tree, and a second document there would leave the writer with
 * two of the same name and the model with one it can never reach again.
 *
 * @param {DocumentsApi} api
 * @param {string} storyId
 * @param {string} path
 * @param {(document: Document) => boolean} sees
 * @returns {{parentId: string, title: string, path: string}|{error: string}}
 */
function resolveNewPath(api, storyId, path, sees) {
  const segments = (path || '')
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)

  const title = segments.pop()
  if (!title) {
    return { error: 'Give the full path for the new document, e.g. "notes/Characters/Elara".' }
  }

  const parentPath = segments.join('/')
  const parent = parentPath
    ? findByPath(api, storyId, parentPath, sees)
    : api.get(rootIdFor(storyId))
  if (!parent) {
    return {
      error: `No folder at "${parentPath}". list_documents shows the folders that exist; create_folder adds one.`,
    }
  }
  if (parent.type !== 'folder') return { error: `"${parentPath}" is a document, not a folder` }

  const full = [parentPath, title].filter(Boolean).join('/')
  if (findByPath(api, storyId, full, sees)) {
    return { error: `"${full}" already exists. Use update_document to change it.` }
  }
  if (findByPath(api, storyId, full)) {
    return { error: `"${full}" is not available. Choose a different title.` }
  }

  return { parentId: parent.id, title, path: full }
}

/**
 * @typedef {Object} DocumentListing
 * @property {string} id - Not sent to the model; what a read is matched against
 * @property {string} path
 * @property {string} type
 * @property {number} [words] - How long a document is; a folder has no length
 * @property {number} [pages] - A file's pages, for one that has pages
 */

/**
 * @typedef {Object} ProjectOverview
 * @property {string} project - The project's name
 * @property {string} [summary] - The story's overview, when someone wrote one
 * @property {{documents: number, folders: number}} size - How much of it the
 *   chat can see, so the model knows there is more than the block shows
 */

/**
 * How long a document is, for a model deciding whether to read it whole.
 *
 * A folder has no length of its own. A file says its pages too, when it has
 * them, since a page is what a paged read will take.
 *
 * @param {Document} document
 * @returns {{words?: number, pages?: number}}
 */
function sizeOf(document) {
  if (document.type === 'folder') return {}
  return {
    words: document.wordCount || 0,
    ...(typeof document.pages === 'number' ? { pages: document.pages } : {}),
  }
}

/**
 * Everything below `parentId` that the chat can see, depth first, each with how
 * many levels down it is. A folder the chat cannot see is still walked into: a
 * chat can hide a folder and show one thing in it.
 *
 * @param {DocumentsApi} api
 * @param {string} parentId
 * @param {(document: Document) => boolean} sees
 * @returns {Array<{document: Document, depth: number}>}
 */
function entriesBelow(api, parentId, sees) {
  /** @type {Array<{document: Document, depth: number}>} */
  const entries = []
  const walk = (/** @type {string} */ id, /** @type {number} */ depth) => {
    for (const child of api.childrenOf(id)) {
      if (sees(child)) entries.push({ document: child, depth })
      if (child.type === 'folder') walk(child.id, depth + 1)
    }
  }
  walk(parentId, 1)
  return entries
}

/**
 * The documents a chat has pinned, whose text rides in the project block on
 * every turn, from the first.
 *
 * A pin names one document or one folder. A folder pins everything under it,
 * the way any mark covers what is under it — a character's folder is the thing
 * a writer points at, not the six documents inside it — except where something
 * nearer says otherwise: a greeting shown, or a document hidden, inside a
 * pinned folder is not pinned. See utils/visibility.js.
 *
 * What the chat cannot see is never pinned, whichever way it came to be out of
 * sight. A pin is a lasting thing and `hidden` is set afterwards as often as
 * before: pin a character, hide the folder they are in, and they have to stop
 * riding in every turn of a chat that cannot see them.
 *
 * A pin on a document that has since been deleted names nothing and is skipped
 * rather than reported: the writer deleted it, which is an answer.
 *
 * Only documents come back. A pinned folder is what is under it.
 *
 * @param {string} storyId
 * @param {ChatMarks|null} [chat] - The chat, whose marks say what is pinned
 * @returns {Promise<DocumentListing[]>} Each once, in tree order
 */
export async function pinnedDocuments(storyId, chat) {
  if (!chat?.pinnedIds?.length) return []
  const { api } = await open(storyId)
  const { sees, markFor } = chatVisibility(chat, api.get)

  return allDocuments(api, storyId)
    .filter(document => document.type !== 'folder' && sees(document))
    .filter(document => markFor(document) === 'pinned')
    .map(document => ({
      id: document.id,
      path: pathOf(api, document),
      type: document.type,
      ...sizeOf(document),
    }))
}

/**
 * What the project block says of the project itself: its name, the story's
 * overview, and how much is in it for this chat.
 *
 * Not the tree. The block moves forward to the newest message every turn, so
 * no prompt cache covers it, and a listing there is paid in full on every
 * request; the model lists the project when it needs to.
 *
 * @param {string} storyId
 * @param {ChatMarks|null} [chat] - The chat it is for, whose marks say what it sees
 * @returns {Promise<ProjectOverview|null>}
 */
export async function projectOverview(storyId, chat) {
  const { api, sees } = await open(storyId, chat)
  const root = api.get(rootIdFor(storyId))
  if (!root) return null
  const summary = root.summary?.trim()
  const seen = visibleDocuments(api, storyId, sees).filter(document => document.id !== root.id)
  const folders = seen.filter(document => document.type === 'folder').length
  return {
    project: root.title || 'Untitled',
    ...(summary ? { summary } : {}),
    size: { documents: seen.length - folders, folders },
  }
}

// ============================================================================
// list_documents — what the project holds, by full path
// ============================================================================

/** How many entries a listing shows before it lists less deep. */
export const LISTING_LIMIT = 200

/** @type {ToolDefinition} */
export const listDocumentsDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'list_documents',
    description:
      'List what the project holds, or what is under one folder: a line for each document and folder, by the full path every tool takes, with how long each document is and whether the writer pinned it. A folder ends in "/". Everything under the folder is listed when it fits; in a large project, a folder further down says how many it holds instead, and listing it shows them.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'The folder to list, by its path from the project root. Default "/", the whole project.',
        },
        depth: {
          type: 'integer',
          description: 'How many levels down to list. Default: as deep as fits.',
        },
      },
    },
  },
}

/** @param {number} n */
const counted = n => n.toLocaleString('en-US')

/**
 * One entry of a listing, as a line: its path, and what can be said of it.
 *
 * @param {DocumentsApi} api
 * @param {Document} document
 * @param {(document: Document) => import('@/utils/visibility.js').ChatMark|null} markFor
 * @param {number|null} hidden - For a folder listed without what is in it, how
 *   many entries are under it
 * @returns {string}
 */
function listingLine(api, document, markFor, hidden) {
  const path = pathOf(api, document)
  if (document.type === 'folder') {
    if (hidden === null) return `${path}/`
    return `${path}/ — ${hidden === 0 ? 'empty' : `${counted(hidden)} inside, not listed`}`
  }
  const facts = [
    ...(document.type === 'file' ? ['file'] : []),
    ...(typeof document.pages === 'number' ? [`${counted(document.pages)} pages`] : []),
    `${counted(document.wordCount || 0)} words`,
    ...(markFor(document) === 'pinned' ? ['pinned'] : []),
  ]
  return `${path} — ${facts.join(', ')}`
}

/**
 * List what is under a folder, by full path, as deep as fits in
 * LISTING_LIMIT entries or as deep as asked.
 *
 * Text rather than JSON: a listing is all names, and a line per name is a
 * fraction of the tokens. Full paths rather than indentation, so a small model
 * copies a path rather than assembling one.
 *
 * @param {{path?: string, depth?: number}} args
 * @param {ToolContext} context
 * @returns {Promise<string|{error: string}>}
 */
export async function executeListDocuments(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const { api, sees, markFor } = await open(context.storyId, context.chatId)
  const asked = typeof args?.path === 'string' && args.path.trim() ? args.path : '/'
  const folder = findByPath(api, context.storyId, asked, sees)
  if (!folder)
    return {
      error: `No folder at "${asked}". list_documents with no path lists the whole project.`,
    }
  if (folder.type !== 'folder') {
    return { error: `"${asked}" is a document, not a folder. read_document reads it.` }
  }

  const entries = entriesBelow(api, folder.id, sees)
  if (entries.length === 0) return `"${asked}" is empty.`

  // As deep as asked, or the deepest level whose entries fit; at least the
  // folder's own children, however many there are.
  const deepest = Math.max(...entries.map(entry => entry.depth))
  let depth = Number.isInteger(args?.depth) && Number(args.depth) > 0 ? Number(args.depth) : deepest
  if (!(Number.isInteger(args?.depth) && Number(args.depth) > 0)) {
    while (depth > 1 && entries.filter(entry => entry.depth <= depth).length > LISTING_LIMIT) {
      depth--
    }
  }

  return entries
    .map((entry, at) => {
      if (entry.depth > depth) return null
      let hidden = null
      if (entry.document.type === 'folder' && entry.depth === depth) {
        hidden = 0
        for (const below of entries.slice(at + 1)) {
          if (below.depth <= entry.depth) break
          hidden++
        }
      }
      return listingLine(api, entry.document, markFor, hidden)
    })
    .filter(Boolean)
    .join('\n')
}

// ============================================================================
// read_document — a document's text
// ============================================================================

/** @type {ToolDefinition} */
export const readDocumentDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'read_document',
    description:
      'Read a document. What you read stays in the conversation: if the document changes afterwards, the project block lists it under `changed`, and reading it again gets the new text; reading something unchanged that is still above says so rather than sending it again. A document up to about 7,000 words comes whole; a longer one comes one slice at a time, with `next` for the offset to go on from and its top sections with their links. For a long document, look at its sections with describe_document first and read the ones you need with `section`, rather than paging through it.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'The document\'s path from the project root, exactly as list_documents gives it (e.g. "notes/Characters/Elara").',
        },
        section: {
          type: 'string',
          description:
            "Read one section: its link, as describe_document gives it (or its title). A section that fits in one read comes whole, its subsections with it; a longer one comes a slice at a time, with its subsections' links on the first, and goes on with `from: next` and the same section.",
        },
        from: {
          type: 'integer',
          description:
            'For a long document: the character offset to read from, as `next` or a search hit gave it. Default 0, the top.',
        },
        page: {
          type: 'integer',
          description:
            'For a file with pages that has not been converted: the page to read from, counted from 1. Takes precedence over `from`.',
        },
      },
      required: ['path'],
    },
  },
}

/**
 * @param {{path: string, section?: string, from?: number, page?: number}} args
 * @param {ToolContext} context
 */
export async function executeReadDocument(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const chat = context.chatId ? useChatsStore().getChatById(context.chatId) : null
  const { api, sees } = await open(context.storyId, chat)

  const document = findByPath(api, context.storyId, args.path, sees)
  if (!document) return noDocument(args.path)
  if (document.type === 'folder') {
    return { error: `"${args.path}" is a folder. list_documents lists what is in it.` }
  }

  const text = document.content || ''
  const long = isLong(text)

  // The same part of the same text, read in a turn still in view, is above
  // already; a second copy would only cost its length again. Only for a caller
  // that sees the conversation's calls: a skill reads a transcript without them.
  const messages = context.conversation?.()
  if (messages && readInView(messages, document.id, args, textHash(text))) {
    return {
      path: pathOf(api, document),
      unchanged: 'Unchanged since you read this earlier in the conversation; that read is above.',
    }
  }

  const base = {
    id: document.id,
    title: document.title || '(untitled)',
    path: pathOf(api, document),
    ...sizeOf(document),
  }

  // A file answers with the text that was read out of it when it came in —
  // a PDF's, page by page under `[p.N]` markers — which is what there is of
  // it for a model that cannot see the file itself. What it is goes with it,
  // so a model can tell a scan with no text from a document that is empty.
  const kind =
    document.type === 'file'
      ? {
          type: 'file',
          mime: document.mime || '',
          ...(text
            ? {}
            : { note: 'No text could be read out of this file. It may be a scan, or a picture.' }),
        }
      : { type: 'text' }

  const sections = sectionsOfText(text)

  // A section, named by its link: whole when it fits in a read, and a slice
  // at a time within it when it does not, stopping where it ends.
  if (typeof args.section === 'string' && args.section.trim()) {
    const section = findSection(sections, args.section)
    if (!section) {
      return {
        error: `"${args.path}" has no section "${args.section}". describe_document lists its sections.`,
        ...(sections.length > 0 ? { sections: sectionTree(sections, MAP_NODES) } : {}),
      }
    }
    const named = { link: section.link, title: section.title, words: section.words }
    if (section.until - section.offset <= READ_BUDGET) {
      return {
        ...base,
        ...kind,
        section: named,
        content: text.slice(section.offset, section.until),
      }
    }
    const asked = Number(args.from) || 0
    const from = asked > section.offset && asked < section.until ? asked : section.offset
    let slice = sliceAt(text, from)
    const last = slice.to >= section.until
    if (last) {
      slice = {
        ...slice,
        to: section.until,
        text: text.slice(slice.from, section.until),
        next: null,
      }
    }
    const inner = sections.filter(
      other => other.offset > section.offset && other.offset < section.until
    )
    return {
      ...base,
      ...kind,
      section: { ...named, from: section.offset, until: section.until },
      from: slice.from,
      to: slice.to,
      next: slice.next,
      ...(from === section.offset && inner.length > 0
        ? { sections: sectionTree(inner, MAP_NODES) }
        : {}),
      note: last
        ? 'This is the end of the section.'
        : 'The section goes on: read it again with from: next, or read one of its sections by its link.',
      content: slice.text,
    }
  }

  if (!long) return { ...base, ...kind, content: text }

  // A long document comes one slice at a time, the first with its top
  // sections and their links; describe_document has the whole tree.
  let from = Number(args.from) || 0
  if (typeof args.page === 'number' && args.page > 0) {
    const offset = offsetOfPage(text, Math.floor(args.page))
    if (offset === null) {
      return { error: `"${args.path}" has no page ${args.page}.` }
    }
    from = offset
  }

  const slice = sliceAt(text, from)
  const page = pageAt(text, slice.from)
  return {
    ...base,
    ...kind,
    from: slice.from,
    to: slice.to,
    length: slice.length,
    next: slice.next,
    ...(page !== null ? { page } : {}),
    ...(slice.next === null ? { note: 'This is the end of the document.' } : {}),
    ...(slice.from === 0 && sections.length > 0
      ? {
          sections: sectionTree(sections, MAP_NODES),
          map: 'describe_document lists every section; read one with section: its link.',
        }
      : {}),
    content: slice.text,
  }
}

/** How many sections a read shows at most, beside its text; describe_document shows more. */
const MAP_NODES = 60

// ============================================================================
// describe_document — a document's sections, for reading by section
// ============================================================================

/** @type {ToolDefinition} */
export const describeDocumentDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'describe_document',
    description:
      "A document's sections, without its text: its headings as a tree, each with the link read_document takes as `section` and how many words it runs to, its subsections included. A section with a long run of subsections — every spell, every monster — gives `entries` (how many) and `range` (the first and last) instead of listing them; name it as `section` to list them. Use it before reading a long document, to go straight to the part you need and to see how big it is.",
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: "The document's path from the project root, as list_documents gives it.",
        },
        section: {
          type: 'string',
          description:
            'List the subsections of one section — its link, or its title — rather than the whole document.',
        },
      },
      required: ['path'],
    },
  },
}

/**
 * @param {{path: string, section?: string}} args
 * @param {ToolContext} context
 */
export async function executeDescribeDocument(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const chat = context.chatId ? useChatsStore().getChatById(context.chatId) : null
  const { api, sees } = await open(context.storyId, chat)

  const document = findByPath(api, context.storyId, args.path, sees)
  if (!document) return noDocument(args.path)
  if (document.type === 'folder') {
    return { error: `"${args.path}" is a folder. list_documents lists what is in it.` }
  }
  const sections = sectionsOfText(document.content || '')
  const base = {
    id: document.id,
    title: document.title || '(untitled)',
    path: pathOf(api, document),
    ...sizeOf(document),
  }
  if (typeof args.section === 'string' && args.section.trim()) {
    const section = findSection(sections, args.section)
    if (!section) {
      return {
        error: `"${args.path}" has no section "${args.section}".`,
        ...(sections.length > 0 ? { sections: sectionTree(sections) } : {}),
      }
    }
    const inner = sections.filter(
      other => other.offset > section.offset && other.offset < section.until
    )
    return {
      ...base,
      section: {
        link: section.link,
        title: section.title,
        in: sectionPath(sections, sections.indexOf(section)),
        words: section.words,
      },
      ...(inner.length > 0
        ? { sections: sectionTree(inner, SUBTREE_LIMIT) }
        : { note: 'This section has no subsections; read_document reads it.' }),
    }
  }
  return {
    ...base,
    ...(sections.length > 0
      ? { sections: sectionTree(sections) }
      : {
          note: 'This document has no headings. read_document reads it from the top, a slice at a time when it is long.',
        }),
  }
}

/** How many nodes the subsections of one section list: a run of every spell is the answer. */
const SUBTREE_LIMIT = 600

/**
 * What a tool call read, as the notes it leaves on its result in the turn's
 * stored trajectory: the document, the path it was read at, and a hash of the
 * text it read. The project block reads them for what has changed since; see
 * ai/context/reads.js. Stripped before anything is sent, as every key that
 * starts with an underscore is.
 *
 * @param {string} toolName
 * @param {any} result - The tool's own return value, before it was serialized
 * @returns {{_document: string, _path: string, _hash: string}|null} Null for
 *   a call that read no document
 */
export function readNotes(toolName, result) {
  if (toolName !== 'read_document' || typeof result?.id !== 'string') return null
  const text = useDocumentsStore().getDocument(result.id)?.content || ''
  return { _document: result.id, _path: result.path || '', _hash: textHash(text) }
}

/**
 * Where each document is now for one chat, and what it says, for telling what
 * changed since the model read it. Null for a document the chat can no longer
 * see: deleted, or hidden from it.
 *
 * @param {string} storyId
 * @param {ChatMarks|null} [chat]
 * @returns {Promise<(id: string) => import('@/ai/context/reads.js').Located|null>}
 */
export async function documentLocator(storyId, chat) {
  const { api, sees } = await open(storyId, chat)
  return id => {
    const document = api.get(id)
    if (!document || document.type === 'folder' || !sees(document)) return null
    return { path: pathOf(api, document), text: document.content || '' }
  }
}

// ============================================================================
// search_documents — substring across titles and content
// ============================================================================

/** @type {ToolDefinition} */
export const searchDocumentsDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'search_documents',
    description:
      'Find every document that contains a word or phrase, with the passages around the hits. Case-insensitive, across titles and text. In a long document with sections, `titled` lists the sections named with the words — a section named exactly that comes first — and each passage says the `section` it is in and where that sits (`in`), so the next step is read_document(path, section) on the one you need, not a read of the document around it; `inSections` says how many sections the words appear in when more than are shown. In a long document without sections a passage gives its offset and page to read from. One call finds where something is said — a number, a name, a term — where opening documents one by one would cost a read each.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'The words to look for. A phrase is matched as written; when nothing has the phrase, documents that have every one of its words are returned instead, and the result says so. A few distinctive words find more than a whole question.',
        },
      },
      required: ['query'],
    },
  },
}

/** How many documents a search reports, and how many passages from each. */
const SEARCH_LIMIT = 20
const SNIPPETS_PER_DOCUMENT = 3

/**
 * The passages around each place a document says something, up to a few.
 *
 * @param {string} text
 * @param {string} needle - Lowercased
 * @returns {Array<{at: number, text: string}>} Each with the offset of the hit it is around
 */
function snippetsOf(text, needle) {
  const lower = text.toLowerCase()
  /** @type {Array<{at: number, text: string}>} */
  const snippets = []
  for (
    let index = lower.indexOf(needle);
    index !== -1 && snippets.length < SNIPPETS_PER_DOCUMENT;
    index = lower.indexOf(needle, index + needle.length)
  ) {
    const start = Math.max(0, index - 80)
    const end = Math.min(text.length, index + needle.length + 80)
    snippets.push({
      at: index,
      text:
        (start > 0 ? '…' : '') +
        text.slice(start, end).replace(/\s+/g, ' ') +
        (end < text.length ? '…' : ''),
    })
  }
  return snippets
}

/**
 * How many times a document says something, across its text.
 * @param {string} lower - The text, lowercased
 * @param {string} needle - Lowercased
 */
const countOf = (lower, needle) => (needle ? lower.split(needle).length - 1 : 0)

/**
 * A document searched for one needle: where it says it, and how often.
 *
 * @param {Document} document
 * @param {string} needle - Lowercased
 * @returns {{matches: number, snippets: Array<{at: number, text: string}>, inTitle: boolean}|null}
 *   Null when the document does not say it anywhere
 */
function findIn(document, needle) {
  const text = document.content || ''
  const inTitle = norm(document.title).includes(needle)
  const snippets = snippetsOf(text, needle)
  if (!inTitle && snippets.length === 0) return null
  return { matches: countOf(text.toLowerCase(), needle), snippets, inTitle }
}

/**
 * The passages a hit shows, each saying where it is in a long document, so
 * the model reads from that one rather than from the top or from the first.
 * A short document is read whole, so its passages say nothing.
 *
 * A long document with sections shows one passage from each of the first
 * few sections that say it, each with the section it is in — its link and
 * where it sits — so the next step is reading that section, not a slice of
 * the document around an offset.
 *
 * @param {Document} document
 * @param {Array<{at: number, text: string}>} snippets
 * @param {string} [needle] - Lowercased, for finding a passage in each section
 * @returns {{passages: Array<{text: string, at?: number, page?: number, section?: string, in?: string}>, sections?: number}}
 */
function passagesOf(document, snippets, needle) {
  const text = document.content || ''
  if (!isLong(text)) return { passages: snippets.map(({ text }) => ({ text })) }
  const sections = sectionsOfText(text)
  if (sections.length === 0 || !needle) {
    return {
      passages: snippets.map(({ at, text: passage }) => {
        const page = pageAt(text, at)
        return { at, ...(page !== null ? { page } : {}), text: passage }
      }),
    }
  }

  // One passage per section, in the order the text has them.
  const lower = text.toLowerCase()
  /** @type {Map<number, number>} section index → the first hit in it */
  const first = new Map()
  let scanned = 0
  for (
    let index = lower.indexOf(needle);
    index !== -1 && scanned < SCAN_LIMIT;
    index = lower.indexOf(needle, index + needle.length), scanned++
  ) {
    // A line of the index a conversion puts on top names the section; it
    // is not a place the text says it.
    const lineStart = text.lastIndexOf('\n', index) + 1
    if (INDEX_LINE.test(text.slice(lineStart, index + needle.length + 200))) continue
    const section = sectionIndexAt(sections, index)
    if (!first.has(section)) first.set(section, index)
  }
  const passages = [...first.entries()].slice(0, SECTIONS_PER_DOCUMENT).map(([section, at]) => {
    const [snippet] = snippetsOf(text.slice(Math.max(0, at - 80), at + needle.length + 80), needle)
    const page = pageAt(text, at)
    return {
      ...(section >= 0
        ? { section: sections[section].link, in: sectionPath(sections, section) }
        : {}),
      at,
      ...(page !== null ? { page } : {}),
      text: snippet ? snippet.text : '',
    }
  })
  return { passages, sections: first.size }
}

/** A line of a converted document's index: a link to one of its sections. */
const INDEX_LINE = /^[ \t]*- \[[^\n]*\]\(#[^)\s]+\)/

/** How many hits in one document a search looks through for their sections. */
const SCAN_LIMIT = 2000

/** How many sections of one document a search shows a passage from. */
const SECTIONS_PER_DOCUMENT = 6

/** How many sections titled with the words a search lists per document. */
const TITLED_LIMIT = 5

/**
 * The sections of a document titled with the words searched for: the ones
 * named exactly that first, then the ones whose titles hold them — so a
 * search for a spell leads with the spell's own entry, not the first page
 * that mentions it.
 *
 * @param {Document} document
 * @param {string} needle - Lowercased
 * @returns {{titled: Array<{section: string, in: string, words: number}>, exact: boolean}}
 */
function titledSections(document, needle) {
  const sections = sectionsOfText(document.content || '')
  const exact = []
  const holding = []
  sections.forEach((section, index) => {
    const title = norm(section.title)
    if (title === needle || section.link === slugOf(needle)) exact.push(index)
    else if (title.includes(needle)) holding.push(index)
  })
  const titled = [...exact, ...holding].slice(0, TITLED_LIMIT).map(index => ({
    section: sections[index].link,
    in: sectionPath(sections, index),
    words: sections[index].words,
  }))
  return { titled, exact: exact.length > 0 }
}

/**
 * @param {{query: string}} args
 * @param {ToolContext} context
 */
export async function executeSearchDocuments(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const { api, sees } = await open(context.storyId, context.chatId)

  const phrase = norm(args.query)
  if (!phrase) return { results: [] }
  const documents = visibleDocuments(api, context.storyId, sees).filter(
    document => document.type !== 'folder'
  )

  /**
   * @typedef {Object} Hit
   * @property {string} id
   * @property {string} title
   * @property {string} path
   * @property {number} matches
   * @property {Array<{text: string, at?: number, page?: number, section?: string, in?: string}>} passages - Up
   *   to a few, each with its offset and page in a long document, and its section where it has them
   * @property {Array<{section: string, in: string, words: number}>} [titled] - Sections named with the words
   * @property {number} [inSections] - How many sections have the words, when more than are shown
   * @property {boolean} [exact] - Whether a section is named exactly that; for ranking, not sent
   * @property {number} [words] - How long the document is, for deciding whether to read it whole
   * @property {number} [pages]
   */
  const toHit = (
    /** @type {Document} */ document,
    /** @type {NonNullable<ReturnType<typeof findIn>>} */ found,
    /** @type {string} */ needle
  ) => {
    const { passages, sections } = passagesOf(document, found.snippets, needle)
    const { titled, exact } = titledSections(document, needle)
    return {
      id: document.id,
      title: document.title || '(untitled)',
      path: pathOf(api, document),
      matches: found.matches,
      ...(titled.length > 0 ? { titled } : {}),
      passages,
      ...(sections !== undefined && sections > passages.length ? { inSections: sections } : {}),
      ...sizeOf(document),
      exact,
    }
  }

  /** @type {Hit[]} */
  let results = []
  for (const document of documents) {
    const found = findIn(document, phrase)
    if (found) results.push(toHit(document, found, phrase))
  }

  // A question rarely appears anywhere as written — "Marcus reranker
  // measured" is three words that a standup has in three places. When no
  // document has the phrase, the ones that have every word of it are the
  // next best answer, and the model is told that is what it is getting.
  let byWords = false
  const terms = [...new Set(phrase.split(/\s+/).filter(term => term.length > 1))]
  if (results.length === 0 && terms.length > 1) {
    byWords = true
    for (const document of documents) {
      const each = terms.map(term => findIn(document, term))
      if (each.some(found => !found)) continue
      // The passages around the scarcest word, which is the one that says
      // most about why this document matched.
      const rarest = each.reduce((best, found) => (found.matches < best.matches ? found : best))
      const rarestTerm = terms[each.indexOf(rarest)]
      results.push(
        toHit(
          document,
          {
            matches: rarest.matches,
            snippets: rarest.snippets,
            inTitle: each.some(found => found.inTitle),
          },
          rarestTerm
        )
      )
    }
  }

  // A document with a section named exactly that first; then the ones that
  // say it most, so a search for a term the whole project uses still leads
  // with the ones that are about it.
  results.sort((a, b) => Number(b.exact) - Number(a.exact) || b.matches - a.matches)
  const shown = results.slice(0, SEARCH_LIMIT).map(({ exact: _exact, ...hit }) => hit)
  return {
    results: shown,
    ...(byWords && shown.length > 0
      ? {
          matchedBy: 'words',
          note: 'No document has that phrase as written; these have every word of it.',
        }
      : {}),
    ...(results.length > shown.length
      ? {
          more: results.length - shown.length,
          note: 'More documents matched; a more specific phrase would narrow it.',
        }
      : {}),
  }
}

// ============================================================================
// create_document
// ============================================================================

/** @type {ToolDefinition} */
export const createDocumentDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'create_document',
    description:
      'Create a document in the project. Use this to record a new character, location, or piece of background, or to start a new chapter. The path says both what it is called and where it goes, so check list_documents for the folder that exists rather than assuming one — the folder has to be there already, and create_folder is how to add one.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'The full path of the new document: the folder it belongs in, then its title (e.g. "manuscript/Chapter 4", "notes/Characters/Elara"). A bare title puts it at the top level of the project.',
        },
        content: {
          type: 'string',
          description: 'The body text, in Markdown.',
        },
      },
      required: ['path', 'content'],
    },
  },
}

/**
 * @param {{path: string, content?: string}} args
 * @param {ToolContext} context
 */
export async function executeCreateDocument(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const { api, sees } = await open(context.storyId, context.chatId)

  const target = resolveNewPath(api, context.storyId, args.path, sees)
  if ('error' in target) return target

  if (context.propose) {
    return propose(context, {
      documentId: '',
      path: target.path,
      tool: 'create_document',
      old: '',
      new: args.content || '',
    })
  }

  const document = api.createTextDocument(target.parentId, target.title, args.content)
  record(context, {
    documentId: document.id,
    path: target.path,
    tool: 'create_document',
    old: '',
    new: document.content || '',
  })

  return {
    success: true,
    // Type and path both come back from what was stored: a model that asked
    // for the wrong thing can see that it did.
    document: {
      id: document.id,
      title: document.title,
      type: document.type,
      path: pathOf(api, api.get(document.id)),
    },
  }
}

// ============================================================================
// create_folder
// ============================================================================

/** @type {ToolDefinition} */
export const createFolderDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'create_folder',
    description:
      'Create an empty folder to hold documents. Only when the project has nowhere sensible to put something — the folders a project starts with are usually the right ones, and a folder holding one note is worse than the note sitting where it belongs.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'The full path of the new folder: where it goes, then its name (e.g. "notes/Factions"). Its own parent folder has to exist already.',
        },
      },
      required: ['path'],
    },
  },
}

/**
 * @param {{path: string}} args
 * @param {ToolContext} context
 */
export async function executeCreateFolder(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const { api, sees } = await open(context.storyId, context.chatId)

  const target = resolveNewPath(api, context.storyId, args.path, sees)
  if ('error' in target) return target

  const folder = api.createFolder(target.parentId, target.title)
  return {
    success: true,
    document: {
      id: folder.id,
      title: folder.title,
      type: folder.type,
      path: pathOf(api, api.get(folder.id)),
    },
  }
}

// ============================================================================
// update_document
// ============================================================================

/** @type {ToolDefinition} */
export const updateDocumentDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'update_document',
    description:
      "Change a document's title, or rewrite its whole body. Content replaces the whole body, so use it only for a rewrite: to change a passage use edit_document, and to add to the end use append_document.",
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: "The document's path from the project root.",
        },
        updates: {
          type: 'object',
          description: 'The fields to change',
          properties: {
            title: { type: 'string', description: 'New title' },
            content: {
              type: 'string',
              description: 'New body text in Markdown, replacing the old',
            },
          },
        },
      },
      required: ['path', 'updates'],
    },
  },
}

/**
 * @param {{path: string, updates: {title?: string, content?: string}}} args
 * @param {ToolContext} context
 */
export async function executeUpdateDocument(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const { api, store, sees } = await open(context.storyId, context.chatId)

  const document = findByPath(api, context.storyId, args.path, sees)
  if (!document) return noDocument(args.path)

  const updates = args.updates || {}
  /** @type {Partial<Document>} */
  const patch = {}
  if (typeof updates.title === 'string') patch.title = updates.title

  const hasContent = typeof updates.content === 'string'
  if (hasContent && document.type === 'folder') {
    return { error: 'A folder has no content to update' }
  }
  if (hasContent && document.type === 'file') return { error: fileIsNotWritten(args.path) }
  if (!hasContent && Object.keys(patch).length === 0) {
    return { error: 'No supported fields to update' }
  }

  // Content goes through the document API, which knows whether the editor
  // holds it; the rest is plain metadata the editor does not.
  if (Object.keys(patch).length > 0) store.updateDocument(document.id, patch)
  if (hasContent && context.propose) {
    return propose(context, {
      documentId: document.id,
      path: pathOf(api, document),
      tool: 'update_document',
      old: api.currentContent(document.id),
      new: updates.content,
    })
  }
  if (hasContent) {
    recording(context, api, document, 'update_document', () =>
      api.setContent(document.id, updates.content)
    )
  }

  const updated = api.get(document.id)
  return {
    success: true,
    document: { id: updated.id, title: updated.title, path: pathOf(api, updated) },
  }
}

// ============================================================================
// edit_document — one passage, replaced
// ============================================================================

/** @type {ToolDefinition} */
export const editDocumentDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'edit_document',
    description:
      'Change one passage of a document, leaving the rest exactly as it is. Give the passage as it reads now and what it should read instead. This is how to revise: it sends only what changes, so prefer it over update_document for anything short of a rewrite. The passage has to match the document exactly and exactly once, so quote it as read_document gave it and include enough of it to be unique.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: "The document's path from the project root.",
        },
        old: {
          type: 'string',
          description:
            'The passage to change, exactly as it appears in the document — same words, punctuation, line breaks, and Markdown.',
        },
        new: {
          type: 'string',
          description: 'What the passage becomes, in Markdown. Empty removes it.',
        },
      },
      required: ['path', 'old', 'new'],
    },
  },
}

/**
 * Whitespace as one space, for telling a wrong quote from a wrongly spaced one.
 * @param {string} text
 */
const squash = text => text.replace(/\s+/g, ' ').trim()

/**
 * The lines of a document most like the passage that was not found, for a
 * model to see what it misquoted. Likeness is shared word bigrams against the
 * passage's first line; the window is that line with one either side.
 *
 * @param {string} content
 * @param {string} passage
 * @returns {string} A few lines of the document, or its opening when nothing is alike
 */
export function nearestContext(content, passage) {
  const lines = content.split('\n')
  const probe = passage.split('\n').find(line => line.trim()) || ''
  const bigrams = (/** @type {string} */ text) => {
    const words = squash(text).toLowerCase().split(' ')
    return new Set(words.slice(1).map((word, i) => `${words[i]} ${word}`))
  }
  const target = bigrams(probe)

  let best = -1
  let score = 0
  lines.forEach((line, i) => {
    const own = bigrams(line)
    let shared = 0
    for (const gram of own) if (target.has(gram)) shared++
    const likeness = shared / Math.max(1, Math.max(own.size, target.size))
    if (likeness > score) {
      score = likeness
      best = i
    }
  })

  if (best === -1) return lines.slice(0, 3).join('\n')
  return lines.slice(Math.max(0, best - 1), best + 2).join('\n')
}

/**
 * @param {{path: string, old: string, new: string}} args
 * @param {ToolContext} context
 */
export async function executeEditDocument(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const { api, sees } = await open(context.storyId, context.chatId)

  const document = findByPath(api, context.storyId, args.path, sees)
  if (!document) return noDocument(args.path)
  if (document.type === 'folder') return { error: 'A folder has no content to edit' }
  if (document.type === 'file') return { error: fileIsNotWritten(args.path) }

  const old = typeof args.old === 'string' ? args.old : ''
  const replacement = typeof args.new === 'string' ? args.new : ''
  if (!old)
    return { error: 'Give the passage to change as "old"; to add text, use append_document.' }

  /** @type {{applied: boolean, count: number}} */
  let outcome = { applied: false, count: 0 }
  if (context.propose) {
    // Checked as if applied, so a misquote is corrected now rather than when
    // the writer accepts.
    const count = api.currentContent(document.id).split(old).length - 1
    outcome = { applied: count === 1, count }
  } else {
    recording(context, api, document, 'edit_document', () => {
      outcome = api.replaceText(document.id, old, replacement)
    })
  }
  const { applied, count } = outcome
  if (!applied) {
    const content = api.currentContent(document.id)
    if (count > 1) {
      return {
        error: `"old" appears ${count} times in "${args.path}". Include more of the surrounding text so it matches once.`,
      }
    }
    const spacedDifferently = squash(content).includes(squash(old))
    return {
      error: spacedDifferently
        ? `"old" was not found in "${args.path}" as written, though the words are there: the line breaks or spacing differ. Quote the passage exactly as read_document gave it.`
        : `"old" was not found in "${args.path}". Quote the passage exactly as read_document gave it; the nearest lines are in "nearest".`,
      nearest: nearestContext(content, old),
    }
  }

  if (context.propose) {
    return propose(context, {
      documentId: document.id,
      path: pathOf(api, document),
      tool: 'edit_document',
      old,
      new: replacement,
    })
  }

  return {
    success: true,
    document: { id: document.id, title: document.title, path: pathOf(api, document) },
    charactersRemoved: old.length,
    charactersWritten: replacement.length,
  }
}

// ============================================================================
// append_document
// ============================================================================

/** @type {ToolDefinition} */
export const appendDocumentDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'append_document',
    description:
      'Add text to the end of a document, leaving what is already there untouched. This is how to continue a chapter or add to a set of notes: it costs nothing to send and cannot accidentally rewrite existing prose, unlike replacing the whole body with update_document.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: "The document's path from the project root.",
        },
        text: {
          type: 'string',
          description:
            'The text to add, in Markdown. For story prose this is narrator voice only — no chat or meta commentary, no questions to the writer, no out-of-scene asides.',
        },
      },
      required: ['path', 'text'],
    },
  },
}

/**
 * @param {{path: string, text: string}} args
 * @param {ToolContext} context
 */
export async function executeAppendDocument(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const { api, sees } = await open(context.storyId, context.chatId)

  const document = findByPath(api, context.storyId, args.path, sees)
  if (!document) return noDocument(args.path)
  if (document.type === 'folder') return { error: 'A folder has no content to append to' }
  if (document.type === 'file') return { error: fileIsNotWritten(args.path) }

  const text = typeof args.text === 'string' ? args.text : ''
  if (!text.trim()) return { error: 'No text provided' }

  if (context.propose) {
    return propose(context, {
      documentId: document.id,
      path: pathOf(api, document),
      tool: 'append_document',
      old: '',
      new: text,
    })
  }

  recording(context, api, document, 'append_document', () => api.appendContent(document.id, text))

  return {
    success: true,
    document: { id: document.id, title: document.title, path: pathOf(api, document) },
    charactersWritten: text.length,
  }
}

// ============================================================================
// applyProposal — what the writer's Accept runs
// ============================================================================

/**
 * Make a change that was proposed, now that the writer has accepted it.
 *
 * Applied through the document API like the tool would have, and recorded
 * the same way: what comes back is the pair as applied, cut small, which is
 * what rewinding past the turn will undo. A passage that has changed since
 * it was proposed is refused — the writer's version stands, and they are
 * told.
 *
 * @param {string} storyId
 * @param {DocumentEdit} edit - As proposed
 * @returns {Promise<{documentId: string, path: string, old: string, new: string}|{error: string}>}
 */
export async function applyProposal(storyId, edit) {
  const { api, store, sees } = await open(storyId)

  if (edit.tool === 'create_document') {
    const target = resolveNewPath(api, storyId, edit.path, sees)
    if ('error' in target) return target
    const document = api.createTextDocument(target.parentId, target.title, edit.new)
    if (typeof edit.summary === 'string')
      store.updateDocument(document.id, { summary: edit.summary })
    return { documentId: document.id, path: target.path, old: '', new: document.content || '' }
  }

  const document = api.get(edit.documentId)
  if (!document || document.type !== 'text') return noDocument(edit.path)

  const before = api.currentContent(document.id)
  if (edit.tool === 'edit_document') {
    if (!api.replaceText(document.id, edit.old, edit.new).applied) {
      return { error: 'The passage has changed since this was proposed.' }
    }
  } else if (edit.tool === 'append_document') {
    api.appendContent(document.id, edit.new)
  } else {
    api.setContent(document.id, edit.new)
  }

  const pair = pairOf(edit.tool, before, api.currentContent(document.id)) || { old: '', new: '' }
  return { documentId: document.id, path: pathOf(api, document), ...pair }
}
