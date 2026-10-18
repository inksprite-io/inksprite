/* global Response */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearSessions, forgetSession, keepSession, signInFor } from '@/drive/session.js'
import { refreshSession, signInInBrowser, signInInPopup } from '@/drive/signIn.js'
import { DriveError } from '@/drive/errors.js'

vi.mock('@/drive/signIn.js', () => ({
  signInInPopup: vi.fn(),
  signInInBrowser: vi.fn(),
  refreshSession: vi.fn(),
}))
vi.mock('@/platform/fetch.js', () => ({ fetch: (...args) => fetch(...args) }))

const HOUR = 3600_000
const session = (token, extra = {}) => ({ token, expiresAt: Date.now() + HOUR, ...extra })
const kept = () => JSON.parse(window.localStorage.getItem('inksprite_google_refresh') || '{}')

describe('signInFor', () => {
  /** Drive's about, saying whose the token is. */
  const about = vi.fn(
    async () => new Response(JSON.stringify({ user: { emailAddress: 'writer@example.com' } }))
  )

  beforeEach(() => {
    clearSessions()
    window.localStorage.clear()
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'web-1')
    vi.stubEnv('VITE_GOOGLE_DESKTOP_CLIENT_ID', 'desktop-1')
    vi.stubEnv('VITE_GOOGLE_DESKTOP_CLIENT_SECRET', 'secret-1')
    vi.stubGlobal('fetch', about)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  describe('in a browser', () => {
    it('signs in plainly, hinted with the account, and holds the token for the syncs after', async () => {
      vi.mocked(signInInPopup).mockResolvedValue(session('tok'))

      await expect(signInFor('writer@example.com')).resolves.toEqual({
        token: 'tok',
        account: 'writer@example.com',
      })
      expect(signInInPopup).toHaveBeenCalledWith('web-1', {
        loginHint: 'writer@example.com',
        signal: undefined,
      })
      expect(about).not.toHaveBeenCalled()

      await signInFor('writer@example.com')
      expect(signInInPopup).toHaveBeenCalledTimes(1)
    })

    it('opens Google’s window within the call, before anything is awaited', () => {
      vi.mocked(signInInPopup).mockReturnValue(new Promise(() => {}))
      signInFor('writer@example.com')
      expect(signInInPopup).toHaveBeenCalledTimes(1)
    })

    it('asks Drive whose a sign-in is when the link does not say', async () => {
      vi.mocked(signInInPopup).mockResolvedValue(session('tok'))
      await expect(signInFor(undefined)).resolves.toEqual({
        token: 'tok',
        account: 'writer@example.com',
      })
      expect(signInInPopup).toHaveBeenCalledWith('web-1', {
        loginHint: undefined,
        signal: undefined,
      })
      // Held under the account it turned out to be.
      await signInFor('writer@example.com')
      expect(signInInPopup).toHaveBeenCalledTimes(1)
    })

    it('signs in again for a token near its end, or one let go of', async () => {
      keepSession('writer@example.com', { token: 'old', expiresAt: Date.now() + 60_000 })
      vi.mocked(signInInPopup).mockResolvedValue(session('new'))
      await expect(signInFor('writer@example.com')).resolves.toMatchObject({ token: 'new' })

      forgetSession('writer@example.com')
      await signInFor('writer@example.com')
      expect(signInInPopup).toHaveBeenCalledTimes(2)
    })

    it('answers null when the writer cancelled', async () => {
      vi.mocked(signInInPopup).mockResolvedValue(null)
      await expect(signInFor('writer@example.com')).resolves.toBeNull()
    })
  })

  describe('in the desktop window', () => {
    beforeEach(() => vi.stubGlobal('__INKSPRITE_DESKTOP__', {}))
    const client = { kind: 'desktop', clientId: 'desktop-1', clientSecret: 'secret-1' }

    it('signs in with no browser from the refresh token kept for the account', async () => {
      keepSession('writer@example.com', session('first', { refreshToken: 'again' }))
      clearSessions()
      expect(kept()).toEqual({ 'writer@example.com': 'again' })
      vi.mocked(refreshSession).mockResolvedValue(session('fresh'))

      await expect(signInFor('writer@example.com')).resolves.toEqual({
        token: 'fresh',
        account: 'writer@example.com',
      })
      expect(refreshSession).toHaveBeenCalledWith(client, 'again', { signal: undefined })
      expect(signInInBrowser).not.toHaveBeenCalled()
    })

    it('forgets a refresh token Google no longer takes, and signs in in the browser', async () => {
      window.localStorage.setItem(
        'inksprite_google_refresh',
        JSON.stringify({ 'writer@example.com': 'revoked' })
      )
      vi.mocked(refreshSession).mockRejectedValue(
        Object.assign(new DriveError('Google could not finish the sign-in: Bad Request.'), {
          refused: true,
        })
      )
      vi.mocked(signInInBrowser).mockResolvedValue(session('tok', { refreshToken: 'renewed' }))

      await expect(signInFor('writer@example.com')).resolves.toMatchObject({ token: 'tok' })
      expect(signInInBrowser).toHaveBeenCalledWith(client, {
        loginHint: 'writer@example.com',
        signal: undefined,
      })
      expect(kept()).toEqual({ 'writer@example.com': 'renewed' })
    })

    it('stops on any other failure, keeping the refresh token', async () => {
      window.localStorage.setItem(
        'inksprite_google_refresh',
        JSON.stringify({ 'writer@example.com': 'again' })
      )
      vi.mocked(refreshSession).mockRejectedValue(new DriveError('Couldn’t reach Drive'))
      await expect(signInFor('writer@example.com')).rejects.toThrow('Couldn’t reach Drive')
      expect(kept()).toEqual({ 'writer@example.com': 'again' })
      expect(signInInBrowser).not.toHaveBeenCalled()
    })
  })
})
