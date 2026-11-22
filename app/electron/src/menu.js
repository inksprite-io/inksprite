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
 * A menu item for one of the terminal's keys, which the page takes itself,
 * from inside a terminal too (`useMenuCommands` in the page): the key is
 * shown beside the item and not taken by the menu, where the system allows
 * that. A Mac's menu takes it all the same, and asks the page what the key
 * would have; the page, taking it first, keeps it from the menu.
 *
 * @param {string} label
 * @param {string} accelerator
 * @param {string} command
 * @returns {Electron.MenuItemConstructorOptions}
 */
const showsKey = (label, accelerator, command) => ({
  ...asks(label, accelerator, command),
  registerAccelerator: false,
})

/**
 * What the menu holds besides what it always does, as the page last said:
 * a new chat while the AI is on, and terminals while the Terminal extension
 * is. Until a page has said, what it held before pages said: a new chat.
 *
 * @typedef {Object} MenuItems
 * @property {boolean} chat
 * @property {boolean} terminal
 */

/** @type {MenuItems} */
let shown = { chat: true, terminal: false }

/** @type {(() => void)|null} */
let newWindowAction = null

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
 * Window's, since a tab has taken its own. The terminal's are a code
 * editor's, Control-` to show one and with Shift to make one.
 *
 * @param {{newWindow: () => void}} actions
 */
export function setMenu({ newWindow }) {
  newWindowAction = newWindow
  buildMenu()
  if (process.platform === 'darwin')
    app.dock?.setMenu(Menu.buildFromTemplate([{ label: 'New Window', click: () => newWindow() }]))
}

/**
 * Hold what the page says the menu should, from whichever window: what it
 * goes by, the AI and the extensions, is the same in every one. Anything
 * but the two answers is not taken, and the menu is built again only when
 * one has changed.
 *
 * @param {unknown} items
 */
export function showInMenu(items) {
  if (typeof items !== 'object' || items === null) return
  const { chat, terminal } = /** @type {Record<string, unknown>} */ (items)
  if (typeof chat !== 'boolean' || typeof terminal !== 'boolean') return
  if (chat === shown.chat && terminal === shown.terminal) return
  shown = { chat, terminal }
  if (newWindowAction) buildMenu()
}

/** Build the menu bar, holding what `shown` says. */
function buildMenu() {
  const mac = process.platform === 'darwin'
  const newWindow = /** @type {() => void} */ (newWindowAction)
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
        // With the AI off its key stays the menu's, and does nothing, as
        // with the AI on it does in focus mode.
        shown.chat
          ? asks('New Chat', 'CmdOrCtrl+T', 'newChat')
          : alsoAsks('CmdOrCtrl+T', 'newChat'),
        ...(shown.terminal ? [showsKey('New Terminal', 'Ctrl+Shift+`', 'newTerminal')] : []),
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
    windowMenu(mac, shown.terminal),
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
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
 * tab at that place, 9 for the last. With terminals, a way to the terminal
 * shown last.
 *
 * @param {boolean} mac
 * @param {boolean} terminal - Whether the Terminal extension is on
 * @returns {Electron.MenuItemConstructorOptions}
 */
function windowMenu(mac, terminal) {
  const [alsoNext, alsoPrevious] = mac
    ? ['Cmd+Shift+]', 'Cmd+Shift+[']
    : ['Ctrl+PageDown', 'Ctrl+PageUp']
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const tabs = [
    asks('Show Next Tab', 'Ctrl+Tab', 'nextTab'),
    asks('Show Previous Tab', 'Ctrl+Shift+Tab', 'previousTab'),
    ...(terminal ? [showsKey('Show Terminal', 'Ctrl+`', 'showTerminal')] : []),
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
