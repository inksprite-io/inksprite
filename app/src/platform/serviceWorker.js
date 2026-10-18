/**
 * @module platform/serviceWorker
 * @description In a browser, the service worker: it keeps the build's files
 * (`sw.js`, written by the build in `vite.config.js`), so that the app opens
 * offline and can be installed, and fetches each new build in the
 * background.
 *
 * A new build waits until the writer reloads into it: the page in front of
 * them is never swapped for another under their hands. One that is waiting
 * when the app opens is offered again. Only built web apps have one: the
 * desktop app's files are its own, and the dev server's change as they are
 * edited.
 *
 * Should the service worker ever have to go, the way out is a build made
 * with VITE_REMOVE_SERVICE_WORKER=true, whose `sw.js` unregisters itself
 * (`sw-remove.js`) and whose page registers none. Leaving `sw.js` out would
 * not do: a browser keeps the worker it has until the address answers with
 * another, and a missing file comes back as the app's page. Building without
 * the variable again brings the worker back.
 */

import { isDesktop } from './desktop.js'

/** @type {ServiceWorkerRegistration|null} */
let registration = null

/**
 * Whether the app keeps its files with a service worker here.
 *
 * @returns {boolean}
 */
export function hasServiceWorker() {
  return (
    import.meta.env.PROD &&
    import.meta.env.VITE_REMOVE_SERVICE_WORKER !== 'true' &&
    !isDesktop() &&
    'serviceWorker' in navigator
  )
}

/**
 * Register the service worker, and call `onBuild` each time a new build is
 * waiting for the page to reload into it, and `onRemoved` if the worker that
 * took over has taken itself away: the files the page loads as it goes are
 * no longer kept, and it has to reload from the network. Does nothing where
 * there is no service worker.
 *
 * @param {() => void} onBuild
 * @param {() => void} onRemoved
 * @returns {Promise<ServiceWorkerRegistration|null>} Null where there is none
 */
export async function registerServiceWorker(onBuild, onRemoved) {
  if (!hasServiceWorker()) return null
  // From sw-remove.js.
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'SERVICE_WORKER_REMOVED') onRemoved()
  })
  registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  // The first install has no build to replace: nothing controls the page yet.
  const replacing = () => !!navigator.serviceWorker.controller
  if (registration.waiting && replacing()) onBuild()
  registration.addEventListener('updatefound', () => {
    const worker = registration?.installing
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && replacing()) onBuild()
    })
  })
  return registration
}

/**
 * Ask whether there is a new build, which `onBuild` hears of once it has
 * been fetched. Browsers ask on their own as the app opens, and only now and
 * then after, which leaves a page that stays open behind.
 *
 * @returns {Promise<void>}
 */
export async function lookForBuild() {
  await registration?.update()
}

/**
 * Reload the page into the build that is waiting. Another tab may have
 * reloaded into it already, which leaves nothing waiting: the page reloads
 * all the same, into the build that took over.
 */
export function reloadIntoBuild() {
  const waiting = registration?.waiting
  if (!waiting) {
    window.location.reload()
    return
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  })
  waiting.postMessage({ type: 'SKIP_WAITING' })
}
