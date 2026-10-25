/**
 * @module editor
 * @description The document model and the editor's state: a closed schema,
 * the markdown that is its file format, and the `EditorState` a document
 * becomes while it is open.
 *
 * - **schema** - The nodes and marks a document can hold
 * - **markdown** - `parseMarkdown` and `serializeMarkdown`, the two directions
 *   of the file format; `settleMarkdown` for text from outside; `appendBlocks`
 *   for joining markdown to markdown
 * - **comments** - A comment on a passage: the markup, the helpers, the parser rules, and
 *   the entries a list shows
 * - **suggestions** - A suggested change: its markup and parser rules, a change
 *   laid out as one suggestion for each change in it, folded into the model's
 *   own where it touches them, where each is, and one accepted or rejected
 * - **suggestionText** - The same in markdown: whether a text holds any, the
 *   text as one reader sees it, and a model's text with its markup read as meant
 * - **comparison** - A version against the text now, laid out as a suggestion
 *   is, for the Versions dialog to show: what a restore would take out and
 *   bring back, and the version's own text to copy out of it
 * - **commentDraft** - The passage a new comment is being written on in the
 *   Comments tab: a range in the state, mapped through every change and tinted
 * - **state** - `createEditorState`, the keys and typed shortcuts, and the
 *   `replaceContent` and `appendContent` transactions an outside writer asks for
 * - **search** - Find and replace: the matches as a plugin's state, drawn as
 *   decorations, and the commands that move between and replace them
 * - **spelling** - What the spelling checker found, drawn under the text, and
 *   the commands its menu runs; see `spelling/`
 * - **clipboard** - The selection as markdown, markdown pasted as what it
 *   stands for, and the clipboard read for a Paste from the editor's menu
 * - **insert** - A table, a horizontal rule or a code block put in from the
 *   editor's menu, where it is otherwise only typed
 * - **plainSearch** - The same for a plain document, in the CodeMirror view it
 *   is shown in; loaded with that view, so not exported here
 * - **projectSearch** - Find across a project: every document with the query,
 *   each match on its line, counted as the document's own find counts them
 * - **plainMacros** - A card's `{{char}}`, `{{user}}` and the rest picked out
 *   in that view; loaded with it too
 * - **size** - `laysOut`, whether a document is short enough for the editor
 *   to lay out, which decides how a long import comes in
 * - **tables** - A table made by typing its header row, the keys that move
 *   through one, rows and columns inserted from the menu, column alignment,
 *   and pasting into a cell
 * - **links** - Making, changing, removing and opening links: the commands,
 *   and a view plugin for Mod-K, Mod-click and a pasted link
 * - **pictures** - Pictures in the text: a node view that draws one from
 *   what the editor component says its path is, a picture from the web as a
 *   placeholder that fetches nothing, figures, and the object URLs the bytes
 *   are shown on
 * - **format** - What the formatting buttons over a selection offer: its
 *   marks, its blocks' style, quoted or listed, and the commands that change
 *   them
 * - **marks** - `markAround`, the run of a mark around a position, for the
 *   link or the comment the caret is in
 * - **shortcuts** - The keys and typed shortcuts as the writer is shown them,
 *   on Mod-/, spelled for their keyboard
 *
 * `Document.content` is markdown. While a document is open — in a tab, with
 * or without a view over it — its `EditorState` is the truth and the store's
 * copy is a projection of it, serialized on a debounce (see
 * `composables/useEditor`); closed, the store's markdown is the truth. A
 * plain document (`Document.plain`) never becomes an `EditorState`: its text
 * is the truth while open and is stored as typed, so a prompt keeps whatever
 * the schema could not hold, and an import too long to lay out comes in as
 * one. The AI tools read and write it as it is; the v13 migration produced
 * it from the HTML that came before. Design: `.llm/markdown_library_design.md`.
 *
 * @example
 * import { parseMarkdown, serializeMarkdown } from '@/editor/markdown'
 * const doc = parseMarkdown('# Chapter One\n\nIt was a dark night.')
 * serializeMarkdown(doc) // '# Chapter One\n\nIt was a dark night.'
 */

export { schema, NODE_NAMES, MARK_NAMES } from './schema.js'
export { parseMarkdown, serializeMarkdown, settleMarkdown, appendBlocks } from './markdown.js'
export {
  createEditorState,
  replaceContent,
  replaceChanged,
  editsTo,
  appendContent,
  isEmptyDocument,
} from './state.js'
export { find, findAt, findNext, replaceCurrent, replaceAll, searchOf } from './search.js'
export { searchProject } from './projectSearch.js'
export { spellingKey, lintAt, replaceWith, forgetWord } from './spelling.js'
export { selectionMarkdown, markdownSlice, pasteMarkdown, readClipboard } from './clipboard.js'
export { insertTable, insertRule, insertCodeBlock } from './insert.js'
export { LAYOUT_LIMIT, laysOut } from './size.js'
export {
  pictures,
  figuresPlugin,
  insertPictures,
  takePictureUrl,
  givePictureUrl,
} from './pictures.js'
