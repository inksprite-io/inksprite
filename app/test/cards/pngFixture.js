/* global TextEncoder, btoa, File */
/**
 * PNGs made up for tests: the signature, the chunks asked for, and an end,
 * with no pixels worth the name.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * A PNG carrying exactly the chunks given.
 *
 * @param {...{name: string, body: Uint8Array}} chunks
 * @returns {Uint8Array}
 */
export const png = (...chunks) => {
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

/**
 * A `tEXt` chunk: keyword, NUL, Latin-1 bytes.
 *
 * @param {string} keyword
 * @param {string} value
 */
export const tEXt = (keyword, value) => ({
  name: 'tEXt',
  body: Uint8Array.from(`${keyword}\0${value}`, c => c.charCodeAt(0)),
})

/**
 * Base64 of a UTF-8 string, the way a card writer produces it.
 *
 * @param {string} value
 */
export const encode = value => {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * A PNG with a card under this keyword.
 *
 * @param {string} keyword
 * @param {any} card
 */
export const carrying = (keyword, card) => png(tEXt(keyword, encode(JSON.stringify(card))))

/**
 * A card in a PNG, as a file chosen.
 *
 * @param {string} name
 * @param {any} card
 */
export const cardPngFile = (name, card) =>
  new File([carrying('chara', card)], name, { type: 'image/png' })

/**
 * A card as JSON, as a file chosen.
 *
 * @param {string} name
 * @param {any} card
 */
export const cardJsonFile = (name, card) =>
  new File([JSON.stringify(card)], name, { type: 'application/json' })
