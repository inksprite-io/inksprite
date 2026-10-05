// @vitest-environment node
/* global structuredClone, URLSearchParams */
// Signing in, end to end, against the harness's test server with --oauth:
// discovery from its 401, registration, the consent page, PKCE at the token
// endpoint, a listed server once signed in, and a refresh when a token lapses.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { spawn } from 'node:child_process'

/** A stand-in for local storage, which Node does not have. */
const kept = new Map()
const memory = {
  get: (key, fallback = null) => (kept.has(key) ? structuredClone(kept.get(key)) : fallback),
  set: (key, value) => kept.set(key, structuredClone(value)),
  remove: key => kept.delete(key),
}

vi.stubGlobal('location', { origin: 'http://app.test' })

const { useAuthStorage, signedIn, signOut, startSignIn, finishSignIn, authProvider } = await import(
  '@/mcp/auth.js'
)
const { callServerTool, disconnect, listServer, describeFailure } = await import('@/mcp/client.js')

/**
 * @param {string[]} args
 * @returns {Promise<{url: string, stop: () => void}>}
 */
function startServer(args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['harness/mcp-server.js', '--port', '0', ...args])
    child.stdout.on('data', chunk => {
      const found = String(chunk).match(/(http:\/\/localhost:\d+\/mcp)/)
      if (found) resolve({ url: found[1], stop: () => child.kill() })
    })
    child.on('error', reject)
  })
}

/**
 * Be the writer on the authorization server's page: allow or deny, and come
 * back with whatever it sends.
 *
 * @param {URL} authorizationUrl
 * @param {'allow'|'deny'} decision
 * @returns {Promise<URLSearchParams>} The query the app is sent back with
 */
async function decide(authorizationUrl, decision) {
  const page = await fetch(authorizationUrl)
  expect(page.status).toBe(200)
  const form = new URLSearchParams({
    client_id: authorizationUrl.searchParams.get('client_id'),
    redirect_uri: authorizationUrl.searchParams.get('redirect_uri'),
    state: authorizationUrl.searchParams.get('state'),
    code_challenge: authorizationUrl.searchParams.get('code_challenge'),
    resource: authorizationUrl.searchParams.get('resource') || '',
    decision,
  })
  const answer = await fetch(new URL('/authorize', authorizationUrl), {
    method: 'POST',
    body: form,
    redirect: 'manual',
  })
  return new URL(answer.headers.get('location')).searchParams
}

/** Start a sign-in and hand back where the writer would be sent. */
async function signInAddress(url) {
  let address = null
  const result = await startSignIn(url, to => (address = to))
  expect(result).toBe('REDIRECT')
  return address
}

describe('signing in to a server', () => {
  let server
  let lapsing

  beforeAll(async () => {
    useAuthStorage(memory)
    server = await startServer(['--oauth'])
    lapsing = await startServer(['--oauth', '--expires', '1'])
  })

  afterAll(() => {
    disconnect('lapsing')
    server?.stop()
    lapsing?.stop()
  })

  beforeEach(() => kept.clear())

  it('says a server that wants signing in does, before anything is kept', async () => {
    const error = await listServer({ url: server.url }).catch(failure => failure)

    expect(describeFailure(error)).toMatch(/sign in/)
    expect(signedIn(server.url)).toBe(false)
  })

  it('sends the writer to the server’s own page, registered, with PKCE and the resource', async () => {
    const address = await signInAddress(server.url)

    expect(address.origin).toBe(new URL(server.url).origin)
    expect(address.pathname).toBe('/authorize')
    expect(address.searchParams.get('client_id')).toBeTruthy()
    expect(address.searchParams.get('redirect_uri')).toBe('http://app.test/connect/mcp')
    expect(address.searchParams.get('code_challenge_method')).toBe('S256')
    expect(address.searchParams.get('resource')).toBe(server.url)
    expect(address.searchParams.get('state')).toBeTruthy()
  })

  it('signs in from what comes back, and lists the server with the sign-in', async () => {
    const back = await decide(await signInAddress(server.url), 'allow')

    expect(await finishSignIn(back)).toEqual({ url: server.url })
    expect(signedIn(server.url)).toBe(true)
    const listed = await listServer({ url: server.url })
    expect(listed.tools.map(tool => tool.name)).toContain('look_up')
  })

  it('says a sign-in the writer denied was cancelled', async () => {
    const back = await decide(await signInAddress(server.url), 'deny')

    const error = await finishSignIn(back).catch(failure => failure)
    expect(error.message).toBe('Sign-in was cancelled.')
    // So the tab waiting on it hears it is over.
    expect(error.url).toBe(server.url)
    expect(signedIn(server.url)).toBe(false)
  })

  it('refuses an answer for a sign-in it did not start, or one already used', async () => {
    const back = await decide(await signInAddress(server.url), 'allow')
    await finishSignIn(back)

    await expect(finishSignIn(back)).rejects.toThrow(/expired, or was started elsewhere/)
    await expect(
      finishSignIn(new URLSearchParams({ code: 'x', state: 'never-asked' }))
    ).rejects.toThrow(/expired, or was started elsewhere/)
  })

  it('refreshes a token that has lapsed, without asking the writer again', async () => {
    await finishSignIn(await decide(await signInAddress(lapsing.url), 'allow'))
    const before = memory.get('inksprite_mcp_auth')[lapsing.url].tokens

    await new Promise(resolve => setTimeout(resolve, 1500))
    const result = await callServerTool({ id: 'lapsing', url: lapsing.url }, 'look_up', {
      term: 'litotes',
    })

    expect(result.content[0].text).toMatch(/litotes/)
    expect(memory.get('inksprite_mcp_auth')[lapsing.url].tokens).not.toEqual(before)
  })

  it('forgets a server’s sign-in when asked', async () => {
    await finishSignIn(await decide(await signInAddress(server.url), 'allow'))

    signOut(server.url)

    expect(signedIn(server.url)).toBe(false)
  })

  it('keeps credentials apart for each authorization server', () => {
    const provider = authProvider(server.url)
    provider.saveTokens({ access_token: 'a', token_type: 'Bearer' }, { issuer: 'https://one' })

    expect(provider.tokens({ issuer: 'https://one' })).toEqual({
      access_token: 'a',
      token_type: 'Bearer',
    })
    expect(provider.tokens({ issuer: 'https://two' })).toBeUndefined()
  })
})
