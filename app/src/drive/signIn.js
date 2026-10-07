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
 *   code is traded for a token with the desktop client's secret. The refresh
 *   token Google adds for a desktop app is let go.
 *
 * Every import signs in afresh: Google asks for consent each time it shows
 * this picker, and the token is used for the one import and not kept.
 */

import { fetch } from '@/platform/fetch.js'
import { callbackOrigin, signInInBrowser } from '@/platform/signIn.js'
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
 * A finished sign-in: the token, and the files picked with it.
 *
 * @typedef {Object} Picked
 * @property {string} token
 * @property {string[]} ids - The picked files' Drive ids
 */

/**
 * The address of Google's sign-in, with its picker.
 *
 * @param {Object} options
 * @param {string} options.clientId
 * @param {string} options.redirectUri
 * @param {'token'|'code'} options.responseType
 * @param {string} options.state
 * @param {string} [options.codeChallenge] - PKCE, for a code
 * @returns {string}
 */
export function authorizationUrl({ clientId, redirectUri, responseType, state, codeChallenge }) {
  const url = new URL(AUTHORIZE)
  const params = {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: responseType,
    scope: DRIVE_SCOPE,
    state,
    // Both required for the picker, which is why consent comes every time.
    prompt: 'consent',
    trigger_onepick: 'true',
    allow_multiple: 'true',
  }
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
 * @returns {{token: string|null, code: string|null, ids: string[]}|null} Null
 *   when the writer cancelled, or picked nothing
 * @throws {DriveError} When it is not this sign-in's, Google refused, or
 *   access to Drive was not allowed
 */
export function readReturn(params, state) {
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
  if (ids.length === 0) return null
  return { token: params.get('access_token'), code: params.get('code'), ids }
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
  if (signal?.aborted) return Promise.reject(signal.reason)
  const state = generateState()
  const redirectUri = `${globalThis.location.origin}${CALLBACK_PATH}`
  const popup = window.open(
    authorizationUrl({ clientId, redirectUri, responseType: 'token', state }),
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
        const read = readReturn(params, state)
        if (read && !read.token) throw new DriveError('Google sent no token.')
        resolve(read && { token: /** @type {string} */ (read.token), ids: read.ids })
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
 * Trade a desktop sign-in's code for a token.
 *
 * @param {Object} options
 * @param {string} options.clientId
 * @param {string} options.clientSecret
 * @param {string} options.code
 * @param {string} options.verifier - The PKCE verifier the sign-in was asked with
 * @param {string} options.redirectUri
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<string>} The access token
 */
export async function exchangeCode({
  clientId,
  clientSecret,
  code,
  verifier,
  redirectUri,
  signal,
}) {
  const response = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
    signal,
  })
  /** @type {any} */
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.access_token) {
    const reason = body?.error_description || body?.error || `it answered ${response.status}`
    throw new DriveError(`Google could not finish the sign-in: ${reason}.`)
  }
  return body.access_token
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
export async function pickInBrowser({ clientId, clientSecret }, { signal } = {}) {
  const state = generateState()
  const verifier = generateCodeVerifier()
  const redirectUri = `${callbackOrigin()}${CALLBACK_PATH}`
  const address = authorizationUrl({
    clientId,
    redirectUri,
    responseType: 'code',
    state,
    codeChallenge: await generateCodeChallenge(verifier),
  })
  const read = readReturn(await signInInBrowser(address, CALLBACK_PATH, { signal }), state)
  if (!read) return null
  if (!read.code) throw new DriveError('Google sent no code.')
  const token = await exchangeCode({
    clientId,
    clientSecret,
    code: read.code,
    verifier,
    redirectUri,
    signal,
  })
  return { token, ids: read.ids }
}
