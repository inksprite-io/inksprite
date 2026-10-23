import { describe, it, expect } from 'vitest'
import { Transform } from 'prosemirror-transform'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import { parseMarkdown, serializeMarkdown } from '../../src/editor/markdown.js'
import { schema } from '../../src/editor/schema.js'
import {
  acceptSuggestion,
  changeOf,
  piecesOf,
  rejectSuggestion,
  seeing,
  suggestChange,
  suggestionAround,
  suggestionEntries,
  suggestionOf,
  suggestionRanges,
  suggestionsIn,
} from '../../src/editor/suggestions.js'
import { anyEdit, plain, random } from '../drive/randomEdits.js'

const ID = 'sab12c'

/** New ids in turn, for the changes after the first. */
const ids = () => {
  let n = 0
  return () => `sn${String(++n).padStart(4, '0')}`
}

/** The change from one piece of markdown to another, suggested, as markdown. */
const suggested = (before, after) => {
  const made = suggestChange(parseMarkdown(before), parseMarkdown(after), ID, [], ids())
  return made && serializeMarkdown(made.doc)
}

/** Each of some suggestions settled one way. */
const acceptAll = (doc, list) => list.reduce((each, id) => acceptSuggestion(each, id), doc)
const rejectAll = (doc, list) => list.reduce((each, id) => rejectSuggestion(each, id), doc)

const accepted = markdown => serializeMarkdown(acceptSuggestion(parseMarkdown(markdown), ID))
const rejected = markdown => serializeMarkdown(rejectSuggestion(parseMarkdown(markdown), ID))

/** A document's markdown with its comments taken off. */
const uncommented = doc => {
  const tr = new Transform(doc)
  tr.removeMark(0, doc.content.size, schema.marks.comment)
  return serializeMarkdown(tr.doc)
}

describe('the markup', () => {
  it('reads and writes both halves with the id', () => {
    const markdown = 'We had a {--cold--}{>>s4k2m1<<}{++narrow++}{>>s4k2m1<<} attic.'
    const doc = parseMarkdown(markdown)
    expect(suggestionsIn(doc)).toEqual(['s4k2m1'])
    expect(serializeMarkdown(doc)).toBe(markdown)
  })

  it('keeps the passage’s own marks inside it', () => {
    const markdown = 'It was {++**very**++}{>>s4k2m1<<} late.'
    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown)
  })

  it('reads a half without its other as the text it was', () => {
    expect(parseMarkdown('A {++loose half.').textContent).toBe('A {++loose half.')
    expect(parseMarkdown('A loose++}{>>s4k2m1<<} half.').textContent).toBe(
      'A loose++}{>>s4k2m1<<} half.'
    )
  })

  it('sits inside a comment, and a comment inside it in pieces', () => {
    const inside = 'A {==dark {--cold--}{>>s4k2m1<<} night==}{>>c7k2m1<<}.'
    expect(serializeMarkdown(parseMarkdown(inside))).toBe(inside)
    // The comment ranks outermost, so a suggestion around one is written in
    // pieces around it.
    const around = parseMarkdown('A {++dark {==cold==}{>>c7k2m1<<} night++}{>>s4k2m1<<}.')
    const written = serializeMarkdown(around)
    expect(written).toBe(
      'A {++dark ++}{>>s4k2m1<<}{=={++cold++}{>>s4k2m1<<}==}{>>c7k2m1<<}{++ night++}{>>s4k2m1<<}.'
    )
    expect(parseMarkdown(written).eq(around)).toBe(true)
  })
})

