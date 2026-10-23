/**
 * The app's windows. Each is the page, which keeps to one project at a time,
 * and a project to one window (`src/platform/windows.js` in the page): a
 * second window is for a second project, opened from the File menu, the
 * Dock, the app opened again, or the page.
 */

import { BrowserWindow, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { saveBeforeClosing } from './closing.js'
import { openable, originOf } from './links.js'
import { showContextMenu } from './menu.js'

/** A new window's size when there is no window to take it from. */
const SIZE = { width: 1400, height: 900 }

/** How far down and right a new window opens from the one in front. */
const CASCADE = 24

/**
 * Where on the page a window may open: a path of the app's own, never an
 * address that would take it to another site.
 *
 * @param {unknown} path
 * @returns {string}
 */
export function pagePath(path) {
  if (typeof path !== 'string' || !/^\/(?![/\\])/.test(path)) {
    throw new Error(`Not a path in the app: ${String(path)}`)
  }
  return path
}

/**
 * A way to open the app's windows, on the page at `pageUrl`.
 *
 * @param {string} pageUrl - Where the page is loaded from
 * @returns {(path?: string) => Electron.BrowserWindow} Opens a window on a
 *   path of the page, `/` by default
 */
export function windowOpener(pageUrl) {
  const origin = originOf(pageUrl)

  return (path = '/') => {
    const url = new URL(pagePath(path), pageUrl).href
    const window = new BrowserWindow({
      title: 'inksprite',
      ...placeBeside(BrowserWindow.getFocusedWindow()),
      minWidth: 360,
      minHeight: 480,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
        sandbox: true,
      },
    })
    window.once('ready-to-show', () => window.show())
    saveBeforeClosing(window)

    const { webContents } = window
    // A link followed in the window would take the app's place, and a window
    // the page opens would be a browser of its own: both go to the system's
    // browser instead, if they are links that may open (`links.js`).
    webContents.on('will-navigate', (event, to) => {
      if (originOf(to) === origin) return
      event.preventDefault()
      if (openable(to)) shell.openExternal(to)
    })
    webContents.setWindowOpenHandler(({ url: to }) => {
      if (openable(to)) shell.openExternal(to)
      return { action: 'deny' }
    })
    webContents.on('context-menu', (_, params) => showContextMenu(webContents, params))

    window.loadURL(url).catch(error => {
      console.error(`The page could not be loaded from ${url}: ${error.message}`)
      window.show()
    })
    return window
  }
}

/**
 * Where a new window goes: the size of the one in front and a little down
 * and to the right of it, as a Mac cascades them, or centred at the usual
 * size with none, or with one taking up the screen.
 *
 * @param {Electron.BrowserWindow|null} front
 * @returns {Partial<Electron.Rectangle>}
 */
export function placeBeside(front) {
  if (!front || front.isFullScreen() || front.isMaximized() || front.isMinimized()) return SIZE
  const { x, y, width, height } = front.getBounds()
  return { x: x + CASCADE, y: y + CASCADE, width, height }
}

/**
 * Bring a window to the front, out of the Dock or the taskbar if it is
 * there.
 *
 * @param {Electron.BrowserWindow|null|undefined} window
 */
export function bringForward(window) {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
