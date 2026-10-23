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
 * path it guesses right has to read the same as one it guesses wrong. The
 * whole tree is consulted only where a name is given — `resolveNewPath`, and a
 * title in `update_document` — so that a document is never created or renamed
 * on top of one the model cannot see.
 *
 * A chat that plays a card reads it with the names in. The documents say
 * `{{char}}` and `{{user}}`, and `open` hands such a chat a view of the tree in
 * which titles, summaries and text have them filled in, so every listing,
 * read, search and offset is of the text its model is shown. What it writes
 * goes in as written; see cards/macros.js.
 *
 * A chat can ask the writer before anything changes. Then a writing tool
 * checks what it would do, records it as proposed, and tells the model so;
 * `applyProposal` is what the writer's Accept runs. Title changes
 * still go straight in — they are the listing, not the prose.
 *
 * A chat that asks first suggests a change to
 * a document's text instead, in the text itself: `edit_document`,
 * `append_document` and `update_document` write the change as marks the
 * writer accepts or rejects there, each change on its own, with a thread for
 * each beside the comments' (see editor/suggestions.js). Its model reads the document with its own
 * pending suggestions made and everyone else's not, as Docs shows a writer
 * theirs, and a later change that touches one goes into it. Every other chat
 * reads the text as it stands. A suggestion is recorded with the turn as any
 * write is, so rewinding past the turn takes it back, or puts back the one it
 * went into as it was.
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
import {
  describeRepository,
  inRepository,
  isRepository,
  isSourceFile,
  repositoryOf,
} from '@/source/tree.js'
import { languageOf } from '@/source/language.js'
import { lineCount } from '@/source/text.js'
import {
  OPEN_MARKUP,
  commentOn,
  commentsGone,
  commentsInDoc,
  countOpen,
  editAroundComments,
  newCommentId,
  newPost,
  newThread,
  placedIds,
  plainPassage,
  quoteWithoutComments,
  rewriteAroundComments,
  threadState,
  withoutComment,
  withoutComments,
} from '@/editor/comments.js'
import { parseMarkdown, serializeMarkdown, appendBlocks } from '@/editor/markdown.js'
import {
  acceptSuggestion,
  changeOf,
  newSuggestionId,
  seeing,
  suggestChange,
  suggestionsIn,
} from '@/editor/suggestions.js'
import { holdsSuggestions, withoutSuggestionMarkup } from '@/editor/suggestionText.js'
import { commentsBetween, ownSuggestions, placedAsRead, postsOf, seenText } from './commentReads.js'
import { peopleOf } from '@/cloud/people.js'
import { extensionFor } from '@/files/inspect.js'
import { namesOf, storedPassage, substitute } from '@/cards/macros.js'
import { currentDigests } from '@/jobs/index.js'

/**
 * The answer for a path nothing is at. When the path is one of the files of a
 * skill the model loads, it says how that is read: told only that there is no
 * such document, a model asked to read a skill's file goes on looking among
 * the project's. When something elsewhere goes by the name the path ends in,
 * it says where (see `namedElsewhere`).
 *
 * @param {string} path
 * @param {string[]} [named] - Paths of what goes by that name elsewhere
 * @returns {{error: string}}
 */
function noDocument(path, named = []) {
  const owner = skillWithFile(path)
  return {
    error: owner
      ? `No document at "${path}". It is one of the ${owner} skill's files, not a document: read it with use_skill(name: "${owner}", file: "${path}").`
      : `No document at "${path}". ${goesByThatName(named) || 'list_documents shows what the project holds.'}`,
  }
}

/**
 * Where something by the name a missed path ends in is: a model told to
 * delete "the Standups folder" asks for "Standups", and the folder is
 * "Notes/Standups". Told only that nothing is at "Standups", a model has
 * listed the top of the project, searched for the word, found neither, and
 * told the writer there is no such folder. Only said, never acted on: two
 * folders can hold one name, and the path is the address.
 *
 * @param {DocumentsApi} api
 * @param {string} storyId
 * @param {string} path
 * @param {(document: Document) => boolean} [sees] - Absent for every document
 * @param {(document: Document) => boolean} [kind] - Which documents count: folders, for a folder asked for
 * @returns {string[]} A few paths, those nearest the top first
 */
function namedElsewhere(api, storyId, path, sees, kind = () => true) {
  const name = norm(path).replace(/\/+$/, '').split('/').pop()
  if (!name) return []
  return (sees ? visibleDocuments(api, storyId, sees) : allDocuments(api, storyId))
    .filter(document => norm(document.title) === name && kind(document))
    .map(document => pathOf(api, document))
    .sort((a, b) => a.split('/').length - b.split('/').length)
    .slice(0, 3)
}

/**
 * @param {string[]} named - Paths from `namedElsewhere`
 * @returns {string} A sentence saying where they are, or nothing
 */
function goesByThatName(named) {
  if (named.length === 0) return ''
  if (named.length === 1) return `"${named[0]}" goes by that name.`
  return `These go by that name: ${named.map(path => `"${path}"`).join(', ')}.`
}

/** @typedef {import('./registry.js').ToolDefinition} ToolDefinition */
/** @typedef {import('prosemirror-model').Node} Node */
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
 * again. An append's is what arrived at the end; see diffAppend. A
 * suggestion's is found where it is, whatever tool made it.
 * @param {string} tool
 * @param {string} before
 * @param {string} after
 * @param {boolean} [suggested]
 */
const pairOf = (tool, before, after, suggested = false) =>
  tool === 'append_document' && !suggested ? diffAppend(before, after) : diffEdit(before, after)

/**
 * Run a write and record what it changed as the smallest reversible pair,
 * with the comment threads it changed beside the text.
 * @param {ToolContext} context
 * @param {DocumentsApi} api
 * @param {Document} document
 * @param {string} tool
 * @param {() => void} write
 * @param {import('@/types/models.js').CommentChange[]} [comments]
 * @param {boolean} [suggested] - Whether the write was a suggestion
 */
function recording(context, api, document, tool, write, comments, suggested = false) {
  const before = api.currentContent(document.id)
  api.fromOutside(document.id, 'model', write)
  const pair = pairOf(tool, before, api.currentContent(document.id), suggested)
  if (pair) {
    record(context, {
      documentId: document.id,
      path: pathOf(api, document),
      tool,
      ...pair,
      ...(comments?.length ? { comments } : {}),
      ...(suggested ? { suggested: true } : {}),
    })
  }
}

/** @typedef {import('@/utils/visibility.js').ChatMarks} ChatMarks */

/**
 * Load a story's tree and hand back the pieces the tools need, with how the
 * chat asking reads it.
 *
 * A chat with names reads the tree through them: `api` is a view whose
 * documents have the names filled in, and `stored` the tree as it is, for
 * what has to be said about the text itself rather than read from it.
 *
 * @param {string} storyId
 * @param {(ChatMarks & {id?: string, userName?: string, characterName?: string})|string|null} [chat] -
 *   The chat, or its id. Without one only what is hidden outright is left out,
 *   which is what the writer's own Accept reads by, nothing is filled in, and
 *   no suggestion is seen made.
 */
async function open(storyId, chat) {
  const api = useDocuments(storyId)
  await api.init()
  const marks = typeof chat === 'string' ? useChatsStore().getChatById(chat) : chat
  const chatId = typeof chat === 'string' ? chat : chat?.id
  const { sees, markFor } = chatVisibility(marks, api.get)
  const names = namesOf(marks)
  return {
    api: readerView(api, names, chatId),
    stored: api,
    chatId,
    names,
    store: useDocumentsStore(),
    sees,
    markFor,
    marks,
  }
}

/**
 * The tree as a chat reads it. A text document's text comes without the
 * comments' markup, whose threads a read lists after the text, with the
 * chat's own pending suggestions made and every other not, and a chat with
 * names has them filled in. Documents are what the view hands out, so a
 * tool walking the tree, building a path, reading a body or searching one
 * never meets a marker or a macro, and every offset it gives is of the text
 * the model is shown; writes go to the tree as it is.
 *
 * @param {DocumentsApi} api
 * @param {import('@/cards/macros.js').Names|null} names
 * @param {string|null|undefined} chatId
 * @returns {DocumentsApi}
 */
function readerView(api, names, chatId) {
  const read = (/** @type {Document|undefined} */ document) =>
    document && readable(document, names, chatId)
  return {
    ...api,
    get: id => read(api.get(id)),
    childrenOf: id => api.childrenOf(id).map(read),
  }
}

/**
 * A document as a chat reads it: the names in its title, summary, digest
 * and text, and its text without the comments' markup and with suggestions
 * as the chat sees them. The same document back when there is nothing to
 * change.
 *
 * The text only when it is asked for: a path is built from every document
 * above it, and the tree is walked whole for every listing and search, while
 * the body of a long file is read rarely.
 *
 * @param {Document} document
 * @param {import('@/cards/macros.js').Names|null} names
 * @param {string|null|undefined} chatId
 * @returns {Document}
 */
function readable(document, names, chatId) {
  const content = document.type === 'text' ? document.content || '' : ''
  const marked = content.includes(OPEN_MARKUP) || (!document.plain && holdsSuggestions(content))
  if (!marked && !names) return document
  /** @type {string|null} */
  let shown = null
  const view = { ...document }
  if (names) {
    view.title = substitute(document.title, names)
    if (document.summary) view.summary = substitute(document.summary, names)
    if (document.digest) {
      view.digest = {
        ...document.digest,
        line: substitute(document.digest.line, names),
        text: substitute(document.digest.text, names),
        ...(document.digest.sections
          ? {
              sections: document.digest.sections.map(section => ({
                ...section,
                line: substitute(section.line, names),
              })),
            }
          : {}),
      }
    }
  }
  const text = () =>
    marked ? withoutComments(seenText(document, content, chatId)) : document.content
  return Object.defineProperty(view, 'content', {
    enumerable: true,
    get: () => (shown ??= names ? substitute(text(), names) : text()),
  })
}

