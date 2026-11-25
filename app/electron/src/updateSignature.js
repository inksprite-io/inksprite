/**
 * What says an update is ours, where nothing else does.
 *
 * A Mac refuses an update not signed by the developer the app is from. On
 * Windows and Linux the builds carry no such signature, and the updater only
 * checks a download against the hash its `latest*.yml` gives, which sits in
 * the same release: whoever could put a file there could put its hash there
 * too. So the release workflow signs each update with a key the release
 * environment alone holds (`scripts/sign-updates.js`), and the app checks
 * each update it downloads against the keys it was built with (`updates.js`):
 * one that none of them answers for is refused, once the check itself has
 * been seen to work (`UPDATE_CHECK` in `updateKeys.js`).
 *
 * What is signed is which update it is, its version and its file's name, and
 * the hash of the file. The version is in it so that an old update, signed
 * in its day, can't be handed out again as a new one.
 *
 * The signature goes beside the update in its release, as `<file>.sig`: the
 * three things signed, and the signature over them. `latest*.yml` is left as
 * the updater wrote it, for the apps from before that read it too.
 */

import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { createReadStream } from 'node:fs'

/**
 * An update as it is signed.
 *
 * @typedef {Object} SignedUpdate
 * @property {string} version - The app's, as the release is tagged without its `v`
 * @property {string} file - The update's file, by its name in the release
 * @property {string} sha512 - The file's hash, in base 64
 */

/**
 * The text a signature is over.
 *
 * @param {SignedUpdate} update
 * @returns {Buffer}
 */
const signedText = ({ version, file, sha512 }) =>
  Buffer.from(['inksprite update', version, file, sha512].join('\n'))

/**
 * How a key signs: an Ed25519 key hashes for itself, and any other (an
 * elliptic curve key, which the openssl on a Mac makes) signs a SHA-256.
 *
 * @param {import('node:crypto').KeyObject} key
 * @returns {string|null}
 */
const digestFor = key => (key.asymmetricKeyType === 'ed25519' ? null : 'sha256')

/**
 * A file's SHA-512, in base 64, read a piece at a time.
 *
 * @param {string} path
 * @returns {Promise<string>}
 */
export function hashOf(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    createReadStream(path)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('base64')))
  })
}

/**
 * An update's signature, as the `.sig` beside it says it.
 *
 * @param {SignedUpdate} update
 * @param {string} privateKey - In PEM
 * @returns {SignedUpdate & {signature: string}}
 */
export function signUpdate({ version, file, sha512 }, privateKey) {
  const key = createPrivateKey(privateKey)
  const update = { version, file, sha512 }
  return { ...update, signature: sign(digestFor(key), signedText(update), key).toString('base64') }
}

/**
 * What is wrong with an update's signature, if anything: it has to be for
 * the version being installed and for the file that was downloaded, by its
 * name as well as its bytes, so that one build of ours can't be served in
 * place of another, and one of the keys has to answer for it.
 *
 * @param {string} written - The `.sig`, as it was read
 * @param {object} expected
 * @param {string} expected.version - The version being installed
 * @param {string} expected.file - The downloaded file's name
 * @param {string} expected.sha512 - The downloaded file's hash, in base 64
 * @param {string[]} expected.keys - The public keys the app was built with, in PEM
 * @returns {string|null} Null when the update is ours
 */
export function signatureProblem(written, { version, file, sha512, keys }) {
  let said
  try {
    said = JSON.parse(written)
  } catch {
    return 'it is not a signature'
  }
  const fields = ['version', 'file', 'sha512', 'signature']
  if (!said || fields.some(field => typeof said[field] !== 'string')) {
    return 'it is not a signature'
  }
  if (said.version !== version) return `it is for ${said.version}, not ${version}`
  if (said.file !== file) return `it is for ${said.file}, not ${file}`
  if (said.sha512 !== sha512) return 'it is for another file'
  const signature = Buffer.from(said.signature, 'base64')
  const ours = keys.some(pem => {
    try {
      const key = createPublicKey(pem)
      return verify(digestFor(key), signedText(said), key, signature)
    } catch {
      return false
    }
  })
  return ours ? null : 'no key the app has made it'
}
