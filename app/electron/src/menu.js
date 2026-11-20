/**
 * The app's menus: the menu bar, and the menu a right-click opens, which a
 * window has none of until the app gives it one.
 */

import { Menu, app, clipboard } from 'electron'

/**
 * Tell a window's page what the menu asked of it (`src/platform/menu.js` in
 * the page), which knows what the writer is in: whether closing a tab closes
 * a document's or a chat's is the page's to say. With no window in front, as
 * on a Mac with every one closed, nothing is asked.
 *
 * @param {Electron.BaseWindow|undefined} window - The one in front
 * @param {string} command
 * @param {number} [detail] - Which tab, for a command that names one
 */
function ask(window, command, detail) {
  const contents = /** @type {Electron.BrowserWindow|undefined} */ (window)?.webContents
  if (contents && !contents.isDestroyed()) contents.send('menu:command', command, detail)
}

/**
 * A menu item that asks the window in front's page for something.
 *
 * @param {string} label
 * @param {string} accelerator
 * @param {string} command
 * @param {number} [detail]
 * @returns {Electron.MenuItemConstructorOptions}
 */
const asks = (label, accelerator, command, detail) => ({
  label,
  accelerator,
  click: (_, window) => ask(window, command, detail),
})

/**
 * A key for something a menu item beside it does already, or that has no
 * item worth a line: it works, and isn't listed.
 *
 * @param {string} accelerator
 * @param {string} command
 * @param {number} [detail]
 * @returns {Electron.MenuItemConstructorOptions}
 */
const alsoAsks = (accelerator, command, detail) => ({
  ...asks(command, accelerator, command, detail),
  visible: false,
})

/**
 * The menu bar: Electron's own menus, less its Help, which is about
 * Electron, and with the app's own in File, Window and, on a Mac, the app's
 * menu. Its Edit menu is what makes the clipboard's keys work on a Mac, and
 * its View menu has the Web Inspector: its console is where a failure the
 * app doesn't show is logged. Windows and Linux show the bar only while Alt
 * is down, though its keys work all the same, so the page has a way of its
 * own to everything here. On a Mac the Dock's menu has New Window too.
 *
 * The keys are a browser's for its tabs, which the app in a browser has to
 * leave to it: a new document and a new chat, the tab the writer is in
 * closed, the one closed last opened again, the tabs stepped through and
 * gone to by number. Closing the window moves to the key beside New
 * Window's, since a tab has taken its own.
 *
 * @param {{newWindow: () => void}} actions
 */
