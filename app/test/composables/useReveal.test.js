import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

const { desktop, library, storage, toast } = vi.hoisted(() => ({
  desktop: { on: true },
  library: { revealInLibrary: vi.fn(async () => {}) },
  storage: { documentPath: vi.fn(async () => null) },
  toast: { error: vi.fn() },
}))

vi.mock('@/platform/desktop.js', () => ({ isDesktop: () => desktop.on }))
vi.mock('@/platform/library.js', () => library)
vi.mock('@/storage/index.js', () => ({ storage }))
vi.mock('@/composables/useToast.js', () => ({ useToast: () => toast }))

const { useReveal } = await import('@/composables/useReveal.js')

describe('useReveal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    desktop.on = true
  })

  it('is offered only in the desktop app', () => {
    expect(useReveal().revealItem('ch1')?.icon).toBe('pi pi-folder-open')
    desktop.on = false
    expect(useReveal().revealItem('ch1')).toBeNull()
  })

  it('shows the document where it is in the library', async () => {
    storage.documentPath.mockResolvedValueOnce('My Novel/Notes/Elara.md')
    useReveal().revealItem('elara')?.command()
    await flushPromises()
    expect(storage.documentPath).toHaveBeenCalledWith('elara')
    expect(library.revealInLibrary).toHaveBeenCalledWith('My Novel/Notes/Elara.md')
  })

  it('does nothing for a document not on the disk yet', async () => {
    useReveal().revealItem('new')?.command()
    await flushPromises()
    expect(library.revealInLibrary).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('says so when the folder can’t be shown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    storage.documentPath.mockResolvedValueOnce('My Novel')
    library.revealInLibrary.mockRejectedValueOnce(new Error('gone'))
    useReveal().revealItem('root')?.command()
    await flushPromises()
    expect(toast.error).toHaveBeenCalledWith("The folder couldn't be shown. gone")
  })
})