describe('suggestChange', () => {
  it('changes words in a paragraph, a phrase as one change', () => {
    expect(suggested('The quick brown fox jumps.', 'The slow grey fox jumps.')).toBe(
      `The {--quick brown--}{>>${ID}<<}{++slow grey++}{>>${ID}<<} fox jumps.`
    )
  })

  it('makes each change a suggestion of its own', () => {
    const made = suggestChange(
      parseMarkdown('The thief slipped quietly through the window, its latch broken.'),
      parseMarkdown('The thief slipped through the window, the latch broken.'),
      ID,
      [],
      ids()
    )
    expect(serializeMarkdown(made.doc)).toBe(
      `The thief slipped {--quietly --}{>>${ID}<<}through the window, {--its--}{>>sn0001<<}{++the++}{>>sn0001<<} latch broken.`
    )
    expect(made.ids).toEqual([ID, 'sn0001'])
  })

  it('changes a long text changed throughout paragraph by paragraph', () => {
    const paragraphs = word =>
      Array.from({ length: 300 }, (_, i) => `Night ${i} fell on the ${word} street.`).join('\n\n')
    const made = suggested(paragraphs('wet'), paragraphs('dry'))
    expect(made.split('\n\n')[250]).toMatch(
      /^Night 250 fell on the \{--wet--\}\{>>s\w+<<\}\{\+\+dry\+\+\}\{>>s\w+<<\} street\.$/
    )
  })

  it('keeps changes a word or two apart in a sentence one, and parts them at its end', () => {
    expect(
      suggested(
        'She turned to the shop itself, its shadows deep. It was dark.',
        'The shop was cluttered, its shadows still. It was dark.'
      )
    ).toBe(
      `{--She turned to the --}{>>${ID}<<}{++The ++}{>>${ID}<<}shop {--itself--}{>>${ID}<<}{++was cluttered++}{>>${ID}<<}, its shadows {--deep--}{>>${ID}<<}{++still++}{>>${ID}<<}. It was dark.`
    )
    expect(suggested('A cold wet night. Rain fell.', 'A night. Snow fell.')).toBe(
      `A {--cold wet --}{>>${ID}<<}night. {--Rain--}{>>sn0001<<}{++Snow++}{>>sn0001<<} fell.`
    )
  })

  it('keeps a paragraph parted or joined one change, and one put in beside another apart', () => {
    expect(
      suggested(
        'The tide came in and the gulls went quiet.',
        'The tide came in.\n\nThe gulls went quiet.'
      )
    ).not.toContain('sn0001')
    expect(
      suggested(
        'The tide came in.\n\nThe gulls went quiet.',
        'The tide came in and the gulls went quiet.'
      )
    ).not.toContain('sn0001')
    expect(
      suggested('The tide came in.\n\nRain.', 'The tide went out.\n\nThe gulls flew.\n\nRain.')
    ).toBe(
      `The tide {--came in--}{>>${ID}<<}{++went out++}{>>${ID}<<}.\n\n{++The gulls flew.++}{>>sn0001<<}\n\nRain.`
    )
  })

  it('puts a paragraph in, and takes one out, whole', () => {
    expect(suggested('One.\n\nTwo.', 'One.\n\nA new one.\n\nTwo.')).toBe(
      `One.\n\n{++A new one.++}{>>${ID}<<}\n\nTwo.`
    )
    expect(suggested('One.\n\nTwo.\n\nThree.', 'One.\n\nThree.')).toBe(
      `One.\n\n{--Two.--}{>>${ID}<<}\n\nThree.`
    )
  })

  it('parts a paragraph as its end taken out and a paragraph put in', () => {
    expect(
      suggested(
        'The tide came in and the gulls went quiet.',
        'The tide came in.\n\nThe gulls went quiet.'
      )
    ).toBe(
      `The tide came in{-- and the gulls went quiet--}{>>${ID}<<}.\n\n{++The gulls went quiet.++}{>>${ID}<<}`
    )
  })

  it('changes a heading’s level as the one out and the other in', () => {
    expect(suggested('# Monday\n\nRain.', '## Monday\n\nRain.')).toBe(
      `# {--Monday--}{>>${ID}<<}\n\n## {++Monday++}{>>${ID}<<}\n\nRain.`
    )
  })

  it('changes a list item by item, and a table cell by cell', () => {
    expect(suggested('- rope\n- oar', '- rope\n- salt\n- oar')).toBe(
      `- rope\n- {++salt++}{>>${ID}<<}\n- oar`
    )
    expect(
      suggested('| a | b |\n| --- | --- |\n| c | d |', '| a | b |\n| --- | --- |\n| c | e |')
    ).toBe(`| a | b |\n| --- | --- |\n| c | {--d--}{>>${ID}<<}{++e++}{>>${ID}<<} |`)
  })

  it('makes a list taken out and one put in one list', () => {
    const markdown = suggested('Rain.\n\n- rope\n- oar', 'Rain.\n\n- gull\n- pier')
    expect(markdown).toBe(
      `Rain.\n\n- {--rope--}{>>${ID}<<}\n- {--oar--}{>>${ID}<<}\n- {++gull++}{>>${ID}<<}\n- {++pier++}{>>${ID}<<}`
    )
    expect(accepted(markdown)).toBe('Rain.\n\n- gull\n- pier')
    expect(rejected(markdown)).toBe('Rain.\n\n- rope\n- oar')
  })

  it('keeps the comments of what it keeps', () => {
    expect(
      suggested('A {==commented passage==}{>>c7k2m1<<} here.', 'A commented passage changed here.')
    ).toBe(`A {==commented passage==}{>>c7k2m1<<} {++changed ++}{>>${ID}<<}here.`)
  })

  it('puts words in inside a comment into the comment', () => {
    expect(suggested('A {==dark night==}{>>c7k2m1<<}.', 'A dark and stormy night.')).toBe(
      `A {==dark {++and stormy ++}{>>${ID}<<}night==}{>>c7k2m1<<}.`
    )
  })

  it('marks a block with no words to mark whole', () => {
    expect(suggested('One.\n\nTwo.', 'One.\n\n---\n\nTwo.')).toBe(
      `One.\n\n{++\n---\n++}{>>${ID}<<}\n\nTwo.`
    )
    expect(suggested('Rain.\n\n```\nx = 1\n```', 'Rain.\n\n```\nx = 2\n```')).toBe(
      `Rain.\n\n{--\n\`\`\`\nx = 1\n\`\`\`\n--}{>>${ID}<<}\n\n{++\n\`\`\`\nx = 2\n\`\`\`\n++}{>>${ID}<<}`
    )
    expect(suggested('- rope\n-\n- oar', '- rope\n- salt\n- oar')).toBe(
      `- rope\n- {--\n  --}{>>${ID}<<}\n- {++salt++}{>>${ID}<<}\n- oar`
    )
  })

  it('takes a table out and puts one in when its rows or columns change', () => {
    const table = '| a | b |\n| --- | --- |\n| c | d |'
    const markdown = suggested(table, `${table}\n| e | f |`)
    expect(markdown).toBe(
      `{--\n${table}\n--}{>>${ID}<<}\n\n{++\n${table}\n| e | f |\n++}{>>${ID}<<}`
    )
    expect(accepted(markdown)).toBe(`${table}\n| e | f |`)
    expect(rejected(markdown)).toBe(table)
  })

  it('reads and writes a whole block in a quote and in a list', () => {
    for (const markdown of [
      `> Rain.\n>\n> {--\n> ---\n> --}{>>${ID}<<}`,
      `- Rain.\n\n  {++\n  \`\`\`\n  x\n  \`\`\`\n  ++}{>>${ID}<<}`,
    ]) {
      expect(suggestionsIn(parseMarkdown(markdown))).toEqual([ID])
      expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown)
    }
    expect(accepted(`> Rain.\n>\n> {--\n> ---\n> --}{>>${ID}<<}`)).toBe('> Rain.')
  })

  it('makes a change beside a pending one, to the text as it stands', () => {
    // As it stands, the pending one's words are not in it.
    const pending = 'A {++new ++}{>>s9zzzz<<}word.'
    const markdown = suggested(pending, 'A word, said twice.')
    expect(markdown).toBe(`A {++new ++}{>>s9zzzz<<}word{++, said twice++}{>>${ID}<<}.`)
    expect(rejected(markdown)).toBe(pending)
    const both = acceptSuggestion(acceptSuggestion(parseMarkdown(markdown), ID), 's9zzzz')
    expect(serializeMarkdown(both)).toBe('A new word, said twice.')
  })

  it('leaves what a pending one takes out its own', () => {
    const pending = suggested('A cold night, and rain.', 'A night, and rain.').replaceAll(
      ID,
      's9zzzz'
    )
    expect(pending).toBe('A {--cold --}{>>s9zzzz<<}night, and rain.')
    const markdown = suggested(pending, 'A cold night, and snow.')
    expect(markdown).toBe(
      `A {--cold --}{>>s9zzzz<<}night, and {--rain--}{>>${ID}<<}{++snow++}{>>${ID}<<}.`
    )
    expect(rejected(markdown)).toBe(pending)
    // Taking out again what it takes out is no change of its own.
    expect(suggested(pending, 'A night, and rain.')).toBe(pending)
  })

  it('puts a change after blocks a pending one puts in, in a document of nothing else', () => {
    const pending = '{++All new.++}{>>s9zzzz<<}'
    const markdown = suggested(pending, 'More.')
    expect(markdown).toBe(`${pending}\n\n{++More.++}{>>${ID}<<}`)
    expect(rejected(markdown)).toBe(pending)
  })
})

