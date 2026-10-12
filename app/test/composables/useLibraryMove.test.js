import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useLibraryMove } from '@/composables/useLibraryMove.js'

const open = vi.hoisted(() => ({ moveIntoLibrary: vi.fn(), keepProjectsInApp: vi.fn() }))
const storage = vi.hoisted(() => ({ storage: { dump: vi.fn() } }))
const saved = vi.hoisted(() => ({ flush: vi.fn(), processSync: vi.fn() }))
const toast = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock('@/storage/open.js', () => open)
vi.mock('@/storage/index.js', () => storage)
vi.mock('@/composables/useEditor.js', () => ({ useEditor: () => ({ flush: saved.flush }) }))
vi.mock('@/stores/syncStore.js', () => ({
  useSyncStore: () => ({ processSync: saved.processSync }),
}))
vi.mock('@/composables/useToast.js', () => ({ useToast: () => toast }))

describe('useLibraryMove', () => {
  const reload = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    saved.processSync.mockResolvedValue(undefined)
    open.moveIntoLibrary.mockResolvedValue(undefined)
    open.keepProjectsInApp.mockResolvedValue(undefined)
    Object.defineProperty(window, 'location', { value: { reload }, configurable: true })
  })

  it('saves everything first, moves the projects in saying how far, then opens again', async () => {
    const { state, moveIn } = useLibraryMove()
    const progress = { title: 'Novel', index: 0, count: 1, fraction: 0.5 }
    /** @type {any} */
    let seen = null
    open.moveIntoLibrary.mockImplementation(async onProgress => {
      onProgress(progress)
      seen = { moving: state.moving, progress: state.progress }
    })

    expect(await moveIn()).toBe(true)

    expect(saved.flush).toHaveBeenCalled()
    expect(saved.processSync.mock.invocationCallOrder[0]).toBeLessThan(
      open.moveIntoLibrary.mock.invocationCallOrder[0]
    )
    expect(seen).toEqual({ moving: 'in', progress })
    expect(reload).toHaveBeenCalled()
    // The toast stays until the page goes.
    expect(state.moving).toBe('in')
  })

  it('moves the projects back into the app, then opens again', async () => {
    const { state, moveOut } = useLibraryMove()

    expect(await moveOut()).toBe(true)

    expect(open.keepProjectsInApp).toHaveBeenCalledWith(storage.storage)
    expect(state.moving).toBe('out')
    expect(state.progress).toBe(null)
    expect(reload).toHaveBeenCalled()
  })

  it('says so, and lets the page go, when the projects cannot be moved', async () => {
    open.moveIntoLibrary.mockRejectedValue(new Error('disk full'))
    const { state, moveIn } = useLibraryMove()

    expect(await moveIn()).toBe(false)

    expect(toast.error).toHaveBeenCalledWith(
      "The projects couldn't be moved into a folder: disk full"
    )
    expect(state.moving).toBe(null)
    expect(reload).not.toHaveBeenCalled()
  })

  it('says so when the projects cannot be moved back', async () => {
    open.keepProjectsInApp.mockRejectedValue(new Error('unreadable'))
    const { moveOut } = useLibraryMove()

    expect(await moveOut()).toBe(false)

    expect(toast.error).toHaveBeenCalledWith(
      "The projects couldn't be moved back into the app: unreadable"
    )
    expect(reload).not.toHaveBeenCalled()
  })
})
