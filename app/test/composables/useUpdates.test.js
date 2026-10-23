import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

const updates = vi.hoisted(() => ({ downloadUpdate: vi.fn(), installUpdate: vi.fn() }))
vi.mock('@/platform/updates.js', () => updates)

const serviceWorker = vi.hoisted(() => ({
  registerServiceWorker: vi.fn(),
  lookForBuild: vi.fn(),
  reloadIntoBuild: vi.fn(),
}))
vi.mock('@/platform/serviceWorker.js', () => serviceWorker)

const toast = vi.hoisted(() => ({ action: vi.fn(), error: vi.fn() }))
vi.mock('@/composables/useToast.js', () => ({ useToast: () => toast }))

/** What saving goes through on the way to the database, in order. */
const saved = vi.hoisted(() => /** @type {string[]} */ ([]))
vi.mock('@/composables/useEditor.js', () => ({
  useEditor: () => ({ flush: () => saved.push('editor') }),
}))
vi.mock('@/stores/syncStore.js', () => ({
  useSyncStore: () => ({ processSync: async () => saved.push('store') }),
}))

import {
  UPDATE_CHECK_MS,
  lookForUpdate,
  updateReady,
  useUpdates,
} from '@/composables/useUpdates.js'

/** The app, as far as updates go. */
const mountApp = () =>
  mount(
    defineComponent({
      setup() {
        useUpdates()
        return () => h('div')
      },
    })
  )

/** The toast's Restart, or Reload, clicked. */
const restart = () => toast.action.mock.calls.at(-1)[1].command()

