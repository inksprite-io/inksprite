/* global AbortController */
/**
 * @module harness/desktop
 * @description The desktop app's bridge (`platform/desktop.js`), as much of it
 * as a chat reaches, for a scenario run as the desktop app runs it: its
 * requests, and Python, so that `run_python` is offered and answered.
 *
 * The app finds the bridge on the global, and once it is there sends its
 * requests through it (`platform/fetch.js`), which pass them on to `fetch`
 * here, where the environment keeps them. Python is the desktop app's own
 * Pyodide and wheels, in a worker thread for each chat (`python-worker.js`),
 * and `/project` made from the entries the page hands each run, by the app's
 * own `projectForPython`: the paths a model is tried on are the ones it meets
 * in the app.
 *
 * What differs from the sandbox: nothing fences the code from the disk or the
 * network but Pyodide itself, and an imported file's bytes are in no library
 * on disk, so `/project` holds only the text read out of it. Needs `npm ci`
 * and `node scripts/fetch-python.mjs` in `app/electron`.
 */

import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ELECTRON = join(HERE, '..', 'electron')
const WHEELS = join(ELECTRON, 'python')

/** As the sandbox clips what a run says (`electron/src/sandbox.js`). */
const MAX_OUTPUT = 20000

/** @param {unknown} text */
function clip(text) {
  const string = typeof text === 'string' ? text : ''
  if (string.length <= MAX_OUTPUT) return string
  return `${string.slice(0, MAX_OUTPUT)}\n… (${string.length - MAX_OUTPUT} more characters)`
}

/**
 * @typedef {Object} Session
 * @property {Worker} worker
 * @property {Promise<void>} ready
 * @property {(() => void)|null} stop - Ends the run under way
 */

/** @type {Map<string, Session>} */
const sessions = new Map()
/** The sessions stopped since they last ran, whose next run starts afresh. */
const ended = new Set()
let nextId = 1

/** @param {string} pyodide - Where the package is */
function start(pyodide) {
  const worker = new Worker(join(HERE, 'python-worker.js'), {
    workerData: { pyodide, wheels: WHEELS },
  })
  // A chat's Python is let go with the harness, as an app's with its window.
  worker.unref()
  const ready = new Promise((resolve, reject) => {
    worker.once('message', message => (message?.ready ? resolve(undefined) : reject(message)))
    worker.once('error', reject)
  })
  return { worker, ready: /** @type {Promise<void>} */ (ready), stop: null }
}

/** @param {string} key */
function end(key) {
  const session = sessions.get(key)
  if (!session) return
  sessions.delete(key)
  ended.add(key)
  session.stop?.()
  session.worker.terminate()
}

/** @param {number} ms */
const duration = ms =>
  ms % 60000 === 0
    ? `${ms / 60000} minute${ms === 60000 ? '' : 's'}`
    : `${Math.round(ms / 1000)} seconds`

/**
 * Requests made through the bridge, by the page's id for them.
 *
 * @type {Map<number, AbortController>}
 */
const requests = new Map()

/** @type {import('@/platform/desktop.js').DesktopBridge['fetch']} */
async function fetchFor(id, { url, method, headers, body, redirect }, onBody) {
  const controller = new AbortController()
  requests.set(id, controller)
  let response
  try {
    response = await globalThis.fetch(url, {
      method,
      headers,
      body,
      redirect,
      signal: controller.signal,
    })
  } catch (error) {
    requests.delete(id)
    throw error
  }
  const stream = response.body
  ;(async () => {
    try {
      if (stream) for await (const chunk of stream) onBody({ chunk })
      onBody({ done: true })
    } catch (error) {
      onBody({ error: String(error?.message || error) })
    } finally {
      requests.delete(id)
    }
  })()
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers],
  }
}

/**
 * Stand up the desktop bridge, for a scenario run as the desktop app.
 *
 * @throws {Error} Without the desktop app's Pyodide and wheels
 */
export function installDesktop() {
  let pyodide
  try {
    pyodide = dirname(createRequire(join(ELECTRON, 'package.json')).resolve('pyodide/package.json'))
  } catch {
    throw new Error('Python needs the desktop app’s packages: npm ci in app/electron.')
  }
  if (!existsSync(WHEELS)) {
    throw new Error('Python needs its wheels: node scripts/fetch-python.mjs in app/electron.')
  }

  /** @type {import('@/platform/desktop.js').DesktopPython} */
  const python = {
    async run(key, code, { timeoutMs = null, project = null, filename = null } = {}) {
      const fresh = !sessions.has(key) && ended.delete(key)
      let session = sessions.get(key)
      if (!session) {
        session = start(pyodide)
        sessions.set(key, session)
      }
      try {
        await session.ready
      } catch (error) {
        end(key)
        return { stdout: '', stderr: '', value: null, error: String(error), restarted: true }
      }
      const id = nextId++
      const { worker } = session
      const ran = await new Promise(resolve => {
        const finish = (/** @type {any} */ result) => {
          clearTimeout(timer)
          worker.off('message', onMessage)
          if (session) session.stop = null
          resolve(result)
        }
        const stopped = (/** @type {string} */ error) =>
          finish({ stdout: '', stderr: '', value: null, error, restarted: true })
        const timer = timeoutMs
          ? setTimeout(() => {
              stopped(`Stopped after ${duration(timeoutMs)}.`)
              end(key)
            }, timeoutMs)
          : undefined
        const onMessage = (/** @type {any} */ data) => {
          if (data?.id !== id) return
          finish({
            stdout: clip(data.stdout),
            stderr: clip(data.stderr),
            value: data.value == null ? null : clip(data.value),
            error: data.error == null ? null : clip(data.error),
            restarted: false,
          })
        }
        if (session) session.stop = () => stopped('Stopped.')
        worker.on('message', onMessage)
        worker.postMessage({ id, code, filename: filename ?? '<code>', project: project ?? [] })
      })
      return fresh ? { ...ran, restarted: true } : ran
    },
    stop: end,
  }
  /** @type {Partial<import('@/platform/desktop.js').DesktopBridge>} */
  const bridge = {
    fetch: fetchFor,
    abortFetch: id => {
      requests.get(id)?.abort()
      requests.delete(id)
    },
    python,
  }
  Object.defineProperty(globalThis, '__INKSPRITE_DESKTOP__', { value: bridge, configurable: true })
}