describe('a change over the model’s own pending suggestions', () => {
  const MINE = 's9mine'

  /** The change from the text the model saw, its own accepted, as markdown. */
  const over = (pending, after, own = [MINE]) => {
    const made = suggestChange(parseMarkdown(pending), parseMarkdown(after), ID, own, ids())
    return made && { markdown: serializeMarkdown(made.doc), into: made.into }
  }

  /** A pending suggestion of the model's own. */
  const mine = (before, after) => suggested(before, after).replaceAll(ID, MINE)

  it('folds words changed again into the one that changed them', () => {
    expect(over(mine('A cold night.', 'A warm night.'), 'A chilly night.')).toEqual({
      markdown: `A {--cold--}{>>${MINE}<<}{++chilly++}{>>${MINE}<<} night.`,
      into: {},
    })
  })

  it('takes a table or code changed twice out once, and puts the last in', () => {
    const table = '| a | b |\n| --- | --- |\n| c | d |'
    expect(over(mine(table, `${table}\n| e | f |`), `${table}\n| e | g |`).markdown).toBe(
      `{--\n${table}\n--}{>>${MINE}<<}\n\n{++\n${table}\n| e | g |\n++}{>>${MINE}<<}`
    )
    const code = '```\nx = 1\n```'
    expect(over(mine(code, '```\nx = 2\n```'), '```\nx = 3\n```').markdown).toBe(
      `{--\n${code}\n--}{>>${MINE}<<}\n\n{++\n\`\`\`\nx = 3\n\`\`\`\n++}{>>${MINE}<<}`
    )
  })

  it('makes a change apart from them its own, and leaves them as they were', () => {
    const pending = mine('A cold night.\n\nThe tide came in.', 'A warm night.\n\nThe tide came in.')
    expect(over(pending, 'A warm night.\n\nThe tide went out.')).toEqual({
      markdown: `A {--cold--}{>>${MINE}<<}{++warm++}{>>${MINE}<<} night.\n\nThe tide {--came in--}{>>${ID}<<}{++went out++}{>>${ID}<<}.`,
      into: {},
    })
    expect(over(pending, 'A warm night.\n\nThe tide came in.').markdown).toBe(pending)
  })

  it('puts changes a word or two from one, in its sentence, into it', () => {
    const pending = mine('A cold night, and the sea calm.', 'A warm night, and the sea calm.')
    expect(over(pending, 'A chilly night; the sea rough.')).toEqual({
      markdown: `A {--cold--}{>>${MINE}<<}{++chilly++}{>>${MINE}<<} night{--, and --}{>>${MINE}<<}{++; ++}{>>${MINE}<<}the sea {--calm--}{>>${MINE}<<}{++rough++}{>>${MINE}<<}.`,
      into: {},
    })
  })

  it('makes a change elsewhere in a paragraph one changed its own', () => {
    const pending = mine(
      'The tide came in and the gulls were quiet.',
      'The tide went out and the gulls were quiet.'
    )
    expect(over(pending, 'The tide went out and the gulls were still.').markdown).toBe(
      `The tide {--came in--}{>>${MINE}<<}{++went out++}{>>${MINE}<<} and the gulls were {--quiet--}{>>${ID}<<}{++still++}{>>${ID}<<}.`
    )
  })

  it('leaves a change beside a paragraph it put in apart from it', () => {
    const pending = mine('The tide came in.', 'The tide came in.\n\nThe gulls flew.')
    expect(over(pending, 'The tide went out.\n\nThe gulls flew.').markdown).toBe(
      `The tide {--came in--}{>>${ID}<<}{++went out++}{>>${ID}<<}.\n\n{++The gulls flew.++}{>>${MINE}<<}`
    )
  })

  it('keeps a paragraph parted in two whole under the one it touches', () => {
    const pending = mine(
      'The tide came in and the gulls went quiet.',
      'The tide came in and the gulls flew.'
    )
    const { markdown } = over(pending, 'The tide came in.\n\nThe gulls flew.')
    expect(markdown).toBe(
      `The tide came in{-- and the gulls went quiet--}{>>${MINE}<<}.\n\n{++The gulls flew.++}{>>${MINE}<<}`
    )
  })

  it('joins two it bridges under the older', () => {
    const pending = `The {--cold--}{>>${MINE}<<}{++warm++}{>>${MINE}<<} wet {--night--}{>>s9late<<}{++day++}{>>s9late<<} came on.`
    expect(over(pending, 'The warm dry day came on.', [MINE, 's9late'])).toEqual({
      markdown: `The {--cold wet night--}{>>${MINE}<<}{++warm dry day++}{>>${MINE}<<} came on.`,
      into: { s9late: MINE },
    })
  })

  it('takes back one its change undoes', () => {
    expect(over(mine('A cold night.', 'A warm night.'), 'A cold night.')).toEqual({
      markdown: 'A cold night.',
      into: {},
    })
  })

  it('sees another’s pending one as it stands, and leaves it its own', () => {
    const pending = `A {--cold--}{>>s9zzzz<<}{++warm++}{>>s9zzzz<<} night, {++and ++}{>>${MINE}<<}rain.`
    const { markdown } = over(pending, 'A cold night, and snow.')
    expect(rejected(markdown.replaceAll(MINE, ID))).toBe(
      'A {--cold--}{>>s9zzzz<<}{++warm++}{>>s9zzzz<<} night, rain.'
    )
    expect(markdown).not.toContain(ID)
    expect(
      serializeMarkdown(acceptSuggestion(rejectSuggestion(parseMarkdown(markdown), 's9zzzz'), MINE))
    ).toBe('A cold night, and snow.')
  })
})

