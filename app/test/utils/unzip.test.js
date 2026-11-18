// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { MIB, TooLargeError, unzipWithin } from '@/utils/unzip.js'

describe('a zip opened with a ceiling', () => {
  const zip = zipSync({
    'book/chapter.xhtml': strToU8('<p>One.</p>'),
    'book/cover.png': new Uint8Array(3 * MIB),
    'notes.txt': strToU8('Two.'),
  })

  it('opens what fits, whole', () => {
    const opened = unzipWithin(zip, 4 * MIB)
    expect(Object.keys(opened).sort()).toEqual([
      'book/chapter.xhtml',
      'book/cover.png',
      'notes.txt',
    ])
    expect(opened['book/cover.png'].length).toBe(3 * MIB)
  })

  it('counts only the entries it is asked for', () => {
    const opened = unzipWithin(zip, 1024, entry => !entry.name.endsWith('.png'))
    expect(Object.keys(opened).sort()).toEqual(['book/chapter.xhtml', 'notes.txt'])
  })

  it('inflates nothing of a zip that says it holds more than the ceiling', () => {
    // A few kilobytes, three mebibytes unpacked: what a far larger one is in small.
    expect(zip.length).toBeLessThan(16 * 1024)
    expect(() => unzipWithin(zip, MIB)).toThrow(TooLargeError)
    expect(() => unzipWithin(zip, MIB)).toThrow('too large')
  })

  it('takes no more from an entry than the entry says it holds', () => {
    // The same zip, with the picture's size in its directory made a lie.
    const lying = zip.slice()
    const view = new DataView(lying.buffer)
    for (let at = lying.length - 46; at >= 0; at--) {
      if (view.getUint32(at, true) !== 0x02014b50) continue
      const length = view.getUint16(at + 28, true)
      const name = new TextDecoder().decode(lying.subarray(at + 46, at + 46 + length))
      if (name === 'book/cover.png') view.setUint32(at + 24, 10, true)
    }
    const opened = unzipWithin(lying, 16 * 1024)
    expect(opened['book/cover.png'].length).toBe(10)
  })

  it('counts a stored entry by what the file holds of it, whatever it says it unpacks to', () => {
    // Stored, not deflated: copied out by its size in the file.
    const stored = zipSync({ 'blob.bin': [new Uint8Array(MIB).fill(7), { level: 0 }] })
    const view = new DataView(stored.buffer)
    for (let at = stored.length - 46; at >= 0; at--) {
      if (view.getUint32(at, true) === 0x02014b50) view.setUint32(at + 24, 0, true)
    }
    expect(() => unzipWithin(stored, 1024)).toThrow(TooLargeError)
  })
})
