import { describe, it, expect } from 'vitest'
import { TRASH_KEPT_MS, expired, outOfTrash, trashedIds } from '@/utils/trash.js'

/** @returns {any} */
const doc = (id, parentId, extra = {}) => ({ id, parentId, storyId: 'story_1', ...extra })

describe('trash', () => {
  describe('trashedIds', () => {
    it('finds what was trashed and everything under it', () => {
      const ids = trashedIds([
        doc('root', 'story_1'),
        doc('notes', 'root', { trashed: 1 }),
        doc('people', 'notes'),
        doc('elara', 'people'),
        doc('chapter', 'root'),
      ])
      expect([...ids].sort()).toEqual(['elara', 'notes', 'people'])
    })

    it('finds nothing in a tree with nothing trashed', () => {
      expect(trashedIds([doc('root', 'story_1'), doc('a', 'root')]).size).toBe(0)
    })

    it('reads a loop of folders as not trashed, unless one of them was', () => {
      expect(trashedIds([doc('a', 'b'), doc('b', 'a')]).size).toBe(0)
      expect([...trashedIds([doc('a', 'b'), doc('b', 'a', { trashed: 1 })])].sort()).toEqual([
        'a',
        'b',
      ])
    })

    it('reads a document whose folder is missing by its own mark', () => {
      expect([...trashedIds([doc('a', 'gone', { trashed: 1 }), doc('b', 'gone')])]).toEqual(['a'])
    })
  })

  describe('expired', () => {
    it('is true from 30 days in the trash', () => {
      const now = 10 * TRASH_KEPT_MS
      expect(expired({ trashed: now - TRASH_KEPT_MS }, now)).toBe(true)
      expect(expired({ trashed: now - TRASH_KEPT_MS + 1 }, now)).toBe(false)
      expect(expired({}, now)).toBe(false)
    })
  })

  describe('outOfTrash', () => {
    it('leaves out what is in the trash', () => {
      const rows = [doc('root', 'story_1'), doc('a', 'root', { trashed: 1 }), doc('b', 'a')]
      expect(outOfTrash(rows).map(row => row.id)).toEqual(['root'])
    })

    it('gives back the same list when nothing is in the trash', () => {
      const rows = [doc('root', 'story_1')]
      expect(outOfTrash(rows)).toBe(rows)
    })
  })
})