describe('where suggestions are', () => {
  const markdown = `A {--cold--}{>>${ID}<<}{++**warm** and dry++}{>>${ID}<<} night.\n\n{++\n---\n++}{>>s2bbbb<<}`

  it('gives the runs of each half, the pieces of one joined, and a block whole', () => {
    const doc = parseMarkdown(markdown)
    const ranges = suggestionRanges(doc)
    expect(ranges.map(({ id, kind, block }) => [id, kind, block])).toEqual([
      [ID, 'deletion', false],
      [ID, 'insertion', false],
      ['s2bbbb', 'insertion', true],
    ])
    expect(doc.textBetween(ranges[1].from, ranges[1].to)).toBe('warm and dry')
    expect(doc.nodeAt(ranges[2].from).type.name).toBe('horizontal_rule')
  })

  it('finds the one at a place, on words or around a block', () => {
    const doc = parseMarkdown(
      `{--\n\`\`\`\nx = 1\n\`\`\`\n--}{>>s2bbbb<<}\n\nA {++warm++}{>>${ID}<<} night.`
    )
    const inWords = doc.content.size - ' night.'.length - 2
    expect(suggestionAround(doc.resolve(inWords))).toBe(ID)
    expect(suggestionAround(doc.resolve(3))).toBe('s2bbbb')
    expect(suggestionAround(doc.resolve(doc.content.size - 2))).toBeNull()
  })

  it('finds the one a selection is on: the caret in it, or the only one it touches', () => {
    const doc = parseMarkdown(
      `A {--cold--}{>>${ID}<<}{++warm++}{>>${ID}<<} night, {++very ++}{>>s2bbbb<<}dark.\n\n{++\n---\n++}{>>s3cccc<<}`
    )
    const text = doc.firstChild?.textContent ?? ''
    /** A place in the first paragraph, by where in its text it is. */
    const at = (/** @type {string} */ words) => 1 + text.indexOf(words)
    const of = (/** @type {number} */ from, to = from) =>
      suggestionOf(TextSelection.create(doc, from, to))

    expect(of(at('old'))).toBe(ID)
    expect(of(at(' night'))).toBeNull()
    expect(of(at('arm'), at(' night,') + 3)).toBe(ID)
    // From one to the other, or around the words between halves of one.
    expect(of(at('old'), at('ery'))).toBeNull()
    expect(of(at('night'), at('dark'))).toBe('s2bbbb')
    expect(of(at('A'), at(' night'))).toBe(ID)
    const rule = doc.content.size - doc.lastChild.nodeSize
    expect(suggestionOf(NodeSelection.create(doc, rule))).toBe('s3cccc')
  })

  it('lists each once, where it starts, with what it changes', () => {
    const doc = parseMarkdown(markdown)
    expect(suggestionEntries(doc)).toEqual([
      { id: ID, from: 3, change: { out: 'cold', in: 'warm and dry' } },
      { id: 's2bbbb', from: expect.any(Number), change: { out: '', in: '---' } },
    ])
    expect(changeOf(doc, 'snone1')).toEqual({ out: '', in: '' })
  })

  it('gives what one changes piece by piece', () => {
    const doc = parseMarkdown(
      'The {--old--}{>>s1aaaa<<}{++new++}{>>s1aaaa<<} ferry and the {--slow--}{>>s1aaaa<<} boat.'
    )
    expect(piecesOf(doc, 's1aaaa')).toEqual({ out: ['old', 'slow'], in: ['new'] })
    expect(changeOf(doc, 's1aaaa')).toEqual({ out: 'old … slow', in: 'new' })
    expect(piecesOf(doc, 'snone1')).toEqual({ out: [], in: [] })
  })

  it('shows the text as one reader sees it', () => {
    const doc = parseMarkdown(markdown)
    expect(serializeMarkdown(seeing(doc, [ID]).doc)).toBe('A **warm** and dry night.')
    expect(serializeMarkdown(seeing(doc, ['s2bbbb']).doc)).toBe('A cold night.\n\n---')
  })
})

