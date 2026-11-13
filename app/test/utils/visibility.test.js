import { describe, it, expect } from 'vitest'
import { chatVisibility, markOf, withMark } from '@/utils/visibility.js'

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
    const chat = { shownIds: ['b'], hiddenIds: ['c'] }

    expect(markOf(chat, 'b')).toBe('shown')
    expect(markOf(chat, 'c')).toBe('hidden')
    expect(markOf(chat, 'd')).toBeNull()
  })

  it('reads a pin from before as a document the chat shows', () => {
    // A pin carried a document's text on every turn. Nothing pins now, and a
    // chat that still lists one keeps the document in sight, as the pin did.
    expect(markOf({ pinnedIds: ['a'] }, 'a')).toBe('shown')
    expect(markOf({ pinnedIds: ['a'], hiddenIds: ['a'] }, 'a')).toBe('hidden')
  })

  it('is nothing without a chat', () => {
    expect(markOf(null, 'a')).toBeNull()
    expect(markOf(undefined, 'a')).toBeNull()
  })
})

describe('withMark', () => {
  it('keeps a document in one state at most', () => {
    const chat = { shownIds: ['a', 'b'], hiddenIds: ['c'] }

    expect(withMark(chat, 'a', 'hidden')).toEqual({
      shownIds: ['b'],
      hiddenIds: ['c', 'a'],
    })
  })

  it('takes a document off the pins a chat from before lists', () => {
    expect(withMark({ pinnedIds: ['a', 'b'] }, 'a', 'hidden')).toEqual({
      pinnedIds: ['b'],
      shownIds: undefined,
      hiddenIds: ['a'],
    })
  })

  it('writes an emptied list as absent', () => {
    // A chat that never marked anything and one that has stopped read the same.
    expect(withMark({ shownIds: ['a'] }, 'a', null)).toEqual({
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

  it('sees a pin from before under a folder the chat hid', () => {
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
    const visibility = chatVisibility({ hiddenIds: ['chars'], shownIds: ['vivi'] }, get)

    expect(visibility.hiddenEverywhere(tree.plot)).toBe(true)
    expect(visibility.hiddenEverywhere(tree.elara)).toBe(false)
    expect(visibility.markFor(tree.viviDesc)).toBe('shown')
    expect(visibility.markFor(tree.elaraDesc)).toBe('hidden')
    expect(visibility.markFor(tree.root)).toBeNull()
  })

  it('does not see nothing', () => {
    expect(chatVisibility(null, get).sees(null)).toBe(false)
  })
})