/**
 * What a read of a document is told apart by, for telling whether it has
 * changed since: its text as stored and what its comments say, so a reply
 * or a resolve is a change as an edit is. Hashed by `readKey` for a read's
 * note, and by the project block from `documentLocator`'s text.
 *
 * @param {Document|undefined} document - As stored
 * @returns {string}
 */
function readBasis(document) {
  const content = document?.content || ''
  const threads = document?.comments
  if (!threads) return content
  const said = Object.entries(threads).map(([id, thread]) => [id, thread.status, thread.posts])
  return `${content}\u0000${JSON.stringify(said)}`
}

/**
 * @param {Document|undefined} document - As stored
 * @returns {string}
 */
const readKey = document => textHash(readBasis(document))

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
 * A document or folder by its path, as a chat sees and reads it, with its
 * path as the tools give it: for a tool kept in a module of its own. Null
 * when the chat sees nothing there.
 *
 * @param {string} storyId
 * @param {string|null|undefined} chatId
 * @param {string} path - `/` for the project
 * @returns {Promise<{document: Document, path: string}|null>}
 */
export async function documentForChat(storyId, chatId, path) {
  const { api, sees } = await open(storyId, chatId)
  const document = findByPath(api, storyId, path, sees)
  return document ? { document, path: pathOf(api, document) } : null
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
 * Nothing is made inside a repository: its files are what was imported, and
 * a refresh settles it against where it came from.
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
  if (repositoryOf(api.get, parent)) {
    return { error: `"${parentPath}" is in a repository, which is read-only. Put it elsewhere.` }
  }

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
 * @property {number} [lines] - A source file's lines, in place of words
 * @property {number} [comments] - How many of the writer's comments it holds, when any
 */

/**
 * @typedef {Object} ProjectOverview
 * @property {string} project - The project's name
 * @property {string} [summary] - The story's overview, when someone wrote one
 * @property {string} [about] - What explore said the project holds, when no
 *   one wrote an overview
 * @property {{documents: number, folders: number}} [size] - How much of it the
 *   chat can see, so the model knows there is more than the block shows. Not
 *   for a model that can't reach the rest.
 */

/**
 * How long a document is, for a model deciding whether to read it whole.
 *
 * A folder has no length of its own. A file says its pages too, when it has
 * them, since a page is what a paged read will take. A source file says
 * lines instead of words: code is read and cited by line. A text document
 * says how many of the writer's comments it holds, when it holds any.
 *
 * @param {Document} document
 * @param {(id: string) => Document|undefined} [get] - For telling a source
 *   file, which is one by being in a repository
 * @returns {{words?: number, pages?: number, lines?: number, comments?: number}}
 */
function sizeOf(document, get) {
  if (document.type === 'folder') return {}
  if (get && isSourceFile(get, document)) return { lines: lineCount(document.content || '') }
  const comments = document.type === 'text' ? countOpen(document.comments) : 0
  return {
    words: document.wordCount || 0,
    ...(typeof document.pages === 'number' ? { pages: document.pages } : {}),
    ...(comments > 0 ? { comments } : {}),
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
  const { api, sees, markFor } = await open(storyId, chat)

  return allDocuments(api, storyId)
    .filter(document => document.type !== 'folder' && sees(document))
    .filter(document => markFor(document) === 'pinned')
    .map(document => ({
      id: document.id,
      path: pathOf(api, document),
      type: document.type,
      ...sizeOf(document, api.get),
    }))
}

/**
 * What the project block says of the project itself: its name, the story's
 * overview (or the line of explore's digest of it, where there is none), and
 * how much is in it for this chat.
 *
 * Not the tree. The block moves forward to the newest message every turn, so
 * no prompt cache covers it, and a listing there is paid in full on every
 * request; the model lists the project when it needs to.
 *
 * @param {string} storyId
 * @param {ChatMarks|null} [chat] - The chat it is for, whose marks say what it sees
 * @param {{size?: boolean}} [options] - `size: false` leaves out how much is
 *   in it, for a chat offered no tool to reach any of it
 * @returns {Promise<ProjectOverview|null>}
 */
export async function projectOverview(storyId, chat, { size = true } = {}) {
  const { api, sees } = await open(storyId, chat)
  const root = api.get(rootIdFor(storyId))
  if (!root) return null
  const summary = root.summary?.trim()
  const about = !summary && currentDigests(storyId)(root.id) ? root.digest?.line : undefined
  const overview = {
    project: root.title || 'Untitled',
    ...(summary ? { summary } : {}),
    ...(about ? { about } : {}),
  }
  if (!size) return overview
  const seen = visibleDocuments(api, storyId, sees).filter(document => document.id !== root.id)
  const folders = seen.filter(document => document.type === 'folder').length
  return { ...overview, size: { documents: seen.length - folders, folders } }
}

// ============================================================================
// list_documents — what the project holds, by full path
// ============================================================================

/** How many entries a listing shows before it lists less deep. */
export const LISTING_LIMIT = 200

const LISTING =
  'List what the project holds, or what is under one folder: a line for each document and folder, by the full path every tool takes, with how long each document is, how many comments the user left on it, and whether they pinned it, and under it, indented, what it is about where that has been said: the user\'s summary, or a description written for you from its text by explore_documents. A folder ends in "/". Everything under the folder is listed when it fits; in a large project, a folder further down says how many it holds instead, and listing it shows them. A repository (a codebase) is one line until its own path is listed; its files are code, measured in lines.'

/** The longest a listing's line on what something is about runs, in characters. */
const ABOUT_MOST = 300

/**
 * What a listing says a document or folder is about: the first line of the
 * writer's summary, or else of explore's digest while it is current.
 *
 * @param {Document} document
 * @param {(id: string) => boolean} current - Which digests are current
 * @returns {string}
 */
function aboutLine(document, current) {
  const digest = document.digest && current(document.id) ? document.digest.line : ''
  const line = (document.summary?.trim().split('\n')[0] || digest).replace(/\s+/g, ' ').trim()
  if (line.length <= ABOUT_MOST) return line
  const cut = line.slice(0, ABOUT_MOST)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), ABOUT_MOST / 2))}…`
}

/** @type {ToolDefinition} */
export const listDocumentsDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'list_documents',
    description: LISTING,
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
 * What kind of file a file document is, for its listing: `file, pdf`. The
 * title lost its extension at import, and a link to the file needs it.
 *
 * @param {Document} document
 * @returns {string}
 */
function fileKind(document) {
  const extension = extensionFor(document.mime || '')
  return extension ? `file, ${extension}` : 'file'
}

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
  const facts = isSourceFile(api.get, document)
    ? ['code', `${counted(lineCount(document.content || ''))} lines`]
    : [
        ...(document.type === 'file' ? [fileKind(document)] : []),
        ...(typeof document.pages === 'number' ? [`${counted(document.pages)} pages`] : []),
        `${counted(document.wordCount || 0)} words`,
      ]
  const comments = document.type === 'text' ? countOpen(document.comments) : 0
  if (comments > 0) facts.push(comments === 1 ? '1 comment' : `${counted(comments)} comments`)
  if (markFor(document) === 'pinned') facts.push('pinned')
  return `${path} — ${facts.join(', ')}`
}

/**
 * List what is under a folder, by full path, as deep as fits in
 * LISTING_LIMIT entries or as deep as asked.
 *
 * Text rather than JSON: a listing is all names, and a line per name is a
 * fraction of the tokens. Full paths rather than indentation, so a small model
 * copies a path rather than assembling one. What an entry is about, where
 * something says, goes indented under it: the line is the address, and what
 * is under it is not.
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
  if (!folder) {
    const named = namedElsewhere(api, context.storyId, asked, sees, doc => doc.type === 'folder')
    return {
      error: `No folder at "${asked}". ${goesByThatName(named) || 'list_documents with no path lists the whole project.'}`,
    }
  }
  if (folder.type !== 'folder') {
    return { error: `"${asked}" is a document, not a folder. read_document reads it.` }
  }

  // A repository listed from above is one line however deep the listing
  // goes: its files would otherwise fill the listing, and push the writer's
  // own folders up to their first level. Listing the repository lists it.
  /** @type {Map<string, number>} repository folder → how many files are in it */
  const folded = new Map()
  let entries = entriesBelow(api, folder.id, sees)
  if (!repositoryOf(api.get, folder)) {
    /** @type {{id: string, depth: number}|null} */
    let inside = null
    entries = entries.filter(entry => {
      if (inside && entry.depth > inside.depth) {
        if (entry.document.type !== 'folder') {
          folded.set(inside.id, (folded.get(inside.id) || 0) + 1)
        }
        return false
      }
      inside = null
      if (isRepository(entry.document)) {
        inside = { id: entry.document.id, depth: entry.depth }
        folded.set(entry.document.id, 0)
      }
      return true
    })
  }
  if (entries.length === 0) return `"${asked}" is empty.`
  const current = currentDigests(context.storyId)

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
      const files = folded.get(entry.document.id)
      if (files !== undefined) {
        return `${pathOf(api, entry.document)}/ — ${describeRepository(entry.document, files)}, not listed`
      }
      let hidden = null
      if (entry.document.type === 'folder' && entry.depth === depth) {
        hidden = 0
        for (const below of entries.slice(at + 1)) {
          if (below.depth <= entry.depth) break
          hidden++
        }
      }
      const line = listingLine(api, entry.document, markFor, hidden)
      const about = aboutLine(entry.document, current)
      return about ? `${line}\n  ${about}` : line
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
      'Read a document. What you read stays in the conversation: if the document changes afterwards, the project block lists it under `changed`, and reading it again gets the new text; reading something unchanged that is still above says so rather than sending it again. A document up to about 7,000 words comes whole; a longer one comes one slice at a time, with `next` for the offset to go on from and its top sections with their links. For a long document, look at its sections with describe_document first and read the ones you need with `section`, rather than paging through it. A source file in a repository comes with its line numbers, and is read by line with `line` and `until`.',
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
        line: {
          type: 'integer',
          description:
            'For a source file: the first line to read, counted from 1, as a search hit or `next` gave it. Default 1.',
        },
        until: {
          type: 'integer',
          description:
            'For a source file: the last line to read. Default: as far as one read goes, with `next` for the line to go on from.',
        },
      },
      required: ['path'],
    },
  },
}

/** How long a line of code a read shows before it is cut. */
const LINE_LIMIT = 2000

/**
 * A source file read by line: numbered, from `line` to `until` or as far as
 * a read goes. No sections — a `#` that starts a line of Python or shell is
 * a comment, not a heading — and no offsets: code is cited by line, and the
 * numbers on each line are what make that possible without counting.
 *
 * @param {Document} document
 * @param {Record<string, any>} base - What every read answers with
 * @param {{line?: number, until?: number, from?: number}} args
 * @returns {Record<string, any>}
 */
