/**
 * The desktop app: the web build in windows of its own. What the page asks
 * of the native side is answered in `bridge.js`; the design is
 * `.llm/desktop_design.md`.
 */

import { BrowserWindow, app, session } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleBridge } from './bridge.js'
import { ensureLibrary } from './library.js'
import { originOf } from './links.js'
import { setMenu } from './menu.js'
import { PAGE_URL, registerScheme, servePage } from './page.js'
import { windowOpener } from './windows.js'

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

/** Opens a window on a path of the page (`windows.js`). */
const openWindow = windowOpener(pageUrl)

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

// One copy of the app at a time: a second would open the same database. The
// app opened again opens another window instead, as the File menu's New
// Window does.
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    if (started) openWindow()
  })
  app.whenReady().then(start)
} else {
  app.quit()
}

/** Whether the page is served, and windows may open on it. */
let started = false

async function start() {
  // The projects' folder is there before the window that keeps them.
  await ensureLibrary()
  servePage(pageRoot)
  handleBridge(origin, { openWindow })
  session.defaultSession.setPermissionRequestHandler((_, permission, grant) =>
    grant(PERMISSIONS.has(permission))
  )
  session.defaultSession.setPermissionCheckHandler((_, permission) => PERMISSIONS.has(permission))
  setMenu({ newWindow: () => openWindow() })
  openWindow()
  started = true
  // On a Mac the app stays open with its windows closed, as Mac apps do, and
  // its Dock icon opens a window again.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
