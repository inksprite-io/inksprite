/**
 * @module drive/session
 * @description The Google sign-in a sync works with, kept so that one sync
 * after another shows nothing.
 *
 * A sync signs in plainly, without the picker: Drive gave the app the Doc
 * at its pick, and an account that has consented once is signed in by a
 * window that closes by itself, hinted with the account the Doc was linked
 * from. In a browser the token is then held in memory, by account, for the
 * hour it lasts: a page cannot keep a refresh token, since trading one needs
 * the client's secret. An import's token is held the same way, so a sync
 * straight after it needs no window at all. In the desktop window the
 * refresh token every sign-in comes with is kept, by account, in this
 * machine's local storage, as an MCP server's tokens are, and never in the
 * database: a backup handed around would hand the sign-in around with it.
 * Syncs there are silent until the writer takes the app's access back in
 * their Google account.
 */

import { localStorage } from '@/utils/localStorage.js'
import { accountOf } from './api.js'
import { driveConfig } from './config.js'
import { refreshSession, signInInBrowser, signInInPopup } from './signIn.js'

/** @typedef {import('./signIn.js').Session} Session */

/** Where the desktop app keeps refresh tokens, by account. */
const REFRESH_KEY = 'inksprite_google_refresh'

/**
 * The refresh tokens kept, by account.
 *
 * @returns {Record<string, string>}
 */
const refreshTokens = () => localStorage.get(REFRESH_KEY, {}) ?? {}

/** A token this close to its end is let go: a sync takes a few calls. */
const MARGIN_MS = 2 * 60 * 1000

/**
 * Tokens held, by account; under '' for one whose account is not known.
 *
 * @type {Map<string, {token: string, expiresAt: number}>}
 */
const held = new Map()

/**
 * A sign-in, with the account it is for.
 *
 * @typedef {{token: string, account: string|null}} Signed
 */

/**
 * Keep a sign-in for the syncs after it: its token for as long as it
 * lasts, and in the desktop window its refresh token.
 *
 * @param {string|null|undefined} account - By address
 * @param {Session} session
 */
export function keepSession(account, { token, expiresAt, refreshToken }) {
  held.set(account || '', { token, expiresAt })
  if (refreshToken && account) {
    localStorage.set(REFRESH_KEY, { ...refreshTokens(), [account]: refreshToken })
  }
}

/**
 * Let go of the token held for an account, which Google stopped taking.
 *
 * @param {string|null|undefined} account
 */
export function forgetSession(account) {
  held.delete(account || '')
}

/** Forget every token held. For tests. */
export const clearSessions = () => held.clear()

/**
 * A token for an account: one held, a fresh one from a kept refresh token,
 * or a plain sign-in. In a browser, call it straight from a click, with
 * nothing awaited first: when no token is held, it opens Google's window
 * before it returns.
 *
 * @param {string|null|undefined} account - The address the Doc was linked
 *   from; when not known, whoever signs in, and then their address is asked
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Signed|null>} Null when the writer cancelled
 */
export function signInFor(account, { signal } = {}) {
  const config = driveConfig()
  if (!config) return Promise.reject(new Error('This build has no Google client.'))
  const now = held.get(account || '')
  if (now && now.expiresAt - MARGIN_MS > Date.now()) {
    return Promise.resolve({ token: now.token, account: account || null })
  }
  if (config.kind === 'web') {
    return signInInPopup(config.clientId, { loginHint: account || undefined, signal }).then(
      session => session && remember(account, session, signal)
    )
  }
  return inDesktop(config, account, signal)
}

/**
 * In the desktop window: a token from the refresh token kept for the
 * account, or a sign-in in the system browser when there is none, or
 * Google no longer takes it.
 *
 * @param {{clientId: string, clientSecret: string}} client
 * @param {string|null|undefined} account
 * @param {AbortSignal} [signal]
 * @returns {Promise<Signed|null>}
 */
async function inDesktop(client, account, signal) {
  const kept = account ? refreshTokens()[account] : undefined
  if (kept) {
    try {
      return await remember(account, await refreshSession(client, kept, { signal }), signal)
    } catch (error) {
      if (signal?.aborted || !(/** @type {any} */ (error)?.refused)) throw error
      const rest = refreshTokens()
      delete rest[/** @type {string} */ (account)]
      localStorage.set(REFRESH_KEY, rest)
    }
  }
  const session = await signInInBrowser(client, { loginHint: account || undefined, signal })
  return session && remember(account, session, signal)
}

/**
 * Keep a fresh sign-in, under its account, asked of Drive when not known.
 *
 * @param {string|null|undefined} account
 * @param {Session} session
 * @param {AbortSignal} [signal]
 * @returns {Promise<Signed>}
 */
async function remember(account, session, signal) {
  const known = account || (await accountOf(session.token, { signal }))
  keepSession(known, session)
  if (known && !account) keepSession('', session)
  return { token: session.token, account: known }
}
