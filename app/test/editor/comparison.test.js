import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '../../src/editor/markdown.js'
import { COMPARED, compareTexts, versionBetween } from '../../src/editor/comparison.js'

/**
 * A comparison as lines, a block on each: what a restore takes out in
 * `[-…-]`, what it brings back in `[+…+]`, a block either way whole with the
 * sign before it, and a pending suggestion's halves in `{-…-}` and `{+…+}`.
 */
const shown = doc => {
  const lines = []
  const signOf = node => {
    const mark = node.marks.find(each => ['insertion', 'deletion'].includes(each.type.name))
    if (!mark) return null
    const sign = mark.type.name === 'insertion' ? '+' : '-'
    return mark.attrs.id === COMPARED
      ? { open: `[${sign}`, close: `${sign}]` }
      : { open: `{${sign}`, close: `${sign}}` }
  }
  const walk = (node, depth) => {
    if (node.isTextblock || node.isLeaf) {
      const whole = signOf(node)
      let text = node.isLeaf ? `<${node.type.name}>` : ''
      node.forEach(child => {
        const sign = signOf(child)
        const words = child.isText ? child.text : `<${child.type.name}>`
        text += sign ? `${sign.open}${words}${sign.close}` : words
      })
      lines.push(`${'  '.repeat(depth)}${whole ? `${whole.open[1]} ` : ''}${text}`)
      return
    }
    const whole = signOf(node)
    if (whole) lines.push(`${'  '.repeat(depth)}${whole.open[1]} ${node.type.name}`)
    node.forEach(child => walk(child, depth + (node.type.name === 'doc' ? 0 : 1)))
  }
  walk(doc, 0)
  return lines.join('\n')
}

/** Whether anything in a comparison is a restore's. */
const differs = doc => {
  let found = false
  doc.descendants(node => {
    if (node.marks.some(mark => mark.attrs.id === COMPARED)) found = true
  })
  return found
}

/** A version's markdown against the text now's, as lines. */
const compared = (version, now) => {
  const doc = compareTexts(parseMarkdown(version), parseMarkdown(now))
  doc.check()
  return shown(doc)
}

describe('compareTexts', () => {
  it('marks what a restore takes out of the text now, then what it brings back', () => {
    expect(compared('The gate was locked.', 'The gate was open.')).toBe(
      'The gate was [-open-][+locked+].'
    )
  })

  it('tells a word by its formatting', () => {
    expect(compared('The **gate** was shut.', 'The gate was shut.')).toBe(
      'The [-gate-][+gate+] was shut.'
    )
    const doc = compareTexts(
      parseMarkdown('The **gate** was shut.'),
      parseMarkdown('The gate was shut.')
    )
    const back = []
    doc.descendants(node => {
      if (node.isText && node.marks.some(mark => mark.type.name === 'insertion'))
        back.push(node.marks.map(mark => mark.type.name))
    })
    expect(back).toEqual([['insertion', 'strong']])
  })

  it('takes out a block the version lacks before bringing back one it has', () => {
    expect(
      compared(
        '# Night\n\nThe thief waited on the roof.',
        '# Night\n\nRain fell on every street below.'
      )
    ).toBe('Night\n[-Rain fell on every street below.-]\n[+The thief waited on the roof.+]')
  })

  it('marks a block with no words to mark whole', () => {
    expect(compared('```\nlocked\n```', '```\nopen\n```')).toBe('- open\n+ locked')
    expect(compared('Before.\n\n---\n\nAfter.', 'Before.\n\nAfter.')).toBe(
      'Before.\n+ <horizontal_rule>\nAfter.'
    )
  })

  it('compares a list item by item', () => {
    expect(compared('- a key\n- a lamp\n- a rope', '- a key\n- a rope\n- a coin')).toBe(
      ['    a key', '    [+a lamp+]', '    a rope', '    [-a coin-]'].join('\n')
    )
  })

  it('keeps each of a table’s cells in its place', () => {
    const table = cells => `| a | b |\n|---|---|\n| ${cells.join(' | ')} |`
    expect(compared(table(['the key', '']), table(['', 'the lamp']))).toBe(
      ['    a', '    b', '    [+the key+]', '    [-the lamp-]'].join('\n')
    )
  })

  it('shows what both have as the version has it: its comments and suggestions', () => {
    const doc = compareTexts(
      parseMarkdown('We had a {==narrow==}{>>c1abcd<<} attic.'),
      parseMarkdown('We had a narrow attic.')
    )
    const commented = []
    doc.descendants(node => {
      if (node.isText && node.marks.some(mark => mark.type.name === 'comment'))
        commented.push(node.text)
    })
    expect(commented).toEqual(['narrow'])
    expect(differs(doc)).toBe(false)

    // Its pending suggestion is its own, though the text now has it accepted.
    expect(
      compared(
        'We had a {--cold--}{>>s4k2m1<<}{++narrow++}{>>s4k2m1<<} attic.',
        'We had a narrow attic.'
      )
    ).toBe('We had a {-cold-}{+narrow+} attic.')
  })

  it('takes out the words a suggestion pending now puts in', () => {
    expect(
      compared(
        'We had a cold attic.',
        'We had a {--cold--}{>>s4k2m1<<}{++narrow++}{>>s4k2m1<<} attic.'
      )
    ).toBe('We had a cold[-narrow-] attic.')
  })

  it('pairs each paragraph with its own in a text changed throughout', () => {
    const paragraphs = word =>
      Array.from({ length: 200 }, (_, i) => `Night ${i} fell on the ${word} street.`).join('\n\n')
    const lines = compared(paragraphs('wet'), paragraphs('dry')).split('\n')
    expect(lines).toHaveLength(200)
    expect(lines[150]).toBe('Night 150 fell on the [-dry-][+wet+] street.')
  })

  it('leaves out nothing when the two are the same', () => {
    const doc = compareTexts(parseMarkdown('The gate.'), parseMarkdown('The gate.'))
    expect(differs(doc)).toBe(false)
    expect(shown(doc)).toBe('The gate.')
  })
})

describe('versionBetween', () => {
  it('is the version’s own text, what a restore takes out left behind', () => {
    const doc = compareTexts(
      parseMarkdown('The gate was locked.\n\nThe thief waited.'),
      parseMarkdown('The gate was open.\n\nThe thief waited.')
    )
    const slice = versionBetween(doc, 0, doc.content.size)
    expect(slice.content.textBetween(0, slice.content.size, '\n')).toBe(
      'The gate was locked.\nThe thief waited.'
    )
    const marks = []
    slice.content.descendants(node => {
      for (const mark of node.marks) marks.push(mark.type.name)
    })
    expect(marks).toEqual([])
  })
})
