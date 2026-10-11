/**
 * @module stores/storiesStore
 * @description Central store for managing stories in inksprite. Handles all CRUD operations
 * for stories including creation, deletion, updates, and synchronization with IndexedDB.
 * Stories are the top-level entities that contain parts (acts) and scenes (chapters).
 *
 * @example
 * // Create a new story
 * const store = useStoriesStore()
 * const story = await store.createStory('My Novel')
 *
 * @example
 * // Update story content
 * await store.updateStory(storyId, { content: 'Chapter 1...' })
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { nanoid } from 'nanoid'
import { useSyncStore } from './syncStore'
import { useDocumentsStore } from './documentsStore'
import db from './db'
import { freeProjectName } from '@/utils/titleValidation.js'

/** @typedef {import('../types/models.js').Story} Story */

/**
 * Generate a unique story ID
 * @returns {string} Story ID in format story_xxx
 */
function generateStoryId() {
  return `story_${nanoid()}`
}

export const useStoriesStore = defineStore('stories', () => {
  /**
   * @type {import('vue').Ref<Map<string, Story>>}
   */
  const stories = ref(new Map())

  // Get sync store instance
  const syncStore = useSyncStore()

  /**
   * Initialize store by loading all stories from database
   * @returns {Promise<void>}
   */
  async function initialize() {
    try {
      // Load all stories and filter in memory (IndexedDB doesn't handle boolean indexes well)
      const allStories = await db.stories.toArray()
      const loaded = allStories
      loaded.forEach(story => {
        stories.value.set(story.id, story)
      })
      console.log(`Loaded ${loaded.length} stories from database`)
    } catch (error) {
      console.error('Failed to load stories from database:', error)
    }
  }

  /** @type {import('vue').Ref<boolean>} */
  const isInitialized = ref(false)

  /** @type {import('vue').Ref<Promise<void>|null>} */
  const initializePromise = ref(null)

  /**
   * Ensure initialization happens only once
   * @returns {Promise<void>}
   */
  function ensureInitialized() {
    if (!initializePromise.value) {
      initializePromise.value = (async () => {
        try {
          await initialize()
        } finally {
          isInitialized.value = true
        }
      })()
    }
    return initializePromise.value
  }

  // Auto-initialize when store is created
  ensureInitialized()

  /**
   * Create a new project: a story row and an empty root node. What goes under
   * the root is the writer's to lay out; nothing is put there for them.
   *
   * @param {string} [title] - The project's name, written onto its root node
   * @returns {Promise<Story>} The created story
   */
  async function createStory(title) {
    await ensureInitialized()

    const storyId = generateStoryId()

    // The project's name lives on its root node, so the tree is built before
    // the story row exists — including for the bookshelf, which shows the
    // name long before anyone opens the project.
    const documentsStore = useDocumentsStore()
    documentsStore.ensureRoot(storyId, title)

    /** @type {Story} */
    const story = {
      id: storyId,
      overview: '',
      wordCount: 0,
      lastDocumentId: null,
      // Absent options mean the defaults: new chats start on the built-in
      // chat prompt until the project's settings say otherwise.
      options: {},
      version: 1,
      created: Date.now(),
      updated: Date.now(),
    }

    stories.value.set(story.id, story)

    // Track change for persistence
    syncStore.trackChange('stories', story.id, story)

    return story
  }

  /**
   * Update an existing story with partial updates
   * @param {string} storyId - Story ID to update
   * @param {Partial<Story>} updates - Fields to update
   * @returns {Promise<Story>} Updated story
   * @throws {Error} If story not found
   */
  async function updateStory(storyId, updates) {
    await ensureInitialized()

    const story = stories.value.get(storyId)
    if (!story) {
      throw new Error(`Failed to update story, '${storyId}' not found`)
    }

    /** @type {Story} */
    const updated = {
      ...story,
      ...updates,
      // Preserve system fields
      id: story.id,
      created: story.created,
      version: story.version,
      updated: Date.now(),
    }

    stories.value.set(storyId, updated)

    // Track change for persistence
    syncStore.trackChange('stories', storyId, updated)

    return updated
  }

  /**
   * Delete a story and cascade to all children
   * @param {string} storyId - Story ID to delete
   * @throws {Error} If story not found
   */
  async function deleteStory(storyId) {
    await ensureInitialized()

    const story = stories.value.get(storyId)
    if (!story) {
      throw new Error(`Failed to delete story, '${storyId}' not found`)
    }

    // Cascade delete to all children
    // Import stores (they're already loaded in the app)
    const { useChatsStore } = await import('./chatsStore.js')
    const { useMessagesStore } = await import('./messagesStore.js')

    const chatsStore = useChatsStore()
    const messagesStore = useMessagesStore()

    // The manuscript, notes, and everything else the project holds are one
    // tree, so one call reaches all of it.
    await useDocumentsStore().deleteStoryDocuments(storyId)

    // Delete chats -> messages
    await chatsStore.loadChatsForStory(storyId)
    const chats = chatsStore.getChatsForStory(storyId)
    for (const chat of chats) {
      messagesStore.deleteMessagesForChat(chat.id)
      chatsStore.deleteChat(chat.id)
    }

    syncStore.trackDelete('stories', storyId)
    stories.value.delete(storyId)
  }

  /**
   * Read one story's record into the store, for a story written to the
   * database by something other than the store: an imported project, whose
   * rows go in together in one transaction.
   *
   * @param {string} storyId
   * @returns {Promise<Story|null>} The story, or null if the database has no such row
   */
  async function loadStory(storyId) {
    await ensureInitialized()

    const story = await db.stories.get(storyId)
    if (!story) return null
    stories.value.set(story.id, story)
    return story
  }

  /**
   * Get a single story by ID
   * @param {string} storyId - Story ID to retrieve
   * @returns {Story|null} Story or null if not found
   */
  function getStory(storyId) {
    // Check if we have the story in memory
    const story = stories.value.get(storyId)
    return story || null
  }

  /**
   * Get all stories as an array
   * @returns {Story[]} Array of stories
   */
  function getAllStories() {
    return Array.from(stories.value.values())
  }

  /**
   * Get all stories ordered by last updated date and title
   * @returns {Story[]} Array of stories
   */
  function getAllStoriesOrdered() {
    return (
      Array.from(stories.value.values())
        // Names live on root documents now, so the tiebreak is on id: stable,
        // and it needs nothing loaded beyond the story records themselves.
        .sort((a, b) => b.updated - a.updated || (a.id > b.id ? 1 : a.id < b.id ? -1 : 0))
    )
  }

  /**
   * A name no other project goes by: `title`, or a numbered copy of it. See
   * `freeProjectName`. The names are read off the projects' roots as far as
   * they are loaded; `loadNames` loads them all, and the outline's project
   * switcher has done so already.
   *
   * @param {string} title
   * @param {string} [exceptStoryId] - The project being named, which is not in its own way
   * @returns {string}
   */
  function freeName(title, exceptStoryId) {
    const documentsStore = useDocumentsStore()
    const taken = []
    for (const id of stories.value.keys()) {
      const root = id === exceptStoryId ? null : documentsStore.getRoot(id)
      if (root) taken.push(root.title?.trim() || 'Untitled')
    }
    return freeProjectName(taken, title)
  }

  /**
   * Load every project's name, for `freeName` to read.
   * @returns {Promise<void>}
   */
  async function loadNames() {
    await ensureInitialized()
    await useDocumentsStore().loadRoots([...stories.value.keys()])
  }

  return {
    // State
    stories,
    isInitialized,

    // Actions
    createStory,
    updateStory,
    deleteStory,
    loadStory,
    getStory,
    getAllStories,
    getAllStoriesOrdered,
    ensureInitialized,
    freeName,
    loadNames,
  }
})
