/**
 * @module composables/useUpdates
 * @description In the desktop app, updates downloaded as soon as there are
 * any, and a toast to restart into one; in a browser, a toast to reload into
 * a new build once the service worker has it. Sync, waiting for an update,
 * looks for one at once, and its settings offer the one ready.
 */

import { onMounted, onUnmounted, readonly, shallowRef } from 'vue'
import { isDesktop } from '@/platform/desktop.js'
import { downloadUpdate, installUpdate } from '@/platform/updates.js'
import { lookForBuild, registerServiceWorker, reloadIntoBuild } from '@/platform/serviceWorker.js'
import { useSyncStore } from '@/stores/syncStore.js'
import { useEditor } from './useEditor.js'
import { useToast } from './useToast.js'

/** How often the app looks for an update again, after it opens. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000

/**
 * @typedef {Object} ReadyUpdate
 * @property {string|null} version - A release's; none for a browser's build
 * @property {() => Promise<void>} apply - Restart or reload into it, edits saved first
 */

/** @type {import('vue').ShallowRef<ReadyUpdate|null>} */
const ready = shallowRef(null)

/** The look the app makes every hour, once it has made its first. */
let lookNow = () => {}

/** The update ready to restart or reload into, if there is one. */
export const updateReady = readonly(ready)

/** Look for an update now rather than at the next hour: sync waits for one. */
export function lookForUpdate() {
  lookNow()
}

/**
 * Look for an update as the app opens, and every hour after, and offer it
 * once it is downloaded. Called once, by the app, in its setup.
 */
export function useUpdates() {
  if (isDesktop()) offerReleases()
  else offerBuilds()
}

/**
 * Edits wait twice on the way to the database, in the open document and then
 * the store, and a restart or a reload would lose them: both are saved.
 *
 * @returns {Promise<void>}
 */
async function saveEdits() {
  useEditor().flush()
  await useSyncStore().processSync()
}

/** In the desktop app: releases, downloaded, and restarted into. */
function offerReleases() {
  const toast = useToast()

  /**
   * The version offered, if any. Each is offered once while the app is
   * open; closed without a restart, it is offered again the next time.
   * @type {string|null}
   */
  let offered = null
  /** @type {number|undefined} */
  let timer

  const restart = async () => {
    await saveEdits()
    try {
      await installUpdate()
    } catch (error) {
      toast.error(`The update couldn't be installed: ${error.message}`)
    }
  }

  const look = async () => {
    try {
      const version = await downloadUpdate()
      if (!version || version === offered) return
      offered = version
      ready.value = { version, apply: restart }
      toast.action(
        `inksprite ${version} is ready.`,
        { label: 'Restart', command: restart },
        { duration: 0 }
      )
    } catch (error) {
      // Offline, most often. The next look tries again.
      console.warn('No update:', error)
    }
  }

  onMounted(() => {
    look()
    lookNow = look
    timer = window.setInterval(look, UPDATE_CHECK_MS)
  })
  onUnmounted(() => {
    window.clearInterval(timer)
    lookNow = () => {}
    ready.value = null
  })
}

/**
 * In a browser: new builds, fetched by the service worker, and reloaded
 * into. Each is offered once while the page is open; closed without a
 * reload, it is offered again the next time the app opens.
 */
function offerBuilds() {
  const toast = useToast()
  /** @type {number|undefined} */
  let timer

  const reload = async () => {
    await saveEdits()
    reloadIntoBuild()
  }

  // Only from a build made to take the service worker away, which leaves this
  // page's own files out of reach.
  const reloadFromNetwork = async () => {
    await saveEdits()
    window.location.reload()
  }

  const offer = () => {
    ready.value = { version: null, apply: reload }
    toast.action(
      'A new version of inksprite is ready.',
      { label: 'Reload', command: reload },
      { duration: 0 }
    )
  }

  const look = () =>
    lookForBuild().catch(error => {
      // Offline, most often. The next look tries again.
      console.warn('No new build:', error)
    })

  onMounted(async () => {
    try {
      if (!(await registerServiceWorker(offer, reloadFromNetwork))) return
    } catch (error) {
      console.warn('The service worker could not be registered:', error)
      return
    }
    lookNow = look
    timer = window.setInterval(look, UPDATE_CHECK_MS)
  })
  onUnmounted(() => {
    window.clearInterval(timer)
    lookNow = () => {}
    ready.value = null
  })
}
