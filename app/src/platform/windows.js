/* global BroadcastChannel */
/**
 * @module platform/windows
 * @description The app open more than once: in more than one window of the
 * desktop app, or in more than one tab of a browser.
 *
 * Each window keeps what it reads in memory and writes its rows whole, so two
 * windows on one project would write over each other's edits, and each would
 * go on showing its own. So in the desktop app a project is open in one
 * window at a time. The window holds it with a lock (Web Locks) while the
 * project is open there, or while a job of the project runs there, and lets
 * go when it moves to another project or the job ends. A window that closes
 * or reloads lets go of its projects with it. A project asked for in another
 * window is shown there.
 *
 * A browser's tabs hold nothing: a tab opens the project it is asked for, as
 * the app did before it knew of other windows, rather than tell the writer
 * each new tab that the project is open in another.
 *
 * What the windows share besides, the app's settings and the list of
 * projects, they tell each other about when they change it, on a
 * BroadcastChannel, and each reads it again (`onNotice`), tabs as well. A
 * window that took a project another window has had since is behind on it,
 * and reloads rather than show what it kept (`takeProject`'s `stale`).
 */

import { desktop, isDesktop } from './desktop.js'

/**
 * What a window holds a project for: being open there, or a job running
 * there, by the job's id.
 * @typedef {'open'|`job:${string}`} Reason
 */

/**
 * What came of taking a project: whether this window holds it, and whether
 * what it kept of it from before is behind (see `takeProject`).
 * @typedef {{held: boolean, stale: boolean, first: boolean}} Taken
 */

/**
 * What one window tells the others.
 *
 * - `taken` - It took a project: one another window had is now behind
 * - `show` - Whichever window has this project is to show it, and come to
 *   the front
 * - `tables` - It wrote rows of these app tables
 * - `projects` - A project came, went, or was renamed
 * - `reload` - Everything was replaced, and every window is to read it again
 * - `cloud` - The sync server has something new, and a window that syncs
 *   projects of its own is to sync them
 *
 * @typedef {{type: 'taken'|'show', storyId: string}
 *   | {type: 'tables', tables: string[]}
 *   | {type: 'projects'|'reload'|'cloud'}} Notice
 */

/** The channel the windows speak on. */
const CHANNEL = 'inksprite-windows'

/** A project's lock, by its story's id. */
const lockName = storyId => `inksprite-project:${storyId}`

/**
 * The projects this window holds, each with why, and the call that lets go
 * of its lock.
 * @type {Map<string, {reasons: Set<Reason>, release: () => void}>}
 */
const held = new Map()

/** @type {Map<string, Promise<void>>} Takes of a project under way, by its id */
const taking = new Map()

/** Projects this window has held since it loaded. */
const touched = new Set()

/** Projects this window has held that another window has taken since. */
const behind = new Set()

/** @type {Map<string, Set<(notice: any) => void>>} */
const listeners = new Map()

/** @type {BroadcastChannel|null} */
let channel = null

/**
 * The locks projects are held with: the desktop app's, which a browser's
 * tabs go without.
 * @returns {LockManager|null}
 */
const locks = () => (isDesktop() ? (globalThis.navigator?.locks ?? null) : null)

/**
 * The channel, opened the first time it is wanted.
 * @returns {BroadcastChannel|null}
 */
function theChannel() {
  if (channel || typeof BroadcastChannel === 'undefined') return channel
  channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = event => heard(event.data)
  return channel
}

/** @param {Notice} notice */
function heard(notice) {
  if (!notice || typeof notice !== 'object') return
  // Without locks every window takes every project, and none is behind.
  if (notice.type === 'taken' && locks() && touched.has(notice.storyId)) {
    behind.add(notice.storyId)
  }
  for (const listener of listeners.get(notice.type) || []) listener(notice)
}

/**
 * Tell the other windows.
 * @param {Notice} notice
 */
export function tellOtherWindows(notice) {
  theChannel()?.postMessage(notice)
}

/**
 * Have this window hear a notice as if another window had told it: sync,
 * having written rows of app tables that this window's stores read.
 * @param {Notice} notice
 */
export function tellThisWindow(notice) {
  heard(notice)
}

/**
 * Hear what the other windows tell, of one kind.
 *
 * @template {Notice['type']} T
 * @param {T} type
 * @param {(notice: Extract<Notice, {type: T}>) => void} listener
 * @returns {() => void} Stops listening
 */
export function onNotice(type, listener) {
  theChannel()
  if (!listeners.has(type)) listeners.set(type, new Set())
  listeners.get(type)?.add(listener)
  return () => listeners.get(type)?.delete(listener)
}

/**
 * When another window writes rows of these app tables: a store reads its
 * rows again. What goes wrong doing so is logged.
 *
 * @param {string[]} tables
 * @param {() => Promise<void>|void} reload
 * @returns {() => void} Stops listening
 */
export function onTablesWritten(tables, reload) {
  return onNotice('tables', async notice => {
    if (!notice.tables.some(table => tables.includes(table))) return
    try {
      await reload()
    } catch (error) {
      console.error(`Failed to read ${tables.join(', ')} again:`, error)
    }
  })
}