function readSource(document, base, args) {
  const text = document.content || ''
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
  const total = text ? lines.length : 0
  const kind = {
    type: 'file',
    language: languageOf(document.title || '').language,
  }
  if (total === 0) return { ...base, ...kind, content: '', note: 'This file is empty.' }

  // A source file has no offsets: a `from` given to one, as a model used to
  // prose will give, is the line it meant.
  const first = Math.max(1, Math.floor(Number(args.line ?? args.from) || 1))
  if (first > total) {
    return { error: `"${base.path}" has ${total} lines; line ${first} is past the end.` }
  }
  const asked = Math.floor(Number(args.until) || 0)
  const last = asked >= first ? Math.min(total, asked) : total

  // As far as the budget goes, but always at least the first line.
  const cost = (/** @type {string} */ line) => Math.min(line.length, LINE_LIMIT) + 8
  let to = first
  let size = cost(lines[first - 1])
  while (to < last && size + cost(lines[to]) <= READ_BUDGET) {
    size += cost(lines[to])
    to++
  }

  const width = String(to).length
  const content = lines
    .slice(first - 1, to)
    .map((line, at) => {
      const shown =
        line.length > LINE_LIMIT
          ? `${line.slice(0, LINE_LIMIT)}… (${counted(line.length - LINE_LIMIT)} more characters)`
          : line
      return `${String(first + at).padStart(width)}\t${shown}`
    })
    .join('\n')

  const whole = first === 1 && to === total
  return {
    ...base,
    ...kind,
    ...(whole ? {} : { line: first, until: to }),
    ...(to < last ? { next: to + 1, note: 'There is more: read again with line: next.' } : {}),
    ...(!whole && to === total ? { note: 'This is the end of the file.' } : {}),
    content,
  }
}

/**
 * @param {{path: string, section?: string, from?: number, page?: number, line?: number, until?: number}} args
 * @param {ToolContext} context
 */
export async function executeReadDocument(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const { api, stored, sees, names, chatId } = await open(context.storyId, context.chatId)

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
  // By the text as stored, which is what the read's note hashed: see readNotes.
  const messages = context.conversation?.()
  const hash = readKey(stored.get(document.id))
  if (messages && readInView(messages, document.id, args, hash)) {
    return {
      path: pathOf(api, document),
      unchanged: 'Unchanged since you read this earlier in the conversation; that read is above.',
    }
  }

  const base = {
    id: document.id,
    title: document.title || '(untitled)',
    path: pathOf(api, document),
    ...sizeOf(document, api.get),
    // Where a page or a file kept from the web came from, to cite it by.
    ...(document.url ? { source: document.url } : {}),
  }

  if (isSourceFile(api.get, document)) return readSource(document, base, args)

  // The open comments whose passages end in what was read, after its text:
  // a comment over the end of a slice comes with the slice that has its last
  // words. In their place, the count of the document's.
  const placed =
    document.type === 'text' ? placedAsRead(stored.get(document.id), names, chatId) : null
  /**
   * @template {Record<string, any>} T
   * @param {T} result
   * @param {number} from
   * @param {number} to
   */
  const withComments = (result, from, to) => {
    const listed = placed
      ? commentsBetween(placed, names, from, to, peopleOf(document.storyId))
      : []
    const { comments: _count, ...rest } = result
    return listed.length > 0 ? { ...rest, comments: listed } : rest
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
      return withComments(
        {
          ...base,
          ...kind,
          section: named,
          content: text.slice(section.offset, section.until),
        },
        section.offset,
        section.until
      )
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
    return withComments(
      {
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
      },
      slice.from,
      slice.to
    )
  }

  if (!long) return withComments({ ...base, ...kind, content: text }, 0, text.length)

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
  return withComments(
    {
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
    },
    slice.from,
    slice.to
  )
}

/** How many sections a read shows at most, beside its text; describe_document shows more. */
const MAP_NODES = 60

// ============================================================================
// describe_document — a document's sections, for reading by section
// ============================================================================

const DESCRIBE =
  "A document's sections, without its text: its headings as a tree, each with the link read_document takes as `section` and how many words it runs to, its subsections included. A section with a long run of subsections — every term in a glossary, every entry in a reference — gives `entries` (how many) and `range` (the first and last) instead of listing them; name it as `section` to list them. Use it before reading a long document, to go straight to the part you need and to see how big it is. Where explore_documents wrote a description of the document from its text, `about` gives it: what it covers, the names in it, and when to read it; a long section can have an `about` line of its own. A folder that has one gives it too."

/** @type {ToolDefinition} */
export const describeDocumentDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'describe_document',
    description: DESCRIBE,
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
  const { api, sees } = await open(context.storyId, context.chatId)

  const document = findByPath(api, context.storyId, args.path, sees)
  if (!document) return noDocument(args.path)
  // What explore wrote of it and of its long sections, for the model, while
  // it is current.
  const digest =
    document.digest && currentDigests(context.storyId)(document.id) ? document.digest : null
  const about = digest ? digestAbout(digest) : undefined
  const lines = sectionLines(digest)
  if (document.type === 'folder') {
    if (!about) {
      return { error: `"${args.path}" is a folder. list_documents lists what is in it.` }
    }
    const path = pathOf(api, document)
    return {
      path: path === '/' ? path : `${path}/`,
      about,
      note: 'list_documents lists what is in it.',
    }
  }
  const base = {
    id: document.id,
    title: document.title || '(untitled)',
    path: pathOf(api, document),
    ...sizeOf(document, api.get),
    ...(about ? { about } : {}),
  }
  if (isSourceFile(api.get, document)) {
    return {
      ...base,
      language: languageOf(document.title || '').language,
      note: 'A source file has no sections. read_document reads it by line, with line and until; search_documents finds the lines that mention something.',
    }
  }
  const sections = sectionsOfText(document.content || '')
  if (typeof args.section === 'string' && args.section.trim()) {
    const section = findSection(sections, args.section)
    if (!section) {
      return {
        error: `"${args.path}" has no section "${args.section}".`,
        ...(sections.length > 0
          ? { sections: withSectionLines(sectionTree(sections), lines) }
          : {}),
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
        ...(lines.has(section.link) ? { about: lines.get(section.link) } : {}),
      },
      ...(inner.length > 0
        ? { sections: withSectionLines(sectionTree(inner, SUBTREE_LIMIT), lines) }
        : { note: 'This section has no subsections; read_document reads it.' }),
    }
  }
  return {
    ...base,
    ...(sections.length > 0
      ? { sections: withSectionLines(sectionTree(sections), lines) }
      : {
          note: 'This document has no headings. read_document reads it from the top, a slice at a time when it is long.',
        }),
  }
}

/**
 * What explore said of a document or folder, as one paragraph: its line in
 * front of its paragraph, unless the paragraph already begins with it, as it
 * does where the model wrote only the one.
 *
 * @param {import('@/types/models.js').Digest} digest
 * @returns {string}
 */
export function digestAbout({ line, text }) {
  if (!line || text.startsWith(line)) return text
  if (!text) return line
  return `${line}${/[.!?:]$/.test(line) ? '' : '.'} ${text}`
}

/**
 * The lines explore wrote of a document's long sections, by link.
 *
 * @param {import('@/types/models.js').Digest|null|undefined} digest - Current, or none
 * @returns {Map<string, string>}
 */
export function sectionLines(digest) {
  return new Map((digest?.sections || []).map(section => [section.link, section.line]))
}

/**
 * A section tree with explore's line, as `about`, on each section that has
 * one: what is in it, for telling which to read.
 *
 * @param {import('@/utils/sections.js').SectionNode[]} nodes
 * @param {Map<string, string>} lines - By link
 * @returns {import('@/utils/sections.js').SectionNode[]}
 */
export function withSectionLines(nodes, lines) {
  if (lines.size === 0) return nodes
  return nodes.map(({ sections, ...node }) => ({
    ...node,
    ...(lines.has(node.link) ? { about: lines.get(node.link) } : {}),
    ...(sections ? { sections: withSectionLines(sections, lines) } : {}),
  }))
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
  const hash = readKey(useDocumentsStore().getDocument(result.id))
  return { _document: result.id, _path: result.path || '', _hash: hash }
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
  const { api, stored, sees } = await open(storyId, chat)
  return id => {
    const document = api.get(id)
    if (!document || document.type === 'folder' || !sees(document)) return null
    // The path the chat reads, and the text as stored with what its comments
    // say, which is what a read's note hashed: see readNotes.
    return { path: pathOf(api, document), text: readBasis(stored.get(id)) }
  }
}

// ============================================================================
// Comments — the writer's and the model's, on passages
// ============================================================================

/** @typedef {import('@/types/models.js').CommentThread} CommentThread */
/** @typedef {import('@/types/models.js').CommentSuggestion} CommentSuggestion */
/** @typedef {import('@/types/models.js').CommentChange} CommentChange */

/**
 * A document's threads marked resolved, as the changes to record: those it
 * has of these ids that are not resolved already.
 *
 * @param {DocumentsApi} api
 * @param {string} documentId
 * @param {string[]} ids
 * @returns {CommentChange[]}
 */
function resolving(api, documentId, ids) {
  const threads = api.threadsOf(documentId) || {}
  return [...new Set(ids)]
    .filter(id => threads[id] && threads[id].status !== 'resolved')
    .map(id => ({ id, before: threads[id], after: { ...threads[id], status: 'resolved' } }))
}

