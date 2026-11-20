import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { api, history } = vi.hoisted(() => ({
  api: {
    createTextDocument: vi.fn(() => ({ id: 'doc_new' })),
    open: vi.fn(),
    requestRename: vi.fn(),
  },
  history: { created: vi.fn() },
}))

vi.mock('@/composables/useDocuments.js', () => ({ useDocuments: () => api }))
vi.mock('@/composables/useTreeHistory.js', () => ({ useTreeHistory: () => history }))

const { useNewDocument } = await import('@/composables/useNewDocument.js')

/**
 * Put an outline in the page, on screen or hidden.
 * @param {boolean} showing
 */
const haveOutline = showing => {
  const outline = document.createElement('div')
  outline.setAttribute('data-document-tree', '')
  outline.getClientRects = () => /** @type {any} */ (showing ? [{}] : [])
  document.body.append(outline)
}

describe('useNewDocument', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('makes a document at the top of the project, opens it, and keeps the step to take back', () => {
    const created = useNewDocument('story_1')()

    expect(created).toEqual({ id: 'doc_new' })
    expect(api.createTextDocument).toHaveBeenCalledWith('root_story_1', '')
    expect(history.created).toHaveBeenCalledWith('doc_new')
    expect(api.open).toHaveBeenCalledWith('doc_new')
  })

  it('names it in the outline where the outline is on screen', () => {
    haveOutline(true)
    useNewDocument('story_1')()

    expect(api.requestRename).toHaveBeenCalledWith('doc_new')
  })

  it('asks for no name with the outline hidden, or not there', () => {
    useNewDocument('story_1')()
    haveOutline(false)
    useNewDocument('story_1')()

    expect(api.open).toHaveBeenCalledTimes(2)
    expect(api.requestRename).not.toHaveBeenCalled()
  })
})
