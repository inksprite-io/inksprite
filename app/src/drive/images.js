/* global atob, TextEncoder */
/**
 * @module drive/images
 * @description The pictures in a Google Doc's markdown, taken out of it.
 *
 * Google's export writes a picture reference-style: `![][image1]` or
 * `![alt][image2]` where it was, and at the end a definition for each,
 * `[image1]: <data:image/png;base64,…>`, holding the whole picture. The
 * editor has no images, and what it makes of these leaves the base64 in the
 * document, megabytes of it in front of the model. So they come out before
 * the importer sees the markdown: for now they are counted and left out;
 * when documents hold images, the same pictures go into the project.
 */

/**
 * A picture taken out of the markdown.
 *
 * @typedef {Object} TakenImage
 * @property {string} ref - Its label, lower-cased (`image1`); empty for one written inline
 * @property {string} alt - Its alt text, as the first use gave it
 * @property {string} mime - Its media type
 * @property {Uint8Array} bytes - The picture
 */

/**
 * A use of a picture: `![alt][label]`, `![label][]` or `![label]`, the last
 * not followed by a link of its own.
 */
const REFERENCE = /!\[((?:\\.|[^\\\]\n])*)\](?:\[((?:\\.|[^\\\]\n])*)\]|(?![([]))[ \t]*/g

/** A picture written inline as a data URI: `![alt](data:…)`. */
const INLINE =
  /!\[((?:\\.|[^\\\]\n])*)\]\(\s*<?data:([^;,>\s)]*)((?:;[^;,>\s)]*)*),([^>\s)]*)>?\s*\)[ \t]*/g

/** A definition holding a picture: `[label]: <data:…>`, on a line of its own. */
const DEFINITION =
  /^ {0,3}\[((?:\\.|[^\\\]\n])+)\]:[ \t]*<?data:([^;,>\s]*)((?:;[^;,>\s]*)*),([^>\s]*)>?[ \t]*$/

/**
 * @param {string} text
 * @returns {string}
 */
const unescape = text => text.replace(/\\(.)/g, '$1')

/**
 * The bytes of a data URI's payload.
 *
 * @param {string} params - What followed the media type, `;base64` among them
 * @param {string} data
 * @returns {Uint8Array}
 */
function bytesOf(params, data) {
  try {
    if (/;base64/i.test(params)) return Uint8Array.from(atob(data), c => c.charCodeAt(0))
    return new TextEncoder().encode(decodeURIComponent(data))
  } catch {
    return new Uint8Array()
  }
}

/**
 * Take the pictures out of a Doc's markdown: each definition that holds one,
 * each use of those, and each one written inline. A reference to anything
 * else, a link or a picture on the web, is left where it is.
 *
 * @param {string} markdown
 * @returns {{markdown: string, images: TakenImage[]}}
 */
export function takeImages(markdown) {
  const lines = markdown.split('\n')
  /** @type {Map<string, TakenImage>} */
  const defined = new Map()
  /** @type {Set<number>} */
  const definitions = new Set()

  lines.forEach((line, index) => {
    const match = line.match(DEFINITION)
    if (!match) return
    const ref = unescape(match[1]).toLowerCase()
    definitions.add(index)
    if (defined.has(ref)) return
    defined.set(ref, {
      ref,
      alt: '',
      mime: match[2] || 'application/octet-stream',
      bytes: bytesOf(match[3], match[4]),
    })
  })

  /** @type {TakenImage[]} */
  const inline = []
  /** @type {Set<string>} */
  const used = new Set()
  let changed = definitions.size > 0

  const out = []
  for (const [index, line] of lines.entries()) {
    if (definitions.has(index)) continue
    const taken = line
      .replace(INLINE, (_, alt, mime, params, data) => {
        inline.push({
          ref: '',
          alt: unescape(alt),
          mime: mime || 'application/octet-stream',
          bytes: bytesOf(params, data),
        })
        return ''
      })
      .replace(REFERENCE, (whole, alt, label) => {
        const ref = unescape(label || alt).toLowerCase()
        const image = defined.get(ref)
        if (!image) return whole
        if (!used.has(ref)) {
          used.add(ref)
          image.alt = unescape(alt)
        }
        return ''
      })
    if (taken === line) out.push(line)
    else {
      changed = true
      out.push(taken.trimEnd())
    }
  }

  if (!changed) return { markdown, images: [] }
  const images = [...defined.values(), ...inline]
  const tidied = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
  return { markdown: markdown.endsWith('\n') ? `${tidied}\n` : tidied, images }
}
