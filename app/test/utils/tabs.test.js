import { describe, it, expect } from 'vitest'
import {
  NO_TABS,
  closeTab,
  dropTabs,
  keepTab,
  normalizeTabs,
  openTab,
  tabsOf,
  tabNames,
  tabsPatch,
} from '@/utils/tabs.js'

const tabs = (open, active = open[0] ?? null, preview = null) => ({ open, active, preview })

describe('tabsOf', () => {
  it('reads the tabs off a story', () => {
    expect(tabsOf({ openDocumentIds: ['a', 'b'], lastDocumentId: 'b' })).toEqual(
      tabs(['a', 'b'], 'b')
    )
  })

  it('gives a story from before tabs one tab, its last document', () => {
    expect(tabsOf({ lastDocumentId: 'a' })).toEqual(tabs(['a']))
    expect(tabsOf({ lastDocumentId: null })).toEqual(NO_TABS)
    expect(tabsOf(null)).toEqual(NO_TABS)
  })

  it('leaves a story closed down to nothing at nothing', () => {
    expect(tabsOf({ openDocumentIds: [], lastDocumentId: null })).toEqual(NO_TABS)
  })

  it('repairs a set whose active tab is not open', () => {
    expect(tabsOf({ openDocumentIds: ['a', 'b'], lastDocumentId: 'c' })).toEqual(
      tabs(['a', 'b'], 'a')
    )
    expect(tabsOf({ openDocumentIds: [], lastDocumentId: 'c' })).toEqual(NO_TABS)
  })

  it('opens each document once', () => {
    expect(tabsOf({ openDocumentIds: ['a', 'b', 'a'], lastDocumentId: 'a' })).toEqual(
      tabs(['a', 'b'], 'a')
    )
  })
})

describe('tabsPatch', () => {
  it('writes the tabs back as story fields', () => {
    expect(tabsPatch(tabs(['a', 'b'], 'b', 'a'))).toEqual({
      openDocumentIds: ['a', 'b'],
      lastDocumentId: 'b',
      previewDocumentId: 'a',
    })
    expect(tabsPatch(NO_TABS)).toEqual({
      openDocumentIds: [],
      lastDocumentId: null,
      previewDocumentId: null,
    })
  })

  it('round-trips through a story', () => {
    const set = tabs(['a', 'b', 'c'], 'c')
    expect(tabsOf(tabsPatch(set))).toEqual(set)
  })
})

describe('openTab', () => {
  it('adds a new document at the end of the strip, showing', () => {
    expect(openTab(tabs(['a', 'b'], 'a'), 'c')).toEqual(tabs(['a', 'b', 'c'], 'c'))
    expect(openTab(NO_TABS, 'a')).toEqual(tabs(['a']))
  })

  it('brings a document already open to the front where it is', () => {
    expect(openTab(tabs(['a', 'b', 'c'], 'c'), 'a')).toEqual(tabs(['a', 'b', 'c'], 'a'))
  })

  it('changes nothing for the document already showing', () => {
    const set = tabs(['a', 'b'], 'b')
    expect(openTab(set, 'b')).toBe(set)
  })
})

describe('closeTab', () => {
  it('closes a tab that is not showing and leaves the rest', () => {
    expect(closeTab(tabs(['a', 'b', 'c'], 'a'), 'b')).toEqual(tabs(['a', 'c'], 'a'))
  })

  it('brings the neighbour to the right forward when the showing one goes', () => {
    expect(closeTab(tabs(['a', 'b', 'c'], 'b'), 'b')).toEqual(tabs(['a', 'c'], 'c'))
  })

  it('falls back to the neighbour on the left at the end of the strip', () => {
    expect(closeTab(tabs(['a', 'b', 'c'], 'c'), 'c')).toEqual(tabs(['a', 'b'], 'b'))
  })

  it('leaves nothing showing when the last tab goes', () => {
    expect(closeTab(tabs(['a']), 'a')).toEqual(NO_TABS)
  })

  it('changes nothing for a document that is not open', () => {
    const set = tabs(['a', 'b'], 'a')
    expect(closeTab(set, 'z')).toBe(set)
  })

  it('does not change the tabs it was given', () => {
    const set = tabs(['a', 'b'], 'a')
    closeTab(set, 'a')
    expect(set).toEqual(tabs(['a', 'b'], 'a'))
  })
})

describe('dropTabs', () => {
  it('closes several, and shows the nearest survivor to the right', () => {
    expect(dropTabs(tabs(['a', 'b', 'c', 'd'], 'b'), ['b', 'c'])).toEqual(tabs(['a', 'd'], 'd'))
  })

  it('shows the nearest survivor to the left when nothing is right', () => {
    expect(dropTabs(tabs(['a', 'b', 'c', 'd'], 'c'), ['d', 'c'])).toEqual(tabs(['a', 'b'], 'b'))
  })

  it('leaves the showing tab alone when it survives', () => {
    expect(dropTabs(tabs(['a', 'b', 'c'], 'b'), ['a', 'c'])).toEqual(tabs(['b'], 'b'))
  })

  it('is the same tabs when nothing is dropped', () => {
    const set = tabs(['a', 'b'], 'a')
    expect(dropTabs(set, [])).toBe(set)
    expect(dropTabs(set, ['z'])).toBe(set)
  })
})