/**
 * The comments an edit resolved, for the model to see what went with the old
 * words: each by its id, with what its first post said.
 *
 * @param {CommentChange[]} changes
 * @param {import('@/cards/macros.js').Names|null} names
 */
const resolvedNote = (changes, names) =>
  changes.length
    ? {
        resolvedComments: changes.map(change => ({
          id: change.id,
          comment: substitute(change.before?.posts[0]?.text || '', names),
        })),
      }
    : {}

/**
 * A text document a comment tool can work on, or what to tell the model.
 *
 * @param {DocumentsApi} api
 * @param {string} storyId
 * @param {string} path
 * @param {(document: Document) => boolean} sees
 * @returns {{document: Document}|{error: string}}
 */
function commentable(api, storyId, path, sees) {
  const document = findByPath(api, storyId, path, sees)
  if (!document) return noDocument(path)
  if (document.type === 'folder') return { error: 'A folder has no comments' }
  if (document.type === 'file') return { error: fileIsNotWritten(path) }
  return { document }
}

/** @type {ToolDefinition} */
export const listCommentsDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'list_comments',
    description:
      'The open comments on passages, by the writer and by you: each with its id, its document, its passage, and what has been said on it, by whom. A read lists the comments in what it read after the text; this lists them without reading every document. A comment whose passage was deleted says so.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: "One document's path, to list only its comments. Every document otherwise.",
        },
      },
    },
  },
}

/**
 * @param {{path?: string}} args
 * @param {ToolContext} context
 */
export async function executeListComments(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const { api, sees, names } = await open(context.storyId, context.chatId)

  /** @type {Document[]} */
  let documents
  if (args?.path) {
    const document = findByPath(api, context.storyId, args.path, sees)
    if (!document) return noDocument(args.path)
    documents = [document]
  } else {
    documents = visibleDocuments(api, context.storyId, sees)
  }

  const comments = []
  for (const document of documents) {
    if (document.type !== 'text') continue
    const threads = api.threadsOf(document.id)
    if (!threads) continue
    const { text, placed } = placedAsRead(
      { ...document, content: api.currentContent(document.id), comments: threads },
      names,
      context.chatId
    )
    const path = pathOf(api, document)
    for (const { id, thread, start, end } of placed) {
      const posts = postsOf(thread, names, peopleOf(context.storyId))
      comments.push({ id, path, passage: text.slice(start, end), posts })
    }
    const placedNow = new Set(placed.map(entry => entry.id))
    for (const [id, thread] of Object.entries(threads)) {
      if (placedNow.has(id) || thread.suggestion || threadState(thread, false) !== 'stale') continue
      comments.push({
        id,
        path,
        passage: substitute(plainPassage(thread.quote), names),
        stale: 'Its passage was deleted. resolve_comment takes it off.',
        posts: postsOf(thread, names, peopleOf(context.storyId)),
      })
    }
  }
  return { comments }
}

/** @type {ToolDefinition} */
export const addCommentDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'add_comment',
    description:
      "Leave a comment on a passage, for the writer to read where it is: for the notes they ask for, and for a gap you could not fill in what you wrote. Anything else goes in the chat, or is the edit itself. Quote the passage as edit_document's old is quoted, exactly as read; it has to be there once, within one paragraph.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: "The document's path from the project root." },
        passage: { type: 'string', description: 'The words the comment is on, exactly as read.' },
        text: { type: 'string', description: 'What you have to say about them.' },
      },
      required: ['path', 'passage', 'text'],
    },
  },
}

/**
 * @param {{path: string, passage: string, text: string}} args
 * @param {ToolContext} context
 */
export async function executeAddComment(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const { api, sees, names } = await open(context.storyId, context.chatId)
  const target = commentable(api, context.storyId, args.path, sees)
  if ('error' in target) return target
  const { document } = target

  const said = typeof args.text === 'string' ? args.text.trim() : ''
  if (!said) return { error: 'Give what the comment says as "text".' }
  const quoted = quoteWithoutComments(typeof args.passage === 'string' ? args.passage : '')
  if (!quoted.trim()) return { error: 'Give the words the comment is on as "passage".' }
  if (quoted.includes('\n')) {
    return { error: 'A comment is on words within one paragraph; quote fewer of them.' }
  }

  const stored = api.currentContent(document.id)
  const plain = withoutComments(stored)
  const found = names ? storedPassage(plain, names, quoted, quoted) : null
  const passage = found?.old ?? quoted
  const count = found ? found.count : plain.split(passage).length - 1
  if (count !== 1) {
    const content = substitute(withoutComments(api.currentContent(document.id)), names)
    return count > 1
      ? {
          error: `"passage" appears ${count} times in "${args.path}". Include more of the words around it so it is there once.`,
        }
      : {
          error: `"passage" was not found in "${args.path}". Quote it exactly as read_document gave it; the nearest lines are in "nearest".`,
          nearest: nearestContext(content, quoted),
        }
  }

  // On words other comments are on or not: comments may overlap.
  const at = plain.indexOf(passage)
  const id = newCommentId()
  const next = commentOn(stored, at, at + passage.length, id)
  if (!next) return { error: 'Give the words the comment is on as "passage".' }
  const edit = diffEdit(stored, next) || { old: '', new: '' }

  // The markup has to come through as a comment on those words: a passage
  // running into a link's address, or half out of a code span, would not.
  if (!document.plain) {
    const entry = commentsInDoc(parseMarkdown(next)).find(placed => placed.id === id)
    if (!entry || squash(entry.passage) !== squash(plainPassage(passage))) {
      return {
        error:
          'Those words cannot take a comment as quoted: they run into a link or other markup. Quote the words alone.',
      }
    }
  }

  const thread = newThread(newPost('model', said), passage)
  /** @type {CommentChange[]} */
  const comments = [{ id, before: null, after: thread }]
  if (context.propose) {
    return {
      ...propose(context, {
        documentId: document.id,
        path: pathOf(api, document),
        tool: 'edit_document',
        old: edit.old,
        new: edit.new,
        comments,
      }),
      comment: id,
    }
  }

  recording(
    context,
    api,
    document,
    'edit_document',
    () => {
      // The thread first, so the text's save finds a thread it places.
      api.changeThreads(document.id, comments, false)
      api.replaceText(document.id, edit.old, edit.new)
    },
    comments
  )

  return {
    success: true,
    document: { id: document.id, title: document.title, path: pathOf(api, document) },
    comment: id,
  }
}

/** @type {ToolDefinition} */
export const replyCommentDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'reply_comment',
    description:
      'Answer a comment where it is, for the writer to read beside the passage: to say what you did about it, or to ask what they meant. Name it by its id, from a read or from list_comments. It stays as it was: an open one stays open until resolve_comment takes it off, and one your edit resolved can still be told what you changed.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: "The document's path from the project root." },
        id: { type: 'string', description: "The comment's id." },
        text: { type: 'string', description: 'What you say.' },
      },
      required: ['path', 'id', 'text'],
    },
  },
}

/**
 * Replies go straight in, in a chat that asks first too: they are said, not
 * written into the document. Rewinding past the turn takes them back. A
 * resolved comment takes one too, and stays resolved: an edit resolves the
 * comment on the words it changes, and the reply is where the model says
 * what it changed.
 *
 * @param {{path: string, id: string, text: string}} args
 * @param {ToolContext} context
 */
export async function executeReplyComment(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const { api, sees, names } = await open(context.storyId, context.chatId)
  const target = commentable(api, context.storyId, args.path, sees)
  if ('error' in target) return target
  const { document } = target

  const said = typeof args.text === 'string' ? args.text.trim() : ''
  if (!said) return { error: 'Give what you say as "text".' }
  const thread = api.threadsOf(document.id)?.[args.id]
  if (!thread) return noComment(args)

  const after = { ...thread, posts: [...thread.posts, newPost('model', said)] }
  /** @type {CommentChange[]} */
  const comments = [{ id: args.id, before: thread, after }]
  api.changeThreads(document.id, comments, false)
  record(context, {
    documentId: document.id,
    path: pathOf(api, document),
    tool: 'reply_comment',
    old: '',
    new: '',
    comments,
  })

  return {
    success: true,
    document: { id: document.id, title: document.title, path: pathOf(api, document) },
    comment: {
      id: args.id,
      ...(after.status === 'resolved' ? { resolved: true } : {}),
      posts: postsOf(after, names, peopleOf(context.storyId)),
    },
  }
}

/**
 * What the model is told when it names a comment that is not there.
 * @param {{path: string, id: string}} args
 */
const noComment = args => ({
  error: `No comment "${args.id}" in "${args.path}". list_comments gives the ids that are there.`,
})

/** @type {ToolDefinition} */
export const resolveCommentDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'resolve_comment',
    description:
      'Take a comment off once it is dealt with, leaving its passage as it is: one you have answered, or that needs no change. To change the passage, use edit_document, which resolves a comment whose words it changes. Name the comment by its id, from a read or from list_comments; there is nothing to quote.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: "The document's path from the project root." },
        id: { type: 'string', description: "The comment's id." },
      },
      required: ['path', 'id'],
    },
  },
}

/**
 * @param {{path: string, id: string}} args
 * @param {ToolContext} context
 */
