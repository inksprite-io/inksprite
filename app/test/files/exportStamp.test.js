import { describe, it, expect } from 'vitest'
import { STAMP_NOTE, readStamp, stamped, withoutStamp } from '@/files/exportStamp.js'

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
    const { stamp, body } = readStamp(stamped(odd, BODY))

    expect(stamp).toEqual(odd)
    expect(body).toBe(BODY)
  })

  it('stamps an empty document', () => {
    expect(readStamp(stamped(FROM, ''))).toMatchObject({ stamp: { id: 'doc_1' }, body: '' })
  })
})

describe('readStamp', () => {
  it('reads back what was stamped, and the text under it', () => {
    const { stamp, body, others } = readStamp(stamped(FROM, BODY))
    expect(stamp).toEqual(FROM)
    expect(body).toBe(BODY)
    expect(others).toEqual({})
  })

  it('finds none in a file without one, whose text is all its own', () => {
    for (const text of [
      BODY,
      '---\ntitle: A page\n---\n\nText.\n',
      '---\ninksprite: yes\n---\n\nText.\n',
      '---\ninksprite:\n  project: Thief\n---\n\nNo id.\n',
      '---\nnot: [closed\n---\n\nText.\n',
    ]) {
      expect(readStamp(text)).toEqual({ stamp: null, body: text, others: {} })
    }
  })

  it('hands back what else the front matter held, and reads a stamp that says more', () => {
    const text = '---\ntitle: Sync\ninksprite:\n  id: doc_1\n  hash: abc\n---\n\nText.\n'
    expect(readStamp(text)).toEqual({
      stamp: { id: 'doc_1', project: '', document: '' },
      body: 'Text.\n',
      others: { title: 'Sync' },
    })
  })
})

describe('withoutStamp', () => {
  it('takes the stamp off a file brought back in', () => {
    expect(withoutStamp(stamped(FROM, BODY))).toBe(BODY)
  })

  it('leaves a file with no stamp as it was', () => {
    const page = '---\ntitle: A page\n---\n\nText.\n'
    expect(withoutStamp(BODY)).toBe(BODY)
    expect(withoutStamp(page)).toBe(page)
  })

  it('keeps what else the front matter held', () => {
    const text = '---\ntitle: Sync\ninksprite:\n  id: doc_1\n---\n\nText.\n'
    expect(withoutStamp(text)).toBe('---\ntitle: Sync\n---\n\nText.\n')
  })
})
