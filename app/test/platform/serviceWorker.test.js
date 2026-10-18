/* global EventTarget, Event, MessageEvent */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

/** A service worker, as the page sees it. */
class FakeWorker extends EventTarget {
  state = 'installing'
  postMessage = vi.fn()

  /** @param {string} state */
  become(state) {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}

/** The page's registration, with whatever is installing or waiting in it. */
class FakeRegistration extends EventTarget {
  /** @type {FakeWorker|null} */
  installing = null
  /** @type {FakeWorker|null} */
  waiting = null
  update = vi.fn(async () => {})

  /** A new build found: its worker starts installing. */
  found() {
    this.installing = new FakeWorker()
    this.dispatchEvent(new Event('updatefound'))
    return this.installing
  }
}

/** @type {FakeRegistration} */
let registration
/** The browser's service workers, as `navigator.serviceWorker`. */
let container
/** @type {typeof import('@/platform/serviceWorker.js')} */
let serviceWorker

/**
 * The browser's service workers, with the page controlled by an earlier
 * build's worker or not.
 *
 * @param {{controlled?: boolean}} [options]
 */
const supportServiceWorkers = ({ controlled = true } = {}) => {
  container = Object.assign(new EventTarget(), {
    controller: controlled ? new FakeWorker() : null,
    register: vi.fn(async () => registration),
  })
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true })
}

beforeEach(async () => {
  vi.stubEnv('PROD', true)
  vi.stubGlobal('location', { reload: vi.fn() })
  registration = new FakeRegistration()
  vi.resetModules()
  serviceWorker = await import('@/platform/serviceWorker.js')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  delete (/** @type {any} */ (navigator).serviceWorker)
  delete globalThis.__INKSPRITE_DESKTOP__
})

describe('registerServiceWorker', () => {
  it('registers the worker for the whole app', async () => {
    supportServiceWorkers()
    expect(await serviceWorker.registerServiceWorker(() => {})).toBe(registration)
    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
  })

  it('registers none on the dev server', async () => {
    vi.stubEnv('PROD', false)
    supportServiceWorkers()

    expect(await serviceWorker.registerServiceWorker(() => {})).toBeNull()
    expect(container.register).not.toHaveBeenCalled()
  })

  it('registers none in the desktop app', async () => {
    globalThis.__INKSPRITE_DESKTOP__ = {}
    supportServiceWorkers()

    expect(await serviceWorker.registerServiceWorker(() => {})).toBeNull()
    expect(container.register).not.toHaveBeenCalled()
  })

  it('registers none where the browser has no service workers', async () => {
    expect(await serviceWorker.registerServiceWorker(() => {})).toBeNull()
  })

  it('registers none in a build made to take the worker away', async () => {
    vi.stubEnv('VITE_REMOVE_SERVICE_WORKER', 'true')
    supportServiceWorkers()

    expect(await serviceWorker.registerServiceWorker(() => {})).toBeNull()
    expect(container.register).not.toHaveBeenCalled()
  })

  it('tells of a new build once it is installed', async () => {
    supportServiceWorkers()
    const onBuild = vi.fn()
    await serviceWorker.registerServiceWorker(onBuild)

    const worker = registration.found()
    expect(onBuild).not.toHaveBeenCalled()
    worker.become('installed')
    expect(onBuild).toHaveBeenCalledTimes(1)
  })

  it('tells of nothing on the first install, which replaces no build', async () => {
    supportServiceWorkers({ controlled: false })
    const onBuild = vi.fn()
    await serviceWorker.registerServiceWorker(onBuild)

    registration.found().become('installed')
    expect(onBuild).not.toHaveBeenCalled()
  })

  it('tells of a build left waiting the last time the app was open', async () => {
    supportServiceWorkers()
    registration.waiting = new FakeWorker()
    const onBuild = vi.fn()

    await serviceWorker.registerServiceWorker(onBuild)
    expect(onBuild).toHaveBeenCalledTimes(1)
  })

  it('tells of nothing for a build that failed to install', async () => {
    supportServiceWorkers()
    const onBuild = vi.fn()
    await serviceWorker.registerServiceWorker(onBuild)

    registration.found().become('redundant')
    expect(onBuild).not.toHaveBeenCalled()
  })
})

describe('lookForBuild', () => {
  it('asks the registration to look for a new build', async () => {
    supportServiceWorkers()
    await serviceWorker.registerServiceWorker(() => {})

    await serviceWorker.lookForBuild()
    expect(registration.update).toHaveBeenCalled()
  })

  it('does nothing before there is a registration', async () => {
    await expect(serviceWorker.lookForBuild()).resolves.toBeUndefined()
  })
})

