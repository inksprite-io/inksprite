import { describe, it, expect, vi } from 'vitest'
import {
  addUsage,
  assemble,
  checkConversion,
  conversionMessages,
  convertRequest,
  fixHeadings,
  headingMatch,
  joinConverted,
  withoutRepeats,
  splitRequest,
  unfence,
  wordCount,
} from '@/jobs/convert.js'
import { planRequests, unitsOf } from '@/jobs/sections.js'

const heading = (title, level) => ({ title, level, line: 0, consumed: 1 })

/** A line of body text. */
const line = (text, page = 1) => ({ text, page, size: 8 })

/** Sentences enough to count: `n` of them, each numbered. */
const prose = (n, tag = 'word') =>
  Array.from({ length: n }, (_, at) => `The ${tag} sentence number ${at} says something here.`)

describe('putting headings right', () => {
  const given = [heading('Combat', 2), heading('Grappling', 3)]

  it('writes each given heading back exactly, whatever level or wording the model used', () => {
    const answer = ['# combat', 'Swing.', '**Grappling:**', 'Hold.'].join('\n')
    const { markdown, missing } = fixHeadings(answer, given, 6)
    expect(markdown).toBe(['## Combat', 'Swing.', '### Grappling', 'Hold.'].join('\n'))
    expect(missing).toEqual([])
  })

  it('makes every heading the model added a bold line, as a conversion asks', () => {
    const answer = ['## Combat', '#### Weapons', '## Stray', '### Grappling', '#### Holds'].join(
      '\n'
    )
    const { markdown } = fixHeadings(answer, given, 6)
    expect(markdown.split('\n')).toEqual([
      '## Combat',
      '**Weapons**',
      '**Stray**',
      '### Grappling',
      '**Holds**',
    ])
  })

  it('keeps an added heading below the one it falls under when the floor allows it', () => {
    const answer = [
      '## Combat',
      '#### Weapons',
      '## Stray',
      '### Grappling',
      '#### Holds',
      '### Also stray',
    ].join('\n')
    const { markdown } = fixHeadings(answer, given, 2)
    expect(markdown.split('\n')).toEqual([
      '## Combat',
      '#### Weapons',
      '**Stray**',
      '### Grappling',
      '#### Holds',
      '**Also stray**',
    ])
  })

  it('allows added headings only below the section a continued part belongs to', () => {
    const { markdown } = fixHeadings('### Deeper\n## Level\ntext', [], 2)
    expect(markdown).toBe('### Deeper\n**Level**\ntext')
    expect(fixHeadings('# Title page\ntext', [], 6).markdown).toBe('**Title page**\ntext')
  })

  it("takes a heading whose letters the model put right, in the model's wording", () => {
    const misread = [heading('The Case for Evening Rou8nes', 1), heading('Elf', 2)]
    const { markdown, missing } = fixHeadings(
      '## The Case for Evening Routines\ntext\n## Elk\nmore',
      misread,
      6
    )
    expect(markdown.split('\n')[0]).toBe('# The Case for Evening Routines')
    // Short headings must match exactly: Elk is not Elf.
    expect(missing.map(one => one.title)).toEqual(['Elf'])
    expect(headingMatch('Evening Routines', 'Evening Rou8nes')).toBe('near')
    expect(headingMatch('Combat', 'combat')).toBe('same')
    expect(headingMatch('Magic Items', 'Magic Spells')).toBeNull()
  })

  it('writes back both of a group and its only entry, named alike, when the model wrote one', () => {
    const twins = [
      heading('Clockwork Hound', 3),
      heading('Clockwork Hound', 4),
      heading('Actions', 5),
    ]
    const { markdown, missing } = fixHeadings(
      '### Clockwork Hound\nBig.\n##### Actions\nHit.',
      twins,
      6,
      [true, false, false]
    )
    expect(markdown).toBe('### Clockwork Hound\n\n#### Clockwork Hound\nBig.\n##### Actions\nHit.')
    expect(missing).toEqual([])
  })

  it('leaves headings inside code alone', () => {
    const answer = '## Combat\n```\n# comment\n```\n### Grappling'
    expect(fixHeadings(answer, given, 6).markdown).toBe(answer)
  })

  it('writes back a dropped heading with nothing under it, and misses one with text', () => {
    const three = [heading('Core', 3), heading('Dwarf', 4), heading('Elf', 4)]
    const dropped = fixHeadings('#### Dwarf\nDig.\n#### Elf\nSing.', three, 6, [true, false, false])
    expect(dropped.markdown).toBe('### Core\n\n#### Dwarf\nDig.\n#### Elf\nSing.')
    expect(dropped.missing).toEqual([])

    const lost = fixHeadings('#### Dwarf\nDig.', three, 6, [true, false, false])
    expect(lost.missing.map(one => one.title)).toEqual(['Elf'])
  })
})

