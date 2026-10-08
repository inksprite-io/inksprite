import { describe, it, expect, afterEach, vi } from 'vitest'
import { driveAvailable, driveConfig } from '@/drive/config.js'

describe('driveConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const configured = () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'web-1')
    vi.stubEnv('VITE_GOOGLE_DESKTOP_CLIENT_ID', 'desktop-1')
    vi.stubEnv('VITE_GOOGLE_DESKTOP_CLIENT_SECRET', 'secret-1')
  }

  it('takes the web client in a browser', () => {
    configured()
    expect(driveConfig()).toEqual({ kind: 'web', clientId: 'web-1' })
    expect(driveAvailable()).toBe(true)
  })

  it('takes the desktop client, with its secret, in the desktop window', () => {
    configured()
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    expect(driveConfig()).toEqual({
      kind: 'desktop',
      clientId: 'desktop-1',
      clientSecret: 'secret-1',
    })
  })

  it('trims the spaces a pasted value can bring', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', ' web-1\n')
    vi.stubEnv('VITE_GOOGLE_DESKTOP_CLIENT_ID', 'desktop-1 ')
    vi.stubEnv('VITE_GOOGLE_DESKTOP_CLIENT_SECRET', '\tsecret-1 ')
    expect(driveConfig()).toEqual({ kind: 'web', clientId: 'web-1' })

    vi.stubGlobal('__TAURI_INTERNALS__', {})
    expect(driveConfig()).toEqual({
      kind: 'desktop',
      clientId: 'desktop-1',
      clientSecret: 'secret-1',
    })
  })

  it('offers nothing where the build has no client for it', () => {
    vi.stubEnv('VITE_GOOGLE_DESKTOP_CLIENT_ID', 'desktop-1')
    vi.stubEnv('VITE_GOOGLE_DESKTOP_CLIENT_SECRET', 'secret-1')
    expect(driveAvailable()).toBe(false)

    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'web-1')
    vi.stubEnv('VITE_GOOGLE_DESKTOP_CLIENT_SECRET', '')
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    expect(driveAvailable()).toBe(false)
  })
})