describe('reloadIntoBuild', () => {
  it('has the waiting build take over, and then reloads', async () => {
    supportServiceWorkers()
    const waiting = new FakeWorker()
    registration.waiting = waiting
    await serviceWorker.registerServiceWorker(() => {})

    serviceWorker.reloadIntoBuild()
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(window.location.reload).not.toHaveBeenCalled()

    container.dispatchEvent(new Event('controllerchange'))
    expect(window.location.reload).toHaveBeenCalledTimes(1)
  })

  it('reloads straight away when another tab has already taken the build', async () => {
    supportServiceWorkers()
    await serviceWorker.registerServiceWorker(() => {})

    serviceWorker.reloadIntoBuild()
    expect(window.location.reload).toHaveBeenCalledTimes(1)
  })

  it('reloads only for the change it asked for', async () => {
    supportServiceWorkers()
    registration.waiting = new FakeWorker()
    await serviceWorker.registerServiceWorker(() => {})

    container.dispatchEvent(new Event('controllerchange'))
    expect(window.location.reload).not.toHaveBeenCalled()
  })
})

/**
 * sw-remove.js, run in a service worker of its own, with the caches the app's
 * worker left and the pages it served: those that will have reloaded when it
 * looks again, and those still on it then.
 *
 * @param {string[]} cacheNames
 * @param {{stillThere?: boolean}} [options]
 */
const runRemover = (cacheNames, { stillThere = false } = {}) => {
  const caches = new Map(cacheNames.map(name => [name, {}]))
  /** @type {Record<string, (event: any) => void>} */
  const listeners = {}
  const page = {
    url: 'https://app.example/project/1',
    postMessage: vi.fn(),
    navigate: vi.fn(async () => {}),
  }
  /** @type {number|undefined} */
  let waited
  const worker = {
    addEventListener: (type, listener) => (listeners[type] = listener),
    skipWaiting: vi.fn(),
    caches: {
      keys: async () => [...caches.keys()],
      delete: async name => caches.delete(name),
    },
    registration: { unregister: vi.fn(async () => true) },
    clients: {
      matchAll: vi.fn(async ({ includeUncontrolled = false } = {}) =>
        includeUncontrolled || stillThere ? [page] : []
      ),
    },
  }
  // The tests run in app/, beside it.
  const source = readFileSync('sw-remove.js', 'utf8')
  runInNewContext(source, {
    self: worker,
    setTimeout: (/** @type {() => void} */ then, /** @type {number} */ ms) => {
      waited = ms
      then()
    },
  })

  /** The worker installed and then activated, as a browser does it. */
  const takeOver = async () => {
    listeners.install({})
    /** @type {Promise<void>} */
    let activating = Promise.resolve()
    listeners.activate({ waitUntil: promise => (activating = promise) })
    await activating
  }
  return { caches, page, worker, takeOver, waited: () => waited }
}

describe('sw-remove.js', () => {
  it('takes over as soon as it is installed', async () => {
    const { worker, takeOver } = runRemover([])
    await takeOver()
    expect(worker.skipWaiting).toHaveBeenCalled()
  })

  it('deletes what the app worker kept, and nothing else', async () => {
    const { caches, takeOver } = runRemover([
      'workbox-precache-v2-https://app.example/',
      'webassembly',
      'something-else',
    ])
    await takeOver()
    expect([...caches.keys()]).toEqual(['something-else'])
  })

  it('unregisters, and tells every page', async () => {
    const { worker, page, takeOver } = runRemover([])
    await takeOver()

    expect(worker.registration.unregister).toHaveBeenCalled()
    expect(worker.clients.matchAll).toHaveBeenCalledWith({
      type: 'window',
      includeUncontrolled: true,
    })
    expect(page.postMessage).toHaveBeenCalledTimes(1)
  })

  it('leaves a page that heard it to reload itself', async () => {
    const { page, takeOver } = runRemover([])
    await takeOver()
    expect(page.navigate).not.toHaveBeenCalled()
  })

  it('reloads a page still on it a few seconds later, which could not hear it', async () => {
    const { page, takeOver, waited } = runRemover([], { stillThere: true })
    await takeOver()

    expect(waited()).toBeGreaterThanOrEqual(1000)
    expect(page.navigate).toHaveBeenCalledWith('https://app.example/project/1')
  })

  it('has a page that hears it reload', async () => {
    supportServiceWorkers()
    const onRemoved = vi.fn()
    await serviceWorker.registerServiceWorker(() => {}, onRemoved)
    const { page, takeOver } = runRemover([])
    await takeOver()

    container.dispatchEvent(new MessageEvent('message', { data: { type: 'something else' } }))
    expect(onRemoved).not.toHaveBeenCalled()
    container.dispatchEvent(
      new MessageEvent('message', { data: page.postMessage.mock.calls[0][0] })
    )
    expect(onRemoved).toHaveBeenCalledTimes(1)
  })
})