describe('checking an answer', () => {
  const text = prose(40).join(' ')

  it('passes a conversion as long as its text', () => {
    expect(checkConversion({ text, markdown: text, missing: [] })).toBeNull()
  })

  it('refuses one cut off, empty, missing a heading, far shorter, or far longer', () => {
    expect(checkConversion({ text, markdown: text, missing: [], finishReason: 'length' })).toMatch(
      /cut off/
    )
    expect(checkConversion({ text, markdown: '  ', missing: [] })).toMatch(/empty/)
    expect(checkConversion({ text, markdown: text, missing: [heading('Elf', 4)] })).toMatch(
      /"#### Elf"/
    )
    expect(checkConversion({ text, markdown: prose(20).join(' '), missing: [] })).toMatch(
      /shorter than the text/
    )
    expect(checkConversion({ text, markdown: prose(60).join(' '), missing: [] })).toMatch(
      /longer than the text/
    )
  })

  it('counts a passage the text gives twice only once', () => {
    const passage = prose(12, 'sidebar')
    const twice = [...prose(20).join(' ').split('. '), ...passage, ...passage].join('\n')
    const once = [...prose(20).join(' ').split('. '), ...passage].join('\n')
    expect(withoutRepeats(twice)).toBe(once)
    expect(checkConversion({ text: twice, markdown: once, missing: [] })).toBeNull()
    expect(withoutRepeats('short\nshort')).toBe('short\nshort')
    // Two stat blocks that share a line word for word are not one passage twice.
    const shared = 'Reactions: 2. Right after another creature moves.'
    const blocks = [
      'Iron Wyrm',
      shared,
      'Bite. +9 to hit.',
      'Copper Wyrm',
      shared,
      'Bite. +7 to hit.',
    ]
    expect(withoutRepeats(blocks.join('\n'))).toBe(blocks.join('\n'))
  })

  it('does not count a short text, and counts words of letters only', () => {
    expect(checkConversion({ text: 'Tiny bit.', markdown: 'x', missing: [] })).toBeNull()
    expect(wordCount('| 12 | Goblin | a |\n|---|---|---|')).toBe(1)
  })
})

