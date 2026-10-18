/* global Blob */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePictures } from '@/composables/usePictures.js'
import { usePictureViewer } from '@/composables/usePictureViewer.js'

/** A small tree: a chapter with a picture of its own, and a map imported into Maps. */
const tree = vi.hoisted(() => {
  /** @type {Record<string, any>} */
  const rows = {
    root_story_1: { id: 'root_story_1', type: 'folder', title: 'Thief', parentId: 'story_1' },
    ch1: {
      id: 'ch1',
      type: 'text',
      title: 'Prologue',
      parentId: 'root_story_1',
      pictures: {
        'gate.png': { mime: 'image/png', width: 640, height: 480 },
        'wall.png': { mime: 'image/png' },
      },
    },
    maps: { id: 'maps', type: 'folder', title: 'Maps', parentId: 'root_story_1' },
    map: {
      id: 'map',
      type: 'file',
      title: 'Quarter',
      mime: 'image/jpeg',
      parentId: 'maps',
    },
    rules: {
      id: 'rules',
      type: 'file',
      title: 'Rules',
      mime: 'application/pdf',
      parentId: 'maps',
    },
  }
  return {
    rows,
    get: (/** @type {string} */ id) => rows[id],
    childrenOf: (/** @type {string} */ id) =>
      Object.values(rows).filter(row => row.parentId === id),
  }
})
vi.mock('@/composables/useDocuments.js', () => ({ useDocuments: () => tree }))

const files = vi.hoisted(() => ({
  getFile: vi.fn(async () => null),
  putFile: vi.fn(async () => {}),
}))
vi.mock('@/stores/filesStore', () => ({ useFilesStore: () => files }))

// The store writes the row back into the tree, as the real one does.
const store = vi.hoisted(() => ({ updateDocument: vi.fn(), getDocument: vi.fn() }))
vi.mock('@/stores/documentsStore', () => ({ useDocumentsStore: () => store }))

const measured = vi.hoisted(() => ({ size: {} }))
vi.mock('@/files/pictures.js', () => ({ measurePicture: async () => measured.size }))

const openUrl = vi.hoisted(() => vi.fn())
vi.mock('@/platform/open.js', () => ({ openUrl }))

describe('usePictures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePictureViewer().close()
    store.updateDocument.mockImplementation((id, updates) => {
      tree.rows[id] = { ...tree.rows[id], ...updates }
    })
  })

  it("describes a document's own picture, with its size when known", async () => {
    const { describe: what } = usePictures('story_1')

    const gate = what('.images/ch1/gate.png', 'ch1')
    expect(gate).toMatchObject({ kind: 'picture', key: 'ch1/gate.png', size: { width: 640 } })
    await (gate.kind === 'picture' && gate.load())
    expect(files.getFile).toHaveBeenCalledWith('ch1/gate.png')

    expect(what('.images/ch1/wall.png', 'ch1')).toMatchObject({ kind: 'picture', size: undefined })
  })

  it('says a picture its document does not have is missing, by its name', () => {
    expect(usePictures('story_1').describe('.images/ch1/well.png', 'ch1')).toEqual({
      kind: 'missing',
      label: 'well.png',
    })
  })

  it('describes a link to a file document that is a picture, and no other', () => {
    const { describe: what } = usePictures('story_1')
    expect(what('Maps/Quarter.jpg', 'ch1')).toMatchObject({ kind: 'picture', key: 'map' })
    expect(what('Maps/Rules.pdf', 'ch1')).toEqual({ kind: 'missing', label: 'Maps/Rules.pdf' })
    expect(what('Maps/Nothing%20here.png', 'ch1')).toEqual({
      kind: 'missing',
      label: 'Maps/Nothing here.png',
    })
  })

  it('describes an address on the web by its host', () => {
    expect(usePictures('story_1').describe('https://example.com/gate.png', 'ch1')).toEqual({
      kind: 'web',
      host: 'example.com',
    })
  })

  it('opens a picture in the viewer, and an address on the web outside the app', () => {
    const { open } = usePictures('story_1')
    const viewer = usePictureViewer()

    open('.images/ch1/gate.png', 'ch1', 'The north gate')
    expect(viewer.shown.value).toMatchObject({ key: 'ch1/gate.png', alt: 'The north gate' })

    viewer.close()
    open('.images/ch1/well.png', 'ch1')
    expect(viewer.shown.value).toBe(null)

    open('https://example.com/gate.png', 'ch1')
    expect(openUrl).toHaveBeenCalledWith('https://example.com/gate.png')
    expect(viewer.shown.value).toBe(null)
  })

  it('reads a link from the top of the project where there is no document', () => {
    expect(usePictures('story_1').describe('Maps/Quarter.jpg')).toMatchObject({ key: 'map' })
  })
})

