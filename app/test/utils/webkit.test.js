import { describe, it, expect } from 'vitest'
import { isWebKit } from '@/utils/webkit.js'

const agents = {
  chrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  // The desktop app's window on the Mac says neither Version/ nor Safari/.
  desktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  chromeOnIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
}

describe('isWebKit', () => {
  it('is false for Chromium browsers and Firefox', () => {
    expect(isWebKit(agents.chrome)).toBe(false)
    expect(isWebKit(agents.edge)).toBe(false)
    expect(isWebKit(agents.firefox)).toBe(false)
  })

  it('is true for Safari, the desktop window, and any browser on iOS', () => {
    expect(isWebKit(agents.safari)).toBe(true)
    expect(isWebKit(agents.desktop)).toBe(true)
    expect(isWebKit(agents.chromeOnIos)).toBe(true)
  })
})
