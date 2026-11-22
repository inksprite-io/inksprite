// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Menu, app } from 'electron'
import { setMenu, showInMenu } from '../../electron/src/menu.js'

const platform = process.platform

/** @param {string} name */
const onPlatform = name => Object.defineProperty(process, 'platform', { value: name })

beforeEach(() => {
  // What the menu holds until a page says otherwise.
  showInMenu({ chat: true, terminal: false })
  vi.clearAllMocks()
})

afterEach(() => onPlatform(platform))

/** The menu bar set last. */
const menuBar = () => Menu.setApplicationMenu.mock.calls.at(-1)[0]

/** A menu of the bar's, by its label. */
const menuOf = label => menuBar().find(menu => menu.label === label)

/** What a menu lists: each item's label, or its role, or that it is a separator. */
const listed = menu =>
  menu.submenu
    .filter(item => item.visible !== false)
    .map(item => item.label ?? item.role ?? item.type)

/** A window in front, with a page to be asked. */
const windowInFront = () => ({ webContents: { isDestroyed: () => false, send: vi.fn() } })

describe('setMenu', () => {
  it('has New Window in File, on Shift-Command-N', () => {
    onPlatform('darwin')
    const newWindow = vi.fn()
    setMenu({ newWindow })

    const item = menuOf('File').submenu.find(each => each.label === 'New Window')
    expect(item.accelerator).toBe('CmdOrCtrl+Shift+N')
    item.click()
    expect(newWindow).toHaveBeenCalled()
  })

  it('lists a document, a chat and a window to make, the projects, and what to close', () => {
    onPlatform('darwin')
    setMenu({ newWindow: vi.fn() })

    expect(listed(menuOf('File'))).toEqual([
      'New Document',
      'New Chat',
      'New Window',
      'separator',
      'Projects…',
      'separator',
      'Close Tab',
      'Reopen Closed Tab',
      'Close Window',
    ])
  })

  it('gives a tab the keys a browser has for one, and the window the key beside New Window’s', () => {
    onPlatform('darwin')
    setMenu({ newWindow: vi.fn() })

    const keys = Object.fromEntries(
      menuOf('File').submenu.map(item => [item.label ?? item.role, item.accelerator])
    )
    expect(keys).toMatchObject({
      'New Document': 'CmdOrCtrl+N',
      'New Chat': 'CmdOrCtrl+T',
      'Projects…': 'CmdOrCtrl+O',
      'Close Tab': 'CmdOrCtrl+W',
      'Reopen Closed Tab': 'CmdOrCtrl+Shift+T',
      'Close Window': 'CmdOrCtrl+Shift+W',
    })
    expect(menuOf('File').submenu.find(item => item.label === 'Close Window').role).toBe('close')
  })

  it('asks the page of the window in front, which knows what the writer is in', () => {
    onPlatform('darwin')
    setMenu({ newWindow: vi.fn() })
    const window = windowInFront()
    const click = label =>
      menuOf('File')
        .submenu.find(item => item.label === label)
        .click({}, window)

    click('New Document')
    click('New Chat')
    click('Projects…')
    click('Close Tab')
    click('Reopen Closed Tab')

    expect(window.webContents.send.mock.calls).toEqual([
      ['menu:command', 'newDocument', undefined],
      ['menu:command', 'newChat', undefined],
      ['menu:command', 'projects', undefined],
      ['menu:command', 'closeTab', undefined],
      ['menu:command', 'reopenTab', undefined],
    ])
  })

  it('asks nothing with no window in front, or one whose page has gone', () => {
    onPlatform('darwin')
    setMenu({ newWindow: vi.fn() })
    const close = menuOf('File').submenu.find(item => item.label === 'Close Tab')
    const gone = { webContents: { isDestroyed: () => true, send: vi.fn() } }

    expect(() => close.click({}, undefined)).not.toThrow()
    close.click({}, gone)
    expect(gone.webContents.send).not.toHaveBeenCalled()
  })

  it('has the settings in the app’s menu on a Mac, on Command-comma', () => {
    onPlatform('darwin')
    setMenu({ newWindow: vi.fn() })
    const window = windowInFront()

    const settings = menuBar()[0].submenu.find(item => item.label === 'Settings…')
    expect(settings.accelerator).toBe('CmdOrCtrl+,')
    settings.click({}, window)
    expect(window.webContents.send).toHaveBeenCalledWith('menu:command', 'settings', undefined)
    expect(
      menuBar()[0]
        .submenu.map(item => item.role)
        .filter(Boolean)
    ).toEqual(['about', 'services', 'hide', 'hideOthers', 'unhide', 'quit'])
  })

  it('steps through the tabs from Window, on a browser’s keys', () => {
    onPlatform('darwin')
    setMenu({ newWindow: vi.fn() })
    const window = windowInFront()
    const menu = menuOf('Window')

    expect(menu.role).toBe('window')
    expect(listed(menu)).toEqual([
      'minimize',
      'zoom',
      'separator',
      'Show Next Tab',
      'Show Previous Tab',
      'separator',
      'front',
    ])
    const asked = accelerator => {
      window.webContents.send.mockClear()
      menu.submenu.find(item => item.accelerator === accelerator).click({}, window)
      return window.webContents.send.mock.calls[0].slice(1)
    }
    expect(asked('Ctrl+Tab')).toEqual(['nextTab', undefined])
    expect(asked('Ctrl+Shift+Tab')).toEqual(['previousTab', undefined])
    expect(asked('Cmd+Shift+]')).toEqual(['nextTab', undefined])
    expect(asked('Cmd+Shift+[')).toEqual(['previousTab', undefined])
    expect(asked('CmdOrCtrl+1')).toEqual(['showTab', 1])
    expect(asked('CmdOrCtrl+9')).toEqual(['showTab', 9])
  })

  it('has Page Up and Page Down for the tabs elsewhere, and no window of its own to close there', () => {
    onPlatform('win32')
    setMenu({ newWindow: vi.fn() })
    const menu = menuOf('Window')

    expect(menu.role).toBeUndefined()
    expect(listed(menu)).toEqual([
      'minimize',
      'zoom',
      'separator',
      'Show Next Tab',
      'Show Previous Tab',
    ])
    const hidden = menu.submenu.filter(item => item.visible === false).map(item => item.accelerator)
    expect(hidden).toContain('Ctrl+PageDown')
    expect(hidden).toContain('Ctrl+PageUp')
    expect(hidden).not.toContain('Cmd+Shift+]')
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

  it('pastes without formatting on Shift-Command-V on a Mac, beside the Option one it shows', () => {
    onPlatform('darwin')
    setMenu({ newWindow: vi.fn() })

    const edit = menuBar().find(menu => menu.label === 'Edit')
    const plain = edit.submenu.filter(item => item.role === 'pasteAndMatchStyle')
    expect(plain).toEqual([
      { role: 'pasteAndMatchStyle' },
      { role: 'pasteAndMatchStyle', accelerator: 'Cmd+Shift+V', visible: false },
    ])
  })

  it('keeps Electron’s own Edit menu elsewhere, which has Shift-Control-V already', () => {
    onPlatform('win32')
    setMenu({ newWindow: vi.fn() })

    expect(menuBar()).toContainEqual({ role: 'editMenu' })
  })

  it('has the settings and quitting in File elsewhere, with no app menu, and has no Dock', () => {
    onPlatform('win32')
    setMenu({ newWindow: vi.fn() })

    const file = menuOf('File')
    expect(listed(file).slice(-4)).toEqual(['separator', 'Settings…', 'separator', 'quit'])
    expect(menuBar()[0]).toEqual(file)
    expect(app.dock.setMenu).not.toHaveBeenCalled()
  })

  describe('what the page says it holds', () => {
    /** An item of a menu's, by its label. */
    const itemOf = (menu, label) => menuOf(menu).submenu.find(item => item.label === label)

    it('lists no new chat with the AI off, its key kept to do nothing', () => {
      onPlatform('darwin')
      setMenu({ newWindow: vi.fn() })
      showInMenu({ chat: false, terminal: false })

      expect(listed(menuOf('File'))).not.toContain('New Chat')
      const hidden = menuOf('File').submenu.find(item => item.accelerator === 'CmdOrCtrl+T')
      expect(hidden.visible).toBe(false)

      showInMenu({ chat: true, terminal: false })
      expect(listed(menuOf('File')).slice(0, 3)).toEqual(['New Document', 'New Chat', 'New Window'])
    })

    it('lists the terminals while their extension is on, showing keys the page takes', () => {
      onPlatform('darwin')
      setMenu({ newWindow: vi.fn() })
      expect(listed(menuOf('File'))).not.toContain('New Terminal')
      expect(listed(menuOf('Window'))).not.toContain('Show Terminal')

      showInMenu({ chat: true, terminal: true })
      expect(listed(menuOf('File')).slice(0, 4)).toEqual([
        'New Document',
        'New Chat',
        'New Terminal',
        'New Window',
      ])
      expect(listed(menuOf('Window')).slice(3, 6)).toEqual([
        'Show Next Tab',
        'Show Previous Tab',
        'Show Terminal',
      ])
      const newTerminal = itemOf('File', 'New Terminal')
      const showTerminal = itemOf('Window', 'Show Terminal')
      expect(newTerminal).toMatchObject({ accelerator: 'Cmd+L', registerAccelerator: false })
      expect(showTerminal).toMatchObject({ accelerator: 'Ctrl+`', registerAccelerator: false })

      const window = windowInFront()
      newTerminal.click({}, window)
      showTerminal.click({}, window)
      expect(window.webContents.send.mock.calls).toEqual([
        ['menu:command', 'newTerminal', undefined],
        ['menu:command', 'showTerminal', undefined],
      ])
    })

    it('makes a terminal on Control-Shift-L elsewhere, where Control-L is a shell’s', () => {
      onPlatform('linux')
      setMenu({ newWindow: vi.fn() })
      showInMenu({ chat: true, terminal: true })
      expect(itemOf('File', 'New Terminal').accelerator).toBe('Ctrl+Shift+L')
    })

    it('builds the menu again only when what it holds has changed', () => {
      onPlatform('darwin')
      setMenu({ newWindow: vi.fn() })
      expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1)

      showInMenu({ chat: true, terminal: false })
      expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1)
      showInMenu({ chat: true, terminal: true })
      expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(2)
      // The Dock's menu is the same whatever the page says.
      expect(app.dock.setMenu).toHaveBeenCalledTimes(1)
    })

    it('takes nothing but the two answers', () => {
      onPlatform('darwin')
      setMenu({ newWindow: vi.fn() })
      for (const said of [
        null,
        'chat',
        {},
        { chat: false },
        { chat: 'no', terminal: false },
        { chat: false, terminal: 1 },
      ]) {
        showInMenu(said)
      }
      expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1)
      expect(listed(menuOf('File'))).toContain('New Chat')
    })
  })
})
