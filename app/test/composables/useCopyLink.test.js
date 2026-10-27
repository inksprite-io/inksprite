import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCopyLink } from '@/composables/useCopyLink.js'

const { mockApi, toast } = vi.hoisted(() => {
  const docs = [
    { id: 'root_story_1', parentId: 'story_1', type: 'folder', title: 'Thief' },
    { id: 'notes', parentId: 'root_story_1', type: 'folder', title: 'Notes' },
    { id: 'cast', parentId: 'notes', type: 'text', title: 'Cast list' },
    { id: 'plan', parentId: 'root_story_1', type: 'text', title: 'Plan & <notes>' },
  ]
  const get = id => docs.find(doc => doc.id === id) ?? null
  const titles = id => {
    const out = []
    for (let at = get(id); at && at.id !== 'root_story_1'; at = get(at.parentId)) {
      out.unshift(at.title)
    }
    return out
  }
  return {
    mockApi: {
      get,
      childrenOf: parentId => docs.filter(doc => doc.parentId === parentId),
      pathOf: id => (get(id) ? titles(id).join('/') : ''),
      displayTitle: doc => doc.title,
    },
    toast: { error: vi.fn(), success: vi.fn() },
  }
})
vi.mock('@/composables/useDocuments.js', () => ({ useDocuments: () => mockApi }))
vi.mock('@/composables/useToast.js', () => ({ useToast: () => toast }))

/** What a ClipboardItem was made with, read back as text. */
const read = async item =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(item.parts).map(async ([type, blob]) => [type, await blob.text()])
    )
  )

describe('useCopyLink', () => {
  const writeText = vi.fn()
  const write = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    writeText.mockResolvedValue(undefined)
    write.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText, write },
      configurable: true,
    })
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(parts) {
          this.parts = parts
        }
      }
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('puts a link to the document on the clipboard, its path as text, and says it did', async () => {
    await useCopyLink('story_1').copyLink('cast')

    expect(await read(write.mock.calls[0][0][0])).toEqual({
      'text/plain': 'Notes/Cast list',
      'text/html': '<a href="/Notes/Cast%20list.md">Cast list</a>',
    })
    expect(toast.success).toHaveBeenCalledWith('Copied', expect.anything())
  })

  it('copies a link to a heading, and the words given, made safe', async () => {
    const { copyLink } = useCopyLink('story_1')
    await copyLink('cast', 'The crew')
    expect(await read(write.mock.calls[0][0][0])).toEqual({
      'text/plain': 'Notes/Cast list#The crew',
      'text/html': '<a href="/Notes/Cast%20list.md#The%20crew">The crew</a>',
    })
    await copyLink('plan', '', 'the "plan"')
    expect((await read(write.mock.calls[1][0][0]))['text/html']).toBe(
      '<a href="/Plan%20&amp;%20-notes-.md">the &quot;plan&quot;</a>'
    )
  })

  it('copies a link in a document as one to its document, and any other as its address', async () => {
    const { copyHref } = useCopyLink('story_1')
    await copyHref('Notes/Cast%20list.md#The%20crew', 'plan', 'our crew')
    expect(await read(write.mock.calls[0][0][0])).toEqual({
      'text/plain': 'Notes/Cast list#The crew',
      'text/html': '<a href="/Notes/Cast%20list.md#The%20crew">our crew</a>',
    })
    await copyHref('https://example.com/page', 'plan', 'a page')
    expect(writeText).toHaveBeenCalledWith('https://example.com/page')
  })

  it('copies the path alone where the clipboard takes only text', async () => {
    vi.stubGlobal('ClipboardItem', undefined)
    await useCopyLink('story_1').copyLink('cast')
    expect(writeText).toHaveBeenCalledWith('Notes/Cast list')
    expect(write).not.toHaveBeenCalled()
  })

  it('says when the browser would not let it', async () => {
    write.mockRejectedValue(new Error('denied'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await useCopyLink('story_1').copyLink('cast')

    expect(toast.error).toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('copies nothing for a document it cannot place', async () => {
    await useCopyLink('story_1').copyLink('doc_gone')
    expect(write).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('makes the same link for a drag out of the outline', () => {
    expect(useCopyLink('story_1').linkFor('cast')).toEqual({
      text: 'Notes/Cast list',
      html: '<a href="/Notes/Cast%20list.md">Cast list</a>',
    })
  })
})
