import { describe, it, expect } from 'vitest'
import {
  CHAT_TABS,
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

/**
 * A set of tabs. Its history is the one showing alone, as for tabs from
 * before the history was kept, unless given.
 */
const tabs = (open, active = open[0] ?? null, preview = null, shown = active ? [active] : []) => ({
  open,
  active,
  preview,
  shown,
})

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

  it('reads the history, keeping only open tabs, each once, the showing one first', () => {
    expect(
      tabsOf({
        openDocumentIds: ['a', 'b', 'c'],
        lastDocumentId: 'b',
        shownDocumentIds: ['c', 'z', 'a', 'c', 'b'],
      })
    ).toEqual(tabs(['a', 'b', 'c'], 'b', null, ['b', 'c', 'a']))
  })
})

describe('tabsPatch', () => {
  it('writes the tabs back as story fields', () => {
    expect(tabsPatch(tabs(['a', 'b'], 'b', 'a', ['b', 'a']))).toEqual({
      openDocumentIds: ['a', 'b'],
      lastDocumentId: 'b',
      previewDocumentId: 'a',
      shownDocumentIds: ['b', 'a'],
    })
    expect(tabsPatch(NO_TABS)).toEqual({
      openDocumentIds: [],
      lastDocumentId: null,
      previewDocumentId: null,
      shownDocumentIds: [],
    })
  })

  it('round-trips through a story', () => {
    const set = tabs(['a', 'b', 'c'], 'c', null, ['c', 'a', 'b'])
    expect(tabsOf(tabsPatch(set))).toEqual(set)
  })
})

describe("the chat panel's tabs", () => {
  it('reads and writes the chat fields, leaving the editor’s alone', () => {
    const view = {
      openDocumentIds: ['doc_1'],
      lastDocumentId: 'doc_1',
      openChatIds: ['chat_1', 'chat_2'],
      lastChatId: 'chat_2',
      previewChatId: 'chat_1',
      shownChatIds: ['chat_2', 'chat_1'],
    }
    const set = tabsOf(view, CHAT_TABS)
    expect(set).toEqual(tabs(['chat_1', 'chat_2'], 'chat_2', 'chat_1', ['chat_2', 'chat_1']))
    expect(tabsPatch(set, CHAT_TABS)).toEqual({
      openChatIds: ['chat_1', 'chat_2'],
      lastChatId: 'chat_2',
      previewChatId: 'chat_1',
      shownChatIds: ['chat_2', 'chat_1'],
    })
  })
})

describe('openTab', () => {
  it('opens a tab beside the one showing when asked', () => {
    expect(openTab(tabs(['a', 'b', 'c'], 'a'), 'd', { beside: true })).toEqual(
      tabs(['a', 'd', 'b', 'c'], 'd', null, ['d', 'a'])
    )
    expect(openTab(NO_TABS, 'a', { beside: true })).toEqual(tabs(['a']))
  })

  it('adds a new document at the end of the strip, showing', () => {
    expect(openTab(tabs(['a', 'b'], 'a'), 'c')).toEqual(
      tabs(['a', 'b', 'c'], 'c', null, ['c', 'a'])
    )
    expect(openTab(NO_TABS, 'a')).toEqual(tabs(['a']))
  })

  it('brings a document already open to the front where it is', () => {
    expect(openTab(tabs(['a', 'b', 'c'], 'c'), 'a')).toEqual(
      tabs(['a', 'b', 'c'], 'a', null, ['a', 'c'])
    )
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

  it('goes back to the tab shown before, down the whole history', () => {
    // Shown 1, 3, 2, 5, 4.
    let set = ['1', '3', '2', '5', '4'].reduce((before, id) => openTab(before, id), NO_TABS)
    expect(set.shown).toEqual(['4', '5', '2', '3', '1'])

    // 5 closed unseen: 4 still shows, and 5 is out of the history.
    set = closeTab(set, '5')
    expect(set.active).toBe('4')

    const after = []
    while (set.active) {
      set = closeTab(set, set.active)
      after.push(set.active)
    }
    expect(after).toEqual(['2', '3', '1', null])
    expect(set).toEqual(NO_TABS)
  })

  it('goes back to a tab brought forward again, not where it was first opened', () => {
    let set = ['a', 'b', 'c'].reduce((before, id) => openTab(before, id), NO_TABS)
    set = openTab(set, 'a')
    set = openTab(set, 'b')
    expect(closeTab(set, 'b').active).toBe('a')
  })

  it('past the history, brings the neighbour to the right forward', () => {
    expect(closeTab(tabs(['a', 'b', 'c'], 'b'), 'b')).toEqual(tabs(['a', 'c'], 'c'))
  })

  it('past the history, falls back to the neighbour on the left at the end of the strip', () => {
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
  it('closes several, and shows the latest shown of those left', () => {
    expect(
      dropTabs(tabs(['a', 'b', 'c', 'd'], 'b', null, ['b', 'c', 'a', 'd']), ['b', 'c'])
    ).toEqual(tabs(['a', 'd'], 'a', null, ['a', 'd']))
  })

  it('past the history, closes several, and shows the nearest survivor to the right', () => {
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
    expect(openTab(tabs(['a']), 'b', { preview: true })).toEqual(
      tabs(['a', 'b'], 'b', 'b', ['b', 'a'])
    )
  })

  it('opens a preview in the preview tab, where it stands', () => {
    expect(openTab(tabs(['a', 'b', 'c'], 'c', 'b'), 'd', { preview: true })).toEqual(
      tabs(['a', 'd', 'c'], 'd', 'd', ['d', 'c'])
    )
  })

  it('takes the replaced preview out of the history, so closing never goes back to it', () => {
    let set = openTab(NO_TABS, 'a')
    set = openTab(set, 'b', { preview: true })
    set = openTab(set, 'c', { preview: true })
    expect(set.shown).toEqual(['c', 'a'])
    expect(closeTab(set, 'c')).toEqual(tabs(['a'], 'a'))
  })

  it('opens a kept document beside the preview, leaving it a preview', () => {
    expect(openTab(tabs(['a', 'b'], 'b', 'b'), 'c')).toEqual(
      tabs(['a', 'b', 'c'], 'c', 'b', ['c', 'b'])
    )
  })

  it('brings an open document forward as it was, kept or not', () => {
    expect(openTab(tabs(['a', 'b'], 'b', 'b'), 'a', { preview: true })).toEqual(
      tabs(['a', 'b'], 'a', 'b', ['a', 'b'])
    )
    expect(openTab(tabs(['a', 'b'], 'a', 'b'), 'b')).toEqual(tabs(['a', 'b'], 'b', 'b', ['b', 'a']))
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
