/**
 * @module stores
 * @description State management layer for InkSprite using Pinia stores.
 *
 * ## Architecture
 *
 * The stores follow a hierarchical data model:
 * - **Stories** - Top-level entities; a story's name and overview live on its
 *   root document, as that document's title and summary
 * - **Documents** - A story's tree. A folder holds children, a text document
 *   holds content, a file holds the text read out of something imported — a
 *   PDF, an image — with its bytes kept beside it; the manuscript, notes,
 *   lore, and papers are all documents
 * - **Chats** - AI conversation sessions attached to stories
 * - **Messages** - Individual messages within chats
 *
 * ## Store Files
 *
 * - `storiesStore.js` - Story CRUD operations and management
 * - `documentsStore.js` - A story's document tree; the source of truth for its content
 * - `filesStore.js` - The bytes behind a file document, in a table the tree never loads
 * - `chatsStore.js` - AI chat session management
 * - `messagesStore.js` - Chat message history
 * - `aiProvidersStore.js` - AI endpoints and credentials
 * - `aiPresetStore.js` - AI profiles (provider, model, generation overrides)
 * - `aiPromptStore.js` - Saved system prompts, shared app-wide
 * - `skillStore.js` - The writer's own skills, each a SKILL.md and its files, handed to the skills registry as they change
 * - `mcpServerStore.js` - The writer's MCP servers: where each answers and what it offered, handed to `mcp/servers.js` as they change
 * - `syncStore.js` - Database synchronization and state persistence
 * - `db.js` - Dexie (IndexedDB) database configuration
 *
 * ## Usage
 *
 * @example
 * // Create a project. The template decides what is inside it; only the root
 * // is guaranteed, and everything under it is the writer's to change.
 * import { useStoriesStore } from './stores/storiesStore'
 * import { useDocumentsStore } from './stores/documentsStore'
 *
 * const stories = useStoriesStore()
 * const documents = useDocumentsStore()
 *
 * const story = await stories.createStory('My Novel', 'novel')
 * const root = documents.getRoot(story.id)
 *
 * @example
 * // Read a folder's children in display order
 * const chapters = documents.getChildrenOrdered(folderId)
 */

// Re-export all stores for convenience
export { useStoriesStore } from './storiesStore.js'
export { useDocumentsStore } from './documentsStore.js'
export { useChatsStore } from './chatsStore.js'
export { useMessagesStore } from './messagesStore.js'
export { useAIProvidersStore } from './aiProvidersStore.js'
export { useSyncStore } from './syncStore.js'
export { default as db } from './db.js'
