/* global atob, TextEncoder */
/**
 * @module utils/dataUrl
 * @description What a `data:` address holds, as bytes.
 *
 * A picture written into markdown or HTML as `data:image/png;base64,…` is
 * the whole picture. These read it back out, for it to be kept as a file.
 */

/** A `data:` address: its media type, its parameters, and its payload. */
const DATA_URL = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s

/**
 * The bytes of a data URI's payload: base64, or percent-encoded text.
 *
 * @param {string} params - What followed the media type, `;base64` among them
 * @param {string} data - The payload
 * @returns {Uint8Array} Empty when it cannot be read
 */
export function decodeDataPayload(params, data) {
  try {
    if (/;base64/i.test(params)) return Uint8Array.from(atob(data.trim()), c => c.charCodeAt(0))
    return new TextEncoder().encode(decodeURIComponent(data))
  } catch {
    return new Uint8Array()
  }
}

/**
 * What a `data:` address holds, or null for any other address or an empty one.
 *
 * @param {string} url
 * @returns {{mime: string, bytes: Uint8Array}|null}
 */
export function bytesOfDataUrl(url) {
  const found = DATA_URL.exec(url.trim())
  if (!found) return null
  const bytes = decodeDataPayload(found[2], found[3])
  return bytes.length > 0 ? { mime: found[1] || 'application/octet-stream', bytes } : null
}
