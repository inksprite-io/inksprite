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
 * - **state** - `createEditorState`, the keys and typed shortcuts, and the
 *   `replaceContent` and `appendContent` transactions an outside writer asks for
 * - **search** - Find and replace: the matches as a plugin's state, drawn as
 *   decorations, and the commands that move between and replace them
 * - **plainSearch** - The same for a plain document, in the CodeMirror view it
 *   is shown in; loaded with that view, so not exported here
 * - **size** - `laysOut`, whether a document is short enough for the editor
 *   to lay out, which decides how a long import comes in
 * - **tables** - A table made by typing its header row, the keys that move
 *   through one, column alignment, and pasting into a cell
 * - **links** - Making, changing, removing and opening links: the commands,
 *   and a view plugin for Mod-K, Mod-click and a pasted link
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
export { createEditorState, replaceContent, appendContent, isEmptyDocument } from './state.js'
export { find, findNext, replaceCurrent, replaceAll, searchOf } from './search.js'
export { LAYOUT_LIMIT, laysOut } from './size.js'
