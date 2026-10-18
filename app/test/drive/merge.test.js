import { describe, it, expect } from 'vitest'
import { mergeDocs, settle } from '@/drive/merge.js'
import { parseMarkdown, serializeMarkdown } from '@/editor/markdown.js'
import { tableEdits } from './randomEdits.js'

/** Three markdowns merged. */
const merge = (base, mine, theirs) =>
  mergeDocs(parseMarkdown(base), parseMarkdown(mine), parseMarkdown(theirs))

/** Blocks as markdown. */
const md = blocks =>
  serializeMarkdown(parseMarkdown('x').type.schema.nodes.doc.create(null, blocks)).trim()

/** Three markdowns merged, with nothing clashing, as markdown. */
function merged(base, mine, theirs) {
  const result = merge(base, mine, theirs)
  expect(result.clashes.map(clash => [md(clash.mine), md(clash.theirs)])).toEqual([])
  return serializeMarkdown(settle(result)).trim()
}

/** The same markdown, as the serializer writes it. */
const as = markdown => serializeMarkdown(parseMarkdown(markdown)).trim()

const BASE = [
  '# Monday',
  'Rain came in from the west, and the ferry was late again.',
  'The harbour master wrote down every tide.',
  'She kept to the rail.',
].join('\n\n')

describe('mergeDocs', () => {
  it('takes the side that changed, and either when neither did', () => {
    const mine = BASE.replace('late again', 'late once more')
    const theirs = BASE.replace('every tide', 'every tide and every boat')
    expect(merged(BASE, BASE, BASE)).toBe(as(BASE))
    expect(merged(BASE, mine, BASE)).toBe(as(mine))
    expect(merged(BASE, BASE, theirs)).toBe(as(theirs))
  })

  it('takes both sides’ changes to different paragraphs', () => {
    expect(
      merged(
        BASE,
        BASE.replace('late again', 'late once more'),
        BASE.replace('every tide', 'every tide and every boat')
      )
    ).toBe(
      as(
        BASE.replace('late again', 'late once more').replace(
          'every tide',
          'every tide and every boat'
        )
      )
    )
  })

  it('takes both sides’ changes to different words of one paragraph', () => {
    expect(
      merged(
        BASE,
        BASE.replace('Rain came', 'Heavy rain came'),
        BASE.replace('was late again', 'was late')
      )
    ).toBe(as(BASE.replace('Rain came', 'Heavy rain came').replace('was late again', 'was late')))
  })

  it('takes a change both sides made once', () => {
    const both = BASE.replace('rail', 'railing')
    expect(merged(BASE, both, both)).toBe(as(both))
  })

  it('takes a paragraph parted on one side and a word changed in it on the other', () => {
    expect(
      merged(
        BASE,
        BASE.replace('west, and the', 'west.\n\nThe'),
        BASE.replace('late again', 'late')
      )
    ).toBe(as(BASE.replace('west, and the', 'west.\n\nThe').replace('late again', 'late')))
  })

  it('takes paragraphs put in on each side, both where both put them in at one place', () => {
    expect(
      merged(
        BASE,
        `${BASE}\n\nMine at the end.`,
        BASE.replace('# Monday', '# Monday\n\nTheirs first.')
      )
    ).toBe(as(`${BASE.replace('# Monday', '# Monday\n\nTheirs first.')}\n\nMine at the end.`))
    expect(merged(BASE, `${BASE}\n\nMine at the end.`, `${BASE}\n\nTheirs at the end.`)).toBe(
      as(`${BASE}\n\nTheirs at the end.\n\nMine at the end.`)
    )
  })

  it('takes a paragraph taken out on one side and a word changed elsewhere on the other', () => {
    expect(
      merged(BASE, BASE.replace('She kept to the rail.', ''), BASE.replace('Rain', 'Sleet'))
    ).toBe(as(BASE.replace('She kept to the rail.', '').replace('Rain', 'Sleet')))
  })

  it('makes a heading of a paragraph on one side and changes a word in it on the other', () => {
    expect(
      merged(
        BASE,
        BASE.replace('She kept to the rail.', '## She kept to the rail.'),
        BASE.replace('the rail', 'the stern')
      )
    ).toBe(as(BASE.replace('She kept to the rail.', '## She kept to the stern.')))
  })

  it('merges the words of a heading, a quote, list items and code', () => {
    const base = [
      '## The crossing',
      '> Mind the gap between the boat and the steps.',
      '- Ropes\n- Oars\n- A bailer',
      '```\nlet tide = 4\nlet wind = 2\n```',
    ].join('\n\n')
    const mine = base
      .replace('The crossing', 'The long crossing')
      .replace('Mind the gap', 'Do mind the gap')
      .replace('- Ropes', '- Strong ropes')
      .replace('tide = 4', 'tide = 5')
    const theirs = base
      .replace('crossing', 'crossing over')
      .replace('the steps', 'the stone steps')
      .replace('- A bailer', '- A bailer\n- A lamp')
      .replace('wind = 2', 'wind = 3')
    expect(merged(base, mine, theirs)).toBe(
      as(
        [
          '## The long crossing over',
          '> Do mind the gap between the boat and the stone steps.',
          '- Strong ropes\n- Oars\n- A bailer\n- A lamp',
          '```\nlet tide = 5\nlet wind = 3\n```',
        ].join('\n\n')
      )
    )
  })

  it('takes bold, a link and a picture from either side', () => {
    expect(
      merged(
        BASE,
        BASE.replace('every tide', '**every** tide'),
        BASE.replace(
          'the rail',
          'the [rail](https://example.com/rail) ![](.images/doc_a/image1.png)'
        )
      )
    ).toBe(
      as(
        BASE.replace('every tide', '**every** tide').replace(
          'the rail',
          'the [rail](https://example.com/rail) ![](.images/doc_a/image1.png)'
        )
      )
    )
  })

  it('gives words both changed both ways, each with the rest merged', () => {
    const result = merge(
      BASE,
      BASE.replace('Rain came', 'Heavy rain came').replace('late again', 'late twice'),
      BASE.replace('late again', 'late, as ever').replace('She kept', 'He kept')
    )
    expect(result.clashes).toHaveLength(1)
    const [clash] = result.clashes
    expect(md(clash.base)).toBe('Rain came in from the west, and the ferry was late again.')
    // The Doc's comma is a change of its own, with a space kept between it and
    // the clash, so it goes in both ways.
    expect(md(clash.mine)).toBe('Heavy rain came in from the west, and the ferry was late, twice.')
    expect(md(clash.theirs)).toBe(
      'Heavy rain came in from the west, and the ferry was late, as ever.'
    )
    expect(serializeMarkdown(settle(result, ['theirs'])).trim()).toBe(
      as(
        BASE.replace('Rain came', 'Heavy rain came')
          .replace('late again', 'late, as ever')
          .replace('She kept', 'He kept')
      )
    )
    expect(serializeMarkdown(settle(result)).trim()).toBe(
      as(
        BASE.replace('Rain came', 'Heavy rain came')
          .replace('late again', 'late, twice')
          .replace('She kept', 'He kept')
      )
    )
  })

  it('gives a paragraph taken out on one side and changed on the other both ways', () => {
    const result = merge(
      BASE,
      BASE.replace('She kept to the rail.', ''),
      BASE.replace('the rail', 'the stern')
    )
    expect(result.clashes).toHaveLength(1)
    expect(result.clashes[0].mine).toEqual([])
    expect(md(result.clashes[0].theirs)).toBe('She kept to the stern.')
  })

  it('gives list items both changed both ways, as the list', () => {
    const base = 'Bring:\n\n- Ropes\n- Oars'
    const result = merge(base, base.replace('Oars', 'Two oars'), base.replace('Oars', 'Paddles'))
    expect(result.clashes).toHaveLength(1)
    expect(md(result.clashes[0].mine)).toBe('- Ropes\n- Two oars')
    expect(md(result.clashes[0].theirs)).toBe('- Ropes\n- Paddles')
  })

  describe('tables', () => {
    /** A table as markdown, by its rows. */
    const grid = (...rows) =>
      [
        `| ${rows[0].join(' | ')} |`,
        `| ${rows[0].map(() => '---').join(' | ')} |`,
        ...rows.slice(1).map(row => `| ${row.join(' | ')} |`),
      ].join('\n')
    const LOG = grid(['Day', 'Miles', 'Wind'], ['Mon', '12', 'west'], ['Tue', '9', 'north'])
    const with_ = table => `The log.\n\n${table}\n\nAfter.`
    const base = with_(LOG)

    it('takes words both changed in different cells, and in one cell apart', () => {
      expect(
        merged(
          base,
          with_(grid(['Day', 'Miles', 'Wind'], ['Mon', '14', 'west'], ['Tue', '9', 'north'])),
          with_(grid(['Day', 'Miles', 'Wind'], ['Mon', '12', 'west'], ['Tue', '9', 'north wind']))
        )
      ).toBe(
        as(with_(grid(['Day', 'Miles', 'Wind'], ['Mon', '14', 'west'], ['Tue', '9', 'north wind'])))
      )
    })

    it('takes rows and columns either side put in or took out, and the cells changed', () => {
      expect(
        merged(
          base,
          // A row put in, and a column taken out.
          with_(grid(['Day', 'Miles'], ['Mon', '12'], ['Tue', '9'], ['Wed', '20'])),
          // A column put in, a word changed, and a row taken out.
          with_(grid(['Day', 'Miles', 'Wind', 'Rain'], ['Tue', '9', 'north', 'none']))
        )
      ).toBe(as(with_(grid(['Day', 'Miles', 'Rain'], ['Tue', '9', 'none'], ['Wed', '20', '']))))
    })

    it('takes the columns either side took out', () => {
      // One deleted on each side, and a row on one: the rows stay whole.
      expect(
        merged(
          base,
          with_(grid(['Day', 'Miles'], ['Tue', '9'])),
          with_(grid(['Miles', 'Wind'], ['12', 'west'], ['9', 'north']))
        )
      ).toBe(as(with_(grid(['Miles'], ['9']))))
    })

    it('gives a cell both changed, or a row taken out on one side and changed on the other, both ways', () => {
      const words = merge(
        base,
        with_(grid(['Day', 'Miles', 'Wind'], ['Mon', '14', 'west'], ['Tue', '9', 'north'])),
        with_(grid(['Day', 'Miles', 'Wind'], ['Mon', '15', 'west'], ['Tue', '9', 'north']))
      )
      expect(words.clashes.map(clash => [md(clash.mine), md(clash.theirs)])).toEqual([
        [
          grid(['Day', 'Miles', 'Wind'], ['Mon', '14', 'west'], ['Tue', '9', 'north']),
          grid(['Day', 'Miles', 'Wind'], ['Mon', '15', 'west'], ['Tue', '9', 'north']),
        ],
      ])
      const row = merge(
        base,
        with_(grid(['Day', 'Miles', 'Wind'], ['Tue', '9', 'north'])),
        with_(grid(['Day', 'Miles', 'Wind'], ['Mon', '12', 'west gale'], ['Tue', '10', 'north']))
      )
      expect(row.clashes.map(clash => [md(clash.mine), md(clash.theirs)])).toEqual([
        [
          grid(['Day', 'Miles', 'Wind'], ['Tue', '10', 'north']),
          grid(['Day', 'Miles', 'Wind'], ['Mon', '12', 'west gale'], ['Tue', '10', 'north']),
        ],
      ])
    })
  })

  it('keeps the document’s comments, and puts the Doc’s words inside one in it', () => {
    const base = 'We had a cold and narrow attic, and a stair.'
    const mine = 'We had a {==cold and narrow==}{>>c7k2m1<<} attic, and a stair.'
    expect(merged(base, mine, 'We had a cold and narrow attic, and a steep stair.')).toBe(
      'We had a {==cold and narrow==}{>>c7k2m1<<} attic, and a steep stair.'
    )
    expect(merged(base, mine, 'We had a cold and very narrow attic, and a stair.')).toBe(
      'We had a {==cold and very narrow==}{>>c7k2m1<<} attic, and a stair.'
    )
    // Words the Doc changed at a comment's edge are its own, outside it.
    expect(merged(base, mine, 'We had a warm and narrow attic, and a stair.')).toBe(
      'We had a warm{== and narrow==}{>>c7k2m1<<} attic, and a stair.'
    )
  })

  it('takes a change in a commented paragraph the Doc alone made, the comment kept', () => {
    const base = 'Rain came.\n\nWe had a cold attic.'
    const mine = 'Rain came.\n\nWe had a {==cold==}{>>c1aa<<} attic.'
    expect(merged(base, mine, 'Rain came.\n\nWe had a cold attic and a stair.')).toBe(
      'Rain came.\n\nWe had a {==cold==}{>>c1aa<<} attic and a stair.'
    )
  })

  it('takes a commented paragraph out when the Doc did, a comment no change of the document’s', () => {
    expect(
      merged(
        'Rain came.\n\nWe had a cold attic, and a stair.',
        'Rain came.\n\nWe had a {==cold==}{>>c1aa<<} attic, and a stair.',
        'Rain came.'
      )
    ).toBe('Rain came.')
  })

  it('settles to an empty paragraph when nothing is left', () => {
    expect(serializeMarkdown(settle(merge('Gone.', '', 'Gone.'))).trim()).toBe('')
  })
})

