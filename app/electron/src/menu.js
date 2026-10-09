/**
 * The app's menus: the menu bar, and the menu a right-click opens, which a
 * window has none of until the app gives it one.
 */

import { Menu, clipboard } from 'electron'

/**
 * The menu bar: Electron's own menus, less its Help, which is about
 * Electron. Its Edit menu is what makes the clipboard's keys work on a Mac,
 * and its View menu has the Web Inspector: its console is where a failure the
 * app doesn't show is logged. Windows and Linux show the bar only while Alt
 * is down.
 */
export function setMenu() {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(process.platform === 'darwin' ? [{ role: /** @type {const} */ ('appMenu') }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
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
