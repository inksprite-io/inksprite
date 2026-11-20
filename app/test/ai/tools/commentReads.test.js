import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SUGGESTIONS_MOST, suggestionsAsRead } from '@/ai/tools/commentReads.js'
import { withoutComments } from '@/editor/comments.js'
import { seenMarkdown } from '@/editor/suggestionText.js'

/**
 * What a read cost: how often the text was parsed, how many blocks each
 * writing of markdown wrote, and how often the whole document was seen as a
 * reader sees it.
 */
const work = vi.hoisted(() => ({ parsed: 0, written: [], seen: 0 }))

vi.mock('@/editor/markdown.js', async original => {
  const real = await original()
  return {
    ...real,
    parseMarkdown: markdown => {
      work.parsed++
      return real.parseMarkdown(markdown)
    },
    serializeMarkdown: doc => {
      work.written.push(doc.childCount)
      return real.serializeMarkdown(doc)
    },
  }
})

vi.mock('@/editor/suggestions.js', async original => {
  const real = await original()
  return {
    ...real,
    seeing: (doc, accepted) => {
      work.seen++
      return real.seeing(doc, accepted)
    },
  }
})

const CHAT = 'chat_1'
const OTHER = 'chat_2'

/** A thread for a suggestion a chat made. */
const by = (chat, created = 1) => ({
  status: 'open',
  quote: '',
  posts: [],
  suggestion: { text: '', created, chat },
})

/** A text document as stored, with a thread for each suggestion in its text. */
const storedOf = (content, chatOf = () => OTHER) => ({
  id: 'doc_1',
  type: 'text',
  content,
  comments: Object.fromEntries(
    [...new Set([...content.matchAll(/[-+]\}\{>>(s[a-z0-9]+)<<\}/g)].map(match => match[1]))].map(
      (id, n) => [id, by(chatOf(n), n)]
    )
  ),
})

/** A reader's text the long way: the whole document written as they see it. */
const whole = (stored, made) => withoutComments(seenMarkdown(stored.content, made))

/**
 * A log of so many entries, a paragraph each, with a word of an entry
 * changed by a suggestion wherever `suggested` says: the reader's own for
 * every third of them, another chat's for the rest.
 */
const logOf = (entries, suggested) => {
  let made = 0
  const paragraphs = Array.from({ length: entries }, (_, n) => {
    const id = `s${String(n).padStart(5, '0')}`
    const wind = suggested(n) ? `{--steady--}{>>${id}<<}{++rising++}{>>${id}<<}` : 'steady'
    return `Entry ${n} of the harbour log: the tide on the turn, the wind ${wind}, nothing in sight.`
  })
  return storedOf(paragraphs.join('\n\n'), () => (made++ % 3 === 0 ? CHAT : OTHER))
}

