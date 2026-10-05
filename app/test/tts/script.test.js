import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '@/editor/markdown.js'
import { assignSpeaker, blocksOf, blocksOfDoc, keyOf, resolveSpeakers } from '@/tts/script.js'

/** The blocks' texts. */
const textsOf = markdown => blocksOf(markdown).map(block => block.text)

describe('blocksOf', () => {
  it('reads every node that holds text, with the markdown taken off', () => {
    const markdown = [
      '# Chapter One',
      '',
      'Riley walked in. She was **tired**, and *late*.',
      '',
      '> "Sit," said Cody.',
      '',
      '- one',
      '- two',
      '',
      '```',
      'not read aloud',
      '```',
      '',
      '---',
      '',
      'The end.',
    ].join('\n')

    expect(textsOf(markdown)).toEqual([
      'Chapter One',
      'Riley walked in. She was tired, and late.',
      '"Sit," said Cody.',
      'one',
      'two',
      'The end.',
    ])
  })

  it('keeps a paragraph whole, speech and all', () => {
    // A sentence cut at its quotation marks is said as two or three, each
    // ending where it was cut. The paragraph is the block.
    expect(textsOf('"Hello," he said. "How are you?"')).toEqual([
      '"Hello," he said. "How are you?"',
    ])
  })

  it('keeps a line break where the writer ended a line', () => {
    expect(textsOf('Roses are red\nViolets are blue')).toEqual(['Roses are red\nViolets are blue'])
  })

  it('knows where each block is in the document', () => {
    const doc = parseMarkdown('One.\n\n"Hello," he **said**.\nAnd left.\n\n- an item')
    const blocks = blocksOfDoc(doc)

    expect(blocks.map(block => block.text)).toEqual([
      'One.',
      '"Hello," he said.\nAnd left.',
      'an item',
    ])
    for (const block of blocks) {
      // A line the writer ended is one position in the document and one
      // character in the text, so the two stay in step across it.
      expect(doc.textBetween(block.from, block.to, '\n', '\n')).toBe(block.text)
    }
  })

  it('reads a link as its words', () => {
    expect(textsOf('See [the map](http://example.com) for more')).toEqual(['See the map for more'])
  })

  it('keeps nothing empty', () => {
    expect(blocksOf('')).toEqual([])
    expect(blocksOf(null)).toEqual([])
    expect(blocksOf('\n\n   \n')).toEqual([])
  })
})

describe('keyOf', () => {
  it('is the words, one space apart', () => {
    expect(keyOf('  Roses are red\nViolets   are blue ')).toBe('Roses are red Violets are blue')
  })
})

describe('resolveSpeakers', () => {
  const blocks = ['Riley walked in.', '"What do you want to eat?"', '"You pick."']

  it('gives every block to the default voice with no assignments', () => {
    expect(resolveSpeakers(blocks, undefined)).toEqual([null, null, null])
    expect(resolveSpeakers(blocks, [])).toEqual([null, null, null])
  })

  it('finds each assignment by its text', () => {
    const assignments = [
      { text: '"What do you want to eat?"', index: 1, voiceId: 'riley' },
      { text: '"You pick."', index: 2, voiceId: 'cody' },
    ]
    expect(resolveSpeakers(blocks, assignments)).toEqual([null, 'riley', 'cody'])
  })

  it('follows a block that has moved', () => {
    const assignments = [{ text: '"You pick."', index: 2, voiceId: 'cody' }]
    const edited = ['A new opening line.', ...blocks]
    expect(resolveSpeakers(edited, assignments)).toEqual([null, null, null, 'cody'])
  })

  it('keeps two blocks that read the same apart, by where they were', () => {
    const lines = ['Riley spoke.', '"No."', 'Cody answered.', '"No."']
    const assignments = [
      { text: '"No."', index: 1, voiceId: 'riley' },
      { text: '"No."', index: 3, voiceId: 'cody' },
    ]
    expect(resolveSpeakers(lines, assignments)).toEqual([null, 'riley', null, 'cody'])

    // Both shifted by an insertion at the top: each still finds its own.
    const shifted = ['Later that day.', ...lines]
    expect(resolveSpeakers(shifted, assignments)).toEqual([null, null, 'riley', null, 'cody'])
  })

  it('gives a rewritten block back to the default voice', () => {
    const assignments = [{ text: '"You pick."', index: 2, voiceId: 'cody' }]
    const edited = [blocks[0], blocks[1], '"I suppose you pick."']
    expect(resolveSpeakers(edited, assignments)).toEqual([null, null, null])
  })

  it('does not mind how the words are spaced', () => {
    const assignments = [{ text: 'Roses are red Violets are blue', index: 0, voiceId: 'poet' }]
    expect(resolveSpeakers(['Roses are red\nViolets  are blue'], assignments)).toEqual(['poet'])
  })
})

describe('assignSpeaker', () => {
  const blocks = ['Riley walked in.', '"What do you want to eat?"', '"You pick."']

  it('records the block as its words and where it is', () => {
    expect(assignSpeaker(blocks, [null, null, null], [1], 'riley')).toEqual([
      { text: '"What do you want to eat?"', index: 1, voiceId: 'riley' },
    ])
  })

  it('keeps the other speakers, and gives a block back with null', () => {
    const speakers = [null, 'riley', 'cody']
    expect(assignSpeaker(blocks, speakers, [2], null)).toEqual([
      { text: '"What do you want to eat?"', index: 1, voiceId: 'riley' },
    ])
  })

  it('leaves behind an assignment whose block is gone', () => {
    // Resolved against the blocks as they stand, a stale assignment is
    // already null, so writing back from the resolution drops it.
    const stale = [{ text: 'A line since deleted.', index: 5, voiceId: 'ghost' }]
    const speakers = resolveSpeakers(blocks, stale)
    expect(assignSpeaker(blocks, speakers, [0], 'narr')).toEqual([
      { text: 'Riley walked in.', index: 0, voiceId: 'narr' },
    ])
  })

  it('gives several blocks to one voice at once, or gives them back', () => {
    const given = assignSpeaker(blocks, [null, null, null], [1, 2], 'cody')
    expect(given).toEqual([
      { text: '"What do you want to eat?"', index: 1, voiceId: 'cody' },
      { text: '"You pick."', index: 2, voiceId: 'cody' },
    ])
    expect(assignSpeaker(blocks, resolveSpeakers(blocks, given), [1, 2], null)).toEqual([])
  })

  it('round-trips through resolveSpeakers', () => {
    const assignments = assignSpeaker(blocks, [null, 'riley', null], [2], 'cody')
    expect(resolveSpeakers(blocks, assignments)).toEqual([null, 'riley', 'cody'])
  })
})