export async function executeResolveComment(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const { api, sees } = await open(context.storyId, context.chatId)
  const target = commentable(api, context.storyId, args.path, sees)
  if ('error' in target) return target
  const { document } = target

  const thread = api.threadsOf(document.id)?.[args.id]
  if (!thread) return noComment(args)
  if (thread.suggestion) {
    return {
      error: `"${args.id}" is a suggested change, which the writer accepts or rejects. To take it back, change its words back with edit_document.`,
    }
  }
  const comments = resolving(api, document.id, [args.id])
  const done = {
    success: true,
    document: { id: document.id, title: document.title, path: pathOf(api, document) },
    resolved: args.id,
  }

  // Resolved already, by an edit of its words or a call before: done.
  const stored = api.currentContent(document.id)
  const placed = placedIds(stored).has(args.id)
  if (thread.status === 'resolved' && !placed) return { ...done, already: true }

  // Stale, its passage gone: there is no text to change, only the thread.
  if (!placed) {
    api.changeThreads(document.id, comments, false)
    record(context, {
      documentId: document.id,
      path: pathOf(api, document),
      tool: 'resolve_comment',
      old: '',
      new: '',
      comments,
    })
    return done
  }

  const pair = diffEdit(stored, withoutComment(stored, args.id))
  if (!pair) return noComment(args)
  if (context.propose) {
    return propose(context, {
      documentId: document.id,
      path: pathOf(api, document),
      tool: 'edit_document',
      ...pair,
      comments,
    })
  }

  recording(
    context,
    api,
    document,
    'edit_document',
    () => {
      api.changeThreads(document.id, comments, false)
      api.replaceText(document.id, pair.old, pair.new)
    },
    comments
  )
  return done
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
      'Find every document that contains a word or phrase, with the passages around the hits. Case-insensitive, across titles and text. In a long document with sections, `titled` lists the sections named with the words — a section named exactly that comes first — and each passage says the `section` it is in and where that sits (`in`), so the next step is read_document(path, section) on the one you need, not a read of the document around it; `inSections` says how many sections the words appear in when more than are shown. In a long document without sections a passage gives its offset and page to read from. One call finds where something is said — a number, a name, a term — where opening documents one by one would cost a read each. In a source file a hit gives the lines that say it (`hits`), each with its number, to read around with read_document(path, line).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Search only under this folder (or only this document), by its path from the project root. Default: the whole project.',
        },
        query: {
          type: 'string',
          description:
            'The words to look for. A phrase is matched as written, or with other punctuation between its words; when nothing has the phrase, documents that have every one of its words are returned instead, and failing that those with all but one, each saying which it lacks. The result says which it is. A few distinctive words find more than a whole question.',
        },
      },
      required: ['query'],
    },
  },
}

/** How many documents a search reports, and how many passages from each. */
const SEARCH_LIMIT = 20
const SNIPPETS_PER_DOCUMENT = 3

/** How many lines of one source file a search shows, and how much of each. */
const LINES_PER_FILE = 8
const HIT_LINE_LIMIT = 200

/**
 * The lines of a source file that say something, each with its number: the
 * line as it is, cut to a window around the hit when it is long, and never
 * run together with the next the way a passage of prose is.
 *
 * @param {string} text
 * @param {string} needle - Lowercased
 * @returns {Array<{line: number, text: string}>}
 */
function linesSaying(text, needle) {
  /** @type {Array<{line: number, text: string}>} */
  const found = []
  const lines = text.split('\n')
  for (let at = 0; at < lines.length && found.length < LINES_PER_FILE; at++) {
    const index = lines[at].toLowerCase().indexOf(needle)
    if (index === -1) continue
    const line = lines[at]
    if (line.trim().length <= HIT_LINE_LIMIT) {
      found.push({ line: at + 1, text: line.trim() })
      continue
    }
    const start = Math.max(0, index - 80)
    const end = Math.min(line.length, start + HIT_LINE_LIMIT)
    found.push({
      line: at + 1,
      text: `${start > 0 ? '…' : ''}${line.slice(start, end).trim()}${end < line.length ? '…' : ''}`,
    })
  }
  return found
}

/**
 * Whether a document is under a folder, at any depth.
 *
 * @param {DocumentsApi} api
 * @param {Document} document
 * @param {string} folderId
 */
function isUnder(api, document, folderId) {
  for (let at = api.get(document.parentId); at; at = api.get(at.parentId)) {
    if (at.id === folderId) return true
  }
  return false
}

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

/** A word's letters and digits, the runs a loose match keeps in order. */
const RUN = /[\p{L}\p{N}]+/gu

/**
 * Words as a document may write them: the same letters and digits in order,
 * with any punctuation or spacing between them, or none, so `k=60` finds
 * `k = 60` and `re-rank` finds `rerank`; and a word in quotes or brackets
 * without them. Null when that is no different from the words as given.
 *
 * @param {string} words - Lowercased
 * @returns {RegExp|string|null}
 */
function looseMatch(words) {
  const runs = words.match(RUN) || []
  // Runs of letters and digits hold nothing a pattern would read as syntax.
  if (runs.length > 1) return new RegExp(runs.join('[^\\p{L}\\p{N}]*'), 'u')
  return runs.length === 1 && runs[0] !== words ? runs[0] : null
}

/**
 * How a document writes what a search looks for: the words themselves, or
 * what a loose match found in its text or its title. Null when it has neither.
 *
 * @param {Document} document
 * @param {string|RegExp} term - Lowercased
 * @returns {string|null}
 */
function spelledIn(document, term) {
  if (typeof term === 'string') return term
  const found = term.exec((document.content || '').toLowerCase()) || term.exec(norm(document.title))
  return found ? found[0] : null
}

/**
 * A document searched for words, however it writes them.
 *
 * @param {Document} document
 * @param {string|RegExp} term - Lowercased
 */
