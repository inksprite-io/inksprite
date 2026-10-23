import { describe, it, expect } from 'vitest'
import { mergeRow, mergeText, settleText } from '@/cloud/merge.js'

describe('mergeText', () => {
  const base = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n'

  it('takes the side that changed', () => {
    const mine = base.replace('First', 'Opening')
    expect(mergeText(base, mine, base)).toEqual({ text: mine, clashed: false, clashes: 0 })
    expect(mergeText(base, base, mine)).toEqual({ text: mine, clashed: false, clashes: 0 })
  })

  it('keeps changes to different paragraphs from both', () => {
    const mine = base.replace('First', 'Opening')
    const theirs = base.replace('Third', 'Closing')
    expect(mergeText(base, mine, theirs)).toEqual({
      text: 'Opening paragraph.\n\nSecond paragraph.\n\nClosing paragraph.\n',
      clashed: false,
      clashes: 0,
    })
  })

  it('keeps changes to different words of one paragraph from both', () => {
    const one = 'The cat sat on the mat by the door.\n'
    const mine = 'The black cat sat on the mat by the door.\n'
    const theirs = 'The cat sat on the mat by the front door.\n'
    expect(mergeText(one, mine, theirs)).toEqual({
      text: 'The black cat sat on the mat by the front door.\n',
      clashed: false,
      clashes: 0,
    })
  })

  it('keeps both paragraphs written at one place, this device first', () => {
    const mine = `${base}\nMine at the end.\n`
    const theirs = `${base}\nTheirs at the end.\n`
    const merged = mergeText(base, mine, theirs)
    expect(merged.clashed).toBe(false)
    expect(merged.text).toBe(`${base}\nMine at the end.\n\nTheirs at the end.\n`)
  })

  it('keeps this device’s words where the same words changed, and says so', () => {
    const one = 'She walked home.\n'
    const merged = mergeText(one, 'She ran home.\n', 'She drove home.\n')
    expect(merged).toEqual({ text: 'She ran home.\n', clashed: true, clashes: 1 })
  })

  it('keeps a comment mark made on the other device', () => {
    const one = 'A quiet street.\n\nThe end.\n'
    const mine = 'A quiet street.\n\nThe very end.\n'
    const theirs = 'A {==quiet==}{>>c1<<} street.\n\nThe end.\n'
    expect(mergeText(one, mine, theirs).text).toBe(
      'A {==quiet==}{>>c1<<} street.\n\nThe very end.\n'
    )
  })
})

describe('settleText', () => {
  const base = 'One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.\n'

  it('merges what it can around a clash of a paragraph or two, and hands back the other text', () => {
    const mine = base.replace('One.', 'Uno.').replace('Five.', 'Cinq.')
    const theirs = base.replace('One.', 'Eins.').replace('Three.', 'Drei.')
    expect(settleText(base, mine, theirs)).toEqual({
      text: 'Uno.\n\nTwo.\n\nDrei.\n\nFour.\n\nCinq.\n',
      lost: { content: theirs, large: false },
    })
  })

  it('keeps this device’s text whole when more clashed, stitching nothing', () => {
    const mine = 'Uno.\n\nDos.\n\nTres.\n\nFour.\n\nCinq.\n'
    const theirs = 'Eins.\n\nZwei.\n\nDrei.\n\nFour.\n\nFive!\n'
    expect(settleText(base, mine, theirs)).toEqual({
      text: mine,
      lost: { content: theirs, large: true },
    })
  })

  it('hands back nothing when nothing clashed', () => {
    expect(settleText(base, base.replace('One', 'Uno'), base.replace('Five', 'Cinq'))).toEqual({
      text: 'Uno.\n\nTwo.\n\nThree.\n\nFour.\n\nCinq.\n',
      lost: null,
    })
  })
})

describe('mergeRow', () => {
  const doc = {
    id: 'doc_1',
    storyId: 'story_1',
    parentId: 'root',
    type: 'text',
    title: 'Chapter 1',
    content: 'One.\n\nTwo.\n',
    summary: '',
    wordCount: 2,
    version: 3,
    created: 1,
    updated: 10,
  }

  it('merges fields changed on one side each, and the text', () => {
    const mine = { ...doc, title: 'The Beginning', content: 'One!\n\nTwo.\n', updated: 20 }
    const theirs = { ...doc, summary: 'Starts it', content: 'One.\n\nTwo!\n', updated: 30 }
    const { row, lost } = mergeRow('documents', doc, mine, theirs)
    expect(lost).toBeNull()
    expect(row).toMatchObject({
      title: 'The Beginning',
      summary: 'Starts it',
      content: 'One!\n\nTwo!\n',
      updated: 30,
      wordCount: 2,
    })
  })

  it('hands back the other device’s text when the same words changed', () => {
    const mine = { ...doc, content: 'Uno.\n\nTwo.\n', updated: 20 }
    const theirs = { ...doc, content: 'Eins.\n\nTwo.\n', updated: 30 }
    const { row, lost } = mergeRow('documents', doc, mine, theirs)
    expect(row.content).toBe('Uno.\n\nTwo.\n')
    expect(lost).toEqual({ content: 'Eins.\n\nTwo.\n', large: false })
  })

  it('merges threads by their ids', () => {
    const base = { ...doc, comments: { a: { posts: ['x'] } } }
    const mine = { ...base, comments: { a: { posts: ['x'] }, b: { posts: ['mine'] } } }
    const theirs = { ...base, comments: { a: { posts: ['x', 'reply'] } } }
    const { row } = mergeRow('documents', base, mine, theirs)
    expect(row.comments).toEqual({ a: { posts: ['x', 'reply'] }, b: { posts: ['mine'] } })
  })

  it('takes the newer row where the same field changed on both', () => {
    const mine = { ...doc, title: 'Mine', updated: 20 }
    const theirs = { ...doc, title: 'Theirs', updated: 30 }
    expect(mergeRow('documents', doc, mine, theirs).row.title).toBe('Theirs')
  })

  it('never compares the device’s own count of saves', () => {
    const mine = { ...doc, version: 9 }
    expect(mergeRow('documents', doc, mine, doc)).toEqual({ row: doc, lost: null })
  })

  it('without a base, takes the newer, and hands back the older text', () => {
    const mine = { ...doc, content: 'Written here.\n', updated: 50 }
    const theirs = { ...doc, content: 'Written there.\n', updated: 40 }
    expect(mergeRow('documents', null, mine, theirs)).toEqual({
      row: mine,
      lost: { content: 'Written there.\n', large: true },
    })
  })

  it('takes the newer message whole', () => {
    const message = { id: 'm1', chatId: 'c1', content: 'Hi', updated: 5 }
    const theirs = { ...message, content: 'Hello', updated: 9 }
    expect(mergeRow('messages', null, message, theirs).row).toBe(theirs)
  })
})
