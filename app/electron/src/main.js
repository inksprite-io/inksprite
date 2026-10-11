/**
 * The desktop app: the web build in a window of its own. What the page asks
 * of the native side is answered in `bridge.js`; the design is
 * `.llm/desktop_design.md`.
 */

import { BrowserWindow, app, session, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleBridge } from './bridge.js'
import { openable, originOf } from './links.js'
import { setMenu, showContextMenu } from './menu.js'
import { PAGE_URL, registerScheme, servePage } from './page.js'

/**
 * Where the window loads the page from: the build packaged with the app, or,
 * run from the checkout (`start-on-mac.sh`, `npm start`), the dev server (the
 * test server from `docker compose`), so that an edit reloads in the window as
 * it does in a browser. `INKSPRITE_PAGE_URL` names another: `app://inksprite/`
 * is the build in `app/dist`.
 */
const pageUrl = app.isPackaged
  ? PAGE_URL
  : process.env.INKSPRITE_PAGE_URL || 'http://127.0.0.1:8002/'
const origin = /** @type {string} */ (originOf(pageUrl))

/** The build's files: packaged with the app, or `app/dist`. */
const pageRoot = app.isPackaged
  ? path.join(app.getAppPath(), 'page')
  : fileURLToPath(new URL('../../dist', import.meta.url))

/**
 * What the page may be granted, of what a site asks the writer for.
 * Persistent storage keeps the database from being cleared when the disk
 * runs short.
 */
const PERMISSIONS = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'persistent-storage',
])

registerScheme()

// A run from the checkout keeps its data apart from the installed app's, so
// that the two can be open at once.
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'inksprite-dev'))

// One copy of the app at a time: a second would open the same database.
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app.whenReady().then(start)
} else {
  app.quit()
}

function start() {
  servePage(pageRoot)
  handleBridge(origin)
  session.defaultSession.setPermissionRequestHandler((_, permission, grant) =>
    grant(PERMISSIONS.has(permission))
  )
  session.defaultSession.setPermissionCheckHandler((_, permission) => PERMISSIONS.has(permission))
  setMenu()
  openWindow()
  // On a Mac the app stays open with its window closed, as Mac apps do, and
  // its Dock icon opens the window again.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function openWindow() {
  const window = new BrowserWindow({
    title: 'inksprite',
    width: 1400,
    height: 900,
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

  const { webContents } = window
  // A link followed in the window would take the app's place, and a window
  // the page opens would be a browser of its own: both go to the system's
  // browser instead, if they are links that may open (`links.js`).
  webContents.on('will-navigate', (event, url) => {
    if (originOf(url) === origin) return
    event.preventDefault()
    if (openable(url)) shell.openExternal(url)
  })
  webContents.setWindowOpenHandler(({ url }) => {
    if (openable(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  webContents.on('context-menu', (_, params) => showContextMenu(webContents, params))

  window.loadURL(pageUrl).catch(error => {
    console.error(`The page could not be loaded from ${pageUrl}: ${error.message}`)
    window.show()
  })
}