function findLoosely(document, term) {
  const spelled = spelledIn(document, term)
  const found = spelled ? findIn(document, spelled) : null
  return found && spelled ? { ...found, spelled } : null
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
 * @param {{query: string, path?: string}} args
 * @param {ToolContext} context
 */
export async function executeSearchDocuments(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const { api, sees } = await open(context.storyId, context.chatId)

  const phrase = norm(args.query)
  if (!phrase) return { results: [] }
  let documents = visibleDocuments(api, context.storyId, sees).filter(
    document => document.type !== 'folder'
  )

  // A search can be kept to one folder — a repository, the notes — or to one
  // document. The root is the whole project, the same as no path.
  const scopePath = typeof args.path === 'string' ? args.path.trim().replace(/^\/+|\/+$/g, '') : ''
  if (scopePath) {
    const scope = findByPath(api, context.storyId, scopePath, sees)
    if (!scope) {
      return {
        error: `Nothing at "${args.path}" to search in. list_documents shows the folders that exist.`,
      }
    }
    documents =
      scope.type === 'folder'
        ? documents.filter(document => isUnder(api, document, scope.id))
        : documents.filter(document => document.id === scope.id)
  }

  /**
   * @typedef {Object} Hit
   * @property {string} id
   * @property {string} title
   * @property {string} path
   * @property {number} matches
   * @property {Array<{text: string, at?: number, page?: number, section?: string, in?: string}>} [passages] - Up
   *   to a few, each with its offset and page in a long document, and its section where it has them
   * @property {Array<{line: number, text: string}>} [hits] - In a source file, the lines
   *   that say it, in place of passages
   * @property {Array<{section: string, in: string, words: number}>} [titled] - Sections named with the words
   * @property {number} [inSections] - How many sections have the words, when more than are shown
   * @property {boolean} [exact] - Whether a section is named exactly that; for ranking, not sent
   * @property {number} [words] - How long the document is, for deciding whether to read it whole
   * @property {number} [pages]
   * @property {number} [lines] - A source file's length, in place of words
   * @property {string} [missing] - The one word of the query it lacks, when no document had them all
   * @property {number} [rank] - How many documents have the word it lacks; for ranking, not sent
   */
  const toHit = (
    /** @type {Document} */ document,
    /** @type {NonNullable<ReturnType<typeof findIn>>} */ found,
    /** @type {string} */ needle
  ) => {
    if (isSourceFile(api.get, document)) {
      return {
        id: document.id,
        title: document.title || '(untitled)',
        path: pathOf(api, document),
        matches: found.matches,
        hits: linesSaying(document.content || '', needle),
        ...sizeOf(document, api.get),
        exact: false,
      }
    }
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
      ...sizeOf(document, api.get),
      exact,
    }
  }

  /** @type {Hit[]} */
  let results = []
  for (const document of documents) {
    const found = findIn(document, phrase)
    if (found) results.push(toHit(document, found, phrase))
  }

  // The same words with other punctuation between them: `k=60` for
  // `k = 60`, `end to end` for `end-to-end`.
  const loose = looseMatch(phrase)
  if (results.length === 0 && loose) {
    for (const document of documents) {
      const found = findLoosely(document, loose)
      if (found) results.push(toHit(document, found, found.spelled))
    }
  }

  // A question rarely appears anywhere as written — "Marcus reranker
  // measured" is three words that a standup has in three places. When no
  // document has the phrase, the ones that have every word of it are the
  // next best answer, and the model is told that is what it is getting. A
  // word keeps its own punctuation, loosely: a date stays one word.
  /** @type {'words'|'most words'|null} */
  let matchedBy = null
  const terms = [
    ...new Set(
      phrase
        .split(/\s+/)
        .map(term => term.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        .filter(term => term.length > 1)
    ),
  ]
  if (results.length === 0 && terms.length > 1) {
    const matchers = terms.map(term => looseMatch(term) ?? term)
    const found = documents.map(document => matchers.map(term => findLoosely(document, term)))
    /**
     * A hit on the words a document has, its passages around the scarcest,
     * which is the one that says most about why it matched.
     *
     * @param {number} index
     */
    const hitOn = index => {
      const each = found[index].filter(hit => hit !== null)
      const rarest = each.reduce((best, hit) => (hit.matches < best.matches ? hit : best))
      return toHit(
        documents[index],
        {
          matches: rarest.matches,
          snippets: rarest.snippets,
          inTitle: each.some(hit => hit.inTitle),
        },
        rarest.spelled
      )
    }
    found.forEach((each, index) => {
      if (each.every(Boolean)) results.push(hitOn(index))
    })
    if (results.length > 0) matchedBy = 'words'

    // None has them all: those with all but one, which is often a word the
    // writer's notes never use. The ones lacking a word most documents have
    // first, since that word says least about what was meant; each says
    // which it lacks, so the next search can do without it.
    if (results.length === 0 && terms.length > 2) {
      const holding = terms.map((_, at) => found.filter(each => each[at]).length)
      found.forEach((each, index) => {
        const lacking = each.flatMap((hit, at) => (hit ? [] : [at]))
        if (lacking.length !== 1) return
        results.push({ ...hitOn(index), missing: terms[lacking[0]], rank: holding[lacking[0]] })
      })
      if (results.length > 0) matchedBy = 'most words'
    }
  }

  // A document with a section named exactly that first; then the ones that
  // say it most, so a search for a term the whole project uses still leads
  // with the ones that are about it.
  results.sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) || (b.rank ?? 0) - (a.rank ?? 0) || b.matches - a.matches
  )
  const shown = results.slice(0, SEARCH_LIMIT).map(({ exact: _exact, rank: _rank, ...hit }) => hit)
  return {
    results: shown,
    ...(matchedBy === 'words'
      ? {
          matchedBy,
          note: 'No document has that phrase as written; these have every word of it.',
        }
      : {}),
    ...(matchedBy === 'most words'
      ? {
          matchedBy,
          note: 'No document has every word of that; these have all but one, and `missing` says which.',
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
      'Create a document in the project. Use this for a new note, page or chapter. The path says both what it is called and where it goes, so check list_documents for the folder that exists rather than assuming one — the folder has to be there already, and create_folder is how to add one.',
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
          description:
            'The body text, in Markdown. To link to another document, use its path from this one, ending in .md (or a file\'s own extension, such as .pdf), with %20 for each space: from "Drafts/Chapter 1", [the cast](../Notes/Cast%20list.md).',
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

  // What the model writes never makes a comment: add_comment does.
  const body = withoutComments(args.content || '')
  if (context.propose) {
    return propose(context, {
      documentId: '',
      path: target.path,
      tool: 'create_document',
      old: '',
      new: body,
    })
  }

  const document = api.createTextDocument(target.parentId, target.title, body)
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
  record(context, {
    documentId: folder.id,
    path: target.path,
    tool: 'create_folder',
    old: '',
    new: '',
  })
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
// A place for what is kept from the web (save_web_page, in ./web.js)
// ============================================================================

/**
 * The folder something kept from the web goes in: one the chat can see, by
 * its path as list_documents gives it, outside any repository. The top of the
 * project when no path is given. Never made: the folder has to exist, as it
 * does for create_document.
 *
 * @param {ToolContext} context
 * @param {string|undefined} path
 * @returns {Promise<{id: string, path: string}|{error: string}>}
 */
export async function folderToKeepIn(context, path) {
  const { api, sees } = await open(context.storyId, context.chatId)
  const asked = typeof path === 'string' ? path.trim().replace(/^\/+|\/+$/g, '') : ''
  if (!asked) return { id: rootIdFor(context.storyId), path: '' }
  const folder = findByPath(api, context.storyId, asked, sees)
  if (!folder) {
    return {
      error: `No folder at "${asked}". list_documents shows the folders that exist; create_folder adds one.`,
    }
  }
  if (folder.type !== 'folder') return { error: `"${asked}" is a document, not a folder.` }
  if (repositoryOf(api.get, folder)) {
    return { error: `"${asked}" is in a repository, which is read-only. Put it elsewhere.` }
  }
  return { id: folder.id, path: pathOf(api, folder) }
}

/**
 * Where what is at an address is in the project already, by the address it
 * was kept from, when the chat can see it there.
 *
 * @param {ToolContext} context
 * @param {string} url
 * @returns {Promise<string|null>} Its path
 */
export async function keptFrom(context, url) {
  const { api, sees } = await open(context.storyId, context.chatId)
  const found = visibleDocuments(api, context.storyId, sees).find(document => document.url === url)
  return found ? pathOf(api, found) : null
}

/**
 * A document's path, as every tool gives it.
 *
 * @param {ToolContext} context
 * @param {string} id
 * @returns {Promise<string>} '' when it is not there
 */
export async function pathInProject(context, id) {
  const { api } = await open(context.storyId, context.chatId)
  const document = api.get(id)
  return document ? pathOf(api, document) : ''
}

// ============================================================================
// Suggestions — a change made to the text as the chat sees it
// ============================================================================

/** What the model is told when its change waits on the writer in the text. */
export const SUGGESTED_NOTE =
  'Suggested to the writer, who accepts or rejects each change on its own in the document. To say why, reply_comment on its id. Until they decide, you read the document with your suggestions made, and a later change that touches one goes into it.'

/**
 * Whether a chat's change to a document's text is suggested in it: in a chat
 * that asks first, in a document that can hold the marks.
 * A plain one is stored as typed and holds none, so a change to it is
 * proposed in the chat.
 *
 * @param {ToolContext} context
 * @param {Document} document
 * @returns {boolean}
 */
const suggests = (context, document) => !!context.propose && !document.plain

/**
 * Whether a change to a document's text is made to it as the chat sees it:
 * one suggested, and one made at once to a document that holds suggestions,
 * which the chat reads with them settled, so its words are not the stored
 * text's.
 *
 * @param {ToolContext} context
 * @param {DocumentsApi} api
 * @param {Document} document
 * @returns {boolean}
 */
const changesSeen = (context, api, document) =>
  suggests(context, document) ||
  (!context.propose && !document.plain && holdsSuggestions(api.currentContent(document.id)))

/**
 * A document's text as the chat's model sees it, to change: as stored,
 * read; the chat's own pending suggestions in it; and the text with those
 * made and every other not, without the comments' markup.
 *
 * @typedef {{before: Node, own: string[], text: string}} SeenText
 */

/**
 * @param {DocumentsApi} api
 * @param {Document} document
 * @param {string|undefined} chatId
 * @returns {SeenText}
 */
function seenToChange(api, document, chatId) {
  const stored = api.currentContent(document.id)
  const before = parseMarkdown(stored)
  const own = ownSuggestions(api.threadsOf(document.id), chatId)
  const seen = seeing(before, own)
  return {
    before,
    own,
    text: withoutComments(seen.docChanged ? serializeMarkdown(seen.doc) : stored),
  }
}

/**
 * What a change to the text as the chat sees it came to.
 *
 * @typedef {Object} SeenChange
 * @property {boolean} changed - False when the text already read so
 * @property {boolean} suggesting
 * @property {string[]} suggested - The suggestions it made or went into
 * @property {Array<{id: string, into: string}>} joined - Those of the chat's
 *   own it joined to an older one
 * @property {string[]} withdrawn - Those of the chat's own it took back
 * @property {CommentChange[]} resolved - The comments whose passages a
 *   change made at once took
 */

/**
 * Make a change to a document as the chat's model sees it, `written` being
 * that text as the model means it to read. Suggested where the chat
 * suggests: laid out against the text as it stands, and folded into the
 * chat's own pending suggestions where it touches them. Made at once
 * otherwise, over the suggestions there: what touches the chat's own goes
 * into them, which wait on the writer, and the rest is accepted. Recorded
 * with the turn, threads and all, so rewinding takes it back.
 *
 * @param {ToolContext} context
 * @param {DocumentsApi} api
 * @param {Document} document
 * @param {string} tool
 * @param {SeenText} seen
 * @param {string} written
 * @returns {SeenChange|{error: string}}
 */
function changeSeen(context, api, document, tool, { before, own }, written) {
  const suggesting = suggests(context, document)
  const threads = api.threadsOf(document.id) || {}
  // A new id, not one of the document's threads.
  const fresh = () => {
    let id = newSuggestionId()
    while (threads[id]) id = newSuggestionId()
    return id
  }
  const made = suggestChange(before, parseMarkdown(written), fresh(), own, fresh)
  if (!made) return { error: 'That change could not be laid out in the document.' }
  const doc = suggesting
    ? made.doc
    : made.ids.reduce((each, id) => acceptSuggestion(each, id), made.doc)
  const done = { suggesting, suggested: [], joined: [], withdrawn: [], resolved: [] }
  if (doc.eq(before)) return { changed: false, ...done }

  // Only those in the text: one whose marks the writer typed over is not
  // the change's to take back.
  const pending = new Set(suggestionsIn(before))
  const mine = own.filter(each => pending.has(each))
  const { changes, ...touched } = suggestionThreads(threads, doc, made.into, mine, made.ids, {
    suggesting,
    chat: context.chatId,
  })
  // Made at once, the change resolves the comments whose passages it took.
  const resolved = suggesting ? [] : resolving(api, document.id, commentsGone(before, doc))
  const comments = [...changes, ...resolved]
  recording(
    context,
    api,
    document,
    tool,
    () => {
      // The threads first, as a comment's go before the text that places it.
      if (comments.length) api.changeThreads(document.id, comments, false)
      api.setContent(document.id, serializeMarkdown(doc))
    },
    comments,
    suggesting
  )
  return { ...done, changed: true, ...touched, resolved }
}

/**
 * The threads a change brings up to date: a new one for each suggestion it
 * made, with nothing said on it yet; each of the chat's own it went into,
 * with what it changes now; one it joined to an older, its posts gone to
 * that one's thread and itself gone; and one it took back, closed.
 *
 * @param {Record<string, CommentThread>} threads
 * @param {Node} doc - With the change made
 * @param {Record<string, string>} into
 * @param {string[]} own - Oldest first
 * @param {string[]} ids - Those the change made, in the text's order
 * @param {{suggesting: boolean, chat?: string}} by
 * @returns {{changes: CommentChange[], suggested: string[], joined: Array<{id: string, into: string}>, withdrawn: string[]}}
 */
function suggestionThreads(threads, doc, into, own, ids, { suggesting, chat }) {
  const present = new Set(suggestionsIn(doc))
  /** @type {Map<string, CommentThread|null>} */
  const next = new Map()
  /**
   * @param {CommentThread} thread
   * @param {string} each
   * @returns {CommentThread}
   */
  const saying = (thread, each) => {
    const { out, in: put } = changeOf(doc, each)
    const suggestion = /** @type {CommentSuggestion} */ (thread.suggestion)
    return { ...thread, quote: out, suggestion: { ...suggestion, text: put } }
  }

  const created = Date.now()
  for (const id of suggesting ? ids : []) {
    if (!present.has(id)) continue
    const made = { text: '', created, ...(chat ? { chat } : {}) }
    next.set(id, saying({ status: 'open', quote: '', posts: [], suggestion: made }, id))
  }
  /** @type {Array<{id: string, into: string}>} */
  const joined = []
  /** @type {string[]} */
  const withdrawn = []
  for (const each of own) {
    const thread = threads[each]
    const target = into[each]
    if (target && threads[target]) {
      const kept = next.get(target) ?? threads[target]
      const posts = [...kept.posts, ...thread.posts].sort((a, b) => a.created - b.created)
      next.set(target, { ...kept, posts })
      next.set(each, null)
      joined.push({ id: each, into: target })
    } else if (!present.has(each)) {
      const suggestion = /** @type {CommentSuggestion} */ (thread.suggestion)
      next.set(each, {
        ...thread,
        status: 'resolved',
        suggestion: { ...suggestion, settled: 'withdrawn' },
      })
      withdrawn.push(each)
    }
  }
  /** @type {string[]} */
  const suggested = ids.filter(id => next.has(id))
  for (const each of own) {
    if (!present.has(each) || next.get(each) === null) continue
    const thread = threads[each]
    const now = saying(next.get(each) ?? thread, each)
    if (
      next.has(each) ||
      now.quote !== thread.quote ||
      now.suggestion?.text !== thread.suggestion?.text
    ) {
      next.set(each, now)
      suggested.push(each)
    }
  }
  const changes = [...next].map(([each, after]) => ({
    id: each,
    before: threads[each] ?? null,
    after,
  }))
  return { changes, suggested, joined, withdrawn }
}

/**
 * What the model is told of a change it made to the text as it sees it.
 *
 * @param {DocumentsApi} api
 * @param {Document} document
 * @param {SeenChange} change
 * @param {import('@/cards/macros.js').Names|null} names
 * @param {Record<string, number>} counts - What a write made at once says it wrote
 * @returns {Record<string, any>}
 */
function answerSeen(api, document, change, names, counts) {
  const path = pathOf(api, document)
  const where = { id: document.id, title: document.title, path }
  const { suggested, joined, withdrawn } = change
  const ids =
    suggested.length === 1
      ? { suggestion: suggested[0] }
      : suggested.length > 1
        ? { suggestions: suggested }
        : {}
  const folds = {
    ...(joined.length ? { joined } : {}),
    ...(withdrawn.length ? { withdrawn } : {}),
  }
  if (!change.changed) {
    return {
      success: true,
      document: where,
      unchanged: change.suggesting
        ? 'It already reads that way to you, so nothing was suggested.'
        : 'It already reads that way, so nothing changed.',
    }
  }
  if (change.suggesting) {
    return {
      suggested: true,
      document: { path },
      ...ids,
      ...folds,
      note:
        suggested.length > 0
          ? SUGGESTED_NOTE
          : 'That puts back what you had suggested, so the suggestion is gone.',
    }
  }
  return {
    success: true,
    document: where,
    ...counts,
    ...(suggested.length
      ? {
          ...ids,
          note: 'Where the change touched your suggestions waiting on the writer, it went into them.',
        }
      : {}),
    ...folds,
    ...resolvedNote(change.resolved, names),
  }
}

/**
 * A chat's suggestions the writer has accepted or rejected, for the model to
 * be told on its next turn: each with the document it was in, and when.
 *
 * @param {string} storyId
 * @param {ChatMarks & {id?: string}|null} chat
 * @returns {Promise<Array<{suggestion: string, path: string, accepted: boolean, at: number}>>}
 */
export async function settledSuggestions(storyId, chat) {
  if (!chat?.id) return []
  const { api, sees } = await open(storyId, chat)
  return allDocuments(api, storyId).flatMap(document => {
    if (document.type !== 'text' || !sees(document)) return []
    return Object.entries(document.comments || {}).flatMap(([id, thread]) => {
      const { chat: by, settled, settledAt } = thread.suggestion || {}
      if (by !== chat.id || (settled !== 'accepted' && settled !== 'rejected')) return []
      return [
        {
          suggestion: id,
          path: pathOf(api, document),
          accepted: settled === 'accepted',
          at: settledAt ?? 0,
        },
      ]
    })
  })
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
      "Rewrite a document's whole body. The content replaces everything, so use it only to reshape a document from end to end: to change a passage use edit_document, to add to the end use append_document, and to rename or move it use move_document. The writer's comments stay on any passage the new body keeps word for word; the result lists the ones that went.",
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: "The document's path from the project root.",
        },
        content: {
          type: 'string',
          description:
            'The whole new body, in Markdown. A link to another document is its path from this one, ending in .md, with %20 for each space.',
        },
      },
      required: ['path', 'content'],
    },
  },
}

