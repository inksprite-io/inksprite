/* global TextEncoder, btoa, atob, Response, Blob, CompressionStream, DecompressionStream */
/**
 * @module cloud/crypto
 * @description The keys sync is encrypted with, and what is done with them,
 * all on the device: the server gets ciphertext, hashed names, and a key
 * that signs in but opens nothing.
 *
 * - The **passphrase**, through PBKDF2 and a salt the account keeps, gives a
 *   master secret, which HKDF splits into the **sign-in key**, sent to the
 *   server, and the **wrapping key**, which never leaves the device.
 * - The **account key** is random. The server keeps it wrapped, and a device
 *   keeps what it makes (a key to wrap collection keys with, and a key to
 *   name collections with) as CryptoKeys that can't be exported.
 * - A **recovery code** is random as well: 25 characters of Crockford's
 *   base 32, 125 bits, too many to guess however fast each guess is, so HKDF
 *   alone makes its own sign-in key and wrapping key, and the server keeps
 *   the account key wrapped under it a second time.
 * - Each **collection's key** is random too, and kept wrapped under the
 *   account's. HKDF makes from it the key its records are encrypted with
 *   and the key their names are hashed with.
 * - For sharing, an account has a **key pair** (ECDH on P-256): the server
 *   keeps the public half, and the private half sealed under the account
 *   key. A collection shared is wrapped for a friend's public key, and the
 *   friend found by a **friend code**, the public key's fingerprint, which
 *   the server can't forge a key for. In a shared collection a chat is its
 *   writer's **own**, sealed under a key their account makes from the
 *   collection's id, which no other account has.
 *
 * Everything sealed is AES-GCM with a random nonce before the ciphertext,
 * and with what it is (a collection and a record's name) as additional
 * data, so that a body moved to another record does not open there.
 *
 * Design: `.llm/sync_design.md`, "Keys".
 */

const subtle = globalThis.crypto.subtle

/** How keys are made from a passphrase, as the account keeps it. */
export const KDF = { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000 }

/** @typedef {{name: string, hash: string, iterations: number}} Kdf */

/** Bytes as WebCrypto takes them. @typedef {Uint8Array<ArrayBuffer>} Bytes */

/**
 * What a device keeps of the account, to read and write its collections.
 * @typedef {Object} AccountKeys
 * @property {CryptoKey} wrap - Wraps and unwraps collections' keys
 * @property {CryptoKey} ids - Names collections after their projects
 */

/**
 * What a device holds of one collection, in memory.
 * @typedef {Object} CollectionKeys
 * @property {CryptoKey} seal - Encrypts its records and files
 * @property {CryptoKey} names - Hashes its records' names
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * @param {number} size - 65,536 at most
 * @returns {Bytes}
 */
export const randomBytes = size => globalThis.crypto.getRandomValues(new Uint8Array(size))

/** @param {Uint8Array} bytes */
export function toBase64(bytes) {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(text)
}

/**
 * @param {string} text
 * @returns {Bytes}
 */
export function fromBase64(text) {
  const raw = atob(text)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** @param {Uint8Array} bytes */
const toBase64Url = bytes =>
  toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * HKDF's base key, from a secret.
 * @param {Bytes} secret
 */
const hkdfBase = secret =>
  subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey', 'deriveBits'])

/**
 * HKDF's settings, for what a key is for.
 * @param {string} info
 */
const hkdf = info => ({
  name: 'HKDF',
  hash: 'SHA-256',
  salt: new Uint8Array(0),
  info: encoder.encode(info),
})

/**
 * An AES-GCM key from a secret, for what it is for.
 * @param {CryptoKey} base
 * @param {string} info
 */
const aesFrom = (base, info) =>
  subtle.deriveKey(hkdf(info), base, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])

/**
 * An HMAC key from a secret, for what it is for.
 * @param {CryptoKey} base
 * @param {string} info
 */
const hmacFrom = (base, info) =>
  subtle.deriveKey(hkdf(info), base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, [
    'sign',
  ])

/**
 * The sign-in key and the wrapping key, from the passphrase.
 *
 * @param {string} passphrase
 * @param {Bytes} salt
 * @param {Kdf} [kdf]
 * @returns {Promise<{auth: Bytes, wrapping: CryptoKey}>}
 */
