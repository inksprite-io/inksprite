/* global self */
/**
 * The service worker that takes the app's away: `sw.js` in a build made with
 * VITE_REMOVE_SERVICE_WORKER=true (vite.config.js). It is for when the
 * worker writers have must go at once, such as after a build that breaks as
 * it opens, which can't offer the build that fixes it.
 *
 * Browsers fetch it on their own, the next time the app is opened, and it
 * takes over without waiting. It deletes the files the app's worker kept,
 * unregisters, and tells the pages it was serving, which save the writer's
 * edits and reload from the network (`src/platform/serviceWorker.js`). A page
 * still on it a few seconds later couldn't hear it, being broken or half
 * loaded as the files went, and is reloaded.
 *
 * Not a module, and not part of the app: it runs in the worker, alone.
 */

/** Long enough for a page that heard it to save the writer's edits and go. */
const DEAF_AFTER_MS = 5000

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', event => event.waitUntil(remove()))

async function remove() {
  for (const name of await self.caches.keys()) {
    // Workbox's own, and the WebAssembly kept as the spelling checker loads it.
    if (name.startsWith('workbox-') || name === 'webassembly') await self.caches.delete(name)
  }
  await self.registration.unregister()
  for (const page of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
    page.postMessage({ type: 'SERVICE_WORKER_REMOVED' })
  }
  // Those that heard it are on the network by now, and no longer this worker's.
  await new Promise(resolve => setTimeout(resolve, DEAF_AFTER_MS))
  for (const page of await self.clients.matchAll({ type: 'window' })) {
    page.navigate(page.url).catch(() => {})
  }
}