/**
 * @param {{path: string, content?: string, updates?: {title?: string, content?: string}}} args
 *   `updates` is the shape the tool took before it lost renaming, which a
 *   model reading an old conversation may still use
 * @param {ToolContext} context
 */
export async function executeUpdateDocument(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const { api, sees, names } = await open(context.storyId, context.chatId)

  const document = findByPath(api, context.storyId, args.path, sees)
  if (!document) return noDocument(args.path)

  const content = typeof args.content === 'string' ? args.content : args.updates?.content
  if (typeof args.updates?.title === 'string' && typeof content !== 'string') {
    return { error: 'To rename or move a document, use move_document.' }
  }
  if (typeof content !== 'string') return { error: 'Give the whole new body as "content".' }
  if (document.type === 'folder') return { error: 'A folder has no content to update' }
  if (document.type === 'file') return { error: fileIsNotWritten(args.path) }

  if (changesSeen(context, api, document)) {
    const seen = seenToChange(api, document, context.chatId)
    const written = quoteWithoutComments(withoutSuggestionMarkup(content))
    const change = changeSeen(context, api, document, 'update_document', seen, written)
    return 'error' in change ? change : answerSeen(api, document, change, names, {})
  }

  // The comments come across where the new body keeps their words; the
  // rest are resolved. What the model writes never makes a suggestion.
  const { body, resolved } = rewriteAroundComments(
    api.currentContent(document.id),
    withoutSuggestionMarkup(content)
  )
  const comments = resolving(
    api,
    document.id,
    resolved.map(comment => comment.id)
  )
  const resolvedComments = resolvedNote(comments, names)

  if (context.propose) {
    return {
      ...propose(context, {
        documentId: document.id,
        path: pathOf(api, document),
        tool: 'update_document',
        old: api.currentContent(document.id),
        new: body,
        ...(comments.length ? { comments } : {}),
      }),
      ...resolvedComments,
    }
  }
  recording(
    context,
    api,
    document,
    'update_document',
    () => {
      api.setContent(document.id, body)
      if (comments.length) api.changeThreads(document.id, comments, false)
    },
    comments
  )

  return {
    success: true,
    document: { id: document.id, title: document.title, path: pathOf(api, document) },
    ...resolvedComments,
  }
}

// ============================================================================
// move_document
// ============================================================================

/** @type {ToolDefinition} */
export const moveDocumentDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'move_document',
    description:
      'Rename a document or folder, move it into another folder, or both. Give the path it has and the full path it should have. The folder it goes into has to exist already: create_folder adds one. A folder moves with everything in it. Links to it and from it are updated to match; the result lists the documents that changed (`linksUpdated`).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Where it is now, from the project root.',
        },
        to: {
          type: 'string',
          description:
            'The full path it should have: its folder, then its name (e.g. "notes/Factions/The Ashen Court").',
        },
      },
      required: ['path', 'to'],
    },
  },
}

/**
 * @param {{path: string, to: string}} args
 * @param {ToolContext} context
 */
export async function executeMoveDocument(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const { api, sees } = await open(context.storyId, context.chatId)

  const document = findByPath(api, context.storyId, args.path, sees)
  if (!document) return noDocument(args.path)
  if (document.id === rootIdFor(context.storyId))
    return { error: 'The project itself stays where it is.' }
  const from = pathOf(api, document)
  if (document.type !== 'text' && inRepository(api.get, document)) {
    return { error: `"${from}" is part of a repository, which is read-only.` }
  }

  const to = (args.to || '')
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
    .join('/')
  if (to === from) return { error: `"${from}" is already there.` }
  const target = resolveNewPath(api, context.storyId, to, sees)
  if ('error' in target) {
    return {
      error: target.error.replace('Use update_document to change it.', 'Choose another name.'),
    }
  }
  if (target.parentId !== document.parentId && !api.canDropInto(target.parentId, document.id)) {
    return { error: `"${from}" cannot go into a folder inside itself.` }
  }

  // The links to it, and from it, still go where they went: those that would
  // not are written again, and the model is told which documents changed.
  const { relinked } = api.keepingLinks(() => {
    if (target.parentId !== document.parentId) api.moveInto(target.parentId, document.id)
    if (api.get(document.id)?.title !== target.title) api.rename(document.id, target.title)
  })

  const moved = api.get(document.id)
  const path = pathOf(api, moved)
  record(context, { documentId: document.id, path, tool: 'move_document', old: from, new: path })
  const linksUpdated = relinked
    .map(id => api.get(id))
    .filter(linking => linking && sees(linking))
    .map(linking => pathOf(api, linking))
  return {
    success: true,
    document: { id: moved.id, title: moved.title, type: moved.type, path },
    from,
    ...(linksUpdated.length > 0 ? { linksUpdated } : {}),
  }
}

// ============================================================================
// delete_document
// ============================================================================

/**
 * What the model is told when a delete waits on the writer. The note every
 * proposal gets was not enough: told the delete was proposed, and having read
 * that it goes to the trash, the model told the writer it was in the trash.
 * This one was not enough either until the description said a delete can wait
 * on the writer too.
 */
export const DELETE_PROPOSED_NOTE =
  'Not deleted yet, and not in the trash. The writer is asked in the chat, and it goes to the trash only if they accept. Tell them what you asked to delete and why.'

/** @type {ToolDefinition} */
export const deleteDocumentDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'delete_document',
    description:
      "Delete a document or folder, a folder with everything in it. Once deleted it is in the project's trash, where the writer can restore it for 30 days. When the writer approves changes first, the call proposes the delete instead, and nothing is deleted until they accept it in the chat; the result says which it was. Delete only what the writer asks to go, or a document you made that is no longer wanted. A request to tidy or clean up names nothing to go: say what you would delete, and ask.",
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Where it is, from the project root.',
        },
      },
      required: ['path'],
    },
  },
}