describe('accepting and rejecting', () => {
  it('settles one suggestion and leaves the others', () => {
    const markdown =
      'A {--cold--}{>>s1aaaa<<}{++narrow++}{>>s1aaaa<<} attic, {--dark--}{>>s2bbbb<<}.'
    expect(serializeMarkdown(acceptSuggestion(parseMarkdown(markdown), 's1aaaa'))).toBe(
      'A narrow attic, {--dark--}{>>s2bbbb<<}.'
    )
    expect(serializeMarkdown(rejectSuggestion(parseMarkdown(markdown), 's1aaaa'))).toBe(
      'A cold attic, {--dark--}{>>s2bbbb<<}.'
    )
  })

  it('takes a list item out with its words, and the list with its last item', () => {
    const markdown = `One.\n\n- {++salt++}{>>${ID}<<}\n- {++oar++}{>>${ID}<<}\n\nTwo.`
    expect(rejected(markdown)).toBe('One.\n\nTwo.')
    expect(accepted(markdown)).toBe('One.\n\n- salt\n- oar\n\nTwo.')
  })

  it('leaves an empty document one empty paragraph', () => {
    expect(rejected(`{++All of it.++}{>>${ID}<<}`)).toBe('')
  })
})

/** A document with a little of everything a suggestion meets. */
const SAMPLE = [
  '# Harbour notes',
  'Rain from the west, **hard**, then *dry*. Ask [Ada](https://example.com) about it.',
  'The ferry was late again and {==nobody minded==}{>>c7k2m1<<} much.',
  '- Ropes\n- Oars',
  '> Mind the gap.',
  '## Tuesday',
  '| Day | Miles |\n| --- | --- |\n| Mon | 12 |',
  '1. First thing\n2. Second thing',
  '```\ncode stays\n```',
  '---',
  'Last words of the day.',
].join('\n\n')

