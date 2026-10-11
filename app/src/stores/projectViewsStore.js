/**
 * @module stores/projectViewsStore
 * @description Where the writer left each project on this copy of the app:
 * the editor's tabs, and which panels are showing.
 *
 * One row a project, under its story's id, kept with the app's settings
 * rather than in the project. A project opened on two machines, through a
 * library in a synced folder, keeps each machine's tabs to itself; and the
 * project's own files change only when the project does.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useSyncStore } from './syncStore.js'
import { storage } from '@/storage/index.js'

/** @typedef {import('../types/models.js').ProjectView} ProjectView */

export const useProjectViewsStore = defineStore('projectViews', () => {
  /** @type {import('vue').Ref<Map<string, ProjectView>>} */
  const views = ref(new Map())

  const syncStore = useSyncStore()

  /** @type {Promise<void>|null} */
  let initializePromise = null

  async function initialize() {
    try {
      for (const view of await storage.all('projectViews')) views.value.set(view.id, view)
    } catch (error) {
      console.error('Failed to load where projects were left:', error)
    }
  }

  /** @returns {Promise<void>} */
  function ensureInitialized() {
    if (!initializePromise) initializePromise = initialize()
    return initializePromise
  }

  /**
   * @param {string} storyId
   * @returns {ProjectView|undefined}
   */
  const getView = storyId => views.value.get(storyId)

  /**
   * Record where the writer is in a project.
   * @param {string} storyId
   * @param {Partial<Omit<ProjectView, 'id'|'version'|'updated'>>} changes
   */
  function updateView(storyId, changes) {
    const before = views.value.get(storyId)
    /** @type {ProjectView} */
    const view = {
      ...before,
      ...changes,
      id: storyId,
      version: before?.version ?? 1,
      updated: Date.now(),
    }
    views.value.set(storyId, view)
    syncStore.trackChange('projectViews', storyId, view)
  }

  /**
   * Forget where the writer left a project, with the project. Whether or not
   * the views have been read yet: a project can be deleted before any is.
   * @param {string} storyId
   */
  function deleteView(storyId) {
    views.value.delete(storyId)
    syncStore.trackDelete('projectViews', storyId)
  }

  /**
   * Of these projects, the one the writer was in last on this copy of the
   * app, or undefined when none has been opened here.
   * @param {string[]} storyIds
   * @returns {string|undefined}
   */
  function lastOpened(storyIds) {
    let last
    let at = 0
    for (const storyId of storyIds) {
      const updated = views.value.get(storyId)?.updated ?? 0
      if (updated > at) {
        last = storyId
        at = updated
      }
    }
    return last
  }

  return { views, ensureInitialized, getView, updateView, deleteView, lastOpened }
})
