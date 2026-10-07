/* global crypto, btoa, TextEncoder */

/**
 * OAuth PKCE utilities for secure authentication flows
 * @module utils/oauth
 */

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
 */
function storeOAuthParams(params) {
  localStorage.setItem('oauth_verifier', params.verifier)
  localStorage.setItem('oauth_state', params.state)
}

/**
 * Retrieves and clears OAuth flow parameters from local storage
 * @returns {Object|null} OAuth parameters or null if not found
 * @property {string} verifier - Code verifier
 * @property {string} state - State parameter
 */
export function retrieveOAuthParams() {
  const verifier = localStorage.getItem('oauth_verifier')
  const state = localStorage.getItem('oauth_state')

  if (!verifier || !state) {
    return null
  }

  // Clear stored params immediately
  localStorage.removeItem('oauth_verifier')
  localStorage.removeItem('oauth_state')

  return { verifier, state }
}

/**
 * The address to connect an OpenRouter account at, with a fresh PKCE
 * challenge; the verifier and state are kept for when OpenRouter sends the
 * writer back
 * @param {string} callbackUrl - The callback URL to redirect to after authorization
 * @returns {Promise<string>}
 * @throws {Error} If not in a secure context or Web Crypto API unavailable
 */
export async function openRouterAuthorizationUrl(callbackUrl) {
  // Check if we're in a secure context
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new Error(
      'OAuth requires a secure context. Please access the application via HTTPS or localhost.'
    )
  }

  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
  const state = generateState()

  // Store params for callback validation
  storeOAuthParams({ verifier, state })

  // Build authorization URL
  const authUrl = new URL('https://openrouter.ai/auth')
  authUrl.searchParams.set('callback_url', callbackUrl)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', state)
  return authUrl.toString()
}

/**
 * Initiates OpenRouter OAuth flow by opening authorization URL in new tab
 * @param {string} callbackUrl - The callback URL to redirect to after authorization
 * @returns {Promise<void>}
 * @throws {Error} If not in a secure context or Web Crypto API unavailable
 */
export async function initiateOpenRouterOAuth(callbackUrl) {
  window.open(await openRouterAuthorizationUrl(callbackUrl), '_blank')
}
