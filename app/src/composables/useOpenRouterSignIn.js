/* global AbortSignal */
/**
 * @module composables/useOpenRouterSignIn
 * @description Connecting an OpenRouter account with OAuth (PKCE).
 *
 * `start` sends the writer to OpenRouter. In a browser that is a tab of its
 * own, which OpenRouter sends back to `/connect/openrouter`
 * (`OpenRouterCallback.vue`); that page calls `finish` and tells the tab that
 * started it with an `oauth-success` message. In the desktop window it is the
 * system browser, which comes back to the window's listener on localhost:
 * `start` calls `finish` itself and posts the same message to its own window.
 * Whoever listens for the message hears it either way.
 */

import { useAIConfig } from '@/composables/useAIConfig'
import { useAIService } from '@/composables/useAIService'
import { isDesktop } from '@/platform/desktop.js'
import { callbackOrigin, signInInBrowser } from '@/platform/signIn.js'
import {
  initiateOpenRouterOAuth,
  openRouterAuthorizationUrl,
  retrieveOAuthParams,
} from '@/utils/oauth'

/** Where OpenRouter sends the writer back. */
export const OPENROUTER_CALLBACK_PATH = '/connect/openrouter'

/** The provider a connected account is kept as. */
const PROVIDER_ID = 'provider_openrouter_default'

/** How long the desktop window waits for the writer to come back. */
const WAIT_MS = 10 * 60 * 1000

/** @param {number} ms */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export function useOpenRouterSignIn() {
  const aiService = useAIService()
  const aiConfig = useAIConfig()

  /**
   * Finish connecting from what OpenRouter sent back: check the state, trade
   * the code for a key, and keep it on the OpenRouter provider.
   *
   * @param {URLSearchParams} params - The query the writer came back with
   * @returns {Promise<string>} The provider's id
   * @throws {Error} With what the writer should be told
   */
  async function finish(params) {
    const code = params.get('code')
    const state = params.get('state')

    if (!code) {
      throw new Error('No authorization code received')
    }

    // Retrieve and validate stored OAuth params
    const storedParams = retrieveOAuthParams()
    if (!storedParams) {
      throw new Error('OAuth session expired. Please try connecting again.')
    }

    // Validate state parameter for security
    if (state !== storedParams.state) {
      throw new Error('Invalid state parameter. Possible security issue.')
    }

    // Exchange code for API key
    const apiKey = await aiService.exchangeOAuthCode(code, storedParams.verifier)

    if (!aiConfig.getProvider(PROVIDER_ID)) {
      await aiConfig.createProvider({
        id: PROVIDER_ID,
        name: 'OpenRouter',
        type: 'openrouter',
        apiKey: apiKey,
        rememberKey: true,
        isDefault: true,
      })
    } else {
      await aiConfig.updateProvider(PROVIDER_ID, {
        apiKey: apiKey,
        rememberKey: true,
      })
    }

    await sleep(1000) // Brief pause to allow db write to complete
    return PROVIDER_ID
  }

  /**
   * Send the writer to OpenRouter to connect their account. In a browser this
   * returns once the tab is open; in the desktop window, once they are back
   * and the key is kept.
   *
   * @returns {Promise<void>}
   * @throws {Error} With what the writer should be told
   */
  async function start() {
    const callbackUrl = `${callbackOrigin()}${OPENROUTER_CALLBACK_PATH}`
    if (!isDesktop()) return initiateOpenRouterOAuth(callbackUrl)

    const address = await openRouterAuthorizationUrl(callbackUrl)
    const params = await signInInBrowser(address, OPENROUTER_CALLBACK_PATH, {
      signal: AbortSignal.timeout(WAIT_MS),
    }).catch(error => {
      throw error?.name === 'TimeoutError'
        ? new Error('Connecting took too long. Start it again.')
        : error
    })
    const providerId = await finish(params)
    window.postMessage(
      { type: 'oauth-success', provider: 'openrouter', providerId },
      window.location.origin
    )
  }

  return { start, finish }
}