export async function passphraseKeys(passphrase, salt, kdf = KDF) {
  if (kdf.name !== 'PBKDF2') throw new Error(`This version of inksprite can't use ${kdf.name}.`)
  const typed = await subtle.importKey(
    'raw',
    encoder.encode(passphrase.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const master = new Uint8Array(
    await subtle.deriveBits(
      { name: 'PBKDF2', hash: kdf.hash, salt, iterations: kdf.iterations },
      typed,
      256
    )
  )
  const base = await hkdfBase(master)
  const auth = new Uint8Array(await subtle.deriveBits(hkdf('inksprite sign-in'), base, 256))
  return { auth, wrapping: await aesFrom(base, 'inksprite wrapping') }
}

/** The letters a recovery code is written in: Crockford's base 32. */
const CODE_LETTERS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** How many letters a recovery code has: 125 bits. */
const CODE_LENGTH = 25

/**
 * A new recovery code, in groups of five: `7KQ4M-2XWPD-…`.
 * @returns {string}
 */
export function makeRecoveryCode() {
  // 32 letters divide 256, so each byte gives one letter with no bias.
  const letters = [...randomBytes(CODE_LENGTH)].map(byte => CODE_LETTERS[byte & 31]).join('')
  return letters.match(/.{5}/g)?.join('-') ?? letters
}

/**
 * A recovery code as typed back, read the way Crockford's base 32 is: any
 * case, I and L as 1, O as 0, spaces and dashes ignored.
 *
 * @param {string} typed
 * @returns {string|null} Its 25 letters, or null for what isn't one
 */
export function readRecoveryCode(typed) {
  const letters = typed.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
  if (letters.length !== CODE_LENGTH) return null
  return [...letters].every(letter => CODE_LETTERS.includes(letter)) ? letters : null
}

/**
 * The sign-in key and the wrapping key, from a recovery code.
 *
 * @param {string} code - As `readRecoveryCode` gives it
 * @returns {Promise<{auth: Bytes, wrapping: CryptoKey}>}
 */
export async function recoveryKeys(code) {
  const base = await hkdfBase(encoder.encode(code))
  const auth = new Uint8Array(
    await subtle.deriveBits(hkdf('inksprite recovery sign-in'), base, 256)
  )
  return { auth, wrapping: await aesFrom(base, 'inksprite recovery wrapping') }
}

/**
 * What the device keeps of an account, from its key.
 * @param {Bytes} accountSecret
 * @returns {Promise<AccountKeys>}
 */
export async function accountKeys(accountSecret) {
  const base = await hkdfBase(accountSecret)
  return {
    wrap: await aesFrom(base, 'inksprite collections'),
    ids: await hmacFrom(base, 'inksprite collection ids'),
  }
}

/**
 * What the device holds of a collection, from its key.
 * @param {Bytes} secret
 * @returns {Promise<CollectionKeys>}
 */
export async function collectionKeys(secret) {
  const base = await hkdfBase(secret)
  return {
    seal: await aesFrom(base, 'inksprite records'),
    names: await hmacFrom(base, 'inksprite record names'),
  }
}

/**
 * The keys this account's own records in a collection are sealed with: made
 * from the collection's id under the account's id key, the same on each of
 * its devices, and on no other account's.
 * @param {CryptoKey} ids - The account's
 * @param {string} collectionId
 * @returns {Promise<CollectionKeys>}
 */
export async function ownKeys(ids, collectionId) {
  const secret = new Uint8Array(
    await subtle.sign('HMAC', ids, encoder.encode(`own ${collectionId}`))
  )
  return collectionKeys(secret)
}

/** What the private half of an account's key pair is sealed as. */
const PRIVATE_KEY = 'inksprite private key'

/** ECDH on P-256, which every engine's WebCrypto has. */
const ECDH = { name: 'ECDH', namedCurve: 'P-256' }

/**
 * A new key pair for sharing: the public half as the server keeps it, and
 * the private half sealed under the account key.
 * @param {CryptoKey} wrap - The account's
 * @returns {Promise<{publicKey: Bytes, privateKey: Bytes}>}
 */
export async function makeKeyPair(wrap) {
  const pair = /** @type {CryptoKeyPair} */ (await subtle.generateKey(ECDH, true, ['deriveBits']))
  const publicKey = new Uint8Array(await subtle.exportKey('spki', pair.publicKey))
  const privateKey = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey))
  return { publicKey, privateKey: await seal(wrap, privateKey, PRIVATE_KEY) }
}

/**
 * The private half of the key pair, opened, as a key that can't be exported.
 * @param {CryptoKey} wrap - The account's
 * @param {Bytes} sealed
 * @returns {Promise<CryptoKey>}
 */
export async function openPrivateKey(wrap, sealed) {
  const pkcs8 = await open(wrap, sealed, PRIVATE_KEY)
  return subtle.importKey('pkcs8', pkcs8, ECDH, false, ['deriveBits'])
}

/**
 * The AES-GCM key two halves of two key pairs agree on.
 * @param {CryptoKey} privateKey
 * @param {CryptoKey} publicKey
 */
async function agreed(privateKey, publicKey) {
  const bits = new Uint8Array(
    await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  )
  return aesFrom(await hkdfBase(bits), 'inksprite share')
}

/** How long a P-256 public key is, raw: the point, uncompressed. */
const RAW_POINT = 65

/**
 * Seal a secret for whoever holds the private half of a public key: with a
 * key pair made for this once, whose public half goes first.
 * @param {Bytes} publicKey - Theirs, as the server keeps it
 * @param {Bytes} secret
 * @param {string} about
 * @returns {Promise<Bytes>}
 */
