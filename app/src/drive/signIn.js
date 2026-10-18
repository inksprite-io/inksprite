/* global URLSearchParams, BroadcastChannel */
/**
 * @module drive/signIn
 * @description Signing in to Google with its picker: the writer chooses the
 * files on Google's own page, and the sign-in comes back with them.
 *
 * Asked for with `trigger_onepick=true`, Google's sign-in shows its picker
 * after the consent screen, and sends the browser back with the picked
 * files' ids (`picked_file_ids`) beside the token or the code. Nothing of
 * Google's loads in the app's page for it, before or after.
 *
 * - **In a browser**, a popup, opened straight from the click, asks for a
 *   token. Google sends it back to `/connect/google` on this origin with the
 *   token and the ids in the fragment, and that page hands them to this one
 *   on a BroadcastChannel and closes. The channel, not `window.opener`:
 *   Google's pages can cut the popup's tie to the window that opened it.
 * - **In the desktop window**, the system browser asks for a code, with
 *   PKCE. Google sends it back to the app's listener on localhost, and the
 *   code is traded for a token with the desktop client's secret, which
 *   comes with a refresh token, for signing in again without the browser.
 *
 * Every import signs in afresh: Google asks for consent each time it shows
 * this picker. A sync signs in plainly, without it: Drive gave the app the
 * Doc at its pick, and an account that has consented once is signed in
 * without a word (`drive/session.js` keeps what it comes back with).
 */

import { fetch } from '@/platform/fetch.js'
import { callbackOrigin, signInInBrowser as waitInBrowser } from '@/platform/signIn.js'
import { generateCodeChallenge, generateCodeVerifier, generateState } from '@/utils/oauth.js'
import { DriveError, PopupBlockedError } from './errors.js'

/** Where Google sends a sign-in back to, on the page's origin or the desktop app's listener. */
export const CALLBACK_PATH = '/connect/google'

/** The channel the page at `CALLBACK_PATH` hands a sign-in back on. */
export const SIGN_IN_CHANNEL = 'inksprite-google-drive'

/** The files the writer picks, and nothing else in their Drive. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'

/**
 * A finished sign-in: the token, until when it lasts, and in the desktop
 * window the refresh token that comes with it.
 *
 * @typedef {Object} Session
 * @property {string} token
 * @property {number} expiresAt - When the token stops being taken, in ms
 * @property {string} [refreshToken]
 */

/**
 * A finished sign-in with the picker: the files picked with it too.
 *
 * @typedef {Session & {ids: string[]}} Picked
 */

/** How long a token lasts when Google does not say: its usual hour. */
const LIFETIME = 3600

/**
 * When a token Google says lasts this many seconds stops being taken.
 *
 * @param {string|number|null|undefined} seconds
 * @returns {number}
 */
const expiryOf = seconds => Date.now() + (Number(seconds) > 0 ? Number(seconds) : LIFETIME) * 1000

/**
 * The address of Google's sign-in, with its picker or without.
 *
 * @param {Object} options
 * @param {string} options.clientId
 * @param {string} options.redirectUri
 * @param {'token'|'code'} options.responseType
 * @param {string} options.state
 * @param {string} [options.codeChallenge] - PKCE, for a code
 * @param {boolean} [options.pick] - Show the picker; true unless false
 * @param {string} [options.loginHint] - The account to sign in, by address
 * @returns {string}
 */
export function authorizationUrl({
  clientId,
  redirectUri,
  responseType,
  state,
  codeChallenge,
  pick = true,
  loginHint,
}) {
  const url = new URL(AUTHORIZE)
  /** @type {Record<string, string>} */
  const params = {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: responseType,
    scope: DRIVE_SCOPE,
    state,
  }
  if (pick) {
    // Both required for the picker, which is why consent comes every time.
    params.prompt = 'consent'
    params.trigger_onepick = 'true'
    params.allow_multiple = 'true'
  }
  // No prompt without the picker, not even `none`: Google can still ask
  // when it must, a browser signed out or a grant taken back.
  if (loginHint) params.login_hint = loginHint
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  if (codeChallenge) {
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
  }
  return url.toString()
}