describe('usePictures, taking a picture in', () => {
  const PNG = 'image/png'

  beforeEach(() => {
    vi.clearAllMocks()
    tree.rows.ch2 = { id: 'ch2', type: 'text', title: 'Chapter 2', parentId: 'root_story_1' }
    store.updateDocument.mockImplementation((id, updates) => {
      tree.rows[id] = { ...tree.rows[id], ...updates }
    })
  })

  it("makes it the document's own, named for its file, and keeps its bytes", async () => {
    measured.size = { width: 640, height: 480 }
    const blob = new Blob(['png'], { type: PNG })

    expect(usePictures('story_1').take('ch2', blob, 'market map.png')).toBe(
      '.images/ch2/market%20map.png'
    )
    expect(tree.rows.ch2.pictures).toEqual({ 'market map.png': { mime: PNG } })
    expect(files.putFile).toHaveBeenCalledWith('ch2/market map.png', 'story_1', blob)
    await vi.waitFor(() =>
      expect(tree.rows.ch2.pictures['market map.png']).toEqual({
        mime: PNG,
        width: 640,
        height: 480,
      })
    )
  })

  it('numbers a screenshot pasted again, and shows its bytes before they are stored', async () => {
    measured.size = {}
    let stored = () => {}
    files.putFile.mockImplementation(() => new Promise(resolve => (stored = resolve)))
    const { take, describe: what } = usePictures('story_1')
    const shot = new Blob(['first'], { type: PNG })

    expect(take('ch2', shot)).toBe('.images/ch2/image.png')
    expect(take('ch2', new Blob(['second'], { type: PNG }), 'image.png')).toBe(
      '.images/ch2/image%20%282%29.png'
    )
    const source = what('.images/ch2/image.png', 'ch2')
    expect(source.kind === 'picture' && (await source.load())).toBe(shot)
    expect(files.getFile).not.toHaveBeenCalled()
    stored()
  })

  it('takes nothing into what is not a text document', () => {
    expect(usePictures('story_1').take('maps', new Blob(['png'], { type: PNG }))).toBe(null)
    expect(store.updateDocument).not.toHaveBeenCalled()
  })
})

describe('usePictures, a picture pasted from another document', () => {
  const PNG = 'image/png'

  beforeEach(() => {
    vi.clearAllMocks()
    tree.rows.ch2 = {
      id: 'ch2',
      type: 'text',
      title: 'Chapter 2',
      parentId: 'root_story_1',
      pictures: { 'gate.png': { mime: PNG } },
    }
    store.updateDocument.mockImplementation((id, updates) => {
      tree.rows[id] = { ...tree.rows[id], ...updates }
    })
    store.getDocument.mockImplementation(id => tree.rows[id])
    files.putFile.mockImplementation(async () => {})
  })

  it("copies it as this document's own, under its name, numbered where taken", async () => {
    const bytes = new Blob(['gate'], { type: PNG })
    files.getFile.mockImplementation(async key => (key === 'ch1/gate.png' ? bytes : null))
    const { adopt, describe: what } = usePictures('story_1')

    const src = adopt('ch2', '.images/ch1/gate.png')

    expect(src).toBe('.images/ch2/gate%20%282%29.png')
    expect(tree.rows.ch2.pictures['gate (2).png']).toEqual({ mime: PNG, width: 640, height: 480 })
    const source = what(src, 'ch2')
    expect(source.kind === 'picture' && (await source.load())).toBe(bytes)
    await vi.waitFor(() =>
      expect(files.putFile).toHaveBeenCalledWith('ch2/gate (2).png', 'story_1', bytes)
    )
  })

  it('leaves its own pictures, links and pictures on the web as they are', () => {
    const { adopt } = usePictures('story_1')
    for (const src of ['.images/ch2/gate.png', 'Maps/Quarter.jpg', 'https://example.com/a.png']) {
      expect(adopt('ch2', src)).toBe(src)
    }
    expect(store.updateDocument).not.toHaveBeenCalled()
  })
})
