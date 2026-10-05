/**
 * @module mcp/auth
 * @description Signing in to a server, the way the spec has it.
 *
 * A server that answers 401 names its authorization server in its resource
 * metadata. The app finds it, gets a client ID, and sends the writer there in
 * a tab of its own, with PKCE (S256) and the `resource` the token is for; the
 * answer comes back to `/connect/mcp`, which trades the code for tokens and
 * tells the tab that asked. The SDK does the protocol (`auth`); this is the
 * part it leaves to the app — where things are kept, and how the writer is
 * sent to sign in.
 *
 * **The client ID.** On the public site, a Client ID Metadata Document: a
 * fixed HTTPS address that describes the app, which the spec prefers and
 * which suits a static site, with no registration and nothing to keep. A copy
 * of the app anywhere else has no public address for one, and registers
 * itself (Dynamic Client Registration) with each authorization server
 * instead. One that does neither is not supported yet.
 *
 * **Where it is kept.** In this browser's local storage, by the server's
 * address, and never in the database: a backup is a file the writer hands
 * around, and a token in it would be a sign-in handed around with it. A
 * restored server signs in again. Kept per authorization server, as the SDK
 * asks, so a server that moves to another one is not sent old credentials.
 *
 * **Never mid-turn.** A call that finds its sign-in has lapsed past what a
 * refresh can mend fails with a message saying so; the writer signs in from
 * Settings, with a click, which is also what lets the app open a tab at all.
 */

import { localStorage as appStorage } from '@/utils/localStorage.js'

/** @typedef {import('@modelcontextprotocol/client').OAuthClientProvider} OAuthClientProvider */
/** @typedef {import('@modelcontextprotocol/client').OAuthClientMetadata} OAuthClientMetadata */
/** @typedef {import('@modelcontextprotocol/client').OAuthDiscoveryState} OAuthDiscoveryState */

/** Where an authorization server sends the writer back. */
export const CALLBACK_PATH = '/connect/mcp'

/** The site the client ID metadata document is served from. */
export const PUBLIC_ORIGIN = 'https://inksprite.io'

/** The document, which is the app's client ID wherever it is accepted. */
export const CLIENT_METADATA_URL = `${PUBLIC_ORIGIN}/oauth/mcp-client.json`

/** The channel a finished sign-in is announced on, to the tab that asked for it. */
export const SIGN_IN_CHANNEL = 'inksprite-mcp-sign-in'

/** What is kept for each server, by its address. */
const AUTH_KEY = 'inksprite_mcp_auth'

/** Sign-ins under way, by their state. */
const PENDING_KEY = 'inksprite_mcp_sign_ins'

/** How long a sign-in may take before its state is forgotten. */
const SIGN_IN_TTL_MS = 30 * 60 * 1000

/**
 * What is kept for one server.
 *
 * @typedef {Object} AuthRecord
 * @property {Record<string, any>} [clients] - Client information, by issuer
 * @property {Record<string, any>} [tokens] - Tokens, by issuer
 * @property {string} [latest] - The issuer whose tokens were saved last: the
 *   ones a request is sent with, when the transport does not say which
 * @property {string} [verifier] - The PKCE verifier of the sign-in under way
 * @property {OAuthDiscoveryState} [discovery] - Where its authorization server
 *   was found, so the way back need not look again
 */

/**
 * Somewhere to keep things: the app's local storage, or a test's stand-in.
 *
 * @typedef {{get: (key: string, fallback?: any) => any, set: (key: string, value: any) => any, remove: (key: string) => any}} AuthStorage
 */

/** @type {AuthStorage} */
let storage = appStorage

/**
 * Keep sign-ins somewhere else: for a test, which has no browser.
 *
 * @param {AuthStorage} store
 */
export function useAuthStorage(store) {
  storage = store
}

/** @returns {Record<string, AuthRecord>} */
function records() {
  return storage.get(AUTH_KEY, {}) || {}
}

/**
 * @param {string} url
 * @returns {AuthRecord}
 */
function recordOf(url) {
  return records()[url] || {}
}

/**
 * @param {string} url
 * @param {(record: AuthRecord) => AuthRecord} change
 */
function updateRecord(url, change) {
  const all = records()
  all[url] = change({ ...(all[url] || {}) })
  storage.set(AUTH_KEY, all)
}

/**
 * The key credentials are kept under for an authorization server.
 *
 * @param {{issuer?: string}|undefined} ctx
 * @returns {string}
 */
const issuerKey = ctx => ctx?.issuer || ''

/**
 * Whether the writer has signed in to the server at this address.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function signedIn(url) {
  return Object.keys(recordOf(url).tokens || {}).length > 0
}

/**
 * Forget everything kept for a server: its tokens, and the client it was
 * registered as.
 *
 * @param {string} url
 */
export function signOut(url) {
  const all = records()
  delete all[url]
  storage.set(AUTH_KEY, all)
}

/** Where this copy of the app is answering from. */
const appOrigin = () => globalThis.location?.origin || ''

/** Where this copy of the app is sent back to. */
export function callbackUrl() {
  return `${appOrigin()}${CALLBACK_PATH}`
}

/**
 * What the app says about itself to an authorization server it registers
 * with. The same as the metadata document says.
 *
 * @param {string} redirect
 * @returns {OAuthClientMetadata}
 */
function clientMetadata(redirect) {
  return {
    client_name: 'InkSprite',
    client_uri: PUBLIC_ORIGIN,
    redirect_uris: [redirect],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }
}