/**
 * What a sign-in came back with.
 *
 * @param {URLSearchParams} params - The fragment or the query it came back with
 * @param {string} state - What this sign-in was asked with
 * @param {Object} [options]
 * @param {boolean} [options.pick] - It showed the picker; true unless false
 * @returns {{token: string|null, code: string|null, ids: string[], expiresIn?: string}|null}
 *   Null when the writer cancelled, or picked nothing from a picker
 * @throws {DriveError} When it is not this sign-in's, Google refused, or
 *   access to Drive was not allowed
 */
export function readReturn(params, state, { pick = true } = {}) {
  if (params.get('state') !== state) {
    throw new DriveError('Google’s answer was not for this sign-in.')
  }
  const error = params.get('error')
  if (error === 'access_denied') return null
  if (error) {
    throw new DriveError(
      `Google could not sign you in: ${params.get('error_description') || error}.`
    )
  }
  const scope = params.get('scope')
  if (scope !== null && !scope.split(' ').includes(DRIVE_SCOPE)) {
    throw new DriveError('Access to Drive was not allowed.')
  }
  const ids = (params.get('picked_file_ids') || '').split(',').filter(Boolean)
  if (pick && ids.length === 0) return null
  const expiresIn = params.get('expires_in')
  return {
    token: params.get('access_token'),
    code: params.get('code'),
    ids,
    ...(expiresIn && { expiresIn }),
  }
}

/**
 * Where a popup of this size sits centred over the window.
 *
 * @returns {string}
 */
function popupFeatures() {
  const width = Math.min(960, globalThis.screen?.availWidth || 960)
  const height = Math.min(720, globalThis.screen?.availHeight || 720)
  const left = Math.max(0, (window.screenX || 0) + ((window.outerWidth || width) - width) / 2)
  const top = Math.max(0, (window.screenY || 0) + ((window.outerHeight || height) - height) / 2)
  return `popup,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)}`
}

/**
 * In a browser: sign in and pick in a popup. Call it straight from a click,
 * with nothing awaited first: the popup opens before this returns.
 *
 * The popup's closing is not seen here, since Google's pages can cut the
 * tie to it; the writer's Cancel stops the wait by its signal, and closes
 * the popup if it still can.
 *
 * @param {string} clientId - The web client
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Picked|null>} Null when the writer cancelled or picked nothing
 */
export function pickInPopup(clientId, { signal } = {}) {
  return inPopup(clientId, { pick: true, signal })
}

/**
 * In a browser: sign in without the picker, in a popup that closes by
 * itself for an account that has consented. Call it straight from a click,
 * as `pickInPopup`.
 *
 * @param {string} clientId - The web client
 * @param {Object} [options]
 * @param {string} [options.loginHint] - The account, by address
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Session|null>} Null when the writer cancelled
 */
export function signInInPopup(clientId, { loginHint, signal } = {}) {
  return inPopup(clientId, { pick: false, loginHint, signal })
}

/**
 * A sign-in in a popup, with the picker or without.
 *
 * @param {string} clientId
 * @param {Object} options
 * @param {boolean} options.pick
 * @param {string} [options.loginHint]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Picked|null>}
 */
function inPopup(clientId, { pick, loginHint, signal }) {
  if (signal?.aborted) return Promise.reject(signal.reason)
  const state = generateState()
  const redirectUri = `${globalThis.location.origin}${CALLBACK_PATH}`
  const popup = window.open(
    authorizationUrl({ clientId, redirectUri, responseType: 'token', state, pick, loginHint }),
    'inksprite-google',
    popupFeatures()
  )
  if (!popup) return Promise.reject(new PopupBlockedError())

  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(SIGN_IN_CHANNEL)
    const done = () => {
      channel.close()
      signal?.removeEventListener('abort', stop)
    }
    const stop = () => {
      done()
      popup.close()
      reject(signal?.reason)
    }
    channel.onmessage = event => {
      const params = new URLSearchParams(String(event.data?.fragment || ''))
      // Another window's sign-in, finishing at the same time.
      if (params.get('state') !== state) return
      done()
      try {
        const read = readReturn(params, state, { pick })
        if (read && !read.token) throw new DriveError('Google sent no token.')
        resolve(
          read && {
            token: /** @type {string} */ (read.token),
            ids: read.ids,
            expiresAt: expiryOf(read.expiresIn),
          }
        )
      } catch (error) {
        reject(error)
      }
    }
    signal?.addEventListener('abort', stop, { once: true })
  })
}

