import { describe, it, expect } from 'vitest'
import { deviceName } from '@/cloud/deviceName.js'

const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1'
const WINDOWS_FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
const ELECTRON =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) inksprite/0.1.0 Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36'

describe('deviceName', () => {
  it('says the browser and what it runs on', () => {
    expect(deviceName({ userAgent: MAC_CHROME, desktop: false })).toBe('Chrome on macOS')
    expect(deviceName({ userAgent: MAC_SAFARI, desktop: false })).toBe('Safari on macOS')
    expect(deviceName({ userAgent: IPHONE, desktop: false })).toBe('Safari on iPhone')
    expect(deviceName({ userAgent: WINDOWS_FIREFOX, desktop: false })).toBe('Firefox on Windows')
    expect(deviceName({ userAgent: ANDROID_CHROME, desktop: false })).toBe('Chrome on Android')
  })

  it('knows an iPad, which says it is a Mac, by its touch screen', () => {
    expect(deviceName({ userAgent: MAC_SAFARI, maxTouchPoints: 5, desktop: false })).toBe(
      'Safari on iPad'
    )
  })

  it('calls the desktop app inksprite', () => {
    expect(deviceName({ userAgent: ELECTRON, desktop: true })).toBe('inksprite on macOS')
  })
})
