/**
 * The page's end of the bridge to the native side (`bridge.js`), as
 * `window.__INKSPRITE_DESKTOP__`: the page asks through `src/platform/`, and
 * its presence is how the page knows it is in the desktop window.
 *
 * Run in the window's sandbox, apart from the page, so it is CommonJS and
 * reaches nothing but Electron's messages.
 *
 * It runs in every frame of the window, so that a terminal's frame can be
 * given its own bridge, `__INKSPRITE_TERMINAL__`, which is all that frame
 * gets. Only the window's own page is given `__INKSPRITE_DESKTOP__`, and any
 * other frame nothing: what listens below hears nothing there, since the
 * native side speaks to the page alone.
 */

const { contextBridge, ipcRenderer } = require('electron')

/** Where a terminal's frame is (`terminals.js`). */
const TERMINAL_ORIGIN = 'terminal://frame'

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
 * What fetches a file still only on the sync server, for each session whose
 * run is under way: the page's, which says where the file is in the library
 * once it is there (`bridge.js`).
 * @type {Map<string, (id: string) => Promise<string|null>>}
 */
const fetchers = new Map()

ipcRenderer.on('python:fetchFile', async (_, session, request, id) => {
  let file = null
  try {
    file = (await fetchers.get(session)?.(id)) ?? null
  } catch {
    // Not fetched: Python's read of it fails.
  }
  ipcRenderer.send('python:fetched', request, file)
})

/**
 * What answers another app's request in this window (`appCalls.js`): the
 * page's, once it has said so. It is handed a way to say how the request is
 * stopped, should the app give up on it.
 * @type {((connection: object, message: object, onStop: (stop: () => void) => void) => Promise<object>)|null}
 */
let answerApps = null
/** @type {Map<number, () => void>} */
const appStops = new Map()

ipcRenderer.on('apps:call', async (_, request, connection, message) => {
  /** @type {object} */
  let answer = { pass: 'unready' }
  try {
    if (answerApps) {
      // Nothing is handed back to the page from taking its way to stop: the
      // bridge between the two carries plain values only.
      answer = await answerApps(connection, message, stop => {
        appStops.set(request, stop)
      })
    }
  } catch (error) {
    // Not answered here: another window is asked.
    console.error('An app’s request could not be answered in this window:', error)
  }
  appStops.delete(request)
  ipcRenderer.send('apps:answer', request, answer)
})

ipcRenderer.on('apps:cancel', (_, request) => appStops.get(request)?.())

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
 * What the page does when a terminal of its own is named by the program in
 * it, rings, or ends (`terminals.js`).
 * @type {((id: string, event: object) => void)|null}
 */
let terminalEvents = null

ipcRenderer.on('terminal:event', (_, id, event) => {
  terminalEvents?.(id, event)
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

const desktop = {
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

  python: {
    run(session, code, options, fetchFile) {
      if (fetchFile) fetchers.set(session, fetchFile)
      return call('python:run', session, code, options ?? {}).finally(() => {
        if (fetchers.get(session) === fetchFile) fetchers.delete(session)
      })
    },
    stop: session => ipcRenderer.send('python:stop', session),
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

  exportFolder: {
    choose: name => call('export:choose', name),
    write: (target, entries) => call('export:write', target, entries),
  },

  pdf: {
    save: name => call('pdf:save', name),
  },

  terminals: {
    create: () => call('terminal:create'),
    list: () => call('terminal:list'),
    close: id => call('terminal:close', id),
    onEvent(listener) {
      terminalEvents = listener
    },
  },

  apps: {
    list: () => call('apps:list'),
    add: name => call('apps:add', name),
    update: (id, patch) => call('apps:update', id, patch),
    remove: id => call('apps:remove', id),
    setPort: port => call('apps:port', port),
    answer: answer => {
      answerApps = answer
    },
  },
}

if (process.isMainFrame) contextBridge.exposeInMainWorld('__INKSPRITE_DESKTOP__', desktop)
else if (location.origin === TERMINAL_ORIGIN) exposeTerminal()

/**
 * A terminal's frame's bridge to its shell (`terminals.js`, and
 * `../terminal/frame.js` in the frame): a port of the frame's own, which the
 * native side joins to the one terminal the frame names. The page around the
 * frame has no part in it.
 */
function exposeTerminal() {
  /** @type {MessagePort|null} */
  let port = null
  contextBridge.exposeInMainWorld('__INKSPRITE_TERMINAL__', {
    attach(request, onMessage) {
      port?.close()
      const channel = new MessageChannel()
      port = channel.port1
      port.onmessage = event => {
        onMessage(event.data)
      }
      ipcRenderer.postMessage('terminal:attach', request, [channel.port2])
    },
    send(message) {
      port?.postMessage(message)
    },
  })
}
