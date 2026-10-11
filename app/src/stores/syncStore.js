import { defineStore } from 'pinia'
import { ref, toRaw } from 'vue'
import db from './db'
import { useApplicationState } from '@/composables/useApplicationState'

/** @typedef {import('../types/models.js').Change} Change */

// Timing constants (in milliseconds)
const SYNC_DEBOUNCE_MS = 500 // Wait 500ms after last change before syncing
const SYNC_RETRY_MS = 500 // Retry failed syncs after 500ms
const SYNC_PERIODIC_MS = 10000 // Safety sync every 10s

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
    pendingChanges.value.set(key, {
      entityType,
      id,
      op: 'put',
      data: toRaw(data), // Use toRaw to avoid reactivity issues
      timestamp: Date.now(),
    })

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

    pendingChanges.value.set(`${entityType}:${id}`, {
      entityType,
      id,
      op: 'delete',
      data: null,
      timestamp: Date.now(),
    })

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
    /** @type {import('dexie').Table} */
    const table = db[entityType]

    try {
      // Use a transaction for all changes of this type
      await db.transaction('rw', table, async () => {
        for (const change of entityChanges) {
          if (change.op === 'delete') {
            if (debug.value) console.log(`Deleting ${entityType} row:`, change.id)
            await table.delete(change.id)
            continue
          }
          // Belt-and-suspenders: toRaw() removes Vue reactivity, deep clone ensures
          // complete isolation and strips non-serializable properties. This fixed
          // reactivity issues before type checking was added - keeping for safety.
          const plainData = JSON.parse(JSON.stringify(toRaw(change.data)))
          const dataToSave = {
            ...plainData,
            version: (plainData.version || 0) + 1,
          }
          // The whole record, keys and all, so only while the writer has asked
          // to see what the app is doing.
          if (debug.value) console.log(`Saving ${entityType} change:`, dataToSave)
          await table.put(dataToSave)
        }
      })
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
      // Check if database is initialized
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Save each entity type
      let failureCount = 0

      for (const [entityType, entityChanges] of Object.entries(grouped)) {
        // Check if table exists before trying to persist
        if (!db[entityType]) {
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
  }
})