/**
 * On the page Google sends the popup back to: hand what it came back with to
 * the window that asked.
 *
 * @param {string} fragment - The page's fragment, without its `#`
 */
export function relayReturn(fragment) {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(SIGN_IN_CHANNEL)
  channel.postMessage({ fragment })
  channel.close()
}

/**
 * Ask Google's token endpoint for a token, as the desktop client.
 *
 * @param {{clientId: string, clientSecret: string}} client
 * @param {Record<string, string>} fields - The grant
 * @param {AbortSignal} [signal]
 * @returns {Promise<Session>}
 * @throws {DriveError} When Google refuses, with its reason
 */
async function grant({ clientId, clientSecret }, fields, signal) {
  const response = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      ...fields,
    }).toString(),
    signal,
  })
  /** @type {any} */
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.access_token) {
    const reason = body?.error_description || body?.error || `it answered ${response.status}`
    throw Object.assign(new DriveError(`Google could not finish the sign-in: ${reason}.`), {
      refused: body?.error === 'invalid_grant',
    })
  }
  return {
    token: body.access_token,
    expiresAt: expiryOf(body.expires_in),
    ...(body.refresh_token && { refreshToken: body.refresh_token }),
  }
}

/**
 * Trade a desktop sign-in's code for a token, and the refresh token that
 * comes with it.
 *
 * @param {Object} options
 * @param {string} options.clientId
 * @param {string} options.clientSecret
 * @param {string} options.code
 * @param {string} options.verifier - The PKCE verifier the sign-in was asked with
 * @param {string} options.redirectUri
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Session>}
 */
export function exchangeCode({ clientId, clientSecret, code, verifier, redirectUri, signal }) {
  return grant(
    { clientId, clientSecret },
    {
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    },
    signal
  )
}

/**
 * A fresh token from a refresh token, with no browser: the desktop client's,
 * until the writer takes the app's access back in their Google account.
 *
 * @param {{clientId: string, clientSecret: string}} client - The desktop client
 * @param {string} refreshToken
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Session>}
 * @throws {DriveError} With `refused` set when Google no longer takes the refresh token
 */
export function refreshSession(client, refreshToken, { signal } = {}) {
  return grant(client, { refresh_token: refreshToken, grant_type: 'refresh_token' }, signal)
}

/**
 * In the desktop window: sign in and pick in the system browser, and wait
 * for it to come back to the app.
 *
 * @param {{clientId: string, clientSecret: string}} client - The desktop client
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Picked|null>} Null when the writer cancelled or picked nothing
 */
export function pickInBrowser(client, { signal } = {}) {
  return inBrowser(client, { pick: true, signal })
}

/**
 * In the desktop window: sign in without the picker, in the system browser.
 *
 * @param {{clientId: string, clientSecret: string}} client - The desktop client
 * @param {Object} [options]
 * @param {string} [options.loginHint] - The account, by address
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Session|null>} Null when the writer cancelled
 */
export function signInInBrowser(client, { loginHint, signal } = {}) {
  return inBrowser(client, { pick: false, loginHint, signal })
}

/**
 * A sign-in in the system browser, with the picker or without.
 *
 * @param {{clientId: string, clientSecret: string}} client
 * @param {Object} options
 * @param {boolean} options.pick
 * @param {string} [options.loginHint]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Picked|null>}
 */
async function inBrowser({ clientId, clientSecret }, { pick, loginHint, signal }) {
  const state = generateState()
  const verifier = generateCodeVerifier()
  const redirectUri = `${callbackOrigin()}${CALLBACK_PATH}`
  const address = authorizationUrl({
    clientId,
    redirectUri,
    responseType: 'code',
    state,
    codeChallenge: await generateCodeChallenge(verifier),
    pick,
    loginHint,
  })
  const read = readReturn(await waitInBrowser(address, CALLBACK_PATH, { signal }), state, {
    pick,
  })
  if (!read) return null
  if (!read.code) throw new DriveError('Google sent no code.')
  const session = await exchangeCode({
    clientId,
    clientSecret,
    code: read.code,
    verifier,
    redirectUri,
    signal,
  })
  return { ...session, ids: read.ids }
}