describe('mergeDocs, edited at random', () => {
  /** A seeded generator, so a failure can be run again. */
  const random = seed => {
    let s = seed
    return () => {
      s = (s * 1103515245 + 12345) % 2147483648
      return s / 2147483648
    }
  }
  const WORDS = ['tide', 'rope', 'gull', 'harbour', 'late', 'grey', 'oar', 'salt', 'pier', 'the']

  /** A few words. */
  const words = (next, least = 2) =>
    Array.from(
      { length: least + Math.floor(next() * 8) },
      () => WORDS[Math.floor(next() * WORDS.length)]
    ).join(' ')

  /** A block of some sort, as markdown. */
  function block(next) {
    const sort = next()
    if (sort < 0.55) return words(next, 3)
    if (sort < 0.65) return `## ${words(next)}`
    if (sort < 0.75) return `> ${words(next)}`
    if (sort < 0.85)
      return Array.from({ length: 2 + Math.floor(next() * 3) }, () => `- ${words(next)}`).join('\n')
    if (sort < 0.93) {
      const width = 1 + Math.floor(next() * 3)
      const row = () =>
        `| ${Array.from({ length: width }, () => WORDS[Math.floor(next() * WORDS.length)]).join(' | ')} |`
      return [
        row(),
        `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
        ...Array.from({ length: Math.floor(next() * 4) }, row),
      ].join('\n')
    }
    return `\`\`\`\n${words(next)}\n${words(next)}\n\`\`\``
  }

  const blocks = next => Array.from({ length: 4 + Math.floor(next() * 8) }, () => block(next))

  /** The lines of a block that hold words, and the prefix each keeps. */
  function linesOf(text) {
    const lines = text.split('\n')
    return lines.map((line, i) => {
      if (line.startsWith('```') || line.startsWith('|')) return null
      const prefix = /^(## |> |- )?/.exec(line)[0]
      return { i, prefix, words: line.slice(prefix.length).split(' ').filter(Boolean) }
    })
  }

  const plain = text => /^[a-z]/.test(text)

  /** Blocks edited: words in and out, paragraphs parted, joined, added, taken out, made headings. */
  function edit(list, next, count) {
    const out = [...list]
    for (let k = 0; k < count; k++) {
      const i = Math.floor(next() * out.length)
      const what = Math.floor(next() * 9)
      if (what === 8 || (what <= 1 && out[i].startsWith('|'))) {
        // A table's: the first one's, or one put in.
        tableEdits[Math.floor(next() * tableEdits.length)](out, next)
      } else if (what <= 1) {
        const lines = out[i].split('\n')
        const editable = linesOf(out[i]).filter(Boolean)
        const line = editable[Math.floor(next() * editable.length)]
        if (what === 0 || line.words.length < 2) {
          line.words.splice(
            Math.floor(next() * (line.words.length + 1)),
            0,
            WORDS[Math.floor(next() * WORDS.length)]
          )
        } else {
          line.words.splice(Math.floor(next() * line.words.length), 1)
        }
        lines[line.i] = line.prefix + line.words.join(' ')
        out[i] = lines.join('\n')
      } else if (what === 2 && plain(out[i]) && out[i].split(' ').length > 2) {
        const parts = out[i].split(' ')
        const at = 1 + Math.floor(next() * (parts.length - 1))
        out.splice(i, 1, parts.slice(0, at).join(' '), parts.slice(at).join(' '))
      } else if (what === 3 && i + 1 < out.length && plain(out[i]) && plain(out[i + 1])) {
        out.splice(i, 2, `${out[i]} ${out[i + 1]}`)
      } else if (what === 4) {
        out.splice(i + 1, 0, `a ${WORDS[Math.floor(next() * WORDS.length)]} came in`)
      } else if (what === 5 && out.length > 1) {
        out.splice(i, 1)
      } else if (what === 6 && plain(out[i])) {
        out[i] = `## ${out[i]}`
      } else if (what === 7 && out[i].startsWith('## ')) {
        out[i] = out[i].slice(3)
      }
    }
    return out
  }

  /** Comments put on a few runs of words in plain paragraphs. */
  function commented(list, next) {
    let n = 0
    return list.map(text => {
      if (!plain(text) || next() < 0.5) return text
      const parts = text.split(' ')
      const from = Math.floor(next() * parts.length)
      const to = from + 1 + Math.floor(next() * (parts.length - from))
      return [
        ...parts.slice(0, from),
        `{==${parts.slice(from, to).join(' ')}==}{>>cmt${++n}x<<}`,
        ...parts.slice(to),
      ].join(' ')
    })
  }

  /** Markdown with its comments' markup taken off. */
  const uncommented = markdown => markdown.replace(/\{==|==\}\{>>[^<]*<<\}/g, '')

  const doc = list => list.join('\n\n')

  it('takes both sides’ changes when they are apart', () => {
    const next = random(3)
    for (let round = 0; round < 300; round++) {
      const front = blocks(next)
      const back = blocks(next)
      const fence = 'a fence that neither side touches'
      const mineFront = edit(front, next, 1 + Math.floor(next() * 3))
      const theirsBack = edit(back, next, 1 + Math.floor(next() * 3))
      expect(
        merged(
          doc([...front, fence, ...back]),
          doc([...mineFront, fence, ...back]),
          doc([...front, fence, ...theirsBack])
        ),
        `round ${round}`
      ).toBe(as(doc([...mineFront, fence, ...theirsBack])))
    }
  })

  it('takes both sides’ changes to blocks side by side, with none kept between', () => {
    const next = random(21)
    for (let round = 0; round < 300; round++) {
      const base = blocks(next).filter(plain)
      if (base.length < 2) continue
      const i = Math.floor(next() * (base.length - 1))
      /** One block changed: a word in, or the block taken out. */
      const change = (list, at) => {
        const out = [...list]
        if (next() < 0.4) out.splice(at, 1)
        else out[at] = `${out[at]} ${WORDS[Math.floor(next() * WORDS.length)]}`
        return out
      }
      const [first, second] = next() < 0.5 ? [i, i + 1] : [i + 1, i]
      const mine = change(base, first)
      const theirs = change(base, second)
      // Both made to the base, the later first so the earlier's place holds.
      const both = (() => {
        const out = [...base]
        for (const [at, side] of [
          [first, mine],
          [second, theirs],
        ].sort((a, b) => b[0] - a[0])) {
          const taken = side.length < base.length
          if (taken) out.splice(at, 1)
          else out[at] = side[at]
        }
        return out
      })()
      if (new Set(base).size < base.length) continue
      expect(merged(doc(base), doc(mine), doc(theirs)), `round ${round}`).toBe(as(doc(both)))
    }
  })

  it('takes the one side that changed, or the change both made', () => {
    const next = random(9)
    for (let round = 0; round < 300; round++) {
      const base = blocks(next)
      const changed = edit(base, next, 1 + Math.floor(next() * 4))
      expect(merged(doc(base), doc(base), doc(changed)), `round ${round}`).toBe(as(doc(changed)))
      expect(merged(doc(base), doc(changed), doc(base)), `round ${round}`).toBe(as(doc(changed)))
      expect(merged(doc(base), doc(changed), doc(changed)), `round ${round}`).toBe(as(doc(changed)))
    }
  })

  it('takes whatever the Doc changed around the document’s comments, keeping them', () => {
    const next = random(13)
    for (let round = 0; round < 300; round++) {
      const base = blocks(next)
      const mine = commented(base, next)
      const theirs = edit(base, next, 1 + Math.floor(next() * 4))
      const result = merge(doc(base), doc(mine), doc(theirs))
      expect(result.clashes, `round ${round}`).toEqual([])
      const out = serializeMarkdown(settle(result)).trim()
      expect(uncommented(out), `round ${round}`).toBe(as(doc(theirs)))
      // A comment in a paragraph the Doc left alone is there.
      const once = (list, text) => list.filter(each => each === text).length === 1
      for (const text of mine) {
        const was = uncommented(text)
        if (text === was || !once(base, was) || !once(theirs, was)) continue
        for (const [, id] of text.matchAll(/\{>>([^<]*)<<\}/g)) {
          expect(out, `round ${round}: ${id}`).toContain(`{>>${id}<<}`)
        }
      }
    }
  })

  it('always settles to a document, each way, whatever both did', () => {
    const next = random(5)
    for (let round = 0; round < 300; round++) {
      const base = blocks(next)
      const mine = edit(base, next, 1 + Math.floor(next() * 5))
      const theirs = edit(base, next, 1 + Math.floor(next() * 5))
      const result = merge(doc(base), doc(mine), doc(theirs))
      for (const way of ['mine', 'theirs']) {
        settle(
          result,
          result.clashes.map(() => way)
        ).check()
      }
    }
  })
})
