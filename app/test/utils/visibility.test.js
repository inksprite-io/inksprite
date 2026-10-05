import { describe, it, expect } from 'vitest'
import { chatVisibility, markOf, unpinned, withMark } from '@/utils/visibility.js'

// root
// └ Cards
//   └ Characters
//     ├ Vivi
//     │ ├ Description
//     │ └ Greeting
//     └ Elara
//       └ Description
// └ Notes (hidden outright)
//   └ Plot
const tree = {
  root: { id: 'root', parentId: 'story', type: 'folder' },
  cards: { id: 'cards', parentId: 'root', type: 'folder' },
  chars: { id: 'chars', parentId: 'cards', type: 'folder' },
  vivi: { id: 'vivi', parentId: 'chars', type: 'folder' },
  viviDesc: { id: 'viviDesc', parentId: 'vivi', type: 'text' },
  viviGreet: { id: 'viviGreet', parentId: 'vivi', type: 'text' },
  elara: { id: 'elara', parentId: 'chars', type: 'folder' },
  elaraDesc: { id: 'elaraDesc', parentId: 'elara', type: 'text' },
  notes: { id: 'notes', parentId: 'root', type: 'folder', hidden: true },
  plot: { id: 'plot', parentId: 'notes', type: 'text' },
}
const get = id => tree[id]

describe('markOf', () => {
  it('is the mark put on the document itself', () => {
    const chat = { pinnedIds: ['a'], shownIds: ['b'], hiddenIds: ['c'] }

    expect(markOf(chat, 'a')).toBe('pinned')
    expect(markOf(chat, 'b')).toBe('shown')
    expect(markOf(chat, 'c')).toBe('hidden')
    expect(markOf(chat, 'd')).toBeNull()
  })

  it('is nothing without a chat', () => {
    expect(markOf(null, 'a')).toBeNull()
    expect(markOf(undefined, 'a')).toBeNull()
  })
})

describe('withMark', () => {
  it('keeps a document in one state at most', () => {
    const chat = { pinnedIds: ['a', 'b'], hiddenIds: ['c'] }

    expect(withMark(chat, 'a', 'hidden')).toEqual({
      pinnedIds: ['b'],
      shownIds: undefined,
      hiddenIds: ['c', 'a'],
    })
  })

  it('writes an emptied list as absent', () => {
    // A chat that never marked anything and one that has stopped read the same.
    expect(withMark({ pinnedIds: ['a'] }, 'a', null)).toEqual({
      pinnedIds: undefined,
      shownIds: undefined,
      hiddenIds: undefined,
    })
  })

  it('marks a chat that had no marks', () => {
    expect(withMark(null, 'a', 'shown').shownIds).toEqual(['a'])
  })
})

describe('chatVisibility', () => {
  const seen = chat => {
    const { sees } = chatVisibility(chat, get)
    return Object.keys(tree).filter(id => sees(tree[id]))
  }

  it('sees everything not hidden outright when the chat marks nothing', () => {
    expect(seen(null)).toEqual([
      'root',
      'cards',
      'chars',
      'vivi',
      'viviDesc',
      'viviGreet',
      'elara',
      'elaraDesc',
    ])
  })

  it('hides what is under a folder the chat hid', () => {
    expect(seen({ hiddenIds: ['chars'] })).toEqual(['root', 'cards'])
  })

  it('lets the nearest mark decide: one character shown on a hidden shelf', () => {
    // A character imported later lands on the shelf and is hidden with it.
    expect(seen({ hiddenIds: ['chars'], shownIds: ['vivi'] })).toEqual([
      'root',
      'cards',
      'vivi',
      'viviDesc',
      'viviGreet',
    ])
  })

  it('sees a pin under a folder the chat hid', () => {
    expect(seen({ hiddenIds: ['chars'], pinnedIds: ['elaraDesc'] })).toContain('elaraDesc')
    expect(seen({ hiddenIds: ['chars'], pinnedIds: ['elaraDesc'] })).not.toContain('elara')
  })

  it('hides something inside a folder the chat shows', () => {
    expect(seen({ shownIds: ['vivi'], hiddenIds: ['viviGreet'] })).not.toContain('viviGreet')
  })

  it('never shows what is hidden outright, whatever the chat says', () => {
    // A card's JSON, the prompt it replaces: no chat brings them back.
    const chat = { shownIds: ['notes'], pinnedIds: ['plot'] }

    expect(seen(chat)).not.toContain('notes')
    expect(seen(chat)).not.toContain('plot')
  })

  it('says why: hidden everywhere, and the mark that decides', () => {
    const visibility = chatVisibility({ hiddenIds: ['chars'], pinnedIds: ['vivi'] }, get)

    expect(visibility.hiddenEverywhere(tree.plot)).toBe(true)
    expect(visibility.hiddenEverywhere(tree.elara)).toBe(false)
    expect(visibility.markFor(tree.viviDesc)).toBe('pinned')
    expect(visibility.markFor(tree.elaraDesc)).toBe('hidden')
    expect(visibility.markFor(tree.root)).toBeNull()
  })

  it('does not see nothing', () => {
    expect(chatVisibility(null, get).sees(null)).toBe(false)
  })
})

describe('unpinned', () => {
  it('takes off a pin of the document’s own', () => {
    const chat = { pinnedIds: ['viviDesc', 'elaraDesc'], hiddenIds: ['notes'] }

    expect(unpinned(chat, tree.viviDesc, get)).toEqual({
      pinnedIds: ['elaraDesc'],
      shownIds: undefined,
      hiddenIds: ['notes'],
    })
  })

  it('lets a document go from under a pinned folder, keeping it in sight', () => {
    // The folder's pin stays the folder's. The document is shown instead:
    // listed, readable, and not carried — letting go is not hiding.
    const chat = { pinnedIds: ['vivi'] }
    const next = unpinned(chat, tree.viviDesc, get)

    expect(next).toEqual({ pinnedIds: ['vivi'], shownIds: ['viviDesc'], hiddenIds: undefined })
    const { sees, markFor } = chatVisibility(next, get)
    expect(sees(tree.viviDesc)).toBe(true)
    expect(markFor(tree.viviDesc)).toBe('shown')
    expect(markFor(tree.viviGreet)).toBe('pinned')
  })

  it('does the same for a document pinned in its own right under a pinned folder', () => {
    const chat = { pinnedIds: ['vivi', 'viviDesc'] }

    expect(unpinned(chat, tree.viviDesc, get)).toEqual({
      pinnedIds: ['vivi'],
      shownIds: ['viviDesc'],
      hiddenIds: undefined,
    })
  })
})
