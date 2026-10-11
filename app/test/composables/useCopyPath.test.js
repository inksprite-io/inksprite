import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCopyPath } from '@/composables/useCopyPath.js'

const { mockApi, toast } = vi.hoisted(() => ({
  mockApi: { pathOf: vi.fn(id => (id === 'doc_1' ? 'Characters/Elara' : '')) },
  toast: { error: vi.fn(), success: vi.fn() },
}))
vi.mock('@/composables/useDocuments.js', () => ({ useDocuments: () => mockApi }))
vi.mock('@/composables/useToast.js', () => ({ useToast: () => toast }))

describe('useCopyPath', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    writeText.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  it('puts the path on the clipboard, and says it did', async () => {
    await useCopyPath('story_1').copyPath('doc_1')

    expect(writeText).toHaveBeenCalledWith('Characters/Elara')
    expect(toast.success).toHaveBeenCalledWith('Copied', expect.anything())
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('says when the browser would not let it', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await useCopyPath('story_1').copyPath('doc_1')

    expect(toast.error).toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('copies nothing for a document it cannot place', async () => {
    await useCopyPath('story_1').copyPath('doc_gone')
    expect(writeText).not.toHaveBeenCalled()
  })
})