/** A state for one sign-in: random, and long enough not to be guessed. */
function randomState() {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Remember which server a sign-in is for, by its state, forgetting any that
 * were started and never finished.
 *
 * @param {string} state
 * @param {string} url
 */
function rememberSignIn(state, url) {
  const now = Date.now()
  const pending = Object.fromEntries(
    Object.entries(storage.get(PENDING_KEY, {}) || {}).filter(
      ([, entry]) => now - entry.at < SIGN_IN_TTL_MS
    )
  )
  pending[state] = { url, at: now }
  storage.set(PENDING_KEY, pending)
}

/**
 * The server a sign-in coming back is for, once: a state is used up by the
 * answer it came back with.
 *
 * @param {string} state
 * @returns {string|null}
 */
function takeSignIn(state) {
  const pending = storage.get(PENDING_KEY, {}) || {}
  const entry = pending[state]
  delete pending[state]
  storage.set(PENDING_KEY, pending)
  return entry && Date.now() - entry.at < SIGN_IN_TTL_MS ? entry.url : null
}

/**
 * The SDK's view of a server's sign-in.
 *
 * @param {string} url - The server's address
 * @param {{onRedirect?: (authorizationUrl: URL) => void}} [options] - What to
 *   do with the address to sign in at. Nothing, by default: a connection
 *   that finds it needs signing in fails, and the writer signs in from
 *   Settings.
 * @returns {OAuthClientProvider}
 */
export function authProvider(url, { onRedirect = () => {} } = {}) {
  const redirect = callbackUrl()
  return {
    get redirectUrl() {
      return redirect
    },
    ...(appOrigin() === PUBLIC_ORIGIN ? { clientMetadataUrl: CLIENT_METADATA_URL } : {}),
    get clientMetadata() {
      return clientMetadata(redirect)
    },
    state() {
      const state = randomState()
      rememberSignIn(state, url)
      return state
    },
    clientInformation: ctx => recordOf(url).clients?.[issuerKey(ctx)],
    saveClientInformation: (information, ctx) =>
      updateRecord(url, record => ({
        ...record,
        clients: { ...record.clients, [issuerKey(ctx)]: information },
      })),
    // Asked with no issuer, which is the transport reading the token to send,
    // it wants the newest, as the SDK says.
    tokens: ctx => {
      const record = recordOf(url)
      return record.tokens?.[ctx ? issuerKey(ctx) : record.latest || '']
    },
    saveTokens: (tokens, ctx) =>
      updateRecord(url, record => ({
        ...record,
        tokens: { ...record.tokens, [issuerKey(ctx)]: tokens },
        latest: issuerKey(ctx),
      })),
    redirectToAuthorization: authorizationUrl => onRedirect(authorizationUrl),
    saveCodeVerifier: verifier => updateRecord(url, record => ({ ...record, verifier })),
    codeVerifier: () => {
      const verifier = recordOf(url).verifier
      if (!verifier) throw new Error('This sign-in was not started here. Start it again.')
      return verifier
    },
    saveDiscoveryState: discovery => updateRecord(url, record => ({ ...record, discovery })),
    discoveryState: () => recordOf(url).discovery,
    invalidateCredentials: scope =>
      updateRecord(url, record => {
        if (scope === 'all') return {}
        const kept = { ...record }
        if (scope === 'client') delete kept.clients
        if (scope === 'tokens') delete kept.tokens
        if (scope === 'verifier') delete kept.verifier
        if (scope === 'discovery') delete kept.discovery
        return kept
      }),
  }
}

/** @returns {Promise<typeof import('@modelcontextprotocol/client')>} */
const loadSdk = () => import('@modelcontextprotocol/client')

/**
 * Start signing in to a server: find its authorization server, get a client
 * ID, and hand over the address to sign in at.
 *
 * @param {string} url - The server's address
 * @param {(authorizationUrl: URL) => void} onRedirect - Send the writer there
 * @returns {Promise<'AUTHORIZED'|'REDIRECT'>} AUTHORIZED when it was already
 *   signed in, or a refresh was enough
 */
export async function startSignIn(url, onRedirect) {
  const { auth } = await loadSdk()
  return auth(authProvider(url, { onRedirect }), { serverUrl: url })
}

/**
 * Why a sign-in did not finish, and which server it was for when that is
 * known, so the tab waiting on it can be told.
 */
export class SignInError extends Error {
  /**
   * @param {string} message - What the writer should be told
   * @param {string|null} url - The server, when the state named one
   */
  constructor(message, url) {
    super(message)
    this.name = 'SignInError'
    this.url = url
  }
}

/**
 * Finish a sign-in from what the authorization server sent back: trade the
 * code for tokens, and say which server it was for.
 *
 * The state is read first, and used up, whatever else came back: a sign-in
 * the writer cancelled is over too, and the tab waiting on it should hear so.
 *
 * @param {URLSearchParams} params - The query the writer came back with
 * @returns {Promise<{url: string}>}
 * @throws {SignInError} With what the writer should be told
 */
export async function finishSignIn(params) {
  const state = params.get('state')
  const url = state ? takeSignIn(state) : null

  const refused = params.get('error')
  if (refused) {
    const said = params.get('error_description')
    throw new SignInError(
      refused === 'access_denied' ? 'Sign-in was cancelled.' : said || refused,
      url
    )
  }

  const code = params.get('code')
  if (!code || !state) throw new SignInError('The server sent nothing back to sign in with.', url)
  if (!url) {
    throw new SignInError(
      'This sign-in has expired, or was started elsewhere. Start it again.',
      null
    )
  }

  const { auth } = await loadSdk()
  const iss = params.get('iss')
  await auth(authProvider(url), {
    serverUrl: url,
    authorizationCode: code,
    ...(iss ? { iss } : {}),
  })
  updateRecord(url, record => {
    const kept = { ...record }
    delete kept.verifier
    return kept
  })
  return { url }
}
