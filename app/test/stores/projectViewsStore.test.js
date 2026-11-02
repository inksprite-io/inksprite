import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProjectViewsStore } from '../../src/stores/projectViewsStore.js'

const toArray = vi.fn()
vi.mock('../../src/stores/db', () => ({
  default: { projectViews: { toArray: (...args) => toArray(...args) } },
}))

const trackChange = vi.fn()
const trackDelete = vi.fn()
vi.mock('../../src/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange, trackDelete }),
}))

describe('the project views store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    toArray.mockResolvedValue([])
  })

  it('reads where each project was left', async () => {
    toArray.mockResolvedValue([{ id: 's1', lastDocumentId: 'd1', version: 2, updated: 5 }])
    const store = useProjectViewsStore()
    await store.ensureInitialized()

    expect(store.getView('s1')?.lastDocumentId).toBe('d1')
    expect(store.getView('s2')).toBeUndefined()
  })

  it('records a change to a project’s view, keeping the rest of it', async () => {
    toArray.mockResolvedValue([{ id: 's1', lastDocumentId: 'd1', version: 2, updated: 5 }])
    const store = useProjectViewsStore()
    await store.ensureInitialized()

    store.updateView('s1', {
      layout: { sidebar: false, editor: true, chat: true, sidebarTab: 'chats' },
    })

    const view = store.getView('s1')
    expect(view).toMatchObject({ id: 's1', lastDocumentId: 'd1', version: 2 })
    expect(view?.layout?.sidebarTab).toBe('chats')
    expect(view?.updated).toBeGreaterThan(5)
    expect(trackChange).toHaveBeenCalledWith('projectViews', 's1', view)
  })

  it('makes a view for a project first opened here', async () => {
    const store = useProjectViewsStore()
    await store.ensureInitialized()

    store.updateView('s1', { lastDocumentId: 'd1', openDocumentIds: ['d1'] })

    expect(store.getView('s1')).toMatchObject({ id: 's1', version: 1, lastDocumentId: 'd1' })
  })

  it('forgets a project’s view with the project', async () => {
    toArray.mockResolvedValue([{ id: 's1', version: 1, updated: 5 }])
    const store = useProjectViewsStore()
    await store.ensureInitialized()

    store.deleteView('s1')

    expect(store.getView('s1')).toBeUndefined()
    expect(trackDelete).toHaveBeenCalledWith('projectViews', 's1')
  })

  it('forgets the view of a project deleted before the views were read', () => {
    useProjectViewsStore().deleteView('s1')

    expect(trackDelete).toHaveBeenCalledWith('projectViews', 's1')
  })

  it('names the project last opened here, of those asked about', async () => {
    toArray.mockResolvedValue([
      { id: 's1', version: 1, updated: 5 },
      { id: 's2', version: 1, updated: 9 },
      { id: 'gone', version: 1, updated: 20 },
    ])
    const store = useProjectViewsStore()
    await store.ensureInitialized()

    expect(store.lastOpened(['s1', 's2', 's3'])).toBe('s2')
    expect(store.lastOpened(['s3'])).toBeUndefined()
  })

  it('goes by when a project was opened, not by when its view was last saved', async () => {
    toArray.mockResolvedValue([
      // Written in for hours with its tabs as they were.
      { id: 'written', version: 1, opened: 100, updated: 100 },
      // Left earlier, with a job there closing a tab of it since.
      { id: 'left', version: 1, opened: 50, updated: 200 },
    ])
    const store = useProjectViewsStore()
    await store.ensureInitialized()

    expect(store.lastOpened(['written', 'left'])).toBe('written')
  })

  it('takes a project opened now over one last saved before opening was kept', async () => {
    toArray.mockResolvedValue([
      { id: 'older', version: 1, updated: 500 },
      { id: 'mine', version: 1, updated: 100 },
    ])
    const store = useProjectViewsStore()
    await store.ensureInitialized()

    expect(store.lastOpened(['older', 'mine'])).toBe('older')
    store.markOpened('mine')
    expect(store.lastOpened(['older', 'mine'])).toBe('mine')
  })

  it('keeps the rest of a view when marking it opened', async () => {
    toArray.mockResolvedValue([{ id: 's1', version: 1, updated: 5, lastDocumentId: 'doc' }])
    const store = useProjectViewsStore()
    await store.ensureInitialized()

    store.markOpened('s1')

    expect(store.getView('s1')).toMatchObject({ lastDocumentId: 'doc', opened: expect.any(Number) })
    expect(trackChange).toHaveBeenCalledWith('projectViews', 's1', store.getView('s1'))
  })

  it('writes nothing for the project the writer was in last already', async () => {
    toArray.mockResolvedValue([
      { id: 's1', version: 1, opened: 100, updated: 100 },
      { id: 's2', version: 1, opened: 50, updated: 50 },
    ])
    const store = useProjectViewsStore()
    await store.ensureInitialized()

    store.markOpened('s1')
    expect(trackChange).not.toHaveBeenCalled()

    store.markOpened('s2')
    expect(store.lastOpened(['s1', 's2'])).toBe('s2')
    expect(trackChange).toHaveBeenCalledTimes(1)
  })
})
