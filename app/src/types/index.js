/**
 * @module types
 * @description Type definitions and JSDoc typedefs for the inksprite application.
 *
 * ## Type Files
 *
 * - **models** - Data model type definitions (Story, Part, Scene, etc.)
 * - **composables** - Composable return types and interfaces
 *
 * ## Type System
 *
 * inksprite uses JSDoc annotations for type safety without TypeScript:
 * - All functions have explicit parameter and return types
 * - Complex types are defined as JSDoc typedefs
 * - Type checking is done via `npm run typecheck`
 *
 * ## Core Types
 *
 * @typedef {Object} Story
 * @property {string} id - Unique identifier
 * @property {string} title - Story title
 * @property {string} overview - Legacy synopsis; see the root document's `summary`
 * @property {number} createdAt - Creation timestamp
 * @property {number} updatedAt - Last update timestamp
 *
 * @typedef {Object} Part
 * @property {string} id - Unique identifier
 * @property {string} storyId - Parent story ID
 * @property {string} title - Part title (e.g., "Act 1")
 * @property {number} order - Display order
 * @property {boolean} isDrafts - Whether this is the drafts container
 *
 * @typedef {Object} Scene
 * @property {string} id - Unique identifier
 * @property {string} storyId - Parent story ID
 * @property {string} partId - Parent part ID
 * @property {string} title - Scene title
 * @property {string} content - Scene content (HTML)
 * @property {boolean} isDraft - Whether this is a draft scene
 *
 * @typedef {Object} Chat
 * @property {string} id - Unique identifier
 * @property {string} storyId - Associated story ID
 * @property {string} title - Chat title
 * @property {number} createdAt - Creation timestamp
 *
 * @typedef {Object} Message
 * @property {string} id - Unique identifier
 * @property {string} chatId - Parent chat ID
 * @property {string} role - Message role ('user' | 'assistant')
 * @property {string} content - Message content
 * @property {number} createdAt - Creation timestamp
 *
 * @typedef {Object} Lorebook
 * @property {string} id - Unique identifier
 * @property {string} storyId - Associated story ID
 * @property {Array<LorebookEntry>} entries - Lorebook entries
 *
 * @typedef {Object} LorebookEntry
 * @property {string} id - Entry identifier
 * @property {string} title - Entry title
 * @property {string} content - Entry content
 * @property {Array<string>} tags - Associated tags
 * @property {boolean} enabled - Whether entry is active
 */

// Re-export type definition files
export * from './models.js'
export * from './composables.js'