describe('normalizeTabs', () => {
  it('drops what can no longer be shown and keeps the order', () => {
    const canShow = id => id !== 'b'
    expect(normalizeTabs(tabs(['a', 'b', 'c'], 'a'), canShow)).toEqual(tabs(['a', 'c'], 'a'))
  })

  it('moves off a showing tab that is gone, as a close does', () => {
    const canShow = id => id !== 'b'
    expect(normalizeTabs(tabs(['a', 'b', 'c'], 'b'), canShow)).toEqual(tabs(['a', 'c'], 'c'))
  })

  it('is the same tabs when all can be shown', () => {
    const set = tabs(['a', 'b'], 'a')
    expect(normalizeTabs(set, () => true)).toBe(set)
  })
})

describe('previews', () => {
  it('reads a preview off a story, and none that is not open', () => {
    const story = { openDocumentIds: ['a', 'b'], lastDocumentId: 'b' }
    expect(tabsOf({ ...story, previewDocumentId: 'b' })).toEqual(tabs(['a', 'b'], 'b', 'b'))
    expect(tabsOf({ ...story, previewDocumentId: 'c' })).toEqual(tabs(['a', 'b'], 'b'))
  })

  it('opens a preview at the end when there is none', () => {
    expect(openTab(tabs(['a']), 'b', { preview: true })).toEqual(tabs(['a', 'b'], 'b', 'b'))
  })

  it('opens a preview in the preview tab, where it stands', () => {
    expect(openTab(tabs(['a', 'b', 'c'], 'c', 'b'), 'd', { preview: true })).toEqual(
      tabs(['a', 'd', 'c'], 'd', 'd')
    )
  })

  it('opens a kept document beside the preview, leaving it a preview', () => {
    expect(openTab(tabs(['a', 'b'], 'b', 'b'), 'c')).toEqual(tabs(['a', 'b', 'c'], 'c', 'b'))
  })

  it('brings an open document forward as it was, kept or not', () => {
    expect(openTab(tabs(['a', 'b'], 'b', 'b'), 'a', { preview: true })).toEqual(
      tabs(['a', 'b'], 'a', 'b')
    )
    expect(openTab(tabs(['a', 'b'], 'a', 'b'), 'b')).toEqual(tabs(['a', 'b'], 'b', 'b'))
  })

  it('keeps a preview, and leaves a kept tab as it is', () => {
    const set = tabs(['a', 'b'], 'b', 'b')
    expect(keepTab(set, 'b')).toEqual(tabs(['a', 'b'], 'b'))
    expect(keepTab(set, 'a')).toBe(set)
  })

  it('forgets the preview when its tab closes', () => {
    expect(closeTab(tabs(['a', 'b'], 'a', 'b'), 'b')).toEqual(tabs(['a'], 'a'))
    expect(closeTab(tabs(['a', 'b'], 'a', 'b'), 'a')).toEqual(tabs(['b'], 'b', 'b'))
  })
})

describe('tabNames', () => {
  const shown = paths => tabNames(paths).map(({ prefix, title }) => prefix + title)

  it('names a tab by its title when no other open tab shares it', () => {
    expect(shown([['Characters', 'Elara'], ['Chapter 1']])).toEqual(['Elara', 'Chapter 1'])
  })

  it('adds as much of the path as tells two of a title apart', () => {
    expect(shown([['foo', 'a'], ['baz', 'a'], ['b']])).toEqual(['foo/a', 'baz/a', 'b'])
    expect(
      shown([
        ['foo', 'bar', 'a'],
        ['baz', 'bar', 'a'],
      ])
    ).toEqual(['foo/bar/a', 'baz/bar/a'])
  })

  it('adds to each only what it needs', () => {
    expect(
      shown([
        ['foo', 'bar', 'a'],
        ['baz', 'bar', 'a'],
        ['qux', 'a'],
      ])
    ).toEqual(['foo/bar/a', 'baz/bar/a', 'qux/a'])
  })

  it('leaves a top-level document bare beside a nested one of its title', () => {
    expect(shown([['a'], ['bar', 'a']])).toEqual(['a', 'bar/a'])
  })

  it('shows the whole path when even that cannot tell two apart', () => {
    expect(
      shown([
        ['foo', 'a'],
        ['foo', 'a'],
      ])
    ).toEqual(['foo/a', 'foo/a'])
  })

  it('keeps the prefix apart from the title', () => {
    expect(
      tabNames([
        ['foo', 'bar', 'a'],
        ['baz', 'bar', 'a'],
      ])[0]
    ).toEqual({
      prefix: 'foo/bar/',
      title: 'a',
    })
  })
})
