import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useLibraryMove } from '@/composables/useLibraryMove.js'

const open = vi.hoisted(() => ({ moveIntoLibrary: vi.fn() }))
const saved = vi.hoisted(() => ({ flush: vi.fn(), processSync: vi.fn() }))
const toast = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock('@/storage/open.js', () => open)
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
    expect(seen).toEqual({ moving: true, progress })
    expect(reload).toHaveBeenCalled()
    // The toast stays until the page goes.
    expect(state.moving).toBe(true)
  })

  it('says so, and lets the page go, when the projects cannot be moved', async () => {
    open.moveIntoLibrary.mockRejectedValue(new Error('disk full'))
    const { state, moveIn } = useLibraryMove()

    expect(await moveIn()).toBe(false)

    expect(toast.error).toHaveBeenCalledWith(
      "The projects couldn't be moved into their folder: disk full. inksprite tries again the next time it opens."
    )
    expect(state.moving).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
