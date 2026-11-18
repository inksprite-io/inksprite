/**
 * @module utils/addressKeys
 * @description Keys written into an address, which a file made without keys
 * leaves out as it does the rest (utils/backup.js): a hosted MCP server's is
 * often part of its address, and a connection's endpoint can carry one.
 */

/** What stands in an address where a key was, in a file made without keys. */
export const KEY_LEFT_OUT = 'key-left-out'

/** Names a query parameter goes by when it carries a credential. */
const CREDENTIAL_NAME = /key|token|secret|auth|pass|sig|credential|access/i

/**
 * Whether a piece of an address looks like a credential rather than a word:
 * long, of the letters and digits a key is made of, with both among them.
 * An account's id in a path looks like one too, and is left out with them.
 *
 * @param {string} piece
 * @returns {boolean}
 */
const looksLikeKey = piece =>
  piece.length >= 20 && /^[\w\-.~+=%]+$/.test(piece) && /\d/.test(piece) && /[a-z]/i.test(piece)

/**
 * An address without the keys written into it: a password before the host,
 * a query parameter named for a credential or that looks like one, and a
 * piece of the path that looks like one, as a hosted server's often is. Each
 * leaves `KEY_LEFT_OUT` where it was, so the address shows where a key goes.
 * An address with none in it, or that is no address, comes back as it is.
 *
 * @param {unknown} address
 * @returns {any}
 */
export function withoutAddressKeys(address) {
  if (typeof address !== 'string' || !address) return address
  let url
  try {
    url = new URL(address)
  } catch {
    return address
  }
  let found = false
  if (url.password && url.username) {
    // Either may be the key, the other a word a service asks for beside it.
    url.username = KEY_LEFT_OUT
    url.password = KEY_LEFT_OUT
    found = true
  } else if (url.password || url.username) {
    if (url.password) url.password = KEY_LEFT_OUT
    else url.username = KEY_LEFT_OUT
    found = true
  }
  for (const [name, value] of [...url.searchParams]) {
    if (!value || !(CREDENTIAL_NAME.test(name) || looksLikeKey(value))) continue
    url.searchParams.set(name, KEY_LEFT_OUT)
    found = true
  }
  const pieces = url.pathname.split('/')
  if (pieces.some(looksLikeKey)) {
    url.pathname = pieces.map(piece => (looksLikeKey(piece) ? KEY_LEFT_OUT : piece)).join('/')
    found = true
  }
  return found ? url.href : address
}

/**
 * Whether an address has a key left out of it.
 *
 * @param {unknown} address
 * @returns {boolean}
 */
export const hasKeyLeftOut = address =>
  typeof address === 'string' && address.includes(KEY_LEFT_OUT)
