/**
 * @module utils
 * @description Utility functions and helpers for the inksprite application.
 *
 * ## Utilities Overview
 *
 * ### Text Processing
 * - **formatters** - Text formatting utilities
 * - **markdown** - Markdown parsing and rendering
 * - **math** - TeX in markdown typeset with KaTeX, loaded the first time a formula needs it
 * - **partialJson** - The strings in JSON that has not finished arriving
 * - **wordCount** - Words in a document's markdown
 * - **lineDiff** - The lines that changed between two versions of a text
 * - **compareNames** - Names in the order a person expects, numbers by value
 * - **siblingOrder** - The order a folder's children are shown in
 * - **trash** - How long the trash keeps what is in it, and which of a project's documents are there
 * - **versions** - When a document's version is due, and which go as they age
 * - **wordDiff** - Two texts as one, word by word: what both have and what only one has,
 *   for a plain document's versions
 *
 * ### AI Integration
 *
 * ### Chat
 * - **turns** - Fold a chat's messages into the turns they were sent as
 * - **obfuscate** - A chat export with its words taken out, for sharing its shape (the Export obfuscated menu item, with Debug on)
 * - **focus** - Whether the writer is typing somewhere already
 * - **documentPath** - How a document is addressed: by its titles from the root down
 * - **documentLinks** - Links from one document to another, written as Markdown files link to
 *   the files beside them, and followed back
 * - **linkUpdates** - The links a rename or a move would break, written again to where their
 *   documents are
 * - **pictures** - A document's own pictures as its text refers to them, `.images/<id>/<name>`,
 *   and where their bytes are kept
 * - **dataUrl** - What a `data:` address holds, as bytes
 * - **visibility** - What one chat sees of the project: hidden outright, and each chat's pins, shows and hides
 * - **chatTitle** - What a chat is called before it has a name, and a title the model wrote, made plain
 *
 * ### Editor
 * - **tabs** - The editor's tabs: open, close, and what a story remembers of them
 *
 * ### Browser
 * - **webkit** - Whether the page is running in WebKit, for what only WebKit does
 * - **touch** - Whether the writer is typing on a touch screen's keyboard, where Enter starts a new line
 *
 * ### Storage
 * - **localStorage** - LocalStorage wrapper with quota management
 * - **backup** - Build and validate backup files: the whole database, a chat, settings, and a project or a selection saved before
 * - **backupArchive** - A backup as a zip, its rows as JSON and each file's bytes an entry of its own
 * - **zipWriter** - A zip written a piece at a time, a backup's and an export's
 * - **settingsFile** - What a settings file holds, which of it the writer picked, and what importing one changes
 * - **settingsTree** - What Export settings offers, as a tree of boxes, and what the boxes ticked choose
 *
 * ## Usage Examples
 *
 * @example
 * // Word counting
 * import { countWords } from '@/utils/wordCount'
 * const wordCount = countWords(storyContent)
 *
 * @example
 * // Markdown rendering
 * import { renderMarkdown } from '@/utils/markdown'
 * const html = renderMarkdown(markdownText)
 */

// Re-export all utilities
export * from './formatters.js'
export * from './backup.js'
export * from './localStorage.js'
export * from './sessionStorage.js'
export * from './markdown.js'
export * from './wordCount.js'
export * from './turns.js'
export * from './focus.js'
export * from './documentPath.js'
export * from './compareNames.js'
export * from './siblingOrder.js'
export {
  isDocumentHref,
  fileNameOf,
  resolveLink,
  documentNamed,
  readableHref,
  hrefFor,
} from './documentLinks.js'
export { linkTargets, relinked } from './linkUpdates.js'
export * from './pictures.js'
export * from './dataUrl.js'
export * from './visibility.js'