describe('useUpdates', () => {
  /** @type {ReturnType<typeof mountApp>|undefined} */
  let app

  beforeEach(() => {
    vi.useFakeTimers()
    globalThis.__INKSPRITE_DESKTOP__ = {}
    saved.length = 0
  })

  afterEach(() => {
    app?.unmount()
    app = undefined
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete globalThis.__INKSPRITE_DESKTOP__
  })

  it('looks for no release in a browser', async () => {
    delete globalThis.__INKSPRITE_DESKTOP__
    app = mountApp()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS)

    expect(updates.downloadUpdate).not.toHaveBeenCalled()
  })

  it('registers no service worker in the desktop app', async () => {
    updates.downloadUpdate.mockResolvedValue(null)
    app = mountApp()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS)

    expect(serviceWorker.registerServiceWorker).not.toHaveBeenCalled()
  })

  it('offers a downloaded update with a toast that stays', async () => {
    updates.downloadUpdate.mockResolvedValue('0.1.0-dev.5')
    app = mountApp()
    await vi.waitFor(() => expect(toast.action).toHaveBeenCalled())

    expect(toast.action).toHaveBeenCalledWith(
      'inksprite 0.1.0-dev.5 is ready.',
      { label: 'Restart', command: expect.any(Function) },
      { duration: 0 }
    )
  })

  it('offers the update to sync’s settings as well, to install', async () => {
    updates.downloadUpdate.mockResolvedValue('0.1.0-dev.5')
    app = mountApp()
    await vi.waitFor(() => expect(updateReady.value).not.toBeNull())

    expect(updateReady.value?.version).toBe('0.1.0-dev.5')
    await updateReady.value?.apply()
    expect(saved).toEqual(['editor', 'store'])
    expect(updates.installUpdate).toHaveBeenCalled()
  })

  it('looks at once when sync waits for an update', async () => {
    updates.downloadUpdate.mockResolvedValue(null)
    app = mountApp()
    await vi.waitFor(() => expect(updates.downloadUpdate).toHaveBeenCalledTimes(1))

    lookForUpdate()
    expect(updates.downloadUpdate).toHaveBeenCalledTimes(2)
    expect(updateReady.value).toBeNull()
  })

  it('offers nothing when the app is up to date', async () => {
    updates.downloadUpdate.mockResolvedValue(null)
    app = mountApp()
    await vi.waitFor(() => expect(updates.downloadUpdate).toHaveBeenCalled())

    expect(toast.action).not.toHaveBeenCalled()
  })

  it('looks again every hour, and offers each version once', async () => {
    updates.downloadUpdate.mockResolvedValue(null)
    app = mountApp()
    await vi.waitFor(() => expect(updates.downloadUpdate).toHaveBeenCalledTimes(1))

    updates.downloadUpdate.mockResolvedValue('0.1.0-dev.5')
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS)

    expect(updates.downloadUpdate).toHaveBeenCalledTimes(3)
    expect(toast.action).toHaveBeenCalledTimes(1)
  })

  it('stops looking once the app is gone', async () => {
    updates.downloadUpdate.mockResolvedValue(null)
    app = mountApp()
    await vi.waitFor(() => expect(updates.downloadUpdate).toHaveBeenCalledTimes(1))
    app.unmount()
    app = undefined

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS)
    expect(updates.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('keeps quiet when the look fails, and tries again later', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    updates.downloadUpdate.mockRejectedValueOnce(new Error('offline'))
    updates.downloadUpdate.mockResolvedValue('0.1.0-dev.5')
    app = mountApp()
    await vi.waitFor(() => expect(updates.downloadUpdate).toHaveBeenCalledTimes(1))
    expect(toast.action).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS)
    expect(toast.action).toHaveBeenCalledTimes(1)
  })

  it('saves the open document and the store before it installs', async () => {
    updates.downloadUpdate.mockResolvedValue('0.1.0-dev.5')
    updates.installUpdate.mockImplementation(async () => saved.push('install'))
    app = mountApp()
    await vi.waitFor(() => expect(toast.action).toHaveBeenCalled())

    await restart()
    expect(saved).toEqual(['editor', 'store', 'install'])
  })

  it('says so when the update cannot be installed', async () => {
    updates.downloadUpdate.mockResolvedValue('0.1.0-dev.5')
    updates.installUpdate.mockRejectedValue(new Error('Permission denied'))
    app = mountApp()
    await vi.waitFor(() => expect(toast.action).toHaveBeenCalled())

    await restart()
    expect(toast.error).toHaveBeenCalledWith("The update couldn't be installed: Permission denied")
  })

  describe('in a browser', () => {
    beforeEach(() => {
      delete globalThis.__INKSPRITE_DESKTOP__
      serviceWorker.registerServiceWorker.mockResolvedValue({})
      serviceWorker.lookForBuild.mockResolvedValue(undefined)
    })

    /** The service worker's word that a new build is waiting. */
    const buildWaiting = () => serviceWorker.registerServiceWorker.mock.calls.at(-1)[0]()

    it('offers a new build with a toast that stays', async () => {
      app = mountApp()
      await vi.waitFor(() => expect(serviceWorker.registerServiceWorker).toHaveBeenCalled())
      expect(toast.action).not.toHaveBeenCalled()

      buildWaiting()
      expect(toast.action).toHaveBeenCalledWith(
        'A new version of inksprite is ready.',
        { label: 'Reload', command: expect.any(Function) },
        { duration: 0 }
      )
    })

    it('offers the build to sync’s settings as well, to reload into', async () => {
      serviceWorker.reloadIntoBuild.mockImplementation(() => saved.push('reload'))
      app = mountApp()
      await vi.waitFor(() => expect(serviceWorker.registerServiceWorker).toHaveBeenCalled())
      expect(updateReady.value).toBeNull()

      buildWaiting()
      expect(updateReady.value?.version).toBeNull()
      await updateReady.value?.apply()
      expect(saved).toEqual(['editor', 'store', 'reload'])
    })

    it('saves the open document and the store before it reloads', async () => {
      serviceWorker.reloadIntoBuild.mockImplementation(() => saved.push('reload'))
      app = mountApp()
      await vi.waitFor(() => expect(serviceWorker.registerServiceWorker).toHaveBeenCalled())
      buildWaiting()

      await restart()
      expect(saved).toEqual(['editor', 'store', 'reload'])
    })

    it('saves and reloads when the service worker has taken itself away', async () => {
      vi.stubGlobal('location', { reload: vi.fn(() => saved.push('reload')) })
      app = mountApp()
      await vi.waitFor(() => expect(serviceWorker.registerServiceWorker).toHaveBeenCalled())

      await serviceWorker.registerServiceWorker.mock.calls.at(-1)[1]()
      expect(saved).toEqual(['editor', 'store', 'reload'])
      expect(toast.action).not.toHaveBeenCalled()
    })

    it('looks for a new build every hour', async () => {
      app = mountApp()
      await vi.waitFor(() => expect(serviceWorker.registerServiceWorker).toHaveBeenCalled())
      expect(serviceWorker.lookForBuild).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS)
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS)
      expect(serviceWorker.lookForBuild).toHaveBeenCalledTimes(2)
    })

    it('keeps quiet when a look fails, and looks again later', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      serviceWorker.lookForBuild.mockRejectedValueOnce(new Error('offline'))
      app = mountApp()
      await vi.waitFor(() => expect(serviceWorker.registerServiceWorker).toHaveBeenCalled())

      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS)
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS)
      expect(serviceWorker.lookForBuild).toHaveBeenCalledTimes(2)
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('looks for nothing where there is no service worker', async () => {
      serviceWorker.registerServiceWorker.mockResolvedValue(null)
      app = mountApp()
      await vi.waitFor(() => expect(serviceWorker.registerServiceWorker).toHaveBeenCalled())

      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS)
      expect(serviceWorker.lookForBuild).not.toHaveBeenCalled()
    })

    it('keeps quiet when the service worker cannot be registered', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      serviceWorker.registerServiceWorker.mockRejectedValue(new Error('SecurityError'))
      app = mountApp()
      await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())

      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS)
      expect(serviceWorker.lookForBuild).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('stops looking once the app is gone', async () => {
      app = mountApp()
      await vi.waitFor(() => expect(serviceWorker.registerServiceWorker).toHaveBeenCalled())
      await Promise.resolve()
      app.unmount()
      app = undefined

      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS)
      expect(serviceWorker.lookForBuild).not.toHaveBeenCalled()
    })
  })
})