export async function sealFor(publicKey, secret, about) {
  const theirs = await subtle.importKey('spki', publicKey, ECDH, false, [])
  const once = /** @type {CryptoKeyPair} */ (await subtle.generateKey(ECDH, true, ['deriveBits']))
  const point = new Uint8Array(await subtle.exportKey('raw', once.publicKey))
  const sealed = await seal(await agreed(once.privateKey, theirs), secret, about)
  const out = new Uint8Array(point.length + sealed.length)
  out.set(point)
  out.set(sealed, point.length)
  return out
}

/**
 * What `sealFor` sealed for this account.
 * @param {CryptoKey} privateKey - This account's
 * @param {Bytes} sealed
 * @param {string} about
 * @returns {Promise<Bytes>}
 */
export async function openFor(privateKey, sealed, about) {
  const point = await subtle.importKey('raw', sealed.subarray(0, RAW_POINT), ECDH, false, [])
  return open(await agreed(privateKey, point), sealed.subarray(RAW_POINT), about)
}

/** How many letters a friend code has: 100 bits. */
const FRIEND_LENGTH = 20

/**
 * An account's friend code, from its public key: the first 100 bits of the
 * key's SHA-256, as the server makes it (`server/src/friends.js`).
 * @param {Bytes} publicKey
 * @returns {Promise<string>} In groups of five, `7KQ4M-2XWPD-9HJ3N-QRT5V`
 */
export async function friendCode(publicKey) {
  const digest = new Uint8Array(await subtle.digest('SHA-256', publicKey))
  let bits = 0n
  for (const byte of digest.subarray(0, 13)) bits = (bits << 8n) | BigInt(byte)
  bits >>= 4n
  let letters = ''
  for (let at = FRIEND_LENGTH - 1; at >= 0; at--) {
    letters += CODE_LETTERS[Number((bits >> BigInt(5 * at)) & 31n)]
  }
  return /** @type {string[]} */ (letters.match(/.{5}/g)).join('-')
}

/**
 * A friend code as typed, read as a recovery code is.
 * @param {string} typed
 * @returns {string|null} Its letters in groups of five, or null for what isn't one
 */
export function readFriendCode(typed) {
  const letters = typed.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
  if (letters.length !== FRIEND_LENGTH) return null
  if (![...letters].every(letter => CODE_LETTERS.includes(letter))) return null
  return /** @type {string[]} */ (letters.match(/.{5}/g)).join('-')
}

/**
 * Encrypt, the nonce first.
 *
 * @param {CryptoKey} key
 * @param {Bytes} plain
 * @param {string} about - What it is, which opening it must say again
 * @returns {Promise<Bytes>}
 */
export async function seal(key, plain, about) {
  const iv = randomBytes(12)
  const sealed = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(about) }, key, plain)
  )
  const out = new Uint8Array(iv.length + sealed.length)
  out.set(iv)
  out.set(sealed, iv.length)
  return out
}

/**
 * Decrypt what `seal` made.
 *
 * @param {CryptoKey} key
 * @param {Bytes} sealed
 * @param {string} about
 * @returns {Promise<Bytes>}
 * @throws {Error} When it was sealed with another key, or as something else
 */
export async function open(key, sealed, about) {
  return new Uint8Array(
    await subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.subarray(0, 12), additionalData: encoder.encode(about) },
      key,
      sealed.subarray(12)
    )
  )
}

/**
 * A name the server can't read back: an HMAC, in base64url.
 * @param {CryptoKey} key
 * @param {string} name
 */
export async function hashName(key, name) {
  return toBase64Url(new Uint8Array(await subtle.sign('HMAC', key, encoder.encode(name))))
}

/**
 * Bytes run through a stream of the browser's, compressing or not.
 * @param {Bytes} bytes
 * @param {CompressionStream|DecompressionStream} stream
 * @returns {Promise<Bytes>}
 */
async function through(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}

/**
 * A value sealed as JSON, gzipped first: chats are text, and shrink to a
 * quarter.
 *
 * @param {CryptoKey} key
 * @param {unknown} value
 * @param {string} about
 */
export async function sealJson(key, value, about) {
  const json = encoder.encode(JSON.stringify(value))
  return seal(key, await through(json, new CompressionStream('gzip')), about)
}

/**
 * What `sealJson` sealed.
 * @param {CryptoKey} key
 * @param {Bytes} sealed
 * @param {string} about
 */
export async function openJson(key, sealed, about) {
  const zipped = await open(key, sealed, about)
  return JSON.parse(decoder.decode(await through(zipped, new DecompressionStream('gzip'))))
}

/**
 * A fingerprint of a value, the same for the same value whatever order its
 * keys were written in.
 *
 * @param {unknown} value
 * @returns {Promise<string>}
 */
export async function fingerprint(value) {
  const digest = await subtle.digest('SHA-256', encoder.encode(stableJson(value)))
  return toBase64Url(new Uint8Array(digest))
}

/**
 * JSON with every object's keys in order, and nothing JSON would leave out.
 * @param {unknown} value
 * @returns {string}
 */
export function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined && typeof item !== 'function')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
}