export function setMenu({ newWindow }) {
  const mac = process.platform === 'darwin'
  /** @type {Electron.MenuItemConstructorOptions} */
  const newWindowItem = {
    label: 'New Window',
    accelerator: 'CmdOrCtrl+Shift+N',
    click: () => newWindow(),
  }
  const settings = asks('Settings…', 'CmdOrCtrl+,', 'settings')
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(mac ? [macAppMenu(settings)] : []),
    {
      label: 'File',
      submenu: [
        asks('New Document', 'CmdOrCtrl+N', 'newDocument'),
        asks('New Chat', 'CmdOrCtrl+T', 'newChat'),
        newWindowItem,
        { type: 'separator' },
        asks('Projects…', 'CmdOrCtrl+O', 'projects'),
        { type: 'separator' },
        asks('Close Tab', 'CmdOrCtrl+W', 'closeTab'),
        asks('Reopen Closed Tab', 'CmdOrCtrl+Shift+T', 'reopenTab'),
        { role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' },
        // On a Mac the settings and quitting are the app menu's.
        ...(mac
          ? []
          : /** @type {Electron.MenuItemConstructorOptions[]} */ ([
              { type: 'separator' },
              settings,
              { type: 'separator' },
              { role: 'quit' },
            ])),
      ],
    },
    mac ? { label: 'Edit', submenu: macEditMenu() } : { role: 'editMenu' },
    { role: 'viewMenu' },
    windowMenu(mac),
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  if (mac)
    app.dock?.setMenu(Menu.buildFromTemplate([{ label: 'New Window', click: () => newWindow() }]))
}

/**
 * The app's own menu on a Mac: what Electron's holds, with the settings
 * where a Mac app has them.
 *
 * @param {Electron.MenuItemConstructorOptions} settings
 * @returns {Electron.MenuItemConstructorOptions}
 */
function macAppMenu(settings) {
  return {
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      settings,
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  }
}

/**
 * The Window menu: what Electron's holds, less closing the window, which is
 * File's, and with the tabs of the panel the writer is in stepped through.
 * The keys are the ones a browser has: Control-Tab everywhere, the brackets
 * on a Mac and Page Up and Page Down elsewhere besides, and a number for the
 * tab at that place, 9 for the last.
 *
 * @param {boolean} mac
 * @returns {Electron.MenuItemConstructorOptions}
 */
function windowMenu(mac) {
  const [alsoNext, alsoPrevious] = mac
    ? ['Cmd+Shift+]', 'Cmd+Shift+[']
    : ['Ctrl+PageDown', 'Ctrl+PageUp']
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const tabs = [
    asks('Show Next Tab', 'Ctrl+Tab', 'nextTab'),
    asks('Show Previous Tab', 'Ctrl+Shift+Tab', 'previousTab'),
    alsoAsks(alsoNext, 'nextTab'),
    alsoAsks(alsoPrevious, 'previousTab'),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(place => alsoAsks(`CmdOrCtrl+${place}`, 'showTab', place)),
  ]
  return {
    label: 'Window',
    // What makes it the menu a Mac lists the app's windows in.
    ...(mac ? { role: /** @type {const} */ ('window') } : {}),
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      ...tabs,
      ...(mac
        ? /** @type {Electron.MenuItemConstructorOptions[]} */ ([
            { type: 'separator' },
            { role: 'front' },
          ])
        : []),
    ],
  }
}

/**
 * Electron's Edit menu on a Mac, with ⇧⌘V pasting without formatting as it
 * does in a browser, beside the Mac's own ⌥⇧⌘V the menu shows. Electron puts
 * nothing on ⇧⌘V, and a key no menu item has never reaches the page as a
 * paste.
 *
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
function macEditMenu() {
  return [
    { role: 'undo' },
    { role: 'redo' },
    { type: 'separator' },
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { role: 'pasteAndMatchStyle' },
    { role: 'pasteAndMatchStyle', accelerator: 'Cmd+Shift+V', visible: false },
    { role: 'delete' },
    { role: 'selectAll' },
    { type: 'separator' },
    { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] },
  ]
}

/**
 * The menu for a right-click: spelling, the link under the pointer, the
 * clipboard, and the Web Inspector. A right-click the page makes a menu of
 * its own for, on a chat in the list, never gets here.
 *
 * @param {Electron.WebContents} webContents
 * @param {Electron.ContextMenuParams} params
 */
export function showContextMenu(webContents, params) {
  /** @type {Electron.MenuItemConstructorOptions[][]} */
  const groups = []

  if (params.misspelledWord) {
    groups.push([
      ...params.dictionarySuggestions.slice(0, 5).map(word => ({
        label: word,
        click: () => webContents.replaceMisspelling(word),
      })),
      {
        label: 'Add to Dictionary',
        click: () => webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      },
    ])
  }

  if (params.linkURL) {
    groups.push([{ label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) }])
  }

  const { canCut, canCopy, canPaste, canSelectAll } = params.editFlags
  if (params.isEditable) {
    groups.push([
      { role: 'cut', enabled: canCut },
      { role: 'copy', enabled: canCopy },
      { role: 'paste', enabled: canPaste },
      { role: 'selectAll', enabled: canSelectAll },
    ])
  } else if (params.selectionText) {
    groups.push([{ role: 'copy', enabled: canCopy }])
  }

  groups.push([
    { label: 'Inspect Element', click: () => webContents.inspectElement(params.x, params.y) },
  ])

  /** @type {Electron.MenuItemConstructorOptions[]} */
  const items = groups.flatMap((group, i) => (i ? [{ type: 'separator' }, ...group] : group))
  Menu.buildFromTemplate(items).popup()
}
