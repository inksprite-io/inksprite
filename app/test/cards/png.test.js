/* global TextEncoder, btoa */
import { describe, it, expect } from 'vitest'
import { textChunks, cardFromPng } from '@/cards/png.js'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A PNG carrying exactly the chunks given, and no pixels worth the name. */
const png = (...chunks) => {
  const parts = [Uint8Array.from(SIGNATURE)]

  for (const { name, body } of chunks) {
    const head = new Uint8Array(8)
    new DataView(head.buffer).setUint32(0, body.length)
    head.set(
      Uint8Array.from(name, c => c.charCodeAt(0)),
      4
    )
    // The checksum is never read, so it is four bytes of anything.
    parts.push(head, body, new Uint8Array(4))
  }

  const end = new Uint8Array(12)
  end.set(
    Uint8Array.from('IEND', c => c.charCodeAt(0)),
    4
  )
  parts.push(end)

  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** A `tEXt` chunk: keyword, NUL, Latin-1 bytes. */
const tEXt = (keyword, value) => ({
  name: 'tEXt',
  body: Uint8Array.from(`${keyword}\0${value}`, c => c.charCodeAt(0)),
})

/** Base64 of a UTF-8 string, the way a card writer produces it. */
const encode = value => {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const carrying = (keyword, card) => png(tEXt(keyword, encode(JSON.stringify(card))))

describe('cards/png', () => {
  describe('textChunks', () => {
    it('reads a text chunk by its keyword', () => {
      expect(textChunks(png(tEXt('chara', 'aGk=')))).toEqual(new Map([['chara', 'aGk=']]))
    })

    it('keeps the first of a repeated keyword', () => {
      const chunks = textChunks(png(tEXt('chara', 'first'), tEXt('chara', 'second')))

      expect(chunks.get('chara')).toBe('first')
    })

    it('reads nothing past the end marker', () => {
      // IEND ends the file. Bytes after it are not chunks, whatever they look
      // like — and a card appended there is not a card this would find.
      const file = png(tEXt('chara', 'kept'))
      const trailing = png(tEXt('chara', 'ignored'))
      const both = new Uint8Array(file.length + trailing.length)
      both.set(file)
      both.set(trailing, file.length)

      expect(textChunks(both).get('chara')).toBe('kept')
    })

    it('refuses a file that is not a PNG', () => {
      expect(() => textChunks(Uint8Array.from([1, 2, 3]))).toThrow(/not a PNG/)
      expect(() => textChunks(new Uint8Array(0))).toThrow(/not a PNG/)
    })

    it('takes an ArrayBuffer as readily as bytes', () => {
      const bytes = png(tEXt('chara', 'aGk='))
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

      expect(textChunks(buffer).get('chara')).toBe('aGk=')
    })
  })

  describe('cardFromPng', () => {
    it('reads a V2 card from the chara chunk', () => {
      const card = { spec: 'chara_card_v2', data: { name: 'Elara' } }

      expect(cardFromPng(carrying('chara', card))).toEqual(card)
    })

    it('prefers ccv3 when a file carries both', () => {
      // A V3 writer leaves a V2 copy behind so older apps find something. The
      // newer one is the one that was written last and means the most.
      const file = png(
        tEXt('ccv3', encode(JSON.stringify({ spec: 'chara_card_v3', data: { name: 'New' } }))),
        tEXt('chara', encode(JSON.stringify({ spec: 'chara_card_v2', data: { name: 'Old' } })))
      )

      expect(cardFromPng(file).data.name).toBe('New')
    })

    it('falls back to chara when ccv3 is damaged', () => {
      const file = png(
        tEXt('ccv3', 'not base64 at all!!'),
        tEXt('chara', encode(JSON.stringify({ data: { name: 'Old' } })))
      )

      expect(cardFromPng(file).data.name).toBe('Old')
    })

    it('says an ordinary image carries no card', () => {
      expect(cardFromPng(png(tEXt('Comment', 'made in a paint program')))).toBeNull()
      expect(cardFromPng(png())).toBeNull()
    })

    it('keeps the text as it was written, not as Latin-1', () => {
      // Card prose is full of em dashes and smart quotes, and `atob` alone
      // hands back one byte per character — which would arrive as mojibake.
      const card = { data: { description: 'She said “no” — and meant it. こんにちは' } }

      expect(cardFromPng(carrying('chara', card)).data.description).toBe(
        'She said “no” — and meant it. こんにちは'
      )
    })

    it('reads a card far too large to spread into a function call', () => {
      // A book of lore runs to hundreds of kilobytes of base64, and the obvious
      // decode blows the stack somewhere past sixty-odd thousand arguments.
      const card = { data: { description: 'x'.repeat(400_000) } }

      expect(cardFromPng(carrying('chara', card)).data.description).toHaveLength(400_000)
    })
  })
})