/**
 * Hold a project in this window, for a reason: open here, or a job of it
 * running here. Held already, the reason is added. Held by another window,
 * it is not taken.
 *
 * `stale` says this window has held the project before and another has
 * taken it since: what this window kept of it is out of date, and the
 * window is to read it again before using it. `first` says this window has
 * not held it since it loaded: what it read of it meanwhile, for the list of
 * projects, may have been read while another window had it.
 *
 * @param {string} storyId
 * @param {Reason} reason
 * @returns {Promise<Taken>}
 */
export function takeProject(storyId, reason) {
  theChannel()
  // One take of a project at a time: a second, asking for the lock while
  // the first waits on it, would find it taken by this window.
  const before = taking.get(storyId) ?? Promise.resolve()
  const taken = before.then(() => take(storyId, reason))
  /** @type {Promise<void>} */
  const settled = taken.then(
    () => {},
    () => {}
  )
  taking.set(storyId, settled)
  settled.then(() => {
    if (taking.get(storyId) === settled) taking.delete(storyId)
  })
  return taken
}

/**
 * @param {string} storyId
 * @param {Reason} reason
 * @returns {Promise<Taken>}
 */
async function take(storyId, reason) {
  const stale = behind.has(storyId)
  const first = !touched.has(storyId)
  const mine = held.get(storyId)
  if (mine) {
    mine.reasons.add(reason)
    return { held: true, stale, first }
  }
  const manager = locks()
  if (!manager) {
    keep(storyId, reason, () => {})
    return { held: true, stale, first }
  }

  const release = await /** @type {Promise<(() => void)|null>} */ (
    new Promise((resolve, reject) => {
      manager
        .request(lockName(storyId), { ifAvailable: true }, lock => {
          if (!lock) return resolve(null)
          // The lock is held until the promise returned here settles.
          return new Promise(done => resolve(() => done(undefined)))
        })
        .catch(reject)
    })
  )
  if (!release) return { held: false, stale, first }
  keep(storyId, reason, release)
  return { held: true, stale, first }
}

/**
 * @param {string} storyId
 * @param {Reason} reason
 * @param {() => void} release
 */
function keep(storyId, reason, release) {
  held.set(storyId, { reasons: new Set([reason]), release })
  touched.add(storyId)
  behind.delete(storyId)
  tellOtherWindows({ type: 'taken', storyId })
}

/**
 * Stop holding a project for a reason. With no reason left, the project is
 * let go of, for another window to take.
 *
 * @param {string} storyId
 * @param {Reason} reason
 */
export function letGoOfProject(storyId, reason) {
  const mine = held.get(storyId)
  if (!mine) return
  mine.reasons.delete(reason)
  if (mine.reasons.size > 0) return
  held.delete(storyId)
  mine.release()
}

/**
 * Whether this window holds a project, for any reason, or for this one.
 *
 * @param {string} storyId
 * @param {Reason} [reason]
 * @returns {boolean}
 */
export function holdsProject(storyId, reason) {
  const mine = held.get(storyId)
  return Boolean(mine && (!reason || mine.reasons.has(reason)))
}

/**
 * The projects this window holds.
 *
 * @returns {string[]}
 */
export const heldProjects = () => [...held.keys()]

/**
 * The projects other windows hold.
 *
 * @returns {Promise<Set<string>>}
 */
export async function projectsElsewhere() {
  const manager = locks()
  if (!manager) return new Set()
  const prefix = lockName('')
  const { held: all = [] } = await manager.query()
  return new Set(
    all
      .map(lock => lock.name || '')
      .filter(name => name.startsWith(prefix))
      .map(name => name.slice(prefix.length))
      .filter(storyId => !held.has(storyId))
  )
}

/**
 * Ask the window that has a project to show it, and come to the front: the
 * writer asked for a project open in another window.
 *
 * @param {string} storyId
 */
export function askForProject(storyId) {
  tellOtherWindows({ type: 'show', storyId })
}

/**
 * When another window asks for a project this one holds, to show it.
 *
 * @param {(storyId: string) => void} show
 * @returns {() => void} Stops listening
 */
export function onProjectAsked(show) {
  return onNotice('show', ({ storyId }) => {
    if (held.has(storyId)) show(storyId)
  })
}

/**
 * Bring this window to the front.
 *
 * @returns {Promise<void>}
 */
export async function bringWindowForward() {
  if (isDesktop()) await desktop().focusWindow?.()
}

/**
 * Open the app again beside this window, on a path of its own: a new window
 * of the desktop app, a new tab in a browser.
 *
 * @param {string} [path]
 * @returns {Promise<void>}
 */
export async function openWindow(path = '/') {
  if (isDesktop()) {
    await desktop().openWindow?.(path)
    return
  }
  globalThis.open?.(path, '_blank', 'noopener')
}

/** Forget every hold and listener: for tests. */
export function resetWindowsForTesting() {
  for (const mine of held.values()) mine.release()
  held.clear()
  taking.clear()
  touched.clear()
  behind.clear()
  listeners.clear()
  channel?.close()
  channel = null
}