/**
 * Move a document or folder to the project's trash. A folder holding
 * something this chat doesn't see is refused: the model can't know what it
 * would take with it. Recorded with the turn's other changes, so rewinding
 * past the turn brings it back from the trash.
 *
 * @param {{path: string}} args
 * @param {ToolContext} context
 */
export async function executeDeleteDocument(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const { api, sees } = await open(context.storyId, context.chatId)

  const document = findByPath(api, context.storyId, args.path, sees)
  if (!document) {
    return noDocument(args.path, namedElsewhere(api, context.storyId, args.path, sees))
  }
  if (document.id === rootIdFor(context.storyId)) {
    return { error: 'The project itself is not deleted from here.' }
  }
  const path = pathOf(api, document)
  if (inRepository(api.get, document) && document.kind !== 'repository') {
    return { error: `"${path}" is part of a repository, which is read-only.` }
  }
  /** @type {Document[]} */
  const inside = []
  const walk = (/** @type {string} */ id) => {
    for (const child of api.childrenOf(id)) {
      inside.push(child)
      if (child.type === 'folder') walk(child.id)
    }
  }
  walk(document.id)
  if (sees && inside.some(child => !sees(child))) {
    return { error: `"${path}" holds documents kept from this chat. Ask the writer to delete it.` }
  }

  const going = {
    path,
    type: document.type,
    ...(inside.length > 0 ? { inside: inside.length } : {}),
  }
  const edit = { documentId: document.id, path, tool: 'delete_document', old: '', new: '' }
  if (context.propose) {
    return { ...propose(context, edit), document: going, note: DELETE_PROPOSED_NOTE }
  }

  api.trash(document.id)
  record(context, edit)
  return {
    success: true,
    deleted: going,
    note: "In the project's trash, where the writer can restore it.",
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
      "Change one passage of a document, leaving the rest exactly as it is. Give the passage as it reads now and what it should read instead. This is how to revise: it sends only what changes, so prefer it over update_document for anything short of a rewrite. The passage has to match the document exactly and exactly once, so quote it as read_document gave it and include enough of it to be unique. The writer's comment markup can be left out of both. A comment whose highlighted words the edit changes is resolved with it, and the result lists any it resolved; a comment whose words come through unchanged stays on them.",
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
            'The passage to change, exactly as it appears in the document — same words, punctuation, line breaks, and Markdown — with or without comment markup.',
        },
        new: {
          type: 'string',
          description:
            'What the passage becomes, in Markdown. Empty removes it. A link to another document is its path from this one, ending in .md, with %20 for each space.',
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
 * What the model is told when its quote is not in the text once.
 *
 * @param {string} path
 * @param {string} content - The text as the model sees it
 * @param {string} quoted - As the model gave it
 * @param {string} plainQuote - Without any markup
 * @param {number} count
 * @returns {{error: string, nearest?: string}}
 */
function missedQuote(path, content, quoted, plainQuote, count) {
  if (count > 1) {
    return {
      error: `"old" appears ${count} times in "${path}". Include more of the surrounding text so it matches once.`,
    }
  }
  const spacedDifferently = squash(withoutComments(content)).includes(squash(plainQuote))
  return {
    error: spacedDifferently
      ? `"old" was not found in "${path}" as written, though the words are there: the line breaks or spacing differ. Quote the passage exactly as read_document gave it.`
      : `"old" was not found in "${path}". Quote the passage exactly as read_document gave it; the nearest lines are in "nearest".`,
    nearest: nearestContext(content, quoted),
  }
}

/**
 * One passage changed in the text as the chat sees it: found there, and the
 * text with it changed suggested or made (see `changeSeen`). A comment on
 * the passage stays on it while the change is suggested, since the text
 * has not changed yet.
 *
 * @param {ToolContext} context
 * @param {DocumentsApi} api
 * @param {Document} document
 * @param {import('@/cards/macros.js').Names|null} names
 * @param {string} path - As the model gave it
 * @param {string} quoted
 * @param {string} replacement
 */
function editSeen(context, api, document, names, path, quoted, replacement) {
  const seen = seenToChange(api, document, context.chatId)
  const quote = quoteWithoutComments(withoutSuggestionMarkup(quoted))
  const written = quoteWithoutComments(withoutSuggestionMarkup(replacement))
  // Found as the model sees it, its names filled in, and changed where it is.
  const found = names ? storedPassage(seen.text, names, quote, written) : null
  const old = found?.old ?? quote
  const count = found && found.count !== 1 ? found.count : seen.text.split(old).length - 1
  if (count !== 1) return missedQuote(path, substitute(seen.text, names), quoted, quote, count)

  const text = seen.text.replace(old, () => found?.new ?? written)
  const change = changeSeen(context, api, document, 'edit_document', seen, text)
  if ('error' in change) return change
  return answerSeen(api, document, change, names, {
    charactersRemoved: quoted.length,
    charactersWritten: replacement.length,
  })
}

/**
 * @param {{path: string, old: string, new: string}} args
 * @param {ToolContext} context
 */
export async function executeEditDocument(args, context) {
  if (!context?.storyId) return { error: 'No story context available' }
  const { api, sees, names } = await open(context.storyId, context.chatId)

  const document = findByPath(api, context.storyId, args.path, sees)
  if (!document) return noDocument(args.path)
  if (document.type === 'folder') return { error: 'A folder has no content to edit' }
  if (document.type === 'file') return { error: fileIsNotWritten(args.path) }

  const quoted = typeof args.old === 'string' ? args.old : ''
  const replacement = typeof args.new === 'string' ? args.new : ''
  if (!quoted)
    return { error: 'Give the passage to change as "old"; to add text, use append_document.' }
  if (changesSeen(context, api, document)) {
    return editSeen(context, api, document, names, args.path, quoted, replacement)
  }

  // The passage is found in the text as it reads without the writer's
  // comments, so a quote may carry their markup or leave it out, and what
  // the model writes never makes one, nor a suggestion.
  const stored = api.currentContent(document.id)
  const plain = withoutComments(stored)
  const plainQuote = quoteWithoutComments(quoted)
  const plainReplacement = quoteWithoutComments(withoutSuggestionMarkup(replacement))

  // A chat with names quotes the text with the names in, which is not what
  // the document says where it has macros: the passage is found there and
  // changed where it is in the document. Counted as the model sees it.
  const found = names ? storedPassage(plain, names, plainQuote, plainReplacement) : null
  const edit = editAroundComments(stored, found?.old ?? plainQuote, found?.new ?? plainReplacement)
  const { old, new: written, resolved } = edit
  const comments = resolving(
    api,
    document.id,
    resolved.map(comment => comment.id)
  )

  // Not tried unless it is there once as the model sees it: a quote that is
  // there twice in what it read could be there once in the document, and be
  // the wrong one.
  /** @type {{applied: boolean, count: number}} */
  let outcome = { applied: false, count: 0 }
  if ((found && found.count !== 1) || edit.count !== 1) {
    outcome = { applied: false, count: found && found.count !== 1 ? found.count : edit.count }
  } else if (context.propose) {
    // Checked as if applied, so a misquote is corrected now rather than when
    // the writer accepts.
    const count = api.currentContent(document.id).split(old).length - 1
    outcome = { applied: count === 1, count }
  } else {
    recording(
      context,
      api,
      document,
      'edit_document',
      () => {
        outcome = api.replaceText(document.id, old, written)
        if (outcome.applied && comments.length) api.changeThreads(document.id, comments, false)
      },
      comments
    )
  }
  const { applied, count } = outcome
  if (!applied) {
    const content = substitute(withoutComments(api.currentContent(document.id)), names)
    return missedQuote(args.path, content, quoted, plainQuote, count)
  }

  // What was said on each comment the edit resolved, for the model to see
  // what went with the old words.
  const resolvedComments = resolvedNote(comments, names)

  if (context.propose) {
    return {
      ...propose(context, {
        documentId: document.id,
        path: pathOf(api, document),
        tool: 'edit_document',
        old,
        new: written,
        ...(comments.length ? { comments } : {}),
      }),
      ...resolvedComments,
    }
  }

  return {
    success: true,
    document: { id: document.id, title: document.title, path: pathOf(api, document) },
    charactersRemoved: quoted.length,
    charactersWritten: replacement.length,
    ...resolvedComments,
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

  // What the model writes never makes a comment or a suggestion: add_comment
  // and the edits in a chat that asks first do.
  const text = withoutComments(
    withoutSuggestionMarkup(typeof args.text === 'string' ? args.text : '')
  )
  if (!text.trim()) return { error: 'No text provided' }

  if (changesSeen(context, api, document)) {
    const seen = seenToChange(api, document, context.chatId)
    const written = appendBlocks(seen.text, text)
    const change = changeSeen(context, api, document, 'append_document', seen, written)
    if ('error' in change) return change
    return answerSeen(api, document, change, null, { charactersWritten: text.length })
  }

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

  if (edit.tool === 'delete_document') {
    const going = api.get(edit.documentId)
    if (!going) return noDocument(edit.path)
    const path = pathOf(api, going)
    api.trash(going.id)
    return { documentId: going.id, path, old: '', new: '' }
  }

  const document = api.get(edit.documentId)
  if (!document || document.type !== 'text') return noDocument(edit.path)

  const before = api.currentContent(document.id)
  // The threads first, so the text's save finds a comment it places; taken
  // back if the text cannot be changed.
  const comments = edit.comments || []
  if (comments.length) api.changeThreads(document.id, comments, false)
  const applied = api.fromOutside(document.id, 'model', () => {
    if (edit.tool === 'edit_document')
      return api.replaceText(document.id, edit.old, edit.new).applied
    if (edit.tool === 'append_document') api.appendContent(document.id, edit.new)
    else api.setContent(document.id, edit.new)
    return true
  })
  if (!applied) {
    if (comments.length) api.changeThreads(document.id, comments, true)
    return { error: 'The passage has changed since this was proposed.' }
  }

  const pair = pairOf(edit.tool, before, api.currentContent(document.id)) || { old: '', new: '' }
  return { documentId: document.id, path: pathOf(api, document), ...pair }
}
