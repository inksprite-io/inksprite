/**
 * @module utils
 * @description Utility functions and helpers for the inksprite application.
 *
 * ## Utilities Overview
 *
 * ### Text Processing
 * - **formatters** - Text formatting utilities
 * - **markdown** - Markdown parsing and rendering
 * - **partialJson** - The strings in JSON that has not finished arriving
 * - **wordCount** - Words in a document's markdown
 * - **lineDiff** - The lines that changed between two versions of a text
 *
 * ### AI Integration
 *
 * ### Chat
 * - **turns** - Fold a chat's messages into the turns they were sent as
 * - **obfuscate** - A chat export with its words taken out, for sharing its shape (the Export obfuscated menu item, with Debug on)
 * - **focus** - Whether the writer is typing somewhere already
 * - **documentPath** - How a document is addressed: by its titles from the root down
 * - **visibility** - What one chat sees of the project: hidden outright, and each chat's pins, shows and hides
 *
 * ### Editor
 * - **tabs** - The editor's tabs: open, close, and what a story remembers of them
 *
 * ### Storage
 * - **localStorage** - LocalStorage wrapper with quota management
 * - **backup** - Build and validate export files: the whole database, a chat, a project
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
export * from './visibility.js'
