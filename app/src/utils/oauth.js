/* global crypto, btoa, TextEncoder */

/**
 * OAuth PKCE utilities for secure authentication flows
 * @module utils/oauth
 */

import { fetch } from '@/platform/fetch.js'

/**
 * Generates a cryptographically random code verifier for PKCE
 * @returns {string} A random string suitable for use as a code verifier
 */
export function generateCodeVerifier() {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return base64URLEncode(array)
}

/**
 * Generates a code challenge from a code verifier using SHA-256
 * @param {string} verifier - The code verifier
 * @returns {Promise<string>} The base64url-encoded SHA-256 hash of the verifier
 * @throws {Error} If Web Crypto API is not available (insecure context)
 */
export async function generateCodeChallenge(verifier) {
  if (!crypto || !crypto.subtle) {
    throw new Error(
      'Web Crypto API not available. OAuth requires a secure context (HTTPS or localhost).'
    )
  }

  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return base64URLEncode(new Uint8Array(hash))
}

/**
 * Generates a random state parameter for OAuth security
 * @returns {string} A random state string
 */
export function generateState() {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return base64URLEncode(array)
}

/**
 * Encodes a byte array to base64url format (without padding)
 * @param {Uint8Array} buffer - The byte array to encode
 * @returns {string} Base64url-encoded string
 */
function base64URLEncode(buffer) {
  const base64 = btoa(String.fromCharCode(...buffer))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Stores OAuth flow parameters in local storage
 * Note: localStorage is used instead of sessionStorage because the OAuth callback
 * happens in a new tab which doesn't share sessionStorage with the originating tab.
 * These values are immediately deleted after the callback completes.
 * @param {Object} params - OAuth parameters
 * @param {string} params.verifier - Code verifier
 * @param {string} params.state - State parameter
 * @param {string} [params.providerId] - The connection the key is for, when
 *   it was signed in from one
 */
function storeOAuthParams(params) {
  localStorage.setItem('oauth_verifier', params.verifier)
  localStorage.setItem('oauth_state', params.state)
  if (params.providerId) localStorage.setItem('oauth_provider', params.providerId)
  else localStorage.removeItem('oauth_provider')
}

/**
 * Retrieves and clears OAuth flow parameters from local storage
 * @returns {{verifier: string, state: string, providerId?: string}|null} OAuth
 *   parameters, or null if not found
 */
export function retrieveOAuthParams() {
  const verifier = localStorage.getItem('oauth_verifier')
  const state = localStorage.getItem('oauth_state')
  const providerId = localStorage.getItem('oauth_provider')

  if (!verifier || !state) {
    return null
  }

  // Clear stored params immediately
  localStorage.removeItem('oauth_verifier')
  localStorage.removeItem('oauth_state')
  localStorage.removeItem('oauth_provider')

  return { verifier, state, ...(providerId ? { providerId } : {}) }
}

/**
 * The address to sign in to a service at, with a fresh PKCE challenge; the
 * verifier and state are kept for when the service sends the writer back
 * @param {import('@/ai/providers.js').SignIn} service - Where it signs in
 * @param {string} callbackUrl - The callback URL to redirect to after authorization
 * @param {string} [providerId] - The connection the key is for
 * @returns {Promise<string>}
 * @throws {Error} If not in a secure context or Web Crypto API unavailable
 */
export async function authorizationUrl(service, callbackUrl, providerId) {
  // Check if we're in a secure context
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new Error('Signing in needs the app to be served over HTTPS, or from localhost.')
  }

  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
  const state = generateState()

  // Store params for callback validation
  storeOAuthParams({ verifier, state, providerId })

  // Build authorization URL
  const authUrl = new URL(service.authorize)
  authUrl.searchParams.set('callback_url', callbackUrl)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', state)
  for (const [name, value] of Object.entries(service.params ?? {})) {
    authUrl.searchParams.set(name, value)
  }
  return authUrl.toString()
}

/**
 * Trade the code a service sent the writer back with for an API key
 * @param {import('@/ai/providers.js').SignIn} service - Where it signs in
 * @param {string} code - Authorization code from OAuth callback
 * @param {string} codeVerifier - PKCE code verifier
 * @returns {Promise<string>} The API key
 * @throws {Error} When the service refuses, in its words
 */
export async function exchangeCode(service, code, codeVerifier) {
  const response = await fetch(service.exchange, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: codeVerifier, code_challenge_method: 'S256' }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    // OpenRouter's `{error: {message}}`, or OAuth's `{error, error_description}`.
    throw new Error(
      data.error_description || data.error?.message || data.error || `HTTP ${response.status}`
    )
  }
  const key = data.key ?? data.access_token
  if (!key) throw new Error('No API key returned from OAuth exchange')
  return key
}
