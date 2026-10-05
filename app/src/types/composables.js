/**
 * Type definitions for composables
 */

/**
 * @typedef {Object} ChatMessage
 * @property {string} id - Message ID
 * @property {'user'|'assistant'|'system'} role - Message role
 * @property {string} content - Message content
 * @property {string} [reasoning] - Model reasoning (optional)
 * @property {number} created - Creation timestamp
 */

/**
 * @typedef {Object} StoryContext
 * @property {string} id - Story ID
 * @property {Object} [sceneContext] - Current scene context (optional)
 * @property {string} [sceneContext.id] - Scene ID
 */

// Export empty object to make this a module
export {}
