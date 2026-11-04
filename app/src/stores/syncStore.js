import { defineStore } from 'pinia'
import { ref, toRaw } from 'vue'
import { storage } from '@/storage/index.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { plainCopy } from '@/utils/plainCopy.js'

/** @typedef {import('../types/models.js').Change} Change */

// Timing constants (in milliseconds)
const SYNC_DEBOUNCE_MS = 500 // Wait 500ms after last change before syncing
const SYNC_RETRY_MS = 500 // Retry failed syncs after 500ms
const SYNC_PERIODIC_MS = 10000 // Safety sync every 10s

/** The tables a change to which is something done in a project, which saves a project held back. */
const DOING = new Set(['stories', 'documents', 'chats', 'files', 'versions'])

/**
 * The project a change is of, where it says.
 * @param {string} entityType
 * @param {string} id
 * @param {any} data
 * @returns {string|undefined}
 */
const projectOf = (entityType, id, data) =>
  entityType === 'stories' || entityType === 'projectViews' ? id : data?.storyId

export const useSyncStore = defineStore('sync', () => {
  /**
   * @type {import('vue').Ref<Map<string, Change>>}
   */
  const pendingChanges = ref(new Map())

  /** @type {import('vue').Ref<boolean>} */
  const isSyncing = ref(false)

  /** @type {import('vue').Ref<ReturnType<typeof setTimeout>|null>} */
  const syncTimer = ref(null)

  /** Whether the writer has the Debug switch on, which logs every save. */
  const { debug } = useApplicationState()

  /**
   * The changes of a project not saved yet, held back by its id until
   * something is done in it (`hold`): then they go, and it is told.
   * @type {Map<string, {changes: Map<string, Change>, making: boolean, onStart: () => void}>}
   */
  const held = new Map()

  /**
   * Hold back a project's changes: those made in making it, and from then on
   * those that do nothing in it (its view), until one that does (a document,
   * a chat, its name or settings) saves them all. `made` says it is made.
   * @param {string} storyId
   * @param {() => void} onStart - Told once its changes go
   */
  function hold(storyId, onStart) {
    held.set(storyId, { changes: new Map(), making: true, onStart })
  }

  /**
   * A project held back is made: a change that does something in it saves it.
   * @param {string} storyId
   */
  function made(storyId) {
    const holding = held.get(storyId)
    if (holding) holding.making = false
  }

  /**
   * Save a project held back, and what was held of it.
   * @param {string} storyId
   * @returns {boolean} Whether it was held back
   */
  function start(storyId) {
    const holding = held.get(storyId)
    if (!holding) return false
    held.delete(storyId)
    for (const [key, change] of holding.changes) pendingChanges.value.set(key, change)
    holding.onStart()
    schedule()
    return true
  }

  /**
   * Let go of a project held back, and of everything held of it: nothing of
   * it is saved.
   * @param {string} storyId
   */
  function drop(storyId) {
    held.delete(storyId)
  }

  /**
   * Where a change goes while its project is held back: kept with it, or,
   * doing something in it, saving it first.
   * @param {string} key
   * @param {Change} change
   * @returns {boolean} Whether it was held
   */
  function heldBack(key, change) {
    if (held.size === 0) return false
    const storyId =
      change.op === 'delete'
        ? [...held].find(([, holding]) => holding.changes.has(key))?.[0]
        : projectOf(change.entityType, change.id, change.data)
    const holding = storyId ? held.get(storyId) : undefined
    if (!holding) return false
    if (holding.making || change.op === 'delete' || !DOING.has(change.entityType)) {
      holding.changes.set(key, change)
      return true
    }
    start(/** @type {string} */ (storyId))
    return false
  }

  /**
   * Track a change for persistence
   * @param {string} entityType - Type of entity (table name)
   * @param {string} id - Entity ID
   * @param {any} data - Entity data to persist
   * @returns {void}
   */
  function trackChange(entityType, id, data) {
    // Validate required parameters
    if (!entityType || !id) {
      console.error('Invalid trackChange call: missing entityType or id', { entityType, id })
      return
    }

    if (!data) {
      console.error('Invalid trackChange call: missing data', { entityType, id })
      return
    }

    const key = `${entityType}:${id}`
    /** @type {Change} */
    const change = {
      entityType,
      id,
      op: 'put',
      data: toRaw(data), // Use toRaw to avoid reactivity issues
      timestamp: Date.now(),
    }
    if (heldBack(key, change)) return
    pendingChanges.value.set(key, change)

    schedule()
  }

  /**
   * Track a row's removal for persistence.
   *
   * Queued like a write, under the same key, so it lands in order with the
   * writes around it: an edit queued a moment before the delete is dropped
   * rather than put back after the row is gone, and a write queued after the
   * delete — a restore — wins over it.
   *
   * @param {string} entityType - Type of entity (table name)
   * @param {string} id - Entity ID
   * @returns {void}
   */
  function trackDelete(entityType, id) {
    if (!entityType || !id) {
      console.error('Invalid trackDelete call: missing entityType or id', { entityType, id })
      return
    }

    const key = `${entityType}:${id}`
    /** @type {Change} */
    const change = { entityType, id, op: 'delete', data: null, timestamp: Date.now() }
    if (heldBack(key, change)) return
    pendingChanges.value.set(key, change)

    schedule()
  }

  /** Save after a pause in the changes. */
  function schedule() {
    if (syncTimer.value) {
      clearTimeout(syncTimer.value)
    }
    syncTimer.value = setTimeout(() => processSync(), SYNC_DEBOUNCE_MS)
  }

  /**
   * Persist changes for a single entity type
   * @param {string} entityType - Type of entity (table name)
   * @param {Change[]} entityChanges - Array of changes to persist
   * @returns {Promise<boolean>} True if successful
   */
  async function persistEntityChanges(entityType, entityChanges) {
    try {
      const saved = entityChanges.map(change => {
        if (change.op === 'delete') {
          if (debug.value) console.log(`Deleting ${entityType} row:`, change.id)
          return change
        }
        // What's saved is apart from the row the app goes on changing, and
        // free of reactivity and of anything that can't be stored.
        const plainData = plainCopy(change.data)
        const dataToSave = {
          ...plainData,
          version: (plainData.version || 0) + 1,
        }
        // The whole record, keys and all, so only while the writer has asked
        // to see what the app is doing.
        if (debug.value) console.log(`Saving ${entityType} change:`, dataToSave)
        return { ...change, data: dataToSave }
      })
      // All the changes of one type are written together
      await storage.write(entityType, saved)
      return true
    } catch (error) {
      console.error(`Failed to persist ${entityType}:`, error)
      return false
    }
  }

  /** @type {Promise<void>|null} The save under way, if there is one. */
  let saving = null

  /**
   * Save every pending change.
   *
   * One save runs at a time. Asked for during one, this waits for it, then
   * saves what came in meanwhile, so once it resolves every change made
   * before it was called is in the database, unless saving failed and a retry
   * is due.
   * @returns {Promise<void>}
   */
  async function processSync() {
    while (saving) await saving
    if (pendingChanges.value.size === 0) return
    saving = save()
    try {
      await saving
    } finally {
      saving = null
    }
  }

  /**
   * Save the pending changes as they are now.
   * @returns {Promise<void>}
   */
  async function save() {
    isSyncing.value = true
    const changes = Array.from(pendingChanges.value.values())
    pendingChanges.value.clear()

    // Group changes by entity type for batch operations
    /** @type {Object<string, Change[]>} */
    const grouped = changes.reduce((acc, change) => {
      if (!acc[change.entityType]) {
        acc[change.entityType] = []
      }
      acc[change.entityType].push(change)
      return acc
    }, {})

    try {
      // Save each entity type
      let failureCount = 0

      for (const [entityType, entityChanges] of Object.entries(grouped)) {
        // Check if table exists before trying to persist
        if (!storage.has(entityType)) {
          console.error(
            `Table '${entityType}' not found in database - discarding ${entityChanges.length} changes`
          )
          // Don't re-queue changes for non-existent tables
          continue
        }

        const success = await persistEntityChanges(entityType, entityChanges)
        if (!success) {
          console.error(`Failed to persist ${entityType} (${entityChanges.length} changes)`)
          failureCount++
        }
      }

      // If there were failures, throw to trigger retry logic
      if (failureCount > 0) {
        throw new Error(`Failed to persist ${failureCount} entity type(s)`)
      }
    } catch (error) {
      console.error('Sync failed:', error)
      // Re-queue all changes on catastrophic failure (if not superseded)
      changes.forEach(change => {
        const key = `${change.entityType}:${change.id}`
        if (!pendingChanges.value.has(key)) {
          pendingChanges.value.set(key, change)
        }
      })
      // Try again
      if (syncTimer.value) {
        clearTimeout(syncTimer.value)
      }
      syncTimer.value = setTimeout(() => processSync(), SYNC_RETRY_MS)
    } finally {
      isSyncing.value = false
    }
  }

  // Set up event listeners for aggressive saving
  if (typeof window !== 'undefined') {
    // Handler functions (so we can remove them later)
    const handleBlur = () => {
      if (pendingChanges.value.size > 0) {
        processSync()
      }
    }

    const handleVisibilityChange = () => {
      if (document.hidden && pendingChanges.value.size > 0) {
        processSync()
      }
    }

    // Save when window loses focus
    window.addEventListener('blur', handleBlur)

    // Save when tab becomes hidden
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Periodic save as safety net
    window.setInterval(() => {
      if (pendingChanges.value.size > 0) {
        processSync()
      }
    }, SYNC_PERIODIC_MS)

    // Note: Since Pinia stores persist for the app lifetime,
    // we don't need to clean up these listeners
  }

  return {
    // State (exposed for debugging/monitoring)
    pendingChanges,
    isSyncing,

    // Actions
    trackChange,
    trackDelete,
    processSync,
    hold,
    made,
    start,
    drop,
  }
})
