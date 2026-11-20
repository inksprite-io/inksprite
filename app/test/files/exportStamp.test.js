import { describe, it, expect } from 'vitest'
import { STAMP_NOTE, stamped, withoutStamp } from '@/files/exportStamp.js'
import { readFrontmatter } from '@/storage/frontmatter.js'

const FROM = { project: 'Thief', document: 'Designs/Sync', id: 'doc_1' }
const BODY = '# Sync\n\nHow the devices agree.\n'

describe('stamped', () => {
  it('puts where the document came from above its text, under one key', () => {
    expect(stamped(FROM, BODY)).toBe(
      [
        '---',
        'inksprite:',
        '  project: Thief',
        '  document: Designs/Sync',
        '  id: doc_1',
        `  note: ${STAMP_NOTE}`,
        '---',
        '',
        BODY,
      ].join('\n')
    )
  })

  it('is the same for the same text, and changes only with it: there is no date in it', () => {
    expect(stamped(FROM, BODY)).toBe(stamped(FROM, BODY))
    expect(stamped(FROM, `${BODY}More.\n`)).toBe(`${stamped(FROM, BODY)}More.\n`)
  })

  it('keeps a name that YAML would read as something else', () => {
    const odd = { project: 'Thief: the heist #2', document: 'Notes/"Quoted" & more', id: 'doc_1' }
    const { fields, body } = readFrontmatter(stamped(odd, BODY))

    expect(fields.inksprite).toEqual({ ...odd, note: STAMP_NOTE })
    expect(body).toBe(BODY)
  })
})

describe('withoutStamp', () => {
  it('takes the stamp off a file brought back in', () => {
    expect(withoutStamp(stamped(FROM, BODY))).toBe(BODY)
    expect(withoutStamp(stamped(FROM, ''))).toBe('')
    // Whatever its project and its document are called.
    const odd = { project: 'Thief: the heist #2', document: 'Notes/"Quoted" & more', id: 'doc_1' }
    expect(withoutStamp(stamped(odd, BODY))).toBe(BODY)
  })

  it('leaves a file with no stamp as it came', () => {
    for (const text of [
      BODY,
      '',
      '---\ntitle: A page\n---\n\nText.\n',
      // The key with something else under it, or nothing.
      '---\ninksprite: yes\n---\n\nText.\n',
      '---\ninksprite:\n---\n\nText.\n',
      '---\ninksprite:\n  project: Thief\n---\n\nNo id.\n',
      '---\ninksprite:\n  id:\n---\n\nAn id of nothing.\n',
      '---\ninksprite:\n  about:\n    id: doc_1\n---\n\nAn id of something else.\n',
      // The key under another, and in the text.
      '---\nmade:\n  inksprite:\n    id: doc_1\n---\n\nText.\n',
      '---\ntitle: A page\n---\n\ninksprite:\n  id: doc_1\n',
      'inksprite:\n  id: doc_1\n',
      // Front matter that is never closed, or that YAML can't read.
      '---\ninksprite:\n  id: doc_1\n\nText.\n',
      '---\nnot: [closed\n---\n\nText.\n',
    ]) {
      expect(withoutStamp(text), JSON.stringify(text)).toBe(text)
    }
  })

  it('keeps what else the front matter held, as it was written', () => {
    const rest = [
      'title:   "Sync"   # as its author spaced and quoted it',
      'tags: [a,   b]',
      'when: 2026-11-20',
      '',
      'nested:',
      '    deep: &anchor {x: 1}',
      '    again: *anchor',
    ]
    const stamp = [
      'inksprite:',
      '  project: Thief',
      '  id: doc_1',
      '  hash: abc',
      '  note: >-',
      '    Two',
      '    lines.',
    ]
    const file = lines => ['---', ...lines, '---', '', 'Text.', ''].join('\n')
    const without = file(rest)

    // The stamp first, last, and among the rest.
    expect(withoutStamp(file([...stamp, ...rest]))).toBe(without)
    expect(withoutStamp(file([...rest, ...stamp]))).toBe(without)
    expect(withoutStamp(file([...rest.slice(0, 2), ...stamp, ...rest.slice(2)]))).toBe(without)
  })

  it('takes a stamp off a file with Windows line endings, which stay', () => {
    const text = '---\r\ntitle: Sync\r\ninksprite:\r\n  id: doc_1\r\n---\r\n\r\nText.\r\n'
    expect(withoutStamp(text)).toBe('---\r\ntitle: Sync\r\n---\r\n\r\nText.\r\n')
    expect(withoutStamp('---\r\ninksprite:\r\n  id: doc_1\r\n---\r\n\r\nText.\r\n')).toBe(
      'Text.\r\n'
    )
  })

  it('writes out nothing an import brought: front matter made to grow comes back as it was', () => {
    // Aliases within aliases: a few hundred bytes that say a hundred thousand
    // things, once each one is written out in full.
    const ten = name => `[${Array(10).fill(`*${name}`).join(', ')}]`
    const bomb = [
      'a: &a [x, x, x, x, x, x, x, x, x, x]',
      `b: &b ${ten('a')}`,
      `c: &c ${ten('b')}`,
      `d: &d ${ten('c')}`,
      `e: ${ten('d')}`,
    ]
    const stamp = ['inksprite:', '  id: doc_1']
    const file = lines => ['---', ...lines, '---', '', 'Text.', ''].join('\n')
    const text = file([...bomb, ...stamp])
    expect(text.length).toBeLessThan(400)

    const out = withoutStamp(text)

    expect(out).toBe(file(bomb))
    expect(out.length).toBeLessThan(text.length)
  })
})
