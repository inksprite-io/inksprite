import { describe, it, expect, vi, afterEach } from 'vitest'

import { storageAdvice } from '@/platform/persistence.js'

const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15'
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const WINDOWS_FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0'
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1'
const IPHONE_FIREFOX =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15'
const IPHONE_EDGE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/140.0.0.0 Mobile/15E148 Safari/605.1.15'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'

/**
 * @param {string} userAgent
 * @param {{ maxTouchPoints?: number, standalone?: boolean }} [traits]
 */
const adviceFor = (userAgent, { maxTouchPoints = 0, standalone = false } = {}) =>
  storageAdvice({ userAgent, maxTouchPoints, standalone })

describe('storageAdvice', () => {
  it('warns Safari on a Mac about the week, and offers the desktop app', () => {
    expect(adviceFor(MAC_SAFARI)).toEqual({
      clearsAfterAWeek: true,
      homeScreen: false,
      desktopApp: true,
    })
  })

  it('still warns a Mac Dock app, whose exemption is not documented', () => {
    expect(adviceFor(MAC_SAFARI, { standalone: true }).clearsAfterAWeek).toBe(true)
  })

  it('offers other browsers on a computer only the desktop app', () => {
    for (const userAgent of [MAC_CHROME, WINDOWS_FIREFOX]) {
      expect(adviceFor(userAgent)).toEqual({
        clearsAfterAWeek: false,
        homeScreen: false,
        desktopApp: true,
      })
    }
  })

  it('offers Safari on an iPhone the Home Screen instead of the desktop app', () => {
    expect(adviceFor(IPHONE_SAFARI, { maxTouchPoints: 5 })).toEqual({
      clearsAfterAWeek: true,
      homeScreen: true,
      desktopApp: false,
    })
  })

  it('takes an iPad, which sends a Mac user agent, for an iPad by its touch screen', () => {
    expect(adviceFor(MAC_SAFARI, { maxTouchPoints: 5 })).toEqual({
      clearsAfterAWeek: true,
      homeScreen: true,
      desktopApp: false,
    })
  })

  it('says nothing more once opened from the Home Screen', () => {
    expect(adviceFor(IPHONE_SAFARI, { maxTouchPoints: 5, standalone: true })).toEqual({
      clearsAfterAWeek: false,
      homeScreen: false,
      desktopApp: false,
    })
  })

  it('does not take the other browsers on an iPhone for Safari', () => {
    for (const userAgent of [IPHONE_CHROME, IPHONE_FIREFOX, IPHONE_EDGE]) {
      expect(adviceFor(userAgent, { maxTouchPoints: 5 })).toEqual({
        clearsAfterAWeek: false,
        homeScreen: false,
        desktopApp: false,
      })
    }
  })

  it('offers a phone running Android nothing more', () => {
    expect(adviceFor(ANDROID_CHROME, { maxTouchPoints: 5 })).toEqual({
      clearsAfterAWeek: false,
      homeScreen: false,
      desktopApp: false,
    })
  })
})

describe('askToKeepData', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  /**
   * The module afresh, in a browser whose storage answers as given.
   * @param {{ persisted?: boolean, persist?: boolean|Error }} answers
   */
  const withStorage = async ({ persisted = false, persist = true }) => {
    const storage = {
      persisted: vi.fn().mockResolvedValue(persisted),
      persist:
        persist instanceof Error
          ? vi.fn().mockRejectedValue(persist)
          : vi.fn().mockResolvedValue(persist),
    }
    vi.stubGlobal('navigator', { ...globalThis.navigator, storage })
    const { askToKeepData } = await import('@/platform/persistence.js')
    return { storage, askToKeepData }
  }

  it('asks, and says whether the data is kept', async () => {
    const { storage, askToKeepData } = await withStorage({ persist: true })
    expect(await askToKeepData()).toBe(true)
    expect(storage.persist).toHaveBeenCalledOnce()
  })

  it('does not ask for what is already kept', async () => {
    const { storage, askToKeepData } = await withStorage({ persisted: true })
    expect(await askToKeepData()).toBe(true)
    expect(storage.persist).not.toHaveBeenCalled()
  })

  it('asks once a page load, so Firefox prompts no more than once', async () => {
    const { storage, askToKeepData } = await withStorage({ persist: false })
    expect(await askToKeepData()).toBe(false)
    expect(await askToKeepData()).toBe(false)
    expect(storage.persist).toHaveBeenCalledOnce()
  })

  it('answers no where there is nothing to ask', async () => {
    vi.stubGlobal('navigator', { ...globalThis.navigator, storage: undefined })
    const { askToKeepData } = await import('@/platform/persistence.js')
    expect(await askToKeepData()).toBe(false)
  })

  it('answers no, rather than throwing, when asking fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { askToKeepData } = await withStorage({ persist: new Error('denied') })
    expect(await askToKeepData()).toBe(false)
  })
})