describe('joining the pieces', () => {
  it('makes one table of a table cut by a split, dropping a repeated header', () => {
    const first = 'Intro.\n\n| Roll | Race |\n|---|---|\n| 1 | Elf |'
    const repeated = '| Roll | Race |\n|---|---|\n| 2 | Orc |\n\nAfter.'
    expect(joinConverted(first, repeated)).toBe(
      'Intro.\n\n| Roll | Race |\n|---|---|\n| 1 | Elf |\n| 2 | Orc |\n\nAfter.'
    )
  })

  it("keeps a second part's first row when the model made it the header", () => {
    const first = '| Roll | Race |\n|---|---|\n| 1 | Elf |'
    const second = '| 2 | Orc |\n| --- | --- |\n| 3 | Dwarf |'
    expect(joinConverted(first, second)).toBe(
      '| Roll | Race |\n|---|---|\n| 1 | Elf |\n| 2 | Orc |\n| 3 | Dwarf |'
    )
  })

  it('leaves tables of different widths, and prose, apart', () => {
    expect(joinConverted('| a | b |\n|---|---|\n| 1 | 2 |', '| x |\n|---|\n| 1 |')).toBe(
      '| a | b |\n|---|---|\n| 1 | 2 |\n\n| x |\n|---|\n| 1 |'
    )
    expect(joinConverted('One.', 'Two.')).toBe('One.\n\nTwo.')
    expect(joinConverted('', 'Two.')).toBe('Two.')
  })

  it('assembles the answers under an index of links to their sections', () => {
    const markdown = assemble(['# Rules\n\nPlay.', '## Combat\n\nFight.', '# Rules\n\nAgain.'])
    expect(markdown).toBe(
      [
        '- [Rules](#rules)',
        '  - [Combat](#combat)',
        '- [Rules](#rules-1)',
        '',
        '---',
        '',
        '# Rules',
        '',
        'Play.',
        '',
        '## Combat',
        '',
        'Fight.',
        '',
        '# Rules',
        '',
        'Again.',
        '',
      ].join('\n')
    )
    expect(assemble(['Just text.'])).toBe('Just text.\n')
  })

  it('strips a fence around a whole answer and nothing else', () => {
    expect(unfence('```markdown\n# A\n\ntext\n```')).toBe('# A\n\ntext')
    expect(unfence('# A\n\n```js\ncode\n```')).toBe('# A\n\n```js\ncode\n```')
  })

  it('adds up usage, either side missing', () => {
    expect(addUsage(null, { total_tokens: 3 })).toEqual({ total_tokens: 3 })
    expect(
      addUsage(
        { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      )
    ).toEqual({ prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 })
  })
})

describe('converting a request', () => {
  const lines = [
    line('Combat'),
    ...prose(30, 'combat').map(text => line(text)),
    line(''),
    line('Grappling'),
    ...prose(30, 'grapple').map(text => line(text, 2)),
  ]
  const headings = [
    { title: 'Combat', level: 2, line: 0, consumed: 1 },
    { title: 'Grappling', level: 3, line: 32, consumed: 1 },
  ]
  const [request] = planRequests(lines, unitsOf(lines, headings), 100000)

  /** An answer that converts whatever it was sent: the text back, unchanged. */
  const echo = messages => {
    const text = messages[1].content.split('to Markdown:\n\n')[1]
    return { content: text, finishReason: 'stop', usage: { total_tokens: 10 } }
  }

  it('asks with the text, its headings written in, and where it sits', async () => {
    const ask = vi.fn(async messages => echo(messages))
    const done = await convertRequest({ title: 'Rules', lines, headings, request, ask })

    const [system, user] = ask.mock.calls[0][0]
    expect(system.content).toMatch(/headings are already in place/)
    expect(user.content).toContain('Document: Rules')
    expect(user.content).toContain('This text sits at the top of the document.')
    expect(user.content).toContain('## Combat\n\nThe combat sentence number 0')
    expect(user.content).toContain('### Grappling\n\nThe grapple sentence number 0')
    expect(done.markdown.startsWith('## Combat')).toBe(true)
    expect(done.usage).toEqual({ total_tokens: 10 })
  })

  it('says a continued part goes on from the section above', () => {
    const [, user] = conversionMessages({
      title: 'Rules',
      text: 'more',
      above: [heading('Combat', 2)],
      continued: true,
    })
    expect(user.content).toContain('This text sits under: ## Combat.')
    expect(user.content).toContain('its heading is not repeated')
  })

  it('asks again as two halves when an answer fails, and joins them', async () => {
    let calls = 0
    const ask = vi.fn(async messages => {
      calls++
      // The whole request comes back short; each half comes back whole.
      if (calls === 1) return { content: '## Combat\n\nToo short.', finishReason: 'stop' }
      return echo(messages)
    })
    const note = vi.fn()

    const done = await convertRequest({ title: 'Rules', lines, headings, request, ask, note })

    expect(ask).toHaveBeenCalledTimes(3)
    expect(note).toHaveBeenCalledWith('retrying', expect.stringMatching(/Headings are missing/))
    expect(done.markdown).toContain('## Combat')
    expect(done.markdown).toContain('### Grappling')
  })

  it('keeps the text as read, under its headings, when even the halves fail', async () => {
    const ask = vi.fn(async () => ({ content: 'nothing', finishReason: 'stop' }))
    const note = vi.fn()
    const done = await convertRequest({ title: 'Rules', lines, headings, request, ask, note })
    expect(done.markdown).toContain('## Combat\n\nThe combat sentence number 0')
    expect(done.markdown).toContain('### Grappling\n\nThe grapple sentence number 0')
    expect(done.fallback).toEqual({
      problem: expect.stringMatching(/Headings are missing/),
      answer: 'nothing',
    })
    expect(note).toHaveBeenCalledWith('fallback', expect.stringMatching(/Headings are missing/))
  })

  it('splits a request between its units, or inside its one unit at a paragraph', () => {
    const [a, b] = /** @type {any} */ (splitRequest(lines, request))
    expect(a.units.map(unit => unit.heading)).toEqual([0])
    expect(b.units.map(unit => unit.heading)).toEqual([1])

    const long = [
      ...prose(40, 'first').map(text => line(text)),
      line(''),
      ...prose(40, 'second').map(text => line(text)),
    ]
    const whole = { id: 'r', units: [{ heading: 0, from: 0, to: long.length, part: 0 }] }
    const [one, two] = /** @type {any} */ (splitRequest(long, whole))
    expect(one.units[0]).toEqual({ heading: 0, from: 0, to: 41, part: 0 })
    expect(two.units[0]).toEqual({ heading: 0, from: 41, to: long.length, part: 1 })

    const tiny = { id: 'r', units: [{ heading: 0, from: 1, to: 3, part: 0 }] }
    expect(splitRequest(lines, tiny)).toBeNull()
  })
})
