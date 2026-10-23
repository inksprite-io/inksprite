// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Menu, app } from 'electron'
import { setMenu } from '../../electron/src/menu.js'

const platform = process.platform

/** @param {string} name */
const onPlatform = name => Object.defineProperty(process, 'platform', { value: name })

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => onPlatform(platform))

/** The menu bar set last. */
const menuBar = () => Menu.setApplicationMenu.mock.calls.at(-1)[0]

describe('setMenu', () => {
  it('has New Window in File, on Shift-Command-N, beside closing the window on a Mac', () => {
    onPlatform('darwin')
    const newWindow = vi.fn()
    setMenu({ newWindow })

    const file = menuBar().find(menu => menu.label === 'File')
    expect(file.submenu.map(item => item.label ?? item.role ?? item.type)).toEqual([
      'New Window',
      'separator',
      'close',
    ])
    expect(file.submenu[0].accelerator).toBe('CmdOrCtrl+Shift+N')
    file.submenu[0].click()
    expect(newWindow).toHaveBeenCalled()
  })

  it('has New Window in the Dock on a Mac', () => {
    onPlatform('darwin')
    const newWindow = vi.fn()
    setMenu({ newWindow })

    const [dock] = app.dock.setMenu.mock.calls[0]
    expect(dock.map(item => item.label)).toEqual(['New Window'])
    dock[0].click()
    expect(newWindow).toHaveBeenCalled()
  })

  it('quits from File elsewhere, as Electron’s own menu does, and has no Dock', () => {
    onPlatform('win32')
    setMenu({ newWindow: vi.fn() })

    const file = menuBar().find(menu => menu.label === 'File')
    expect(file.submenu.at(-1)).toEqual({ role: 'quit' })
    expect(menuBar()[0]).toEqual(file)
    expect(app.dock.setMenu).not.toHaveBeenCalled()
  })
})