const WORDS = ['tide', 'rope', 'gull', 'salt']

/** Edits to the blocks with no words to mark: code changed, code and rules in and out. */
const blockEdits = [
  (blocks, next) => {
    const i = blocks.findIndex(block => block.startsWith('```'))
    if (i >= 0) blocks[i] = `\`\`\`\n${WORDS[Math.floor(next() * WORDS.length)]} = 1\n\`\`\``
  },
  (blocks, next) => {
    const at = blocks.flatMap((block, i) => (/^(```|---)/.test(block) ? [i] : []))
    if (at.length) blocks.splice(at[Math.floor(next() * at.length)], 1)
  },
  (blocks, next) => blocks.splice(Math.floor(next() * (blocks.length + 1)), 0, '---'),
  (blocks, next) =>
    blocks.splice(Math.floor(next() * (blocks.length + 1)), 0, '```\nnew code\n```'),
]

/** The sample with one to four edits made to it, at random. */
const edited = (markdown, next) => {
  const blocks = markdown.split('\n\n')
  const pick = list => {
    const choices = list.map((block, i) => (plain(block) ? i : -1)).filter(i => i >= 0)
    return choices.length ? choices[Math.floor(next() * choices.length)] : -1
  }
  const count = 1 + Math.floor(next() * 4)
  for (let k = 0; k < count; k++) {
    if (next() < 0.2) blockEdits[Math.floor(next() * blockEdits.length)](blocks, next)
    else anyEdit(blocks, pick, next)
  }
  return blocks.join('\n\n')
}

// A second or so each alone, and several times that beside the rest of the
// tests, past the default five.
describe('suggestChange, edited at random', { timeout: 30_000 }, () => {
  /** Each way to settle two sets of suggestions, in the order given. */
  const settles = [
    [acceptAll, acceptAll],
    [acceptAll, rejectAll],
    [rejectAll, acceptAll],
    [rejectAll, rejectAll],
  ]

  it('accepted reads as the edit, rejected as before, and both ways from the file', () => {
    const next = random(23)
    const fresh = ids()
    const before = parseMarkdown(SAMPLE)
    for (let round = 0; round < 400; round++) {
      const markdown = edited(SAMPLE, next)
      const after = parseMarkdown(markdown)
      const made = suggestChange(before, after, ID, [], fresh)
      const label = `round ${round}:\n${markdown}`
      expect(made, label).not.toBeNull()
      // A suggestion for each change, the first of them `ID`, and no other.
      expect(suggestionsIn(made.doc).sort(), label).toEqual([...made.ids].sort())
      if (made.ids.length) expect(made.ids[0], label).toBe(ID)
      const written = serializeMarkdown(made.doc)
      const read = parseMarkdown(written)
      expect(serializeMarkdown(read), label).toBe(written)
      // Some accepted and the rest rejected reads back as itself.
      const some = made.ids.filter(() => next() < 0.5)
      const others = made.ids.filter(id => !some.includes(id))
      const mixed = []
      for (const each of [made.doc, read]) {
        expect(serializeMarkdown(rejectAll(each, made.ids)), label).toBe(serializeMarkdown(before))
        expect(uncommented(acceptAll(each, made.ids)), label).toBe(uncommented(after))
        mixed.push(serializeMarkdown(rejectAll(acceptAll(each, some), others)))
      }
      expect(mixed[1], label).toBe(mixed[0])
      expect(serializeMarkdown(parseMarkdown(mixed[0])), label).toBe(mixed[0])
    }
  })

  it('makes a change over a pending one, and each settles in either order', () => {
    const next = random(41)
    const fresh = ids()
    const before = parseMarkdown(SAMPLE)
    for (let round = 0; round < 400; round++) {
      const first = suggestChange(before, parseMarkdown(edited(SAMPLE, next)), 'sfirst', [], fresh)
      const pending = first.doc
      // Made to the text as it stands, which is the sample.
      const markdown = edited(SAMPLE, next)
      const made = suggestChange(pending, parseMarkdown(markdown), ID, [], fresh)
      const label = `round ${round}:\n${serializeMarkdown(pending)}\n\n=>\n\n${markdown}`
      expect(made, label).not.toBeNull()
      const written = serializeMarkdown(made.doc)
      const read = parseMarkdown(written)
      expect(serializeMarkdown(read), label).toBe(written)
      for (const each of [made.doc, read]) {
        expect(serializeMarkdown(rejectAll(each, made.ids)), label).toBe(serializeMarkdown(pending))
        const neither = rejectAll(rejectAll(each, first.ids), made.ids)
        expect(serializeMarkdown(neither), label).toBe(serializeMarkdown(before))
        for (const [one, other] of settles) {
          expect(serializeMarkdown(other(one(each, first.ids), made.ids)), label).toBe(
            serializeMarkdown(one(other(each, made.ids), first.ids))
          )
        }
      }
    }
  })

  it('makes a change over its own pending ones, seen accepted, that accepted reads as the change', () => {
    const next = random(57)
    const fresh = ids()
    const before = parseMarkdown(SAMPLE)
    for (let round = 0; round < 400; round++) {
      const first = suggestChange(before, parseMarkdown(edited(SAMPLE, next)), 'sfirst', [], fresh)
      const pending = first.doc
      const seen = serializeMarkdown(acceptAll(pending, first.ids))
      const markdown = edited(seen, next)
      const label = `round ${round}:\n${serializeMarkdown(pending)}\n\n=>\n\n${markdown}`
      // Unchanged, it is as it was.
      const unchanged = suggestChange(pending, parseMarkdown(seen), ID, first.ids, fresh)
      expect(unchanged?.doc.eq(pending), label).toBe(true)
      expect(unchanged.ids, label).toEqual([])
      const made = suggestChange(pending, parseMarkdown(markdown), ID, first.ids, fresh)
      expect(made, label).not.toBeNull()
      // Those joined went into older ones of its own.
      for (const [from, to] of Object.entries(made.into)) {
        expect(first.ids.indexOf(to), label).toBeLessThan(first.ids.indexOf(from))
        expect(first.ids.indexOf(to), label).toBeGreaterThanOrEqual(0)
      }
      const all = [...first.ids, ...made.ids]
      const written = serializeMarkdown(made.doc)
      const read = parseMarkdown(written)
      expect(serializeMarkdown(read), label).toBe(written)
      for (const each of [made.doc, read]) {
        expect(uncommented(acceptAll(each, all)), label).toBe(uncommented(parseMarkdown(markdown)))
        expect(serializeMarkdown(rejectAll(each, all)), label).toBe(serializeMarkdown(before))
      }
    }
  })

  it('makes a change over its own pending ones beside another’s, which stays its own', () => {
    const next = random(59)
    const fresh = ids()
    const before = parseMarkdown(SAMPLE)
    for (let round = 0; round < 400; round++) {
      const theirs = suggestChange(before, parseMarkdown(edited(SAMPLE, next)), 'sother', [], fresh)
      const first = suggestChange(
        theirs.doc,
        parseMarkdown(edited(SAMPLE, next)),
        'sfirst',
        [],
        fresh
      )
      const pending = first.doc
      const seen = serializeMarkdown(rejectAll(acceptAll(pending, first.ids), theirs.ids))
      const markdown = edited(seen, next)
      const label = `round ${round}:\n${serializeMarkdown(pending)}\n\n=>\n\n${markdown}`
      const made = suggestChange(pending, parseMarkdown(markdown), ID, first.ids, fresh)
      expect(made, label).not.toBeNull()
      const mine = [...first.ids, ...made.ids]
      const written = serializeMarkdown(made.doc)
      const read = parseMarkdown(written)
      expect(serializeMarkdown(read), label).toBe(written)
      for (const each of [made.doc, read]) {
        expect(serializeMarkdown(rejectAll(each, mine)), label).toBe(serializeMarkdown(theirs.doc))
        // Another's and the model's settle alike in either order.
        for (const [theirsWay, mineWay] of settles) {
          const mineThen = theirsWay(mineWay(each, mine), theirs.ids)
          const theirsThen = mineWay(theirsWay(each, theirs.ids), mine)
          expect(serializeMarkdown(mineThen), label).toBe(serializeMarkdown(theirsThen))
        }
      }
    }
  })
})
