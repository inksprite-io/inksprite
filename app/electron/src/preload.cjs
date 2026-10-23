/**
 * The page's end of the bridge to the native side (`bridge.js`), as
 * `window.__INKSPRITE_DESKTOP__`: the page asks through `src/platform/`, and
 * its presence is how the page knows it is in the desktop window.
 *
 * Run in the window's sandbox, apart from the page, so it is CommonJS and
 * reaches nothing but Electron's messages.
 */

const { contextBridge, ipcRenderer } = require('electron')

/**
 * The page's listeners for a response's body, and for the browser coming
 * back from a sign-in, by the id the page gave the call.
 * @type {Map<number, (part: object) => void>}
 */
const bodies = new Map()
/** @type {Map<number, (query: string) => void>} */
const returns = new Map()

ipcRenderer.on('fetch:body', (_, id, part) => {
  const listener = bodies.get(id)
  if (!listener) return
  if (!part.chunk) bodies.delete(id)
  listener(part)
})

ipcRenderer.on('signIn:back', (_, id, query) => {
  const listener = returns.get(id)
  returns.delete(id)
  listener?.(query)
})

/**
 * What the page does before its window closes: saves. Done or not, the
 * window is told, and goes (`closing.js`).
 * @type {(() => Promise<void>)|null}
 */
let beforeClosing = null

ipcRenderer.on('window:save', async () => {
  try {
    await beforeClosing?.()
  } catch {
    // The window closes all the same.
  }
  ipcRenderer.send('window:saved')
})

/**
 * Ask the native side, and throw what went wrong there as an Error.
 *
 * @param {string} channel
 * @param {...unknown} args
 */
async function call(channel, ...args) {
  const { value, error } = await ipcRenderer.invoke(channel, ...args)
  if (error !== undefined) throw new Error(error)
  return value
}

contextBridge.exposeInMainWorld('__INKSPRITE_DESKTOP__', {
  fetch(id, request, onBody) {
    bodies.set(id, onBody)
    return call('fetch', id, request).catch(error => {
      bodies.delete(id)
      throw error
    })
  },
  abortFetch: id => ipcRenderer.send('fetch:abort', id),

  signIn(id, request, onReturn) {
    returns.set(id, onReturn)
    return call('signIn', id, request).catch(error => {
      returns.delete(id)
      throw error
    })
  },
  stopSignIn(id) {
    returns.delete(id)
    ipcRenderer.send('signIn:stop', id)
  },

  openInBrowser: url => call('open', url),

  openWindow: path => call('window:open', path),
  focusWindow: () => call('window:focus'),

  downloadUpdate: () => call('update:download'),
  installUpdate: () => call('update:install'),

  settingsFile: () => call('settings:file'),

  beforeClosing: save => {
    beforeClosing = save
  },

  library: {
    settings: () => call('library:settings'),
    markMoved: () => call('library:moved'),
    projects: () => call('library:projects'),
    walk: dir => call('library:walk', dir),
    read: paths => call('library:read', paths),
    list: dir => call('library:list', dir),
    readBytes: path => call('library:readBytes', path),
    apply: ops => call('library:apply', ops),
    reveal: path => call('library:reveal', path),
  },
})
