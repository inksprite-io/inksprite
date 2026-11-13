/* global AbortSignal */
/**
 * @module composables/useSignIn
 * @description Connecting an account by signing in, with OAuth (PKCE), to a
 * service that makes the app a key for it: OpenRouter and NanoGPT
 * (`signIn` on their types, `ai/providers.js`).
 *
 * `start` sends the writer to the service. In a browser that is a tab of its
 * own, which the service sends back to `/connect/<type>`
 * (`SignInCallback.vue`); that page calls `finish` and tells the tab that
 * started it with an `oauth-success` message. In the desktop window it is the
 * system browser, which comes back to the window's listener on localhost:
 * `start` calls `finish` itself and posts the same message to its own window.
 * Whoever listens for the message hears it either way.
 *
 * The key goes on the connection signed in from, or on a new connection of
 * the service where there was none, which takes the built-in's id where the
 * service had one (`addConnection`).
 */

import { useAIConfig } from '@/composables/useAIConfig'
import { useConnections } from '@/composables/useConnections.js'
import { useAIProvidersStore } from '@/stores/aiProvidersStore'
import { providerLabel, signInOf } from '@/ai/providers.js'
import { isDesktop } from '@/platform/desktop.js'
import { callbackOrigin, signInInBrowser } from '@/platform/signIn.js'
import { authorizationUrl, exchangeCode, retrieveOAuthParams } from '@/utils/oauth'

/**
 * Where a service sends the writer back after signing in.
 * @param {string} type - The connection's type: `openrouter`, `nanogpt`
 * @returns {string}
 */
export const signInPath = type => `/connect/${type}`

/** How long the desktop window waits for the writer to come back. */
const WAIT_MS = 10 * 60 * 1000

/** @param {number} ms */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * @param {string} type - The connection's type, one with a sign-in
 */
export function useSignIn(type) {
  const aiConfig = useAIConfig()
  const connections = useConnections()
  const providersStore = useAIProvidersStore()
  const label = providerLabel(type)

  /**
   * The sign-in, as the service's type has it.
   * @returns {import('@/ai/providers.js').SignIn}
   */
  function service() {
    const found = signInOf(type)
    if (!found) throw new Error(`${label} has no sign-in.`)
    return found
  }

  /**
   * Finish connecting from what the service sent back: check the state, trade
   * the code for a key, and keep it on the connection.
   *
   * @param {URLSearchParams} params - The query the writer came back with
   * @returns {Promise<string>} The connection's id
   * @throws {Error} With what the writer should be told
   */
  async function finish(params) {
    const code = params.get('code')
    const state = params.get('state')

    if (!code) {
      throw new Error(`${label} sent no code to sign in with.`)
    }

    // Retrieve and validate stored OAuth params
    const storedParams = retrieveOAuthParams()
    if (!storedParams) {
      throw new Error('The sign-in expired. Try connecting again.')
    }

    // Validate state parameter for security
    if (state !== storedParams.state) {
      throw new Error('This sign-in was not started here. Try connecting again.')
    }

    const apiKey = await exchangeCode(service(), code, storedParams.verifier)

    // The callback's tab has only just started reading the connections.
    await providersStore.ensureInitialized()
    const signedInFrom = storedParams.providerId
      ? aiConfig.getProvider(storedParams.providerId)
      : null
    let providerId
    if (signedInFrom) {
      // Signed in on, it is the writer's, whatever it was before.
      aiConfig.updateProvider(signedInFrom.id, { apiKey, rememberKey: true, added: true })
      providerId = signedInFrom.id
    } else {
      providerId = connections.addConnection(type, { apiKey }).id
    }

    await sleep(1000) // Brief pause to allow db write to complete
    return providerId
  }

  /**
   * Send the writer to the service to connect their account. In a browser
   * this returns once the tab is open; in the desktop window, once they are
   * back and the key is kept.
   *
   * @param {{providerId?: string}} [options] - The connection signed in
   *   from, where there is one yet
   * @returns {Promise<void>}
   * @throws {Error} With what the writer should be told
   */
  async function start({ providerId } = {}) {
    const path = signInPath(type)
    const address = await authorizationUrl(service(), `${callbackOrigin()}${path}`, providerId)
    if (!isDesktop()) {
      window.open(address, '_blank')
      return
    }

    const params = await signInInBrowser(address, path, {
      signal: AbortSignal.timeout(WAIT_MS),
    }).catch(error => {
      throw error?.name === 'TimeoutError'
        ? new Error('Connecting took too long. Start it again.')
        : error
    })
    const connected = await finish(params)
    window.postMessage(
      { type: 'oauth-success', provider: type, providerId: connected },
      window.location.origin
    )
  }

  return { start, finish }
}
