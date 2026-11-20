import { describe, it, expect } from 'vitest'
import {
  STAMP_NOTE,
  asExported,
  bodyHash,
  readStamp,
  stamped,
  withoutStamp,
} from '@/files/exportStamp.js'

const FROM = { project: 'Thief', document: 'Designs/Sync', id: 'doc_1' }
const BODY = '# Sync\n\nHow the devices agree.\n'

describe('stamped', () => {
  it('puts where the document came from above its text, under one key', async () => {
    const text = await stamped(FROM, BODY)

    expect(text).toBe(
      [
        '---',
        'inksprite:',
        '  project: Thief',
        '  document: Designs/Sync',
        '  id: doc_1',
        `  hash: ${await bodyHash(BODY)}`,
        `  note: ${STAMP_NOTE}`,
        '---',
        '',
        BODY,
      ].join('\n')
    )
  })

  it('is the same for the same text, and changes only with it: there is no date in it', async () => {
    expect(await stamped(FROM, BODY)).toBe(await stamped(FROM, BODY))
    expect(await stamped(FROM, `${BODY}More.\n`)).not.toBe(await stamped(FROM, BODY))
  })

  it('keeps a name that YAML would read as something else', async () => {
    const odd = { project: 'Thief: the heist #2', document: 'Notes/"Quoted" & more', id: 'doc_1' }
    const { stamp, body } = readStamp(await stamped(odd, BODY))

    expect(stamp).toMatchObject(odd)
    expect(body).toBe(BODY)
  })

  it('stamps an empty document', async () => {
    const text = await stamped(FROM, '')
    expect(readStamp(text)).toMatchObject({ stamp: { id: 'doc_1' }, body: '' })
    expect(await asExported(text)).toBe(true)
  })
})

describe('bodyHash', () => {
  it('is sixteen hex digits that tell two texts apart', async () => {
    expect(await bodyHash('a')).toMatch(/^[0-9a-f]{16}$/)
    expect(await bodyHash('a')).toBe(await bodyHash('a'))
    expect(await bodyHash('a')).not.toBe(await bodyHash('b'))
  })
})

describe('readStamp', () => {
  it('reads back what was stamped, and the text under it', async () => {
    const { stamp, body, others } = readStamp(await stamped(FROM, BODY))
    expect(stamp).toEqual({ ...FROM, hash: await bodyHash(BODY) })
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

  it('hands back what else the front matter held', () => {
    const text = '---\ntitle: Sync\ninksprite:\n  id: doc_1\n  hash: abc\n---\n\nText.\n'
    expect(readStamp(text)).toMatchObject({
      stamp: { id: 'doc_1', hash: 'abc', project: '', document: '' },
      body: 'Text.\n',
      others: { title: 'Sync' },
    })
  })
})

describe('asExported', () => {
  it('is true of a file as it was exported', async () => {
    expect(await asExported(await stamped(FROM, BODY))).toBe(true)
  })

  it('is false of one whose text was changed since, and of one with no stamp', async () => {
    const text = await stamped(FROM, BODY)
    expect(await asExported(text.replace('agree', 'disagree'))).toBe(false)
    expect(await asExported(`${text}\nA line added.\n`)).toBe(false)
    expect(await asExported(BODY)).toBe(false)
  })

  it('is true of an older export on another branch: what matters is its own text', async () => {
    const older = await stamped(FROM, '# Sync\n\nAn earlier draft.\n')
    expect(await asExported(older)).toBe(true)
  })
})

describe('withoutStamp', () => {
  it('takes the stamp off a file brought back in', async () => {
    expect(withoutStamp(await stamped(FROM, BODY))).toBe(BODY)
  })

  it('leaves a file with no stamp as it was', () => {
    const page = '---\ntitle: A page\n---\n\nText.\n'
    expect(withoutStamp(BODY)).toBe(BODY)
    expect(withoutStamp(page)).toBe(page)
  })

  it('keeps what else the front matter held', () => {
    const text = '---\ntitle: Sync\ninksprite:\n  id: doc_1\n  hash: abc\n---\n\nText.\n'
    expect(withoutStamp(text)).toBe('---\ntitle: Sync\n---\n\nText.\n')
  })
})
