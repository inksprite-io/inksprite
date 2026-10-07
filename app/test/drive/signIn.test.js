/* global URLSearchParams, Response, AbortController */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CALLBACK_PATH,
  DRIVE_SCOPE,
  authorizationUrl,
  exchangeCode,
  pickInBrowser,
  pickInPopup,
  readReturn,
  relayReturn,
} from '@/drive/signIn.js'
import { DriveError, PopupBlockedError } from '@/drive/errors.js'

const signInInBrowser = vi.hoisted(() => vi.fn())
vi.mock('@/platform/signIn.js', () => ({
  callbackOrigin: () => 'http://localhost:41721',
  signInInBrowser,
}))

/** BroadcastChannel, standing in: channels of one name hear each other. */
class Channel {
  /** @type {Set<Channel>} */
  static open = new Set()
  /** @param {string} name */
  constructor(name) {
    this.name = name
    /** @type {((event: {data: any}) => void)|null} */
    this.onmessage = null
    Channel.open.add(this)
  }
  /** @param {any} data */
  postMessage(data) {
    for (const other of Channel.open) {
      if (other !== this && other.name === this.name) other.onmessage?.({ data })
    }
  }
  close() {
    Channel.open.delete(this)
  }
}

/** The query or fragment a sign-in comes back with. */
const back = (/** @type {Record<string, string>} */ fields) =>
  new URLSearchParams(fields).toString()

describe('authorizationUrl', () => {
  it('asks Google for drive.file alone, with its picker, picking many', () => {
    const url = new URL(
      authorizationUrl({
        clientId: 'web-1',
        redirectUri: 'https://inksprite.io/connect/google',
        responseType: 'token',
        state: 's1',
      })
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'web-1',
      redirect_uri: 'https://inksprite.io/connect/google',
      response_type: 'token',
      scope: DRIVE_SCOPE,
      state: 's1',
      prompt: 'consent',
      trigger_onepick: 'true',
      allow_multiple: 'true',
    })
  })

  it('carries a PKCE challenge when given one', () => {
    const url = new URL(
      authorizationUrl({
        clientId: 'desktop-1',
        redirectUri: 'http://localhost:41721/connect/google',
        responseType: 'code',
        state: 's1',
        codeChallenge: 'chal',
      })
    )
    expect(url.searchParams.get('code_challenge')).toBe('chal')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })
})

describe('readReturn', () => {
  it('reads the picked ids, and the token or the code', () => {
    expect(
      readReturn(
        new URLSearchParams(
          back({
            state: 's1',
            access_token: 'tok',
            picked_file_ids: 'a,b',
            scope: DRIVE_SCOPE,
          })
        ),
        's1'
      )
    ).toEqual({ token: 'tok', code: null, ids: ['a', 'b'] })
  })

  it('answers null when the writer cancelled, or picked nothing', () => {
    expect(
      readReturn(new URLSearchParams(back({ state: 's1', error: 'access_denied' })), 's1')
    ).toBe(null)
    expect(readReturn(new URLSearchParams(back({ state: 's1', code: 'c' })), 's1')).toBe(null)
  })

  it('refuses an answer that is not this sign-in’s, Google’s refusal, and a scope not allowed', () => {
    expect(() => readReturn(new URLSearchParams(back({ state: 'other' })), 's1')).toThrow(
      DriveError
    )
    expect(() =>
      readReturn(new URLSearchParams(back({ state: 's1', error: 'invalid_request' })), 's1')
    ).toThrow('Google could not sign you in: invalid_request.')
    expect(() =>
      readReturn(
        new URLSearchParams(back({ state: 's1', picked_file_ids: 'a', scope: 'openid' })),
        's1'
      )
    ).toThrow('Access to Drive was not allowed.')
  })
})

