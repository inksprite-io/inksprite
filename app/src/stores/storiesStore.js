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
import { storage } from '@/storage/index.js'
import { freeName as freeAmong } from '@/utils/titleValidation.js'

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
   * Projects by id, those in the trash aside: what the project list, the
   * switcher and everything else read.
   * @type {import('vue').Ref<Map<string, Story>>}
   */
  const stories = ref(new Map())

  /**
   * Projects in the trash by id, kept out of `stories`; see `utils/trash.js`.
   * @type {import('vue').Ref<Map<string, Story>>}
   */
  const trash = ref(new Map())

  /**
   * Keep a project's record in the map it belongs in, and out of the other.
   * @param {Story} story
   */
  function place(story) {
    ;(story.trashed ? stories : trash).value.delete(story.id)
    ;(story.trashed ? trash : stories).value.set(story.id, story)
  }

  // Get sync store instance
  const syncStore = useSyncStore()

  /**
   * Initialize store by loading all stories from database
   * @returns {Promise<void>}
   */
  async function initialize() {
    try {
      const loaded = await storage.stories()
      loaded.forEach(place)
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
   * Read every project's record again, after another window changed the
   * list: those come and gone, and the rest as written there. Those in
   * `keep`, open here, are this window's and stay as they are.
   *
   * @param {string[]} keep
   * @returns {Promise<void>}
   */
  async function refresh(keep) {
    if (!initializePromise.value) return
    await initializePromise.value
    const kept = new Set(keep)
    try {
      const loaded = await storage.stories()
      const found = new Set(loaded.map(story => story.id))
      for (const map of [stories.value, trash.value]) {
        for (const id of [...map.keys()]) if (!found.has(id) && !kept.has(id)) map.delete(id)
      }
      for (const story of loaded) if (!kept.has(story.id)) place(story)
    } catch (error) {
      console.error('Failed to read the projects again:', error)
    }
  }

  /**
   * Read a project again as this window takes it up, not having had it
   * since it loaded (see `platform/windows.js`): its record and root, read
   * for the list of projects, and in the library what was read of its
   * folder, may have been read while another window had it, and be behind.
   * A project whose tree is loaded was read whole while no other window had
   * it, and is as it was.
   *
   * @param {string} storyId
   * @returns {Promise<void>}
   */
  async function readAfresh(storyId) {
    const documentsStore = useDocumentsStore()
    if (documentsStore.isStoryLoaded(storyId)) return
    try {
      await storage.reopenProject(storyId)
      const story = await storage.story(storyId)
      if (story) place(story)
      await documentsStore.refreshRoots([storyId])
    } catch (error) {
      console.error(`Failed to read ${storyId} again:`, error)
    }
  }

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
   * Take a project's record as another device left it, synced (`cloud/`):
   * kept as it came, and saved.
   *
   * @param {Story} row
   */
  function receive(row) {
    place(row)
    syncStore.trackChange('stories', row.id, row)
  }

  /**
   * Move a project to the trash, whole: its documents and chats stay as they
   * are, and come back with it.
   *
   * @param {string} storyId
   * @param {number} [at] - When, if not now
   * @returns {Promise<Story>}
   * @throws {Error} If the project is not found
   */
  async function trashStory(storyId, at = Date.now()) {
    await ensureInitialized()
    const story = stories.value.get(storyId)
    if (!story) {
      throw new Error(`Failed to trash story, '${storyId}' not found`)
    }
    /** @type {Story} */
    const next = { ...story, trashed: at }
    place(next)
    syncStore.trackChange('stories', storyId, next)
    return next
  }

  /**
   * Bring a project back from the trash.
   *
   * @param {string} storyId
   * @returns {Promise<Story>}
   * @throws {Error} If the project is not in the trash
   */
  async function restoreStory(storyId) {
    await ensureInitialized()
    const story = trash.value.get(storyId)
    if (!story) {
      throw new Error(`Failed to restore story, '${storyId}' is not in the trash`)
    }
    /** @type {Story} */
    const next = { ...story }
    delete next.trashed
    place(next)
    syncStore.trackChange('stories', storyId, next)
    return next
  }

  /**
   * The projects in the trash, the most recent first.
   * @returns {Story[]}
   */
  function trashedStories() {
    return Array.from(trash.value.values()).sort((a, b) => (b.trashed ?? 0) - (a.trashed ?? 0))
  }

  /**
   * Delete a story, in the list or in the trash, and cascade to all children
   * @param {string} storyId - Story ID to delete
   * @throws {Error} If story not found
   */
  async function deleteStory(storyId) {
    await ensureInitialized()

    const story = stories.value.get(storyId) ?? trash.value.get(storyId)
    if (!story) {
      throw new Error(`Failed to delete story, '${storyId}' not found`)
    }

    // Cascade delete to all children
    // Import stores (they're already loaded in the app)
    const { useChatsStore } = await import('./chatsStore.js')
    const { useMessagesStore } = await import('./messagesStore.js')
    const { useProjectViewsStore } = await import('./projectViewsStore.js')

    const chatsStore = useChatsStore()
    const messagesStore = useMessagesStore()

    // The manuscript, notes, and everything else the project holds are one
    // tree, so one call reaches all of it.
    await useDocumentsStore().deleteStoryDocuments(storyId)

    // Delete chats -> messages, those in the trash too. A chat's messages are
    // read first: only those read are known to be there to delete.
    await chatsStore.loadChatsForStory(storyId)
    const chats = [...chatsStore.getChatsForStory(storyId), ...chatsStore.trashedOf(storyId)]
    for (const chat of chats) {
      if (!messagesStore.isChatLoaded(chat.id)) await messagesStore.loadMessagesForChat(chat.id)
      messagesStore.deleteMessagesForChat(chat.id)
      chatsStore.deleteChat(chat.id)
    }

    useProjectViewsStore().deleteView(storyId)
    syncStore.trackDelete('stories', storyId)
    stories.value.delete(storyId)
    trash.value.delete(storyId)
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

    const story = await storage.story(storyId)
    if (!story) return null
    place(story)
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
   * `freeName` in utils/titleValidation. The names are read off the projects' roots as far as
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
    return freeAmong(taken, title)
  }

  /**
   * Load every project's name, for `freeName` to read.
   * @returns {Promise<void>}
   */
  async function loadNames() {
    await ensureInitialized()
    await useDocumentsStore().loadRoots([...stories.value.keys(), ...trash.value.keys()])
  }

  return {
    // State
    stories,
    trash,
    isInitialized,

    // Actions
    createStory,
    updateStory,
    trashStory,
    restoreStory,
    trashedStories,
    deleteStory,
    receive,
    loadStory,
    getStory,
    getAllStories,
    getAllStoriesOrdered,
    ensureInitialized,
    refresh,
    readAfresh,
    freeName,
    loadNames,
  }
})
