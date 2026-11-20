// @vitest-environment node
/* global Blob */
import { describe, it, expect } from 'vitest'
import { tarWriter } from '@/utils/tarWriter.js'

const BLOCK = 512
const decoder = new TextDecoder()

/** A header's field, up to its NUL. */
const field = (block, offset, length) =>
  decoder.decode(block.subarray(offset, offset + length)).replace(/\0.*$/s, '')

/**
 * A tar read back, as `tar` reads one: each entry's name, type and bytes, a
 * pax record's path taking its header's place, and whether every header's
 * sum is right.
 */
async function unpack(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const entries = []
  let named = null
  let at = 0
  while (at < bytes.length) {
    const block = bytes.subarray(at, at + BLOCK)
    if (block.every(byte => byte === 0)) break
    const summed = block.reduce(
      (total, byte, index) => total + (index >= 148 && index < 156 ? 0x20 : byte),
      0
    )
    const size = parseInt(field(block, 124, 12), 8)
    const data = bytes.subarray(at + BLOCK, at + BLOCK + size)
    const type = field(block, 156, 1)
    const entry = {
      name: field(block, 0, 100),
      type,
      size,
      mode: field(block, 100, 8),
      magic: field(block, 257, 6),
      sumOk: parseInt(field(block, 148, 8), 8) === summed,
    }
    if (type === 'x') {
      const [, length, path] = decoder.decode(data).match(/^(\d+) path=(.*)\n$/s)
      expect(Number(length)).toBe(data.length)
      named = path
    } else {
      entries.push({ ...entry, name: named ?? entry.name, header: entry.name, data })
      named = null
    }
    expect(entry.sumOk, entry.name).toBe(true)
    expect(entry.magic).toBe('ustar')
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK
  }
  return { entries, length: bytes.length, ended: bytes.length - at }
}

describe('tarWriter', () => {
  it('writes texts, files and directories as tar reads them', async () => {
    const tar = tarWriter(1_700_000_000)
    tar.addFolder('designs')
    tar.addText('designs/Sync.md', '# Sync\n')
    tar.addBlob('designs/images/dot.png', new Blob([new Uint8Array([1, 2, 3])]))

    const blob = tar.end()
    const { entries, length, ended } = await unpack(blob)

    expect(blob.type).toBe('application/x-tar')
    expect(entries.map(({ name, type, size }) => ({ name, type, size }))).toEqual([
      { name: 'designs/', type: '5', size: 0 },
      { name: 'designs/Sync.md', type: '0', size: 7 },
      { name: 'designs/images/dot.png', type: '0', size: 3 },
    ])
    expect(decoder.decode(entries[1].data)).toBe('# Sync\n')
    expect([...entries[2].data]).toEqual([1, 2, 3])
    expect(entries[0].mode).toBe('0000755')
    expect(entries[1].mode).toBe('0000644')
    // Whole blocks, and two empty ones to end it.
    expect(length % BLOCK).toBe(0)
    expect(ended).toBe(BLOCK * 2)
  })

  it('fills the last block of each file, and adds none to one that ends on a block', async () => {
    const tar = tarWriter()
    tar.addText('a.txt', 'x'.repeat(BLOCK))
    tar.addText('b.txt', 'y')
    tar.addText('none.txt', '')

    const { entries, length } = await unpack(tar.end())

    expect(entries.map(entry => entry.size)).toEqual([BLOCK, 1, 0])
    expect(decoder.decode(entries[1].data)).toBe('y')
    // Three headers, one block of x, one of y, and the end.
    expect(length).toBe(BLOCK * 7)
  })

  it('gives a name a header cannot hold in a record before its entry', async () => {
    const long = `${'a folder with a long name/'.repeat(5)}A document.md`
    const tar = tarWriter()
    tar.addText('notes/Café — plan.md', 'accents\n')
    tar.addText(long, 'long\n')
    tar.addFolder('notes/Für später')

    const { entries } = await unpack(tar.end())

    expect(entries.map(entry => entry.name)).toEqual([
      'notes/Café — plan.md',
      long,
      'notes/Für später/',
    ])
    // The header itself has a stand-in, plain and short enough for it.
    for (const entry of entries) {
      expect(entry.header).toMatch(/^[\x20-\x7e]{1,100}$/)
    }
    expect(entries[2].header.endsWith('/')).toBe(true)
    expect(new Set(entries.map(entry => entry.header)).size).toBe(3)
    expect(decoder.decode(entries[1].data)).toBe('long\n')
  })

  it('refuses a name that would be unpacked anywhere but below where it is run', () => {
    for (const name of ['../up.md', 'a/../../b.md', '/etc/passwd', '']) {
      expect(() => tarWriter().addText(name, 'x'), name).toThrow('Not a path inside an archive')
    }
    expect(() => tarWriter().addFolder('..')).toThrow('Not a path inside an archive')
    // Dots in a name are only a name.
    expect(() => tarWriter().addText('notes/a..b.md', 'x')).not.toThrow()
  })
})
