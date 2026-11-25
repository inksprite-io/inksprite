// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { MIB, TooLargeError, unzippedSize, unzipWithin } from '@/utils/unzip.js'

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

  it('takes no entry named __proto__, which would make its bytes the prototype', () => {
    const zip = zipSync({ __proto_x: strToU8('x'), 'a.txt': strToU8('A.') })
    // The name written in place of its stand-in, the same length.
    const named = zip.slice()
    const text = new TextDecoder('latin1').decode(named)
    for (let at = text.indexOf('__proto_x'); at >= 0; at = text.indexOf('__proto_x', at + 1)) {
      named.set(strToU8('__proto__'), at)
    }
    const opened = unzipWithin(named, MIB)
    expect(Object.keys(opened)).toEqual(['a.txt'])
    expect(Object.getPrototypeOf(opened)).toBe(Object.prototype)
  })

  it('opens none of a zip whose directory claims more than its bytes could hold', () => {
    // Entries whose compressed parts are said to be far longer than the file.
    const overlapping = zip.slice()
    const view = new DataView(overlapping.buffer)
    for (let at = overlapping.length - 46; at >= 0; at--) {
      if (view.getUint32(at, true) === 0x02014b50) view.setUint32(at + 20, 10 * MIB, true)
    }
    expect(() => unzipWithin(overlapping, 64 * MIB)).toThrow('isn’t a zip that can be opened')

    // An end record that claims more entries than the file has room for.
    const crowded = zip.slice()
    const end = new DataView(crowded.buffer)
    for (let at = crowded.length - 22; at >= 0; at--) {
      if (end.getUint32(at, true) !== 0x06054b50) continue
      end.setUint16(at + 8, 0xffff, true)
      end.setUint16(at + 10, 0xffff, true)
      break
    }
    expect(() => unzipWithin(crowded, 64 * MIB)).toThrow()
  })
})

describe('what a zip says it opens into', () => {
  it('is the sizes its directory gives, read without inflating anything', () => {
    const zip = zipSync({
      'a.txt': strToU8('One. '.repeat(100)),
      'big.bin': new Uint8Array(3 * MIB),
    })
    expect(unzippedSize(zip)).toBe(3 * MIB + 500)

    // A size made a lie, far past what the bytes could hold, is read as said.
    const view = new DataView(zip.buffer)
    for (let at = zip.length - 46; at >= 0; at--) {
      if (view.getUint32(at, true) === 0x02014b50) view.setUint32(at + 24, 0xffff0000, true)
    }
    expect(unzippedSize(zip)).toBeGreaterThan(2 * 1024 * MIB)
  })

  it('is refused for what isn’t a zip', () => {
    expect(() => unzippedSize(strToU8('not a zip'))).toThrow()
  })
})
