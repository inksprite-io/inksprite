import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '@/editor/markdown.js'
import { parseFilters } from '@/tts/filters.js'
import { skippedRanges, speakerRanges } from '@/tts/highlight.js'

const voices = [
  { id: 'narrator', name: 'Narrator', voice: 'af_heart' },
  { id: 'riley', name: 'Riley', voice: 'af_nicole', color: '#3b82f6' },
  { id: 'cody', name: 'Cody', voice: 'am_michael' },
]

const doc = parseMarkdown('Riley looked up.\n\n"Hello," she said.\n\n"You pick," said Cody.')

/** The words each range covers, with its colour. */
const covered = ranges =>
  ranges.map(({ from, to, color, name }) => [doc.textBetween(from, to), color, name])

describe('speakerRanges', () => {
  it('finds where a speaker’s paragraphs are in the document', () => {
    const assignments = [{ text: '"Hello," she said.', index: 1, voiceId: 'riley' }]
    expect(covered(speakerRanges(doc, assignments, voices))).toEqual([
      ['"Hello," she said.', '#3b82f6', 'Riley'],
    ])
  })

  it('leaves a voice with no colour, and a voice since removed, plain', () => {
    const assignments = [
      { text: '"You pick," said Cody.', index: 2, voiceId: 'cody' },
      { text: 'Riley looked up.', index: 0, voiceId: 'gone' },
    ]
    expect(speakerRanges(doc, assignments, voices)).toEqual([])
  })

  it('has nothing to colour with no speakers', () => {
    expect(speakerRanges(doc, [], voices)).toEqual([])
    expect(speakerRanges(doc, undefined, voices)).toEqual([])
  })
})

describe('skippedRanges', () => {
  it('finds where the filters match in the document', () => {
    const cited = parseMarkdown('# Chapter 1\n\nA fact [1].\n\nPage 12')
    const ranges = skippedRanges(cited, parseFilters('\\s*\\[\\d+\\]\n^Page \\d+$'))
    expect(ranges.map(({ from, to }) => cited.textBetween(from, to))).toEqual([' [1]', 'Page 12'])
  })

  it('has nothing to grey with no filters', () => {
    expect(skippedRanges(doc, [])).toEqual([])
  })
})
