import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

const updates = vi.hoisted(() => ({ downloadUpdate: vi.fn(), installUpdate: vi.fn() }))
vi.mock('@/platform/updates.js', () => updates)

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

import { UPDATE_CHECK_MS, useUpdates } from '@/composables/useUpdates.js'

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

/** The toast's Restart, clicked. */
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
    delete globalThis.__INKSPRITE_DESKTOP__
  })

  it('looks for nothing in a browser', async () => {
    delete globalThis.__INKSPRITE_DESKTOP__
    app = mountApp()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS)

    expect(updates.downloadUpdate).not.toHaveBeenCalled()
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
})