describe('pickInPopup', () => {
  /** @type {{close: ReturnType<typeof vi.fn>}} */
  let popup
  beforeEach(() => {
    Channel.open.clear()
    vi.stubGlobal('BroadcastChannel', Channel)
    popup = { close: vi.fn() }
    vi.spyOn(window, 'open').mockImplementation(() => /** @type {any} */ (popup))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** The state the popup was opened with. */
  const stateOf = () => new URL(vi.mocked(window.open).mock.calls[0][0]).searchParams.get('state')

  it('opens the popup within the call, for a token back on this origin', () => {
    pickInPopup('web-1')
    expect(window.open).toHaveBeenCalledTimes(1)
    const url = new URL(vi.mocked(window.open).mock.calls[0][0])
    expect(url.searchParams.get('client_id')).toBe('web-1')
    expect(url.searchParams.get('response_type')).toBe('token')
    expect(url.searchParams.get('redirect_uri')).toBe(`${window.location.origin}${CALLBACK_PATH}`)
  })

  it('hears the page it came back to, and takes only its own sign-in', async () => {
    const picking = pickInPopup('web-1')
    relayReturn(back({ state: 'someone-else', access_token: 'x', picked_file_ids: 'z' }))
    relayReturn(
      back({ state: stateOf(), access_token: 'tok', picked_file_ids: 'a,b', scope: DRIVE_SCOPE })
    )
    await expect(picking).resolves.toEqual({ token: 'tok', ids: ['a', 'b'] })
    expect(Channel.open.size).toBe(0)
  })

  it('answers null when the writer cancelled on Google’s page', async () => {
    const picking = pickInPopup('web-1')
    relayReturn(back({ state: stateOf(), error: 'access_denied' }))
    await expect(picking).resolves.toBeNull()
  })

  it('says when the browser blocked the popup', async () => {
    vi.mocked(window.open).mockReturnValue(null)
    await expect(pickInPopup('web-1')).rejects.toBeInstanceOf(PopupBlockedError)
  })

  it('stops waiting by its signal, and closes the popup', async () => {
    const controller = new AbortController()
    const picking = pickInPopup('web-1', { signal: controller.signal })
    controller.abort()
    await expect(picking).rejects.toMatchObject({ name: 'AbortError' })
    expect(popup.close).toHaveBeenCalled()
    expect(Channel.open.size).toBe(0)
  })
})

describe('in the desktop window', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    signInInBrowser.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  /** Google, sending the browser back with what is given, under the state it was asked with. */
  const comesBack = (/** @type {Record<string, string>} */ fields) =>
    signInInBrowser.mockImplementation(async address => {
      const state = new URL(address).searchParams.get('state')
      return new URLSearchParams(back({ state, ...fields }))
    })

  it('signs in and picks in the browser, then trades the code for a token with the secret', async () => {
    comesBack({ code: 'c1', picked_file_ids: 'a', scope: DRIVE_SCOPE })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'tok', refresh_token: 'kept-nowhere' }))
    )

    await expect(
      pickInBrowser({ clientId: 'desktop-1', clientSecret: 'secret-1' })
    ).resolves.toEqual({ token: 'tok', ids: ['a'] })

    const [address, path] = signInInBrowser.mock.calls[0]
    const asked = new URL(address).searchParams
    expect(path).toBe(CALLBACK_PATH)
    expect(asked.get('response_type')).toBe('code')
    expect(asked.get('redirect_uri')).toBe('http://localhost:41721/connect/google')
    expect(asked.get('code_challenge_method')).toBe('S256')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    const sent = new URLSearchParams(init.body)
    expect(Object.fromEntries(sent)).toMatchObject({
      client_id: 'desktop-1',
      client_secret: 'secret-1',
      code: 'c1',
      redirect_uri: 'http://localhost:41721/connect/google',
      grant_type: 'authorization_code',
    })
    expect(sent.get('code_verifier')).toBeTruthy()
  })

  it('answers null, and trades nothing, when the writer cancelled', async () => {
    comesBack({ error: 'access_denied' })
    await expect(pickInBrowser({ clientId: 'desktop-1', clientSecret: 'secret-1' })).resolves.toBe(
      null
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says why Google would not trade the code', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Bad Request' }), {
        status: 400,
      })
    )
    await expect(
      exchangeCode({
        clientId: 'desktop-1',
        clientSecret: 'secret-1',
        code: 'c1',
        verifier: 'v',
        redirectUri: 'http://localhost:41721/connect/google',
      })
    ).rejects.toThrow('Google could not finish the sign-in: Bad Request.')
  })
})
