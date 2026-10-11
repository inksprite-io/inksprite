/* global Event */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTreeDrop, zoneOf } from '@/composables/useTreeDrop.js'

const { moveInto, canDropInto } = vi.hoisted(() => ({
  moveInto: vi.fn(),
  canDropInto: vi.fn(() => true),
}))
vi.mock('@/composables/useDocuments.js', () => ({
  useDocuments: () => ({ moveInto, canDropInto }),
}))

/** A folder's row on the page, 40 pixels high from the top. */
const folderRow = id => {
  const row = document.createElement('div')
  row.setAttribute('role', 'treeitem')
  row.setAttribute('data-document-id', id)
  row.setAttribute('data-folder', 'true')
  row.getBoundingClientRect = () => ({ top: 0, height: 40, bottom: 40, left: 0, right: 200 })
  document.body.appendChild(row)
  return row
}

/** A drag over the page at a height, as a native drag reports it. */
const dragOver = y => {
  const event = new Event('dragover', { bubbles: true })
  Object.assign(event, { clientX: 10, clientY: y })
  document.body.dispatchEvent(event)
}

describe('useTreeDrop', () => {
  let row

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    canDropInto.mockReturnValue(true)
    row = folderRow('folder_1')
    document.elementFromPoint = vi.fn(() => row)
  })

  afterEach(() => {
    useTreeDrop().end()
    row.remove()
  })

  it('reads the top and bottom of a row as before and after it, and its middle as into', () => {
    const rect = { top: 100, height: 40 }
    expect(zoneOf(rect, 102)).toBe('before')
    expect(zoneOf(rect, 120)).toBe('into')
    expect(zoneOf(rect, 138)).toBe('after')
  })

  it('takes the folder whose row the drag is over the middle of, and holds the lists still', () => {
    const drop = useTreeDrop()
    drop.start('story_1', 'doc_1')

    dragOver(20)
    expect(drop.into.value).toBe('folder_1')
    expect(drop.allowsMove()).toBe(false)

    dragOver(4)
    expect(drop.into.value).toBeNull()
    expect(drop.allowsMove()).toBe(true)
  })

  it('moves the document in when it is dropped there', () => {
    const drop = useTreeDrop()
    drop.start('story_1', 'doc_1')
    dragOver(20)
    drop.end()

    expect(moveInto).toHaveBeenCalledWith('folder_1', 'doc_1')
    expect(drop.into.value).toBeNull()
  })

  it('moves nothing when dropped by the edge of a row, where the lists sort', () => {
    const drop = useTreeDrop()
    drop.start('story_1', 'doc_1')
    dragOver(38)
    drop.end()

    expect(moveInto).not.toHaveBeenCalled()
  })

  it('takes no folder the document could not go into, nor the folder itself', () => {
    const drop = useTreeDrop()
    canDropInto.mockReturnValue(false)
    drop.start('story_1', 'doc_1')
    dragOver(20)
    expect(drop.into.value).toBeNull()

    canDropInto.mockReturnValue(true)
    drop.end()
    drop.start('story_1', 'folder_1')
    dragOver(20)
    expect(drop.into.value).toBeNull()
  })

  it('stops following once the drag is over', () => {
    const drop = useTreeDrop()
    drop.start('story_1', 'doc_1')
    drop.end()

    dragOver(20)
    expect(drop.into.value).toBeNull()
  })
})
