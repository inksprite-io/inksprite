import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const net = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@/platform/fetch.js', () => net)

import { authorizationUrl, exchangeCode, retrieveOAuthParams } from '@/utils/oauth.js'
import { signInOf } from '@/ai/providers.js'

const service = {
  authorize: 'https://service.example/auth',
  exchange: 'https://service.example/api/v1/auth/keys',
  params: { client_name: 'inksprite' },
}

/**
 * @param {number} status
 * @param {any} body
 */
const answer = (status, body) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.clearAllMocks())

describe('authorizationUrl', () => {
  it('sends the writer to the service with a challenge, its state and what it is told', async () => {
    const address = new URL(await authorizationUrl(service, 'https://app.example/connect/x'))

    expect(address.origin + address.pathname).toBe('https://service.example/auth')
    expect(address.searchParams.get('callback_url')).toBe('https://app.example/connect/x')
    expect(address.searchParams.get('code_challenge_method')).toBe('S256')
    expect(address.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/)
    expect(address.searchParams.get('client_name')).toBe('inksprite')

    const kept = retrieveOAuthParams()
    expect(kept?.state).toBe(address.searchParams.get('state'))
    expect(kept?.verifier.length).toBeGreaterThanOrEqual(43)
    expect(kept?.providerId).toBeUndefined()
  })

  it('carries inksprite’s referral to NanoGPT’s sign-in, and no referral to OpenRouter’s', async () => {
    const nanoGpt = new URL(await authorizationUrl(signInOf('nanogpt'), 'https://app.example/x'))
    const openRouter = new URL(
      await authorizationUrl(signInOf('openrouter'), 'https://app.example/x')
    )

    expect(nanoGpt.searchParams.get('invitation_code')).toBe('GNjxyGKL')
    expect(openRouter.searchParams.has('invitation_code')).toBe(false)
  })

  it('remembers the connection signed in from, once', async () => {
    await authorizationUrl(service, 'https://app.example/connect/x', 'p_mine')

    expect(retrieveOAuthParams()?.providerId).toBe('p_mine')
    expect(retrieveOAuthParams()).toBeNull()
  })

  it('forgets a connection an earlier sign-in was for', async () => {
    await authorizationUrl(service, 'https://app.example/connect/x', 'p_old')
    await authorizationUrl(service, 'https://app.example/connect/x')

    expect(retrieveOAuthParams()?.providerId).toBeUndefined()
  })
})

describe('exchangeCode', () => {
  it('trades the code at the service’s exchange', async () => {
    net.fetch.mockResolvedValue(answer(200, { key: 'sk-or-1' }))

    expect(await exchangeCode(service, 'c', 'v')).toBe('sk-or-1')
    expect(net.fetch).toHaveBeenCalledWith(
      'https://service.example/api/v1/auth/keys',
      expect.objectContaining({ method: 'POST' })
    )
    expect(JSON.parse(net.fetch.mock.calls[0][1].body)).toEqual({
      code: 'c',
      code_verifier: 'v',
      code_challenge_method: 'S256',
    })
  })

  it('takes an OAuth access token as the key', async () => {
    net.fetch.mockResolvedValue(answer(200, { access_token: 'sk-nano-1', token_type: 'Bearer' }))

    expect(await exchangeCode(service, 'c', 'v')).toBe('sk-nano-1')
  })

  it('says what the service said when it refuses, in either shape', async () => {
    net.fetch.mockResolvedValueOnce(
      answer(400, { error: 'invalid_grant', error_description: 'authorization code expired' })
    )
    await expect(exchangeCode(service, 'c', 'v')).rejects.toThrow('authorization code expired')

    net.fetch.mockResolvedValueOnce(answer(400, { error: { message: 'Invalid code' } }))
    await expect(exchangeCode(service, 'c', 'v')).rejects.toThrow('Invalid code')
  })
})