describe('what telling of suggestions costs', () => {
  beforeEach(() => {
    Object.assign(work, { parsed: 0, written: [], seen: 0 })
  })

  /** The blocks written in all, over every writing of markdown. */
  const blocksWritten = () => work.written.reduce((sum, count) => sum + count, 0)

  it('counts what the long way costs, which the rest is held against', () => {
    const stored = logOf(40, n => n % 10 === 0)
    expect(whole(stored, [])).toContain('the wind steady')
    expect(work).toEqual({ parsed: 1, written: [40], seen: 1 })
  })

  it('reads the document once, however many suggestions wait', () => {
    const entries = 400
    const stored = logOf(entries, n => n % 6 === 0)
    const told = suggestionsAsRead(stored, null, CHAT)

    expect(told.placed).toHaveLength(SUGGESTIONS_MOST)
    expect(told.more).toBe(7)
    expect(told.placed.filter(each => each.own)).toHaveLength(SUGGESTIONS_MOST / 3)
    for (const each of told.placed) {
      expect(each.from).toContain('the wind steady')
      expect(each.to).toContain('the wind rising')
    }
    // Parsed once, written whole once, and never seen whole another way.
    expect(work.parsed).toBe(1)
    expect(work.seen).toBe(0)
    expect(work.written.filter(count => count > entries / 2)).toEqual([entries])
    // Beyond that, the text up to the last one told is written once more, to
    // find where each is, and a few blocks around each: one at a time on
    // either side to see that it has words, and the stretch between, twice.
    // The long way writes every block for every one told: 24,400 here.
    expect(blocksWritten()).toBeLessThanOrEqual(2 * entries + 10 * SUGGESTIONS_MOST)
  })

  it('costs no more for a suggestion in each of the blocks one after another', () => {
    const entries = 400
    const told = suggestionsAsRead(
      logOf(entries, n => n < SUGGESTIONS_MOST),
      null,
      CHAT
    )

    expect(told.placed).toHaveLength(SUGGESTIONS_MOST)
    expect(work).toMatchObject({ parsed: 1, seen: 0 })
    expect(work.written.filter(count => count > entries / 2)).toEqual([entries])
    expect(blocksWritten()).toBeLessThanOrEqual(2 * entries + 10 * SUGGESTIONS_MOST)
  })

  it('costs a longer document only its one writing more', () => {
    const cost = entries => {
      Object.assign(work, { parsed: 0, written: [], seen: 0 })
      const told = suggestionsAsRead(
        logOf(entries, n => n < 300 && n % 5 === 0),
        null,
        OTHER
      )
      expect(told.placed).toHaveLength(SUGGESTIONS_MOST)
      expect(work).toMatchObject({ parsed: 1, seen: 0 })
      return blocksWritten() - entries
    }
    expect(cost(2000)).toBe(cost(400))
  })
})

describe('suggestions as one reader is told of them', () => {
  it('tells its own and another’s in one block, each in the text it reads', () => {
    const stored = storedOf(
      'A {--cold--}{>>sabc1<<}{++warm++}{>>sabc1<<} night, {--dark--}{>>sabc2<<}{++bright++}{>>sabc2<<} and long.',
      n => (n === 0 ? CHAT : OTHER)
    )

    const told = suggestionsAsRead(stored, null, CHAT)

    expect(whole(stored, ['sabc1'])).toBe('A warm night, dark and long.')
    expect(told.placed.map(({ thread: _thread, ...rest }) => rest)).toEqual([
      { id: 'sabc1', own: true, from: 'cold', to: 'warm', start: 2, end: 6 },
      { id: 'sabc2', own: false, from: 'dark', to: 'bright', start: 14, end: 18 },
    ])
    expect(told.placed[0].thread).toBe(stored.comments.sabc1)
  })

  it('places one among paragraphs that read alike where it is, not at the first that reads so', () => {
    const alike = 'The tide came in and the tide went out again.'
    const changed = alike.replace('went', '{--went--}{>>sabc1<<}{++crept++}{>>sabc1<<}')
    const stored = storedOf(
      [...Array(5).fill(alike), changed, ...Array(6).fill(alike)].join('\n\n')
    )

    const [told] = suggestionsAsRead(stored, null, CHAT).placed

    // Its words are as much of the text as is there once, and so are there
    // again, a paragraph over: put in where it says, they make the change.
    const text = whole(stored, [])
    expect(text.slice(told.start, told.end)).toBe(told.from)
    expect(text.indexOf(told.from)).toBeLessThan(told.start)
    expect(`${text.slice(0, told.start)}${told.to}${text.slice(told.end)}`).toBe(
      whole(stored, ['sabc1'])
    )
  })

  it('counts where one is in the text with the chat’s names filled in', () => {
    const stored = storedOf(
      '{{char}} had a {--cold--}{>>sabc1<<}{++warm++}{>>sabc1<<} night of it, said {{user}}.'
    )

    const [told] = suggestionsAsRead(stored, { char: 'Ada Marsh', user: 'Ben' }, CHAT).placed

    const read = 'Ada Marsh had a cold night of it, said Ben.'
    expect(told).toMatchObject({ from: 'cold', to: 'warm' })
    expect(read.slice(told.start, told.end)).toBe('cold')
  })
})
