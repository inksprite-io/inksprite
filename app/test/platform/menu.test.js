import { describe, it, expect, vi, afterEach } from 'vitest'
import { hasMenuCommands, onMenuCommand } from '@/platform/menu.js'

afterEach(() => {
  delete globalThis.__INKSPRITE_DESKTOP__
})

describe('platform/menu', () => {
  it('asks nothing of a browser, which has the keys for its own tabs', () => {
    expect(hasMenuCommands()).toBe(false)
    expect(() => onMenuCommand(vi.fn())()).not.toThrow()
  })

  it('asks nothing of a desktop app from before its menu had the keys', () => {
    globalThis.__INKSPRITE_DESKTOP__ = {}
    expect(hasMenuCommands()).toBe(false)
    expect(() => onMenuCommand(vi.fn())()).not.toThrow()
  })

  it('hears what the menu asks, until it stops listening', () => {
    /** @type {Function|null} */
    let heard = null
    globalThis.__INKSPRITE_DESKTOP__ = {
      onMenuCommand: listener => {
        heard = listener
      },
    }
    const listener = vi.fn()

    const stop = onMenuCommand(listener)
    expect(hasMenuCommands()).toBe(true)
    heard('showTab', 3)
    expect(listener).toHaveBeenCalledWith('showTab', 3)

    stop()
    expect(heard).toBeNull()
  })
})
