import { describe, it, expect } from 'vitest'
import { overviewToRootSummary } from '../../../src/stores/migrations/overview.js'
import { rootIdFor } from '../../../src/stores/migrations/projectTree.js'

const story = (id, overview = '') => ({ id, title: 'A Story', overview, version: 1 })

/** @param {string} storyId */
const root = (storyId, extra = {}) => ({
  id: rootIdFor(storyId),
  storyId,
  parentId: null,
  type: 'folder',
  title: 'A Story',
  content: '',
  summary: '',
  deleted: false,
  ...extra,
})

describe('overviewToRootSummary', () => {
  it('moves the overview onto the root document', () => {
    const { documents, moved } = overviewToRootSummary(
      [story('s1', 'A knight rides north.')],
      [root('s1')]
    )

    expect(moved).toBe(1)
    expect(documents[0]).toMatchObject({
      id: rootIdFor('s1'),
      summary: 'A knight rides north.',
    })
  })

  it('returns only the roots it changed', () => {
    const other = { ...root('s1'), id: 'doc_1', type: 'text' }
    const { documents } = overviewToRootSummary([story('s1', 'Something.')], [root('s1'), other])

    expect(documents).toHaveLength(1)
    expect(documents[0].id).toBe(rootIdFor('s1'))
  })

  it('leaves a story with no overview alone', () => {
    expect(overviewToRootSummary([story('s1', '   ')], [root('s1')])).toEqual({
      documents: [],
      moved: 0,
    })
  })

  it('keeps a summary the writer has already written', () => {
    // A re-imported backup must not walk an edited summary back to the
    // overview it was copied from.
    const { documents, moved } = overviewToRootSummary(
      [story('s1', 'The original pitch.')],
      [root('s1', { summary: 'The one I rewrote.' })]
    )

    expect(moved).toBe(0)
    expect(documents).toEqual([])
  })

  it('is idempotent', () => {
    const stories = [story('s1', 'A knight rides north.')]
    const first = overviewToRootSummary(stories, [root('s1')])
    const second = overviewToRootSummary(stories, first.documents)

    expect(second.moved).toBe(0)
  })

  it('skips a story whose root is missing or deleted', () => {
    expect(overviewToRootSummary([story('s1', 'Text.')], []).moved).toBe(0)
    expect(
      overviewToRootSummary([story('s1', 'Text.')], [root('s1', { deleted: true })]).moved
    ).toBe(0)
  })

  it('tolerates empty and missing input', () => {
    expect(overviewToRootSummary([], [])).toEqual({ documents: [], moved: 0 })
    expect(overviewToRootSummary(null, null)).toEqual({ documents: [], moved: 0 })
  })
})
