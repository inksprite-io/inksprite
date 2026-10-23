/**
 * @module cloud/account
 * @description Making a sync account and signing a device in to one: the
 * keys made from the passphrase here, the account key made here or
 * unwrapped here, and the server told only what signs in.
 *
 * The account key is wrapped twice: under the passphrase, and under a
 * recovery code, made with the account and shown once. Either signs in. A
 * change to either takes the passphrase typed again (or the code, to set a
 * new passphrase), since a device keeps only keys made from the account key,
 * not the key itself. Signing in with the code sets a new passphrase and
 * makes a new code in its place.
 *
 * Design: `.llm/sync_design.md`, "Keys".
 */

import {
  KDF,
  accountKeys,
  fromBase64,
  makeRecoveryCode,
  open,
  passphraseKeys,
  randomBytes,
  readRecoveryCode,
  recoveryKeys,
  seal,
} from './crypto.js'
import { nameProblem } from './names.js'

/** @typedef {import('./api.js').Api} Api */
/** @typedef {import('./crypto.js').AccountKeys} AccountKeys */
/** @typedef {import('./crypto.js').Bytes} Bytes */
/** @typedef {import('./crypto.js').Kdf} Kdf */

/** What the account key is sealed as, under the wrapping key. */
const ACCOUNT = 'inksprite account'

/**
 * A new recovery code for an account key: the code to show, and what the
 * server keeps of it.
 * @param {Bytes} secret
 */
async function recoveryFor(secret) {
  const code = makeRecoveryCode()
  const { auth, wrapping } = await recoveryKeys(/** @type {string} */ (readRecoveryCode(code)))
  return { code, auth, key: await seal(wrapping, secret, ACCOUNT) }
}

/**
 * The fewest characters a new passphrase may have. Whoever holds the
 * server's database can try passphrases against it as fast as the key
 * derivation lets them; one signing in is not held to it.
 */
export const SHORTEST_PASSPHRASE = 12

/**
 * Refuse a new passphrase too short to stand up to that.
 * @param {string} passphrase
 */
function longEnough(passphrase) {
  if (passphrase.length < SHORTEST_PASSPHRASE) {
    throw new Error(`Use a passphrase of at least ${SHORTEST_PASSPHRASE} characters.`)
  }
}

/**
 * What the server keeps of a passphrase for an account key.
 * @param {string} passphrase
 * @param {Bytes} secret
 * @param {Kdf} kdf
 */
async function passphraseFor(passphrase, secret, kdf) {
  longEnough(passphrase)
  const salt = randomBytes(16)
  const { auth, wrapping } = await passphraseKeys(passphrase, salt, kdf)
  return { salt, kdf, auth, key: await seal(wrapping, secret, ACCOUNT) }
}

/**
 * Make an account, and sign this device in to it.
 *
 * @param {Api} api
 * @param {{name: string, passphrase: string, code: string, device: string, kdf?: Kdf}} account
 * @returns {Promise<{token: string, keys: AccountKeys, recoveryCode: string}>}
 */
export async function signUp(api, { name, passphrase, code, device, kdf = KDF }) {
  const problem = nameProblem(name)
  if (problem) throw new Error(problem)
  longEnough(passphrase)
  const salt = randomBytes(16)
  const { auth, wrapping } = await passphraseKeys(passphrase, salt, kdf)
  const secret = randomBytes(32)
  const key = await seal(wrapping, secret, ACCOUNT)
  const recovery = await recoveryFor(secret)
  const { token } = await api.signUp({
    name,
    salt,
    kdf,
    auth,
    key,
    recovery: { auth: recovery.auth, key: recovery.key },
    code,
    device,
  })
  return { token, keys: await accountKeys(secret), recoveryCode: recovery.code }
}

/**
 * Sign this device in to an account.
 *
 * @param {Api} api
 * @param {{name: string, passphrase: string, device: string}} account
 * @returns {Promise<{token: string, keys: AccountKeys}>}
 */
export async function signIn(api, { name, passphrase, device }) {
  const { salt, kdf } = await api.prelogin(name)
  const { auth, wrapping } = await passphraseKeys(passphrase, fromBase64(salt), kdf)
  const { token, key } = await api.signIn(name, auth, device)
  const secret = await open(wrapping, key, ACCOUNT)
  return { token, keys: await accountKeys(secret) }
}

/**
 * The account key, opened with the passphrase typed again, and the
 * passphrase's sign-in key to prove it with.
 *
 * @param {Api} api - As this device signed in
 * @param {string} passphrase
 * @returns {Promise<{secret: Bytes, auth: Bytes}>}
 * @throws {Error} For a passphrase that doesn't open it
 */
async function unlock(api, passphrase) {
  const account = await api.account()
  const { auth, wrapping } = await passphraseKeys(passphrase, account.salt, account.kdf)
  try {
    return { secret: await open(wrapping, account.key, ACCOUNT), auth }
  } catch {
    throw new Error('The passphrase is wrong.')
  }
}

/**
 * Make a new recovery code, in place of the one there was.
 *
 * @param {Api} api - As this device signed in
 * @param {string} passphrase
 * @returns {Promise<string>} The code, to show once
 */
export async function remakeRecovery(api, passphrase) {
  const { secret, auth } = await unlock(api, passphrase)
  const recovery = await recoveryFor(secret)
  await api.setRecovery({ current: auth }, recovery)
  return recovery.code
}

/**
 * Change the passphrase. Devices signed in stay so.
 *
 * @param {Api} api - As this device signed in
 * @param {{current: string, next: string, kdf?: Kdf}} passphrases
 */
export async function changePassphrase(api, { current, next, kdf = KDF }) {
  const { secret, auth } = await unlock(api, current)
  await api.setPassphrase({ current: auth }, await passphraseFor(next, secret, kdf))
}

/**
 * Sign this device in with a recovery code, and set a new passphrase. The
 * code is used up: a new one is made in its place.
 *
 * @param {Api} api
 * @param {{name: string, code: string, passphrase: string, device: string, kdf?: Kdf}} recovering
 * @param {(token: string) => Api} as - The server, as this device signed in with a token
 * @returns {Promise<{token: string, keys: AccountKeys, recoveryCode: string}>}
 * @throws {Error} For what isn't a recovery code
 */
export async function recover(api, { name, code, passphrase, device, kdf = KDF }, as) {
  const read = readRecoveryCode(code)
  if (!read) throw new Error("That isn't a recovery code.")
  longEnough(passphrase)
  const used = await recoveryKeys(read)
  const { token, key } = await api.recover(name, used.auth, device)
  const secret = await open(used.wrapping, key, ACCOUNT)
  const signedIn = as(token)
  const next = await passphraseFor(passphrase, secret, kdf)
  await signedIn.setPassphrase({ recovery: used.auth }, next)
  const recovery = await recoveryFor(secret)
  await signedIn.setRecovery({ current: next.auth }, recovery)
  return { token, keys: await accountKeys(secret), recoveryCode: recovery.code }
}
