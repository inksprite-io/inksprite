/**
 * @module stores/webSearchStore
 * @description How the writer set web search up, app-wide: the service in
 * use, a key for each service they gave one for, and the profiles whose chats
 * search. One row, `id` 'web'.
 *
 * Whatever is here is handed to `web/config.js` the moment it changes, so the
 * tools and the turn read what is here now without reaching for a store — the
 * way the servers reach `mcp/servers.js`.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useSyncStore } from './syncStore.js'
import { setWebSearch } from '@/web/config.js'
import { disconnect } from '@/mcp/client.js'
import { CHAT_PROFILE_ID } from '@/ai/profiles/index.js'
import db from './db'

/** @typedef {import('../types/models.js').WebSearchSetup} WebSearchSetup */

/** The one row's id. */
const ROW = /** @type {const} */ ('web')

/** @returns {WebSearchSetup} A setup with nothing chosen, used in chats on Default once it is */
function emptySetup() {
  return { id: ROW, keys: {}, profiles: [CHAT_PROFILE_ID] }
}

export const useWebSearchStore = defineStore('webSearch', () => {
  /** @type {import('vue').Ref<WebSearchSetup>} */
  const setup = ref(emptySetup())

  const syncStore = useSyncStore()

  /** @type {import('vue').Ref<Promise<void>|null>} */
  const initializePromise = ref(null)

  async function initialize() {
    try {
      const stored = await db.webSearch.get(ROW)
      if (stored) setup.value = { ...emptySetup(), ...stored }
    } catch (error) {
      console.error('Failed to load web search from database:', error)
    }
    setWebSearch(setup.value)
  }

  /** @returns {Promise<void>} */
  function ensureInitialized() {
    if (!initializePromise.value) initializePromise.value = initialize()
    return initializePromise.value
  }

  ensureInitialized()

  /**
   * Change the setup. A key that changed is used on a new connection the next
   * time the service is called.
   *
   * @param {Partial<Omit<WebSearchSetup, 'id'>>} updates
   * @returns {WebSearchSetup}
   */
  function update(updates) {
    /** @type {WebSearchSetup} */
    const updated = { ...setup.value, ...updates, id: ROW, updated: Date.now() }
    if (updates.keys) {
      for (const service of Object.keys(updates.keys)) {
        if (updates.keys[service] !== setup.value.keys?.[service]) disconnect(`web:${service}`)
      }
    }
    setup.value = updated
    syncStore.trackChange('webSearch', ROW, updated)
    setWebSearch(updated)
    return updated
  }

  return { setup, ensureInitialized, update }
})
