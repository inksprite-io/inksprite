import { describe, it, expect } from 'vitest'
import { withoutDeleted, deletedIds, FLAGGED_TABLES } from '@/stores/migrations/purgeDeleted.js'

/** A table with one live row and one marked row, named after the table. */
const pair = name => [{ id: `${name}_live` }, { id: `${name}_gone`, deleted: true, deletedAt: 5 }]

describe('withoutDeleted', () => {
  it('drops the marked rows from every table that carried the flag', () => {
    const tables = Object.fromEntries(FLAGGED_TABLES.map(name => [name, pair(name)]))

    const { tables: out, removed } = withoutDeleted(tables)

    for (const name of FLAGGED_TABLES) {
      expect(out[name]).toEqual([{ id: `${name}_live` }])
    }
    expect(removed).toBe(FLAGGED_TABLES.length)
  })

  it('leaves unmarked rows as they were, and a table it does not know alone', () => {
    const settings = [{ id: 'theme', deleted: true }]
    const tables = {
      stories: [{ id: 's1' }, { id: 's2', deleted: false }],
      settings,
    }

    const { tables: out, removed } = withoutDeleted(tables)

    expect(out.stories).toBe(tables.stories)
    expect(out.settings).toBe(settings)
    expect(removed).toBe(0)
  })

  it("drops a file's bytes along with its marked document", () => {
    const { tables: out, removed } = withoutDeleted({
      documents: [{ id: 'doc_1', type: 'file', deleted: true }],
      files: [{ id: 'doc_1', bytes: 'abc' }],
    })

    expect(out.documents).toEqual([])
    expect(out.files).toEqual([])
    expect(removed).toBe(2)
  })

  it('keeps the bytes of a document that is live', () => {
    const files = [{ id: 'doc_1', bytes: 'abc' }]
    const { tables: out, removed } = withoutDeleted({
      documents: [
        { id: 'doc_1', type: 'file' },
        { id: 'doc_2', type: 'text', deleted: true },
      ],
      files,
    })

    expect(out.files).toBe(files)
    expect(removed).toBe(1)
  })

  it('does not change the tables it was given', () => {
    const tables = { messages: pair('m') }
    withoutDeleted(tables)
    expect(tables.messages).toHaveLength(2)
  })
})

describe('deletedIds', () => {
  it('names the rows that are marked', () => {
    expect(deletedIds([{ id: 'a' }, { id: 'b', deleted: true }, { id: 'c', deleted: 1 }])).toEqual([
      'b',
      'c',
    ])
  })

  it('finds none in a table of live rows', () => {
    expect(deletedIds([{ id: 'a' }, { id: 'b', deleted: false }])).toEqual([])
  })
})
