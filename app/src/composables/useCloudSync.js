/* global AbortController */
/**
 * @module composables/useCloudSync
 * @description Sync, as the app runs it: signing in and out, and the rounds
 * that keep this device's projects in step with the writer's others.
 *
 * Signed in, the device keeps its account in sync's own table: the server's
 * address, the name, the session's token, and the account's keys as
 * CryptoKeys that can't be exported, so the passphrase is asked for once.
 * Every write to a project is noted for sync from then on, in every window.
 *
 * A file's bytes stay on the server until they are wanted: the files store
 * fetches them through `cloud/onDemand.js`, which this provides while signed
 * in.
 *
 * The writer's setup syncs as well, as the account's own collection
 * (`cloud/setup.js`): the app tables it is made of reach sync through the
 * storage facade as a project's rows do, and the settings kept outside the
 * database are watched here, a group to a row.
 *
 * Each device gives the server a name for itself (`cloud/deviceName.js`),
 * so the account's list of devices says which is which, and any of them can
 * sign another out. A device signed out that way finds out at its next
 * request, and lets go of what sync kept, as signing out here would.
 *
 * One window syncs for the app: the one holding the `inksprite-sync` lock.
 * It listens to the server's stream of changes, and runs a round when one
 * comes, a few seconds after a write, when the app comes back into view or
 * online, and every minute. In the desktop app a window also syncs the
 * projects it holds, and the window syncing for the app tells the others
 * when the server has something new.
 *
 * A hosted server may ask a device to wait (too many requests), say the
 * account is full, or that it was turned off: the rounds wait as long as
 * asked, the status says the storage is full, and a device turned off stops
 * syncing and keeps everything, until Sync now finds it on again. Every
 * quarter of an hour, and as the page is hidden, the device sends the
 * server what its engine counted (`cloud/diagnostics.js`), unless the writer
 * turned that off here or the server wants none.
 *
 * A project can be kept on this device only: its files are fetched here
 * first, since the server's copy goes, and its story says so (`syncOff`),
 * which the engine leaves out of every round. Synced again, it goes up whole.
 *
 * A newer app's records hold the pull until this one is updated, and the
 * server may refuse an old build's pushes: the app looks for an update at
 * once, rather than at the next hour (`useUpdates`), and says so once, in a
 * dialog that offers the update when it is ready (`askedToUpdate`), as well
 * as in the status line.
 *
 * A project is shared with friends by their friend codes, from its menu,
 * and a friend leaves one shared with them there. Who this account is, and
 * who is in each project shared, is kept in `cloud/people.js` for what shows
 * a comment's author; the account's id is kept with it, so that a comment
 * written before the server is reached says who wrote it too.
 *
 * Design: `.llm/sync_design.md`.
 */

import { ref, readonly, watch } from 'vue'
import { storage, onWrittenForSync } from '@/storage/index.js'
import { CloudError, createApi } from '@/cloud/api.js'
import {
  changePassphrase as changeTo,
  recover as recoverWith,
  remakeRecovery as remakeWith,
  signIn as signInTo,
  signUp as signUpTo,
} from '@/cloud/account.js'
import { deviceName } from '@/cloud/deviceName.js'
import { createDiagnostics } from '@/cloud/diagnostics.js'
import { createEngine } from '@/cloud/engine.js'
import { appLocal } from '@/cloud/local.js'
import { SETTINGS, settingsRows } from '@/cloud/setup.js'
import { provideFiles } from '@/cloud/onDemand.js'
import { stableJson } from '@/cloud/crypto.js'
import { me, sharing } from '@/cloud/people.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { useStoriesStore } from '@/stores/storiesStore'
import { useSyncStore } from '@/stores/syncStore'
import { upgradeTables } from '@/utils/backup.js'
import { localStorage as kept } from '@/utils/localStorage.js'
import { heldProjects, onNotice, onTablesWritten, tellOtherWindows } from '@/platform/windows.js'
import { lookForUpdate } from './useUpdates.js'

/** @typedef {import('@/cloud/crypto.js').AccountKeys} AccountKeys */
/** @typedef {import('@/cloud/engine.js').Status} Status */
/** @typedef {import('@/cloud/engine.js').Engine} Engine */

/**
 * The account this device is signed in to, as kept.
 *
 * @typedef {Object} SignedIn
 * @property {'account'} id
 * @property {string} server
 * @property {string} name
 * @property {string} token
 * @property {AccountKeys} keys
 * @property {number} [accountId] - The account's id on the server, once it has said
 */

/** How long after a write a round runs, so typing goes as one. */
const AFTER_WRITE_MS = 3000

/** How often a round runs with nothing else to start one. */
const EVERY_MS = 60_000

/** How long to wait before listening again once the stream breaks, at most. */
const MOST_WAIT_MS = 60_000

/** How often diagnostics go to the server while the app is open. */
const DIAGNOSTICS_EVERY_MS = 15 * 60 * 1000

/** Where this device keeps whether it sends them. */
const DIAGNOSTICS_KEY = 'syncDiagnostics'

/** What an account turned off on the server is told here. */
const TURNED_OFF = 'This account has been turned off. Your projects on this device are untouched.'

/** The account, if this device is signed in. @type {import('vue').Ref<{server: string, name: string}|null>} */
const account = ref(null)

/** @type {import('vue').Ref<Status>} */
const status = ref({ phase: 'idle', waiting: 0, last: null, error: null })

/** Why this device was signed out, when it wasn't by the writer here. @type {import('vue').Ref<string|null>} */
const notice = ref(null)

/**
 * What the account keeps and may keep, in bytes, as last asked; no quota for
 * no limit, and nothing until asked or from an older server.
 * @type {import('vue').Ref<{used: number, quota: number|null}|null>}
 */
const usage = ref(null)

/** Whether this device sends the server its diagnostics. */
const sendsDiagnostics = ref(/** @type {boolean} */ (kept.get(DIAGNOSTICS_KEY, true)))

/** Whether the server wants them, as it last said. */
let serverWants = true

/** What the engine counts, until it is sent. */
let diagnostics = createDiagnostics()

/** No round runs before this: the server asked this device to wait. */
let pausedUntil = 0

/** @type {Engine|null} */
let engine = null

/** The server, as this device is signed in to it. @type {ReturnType<typeof createApi>|null} */
let api = null

/** Whether this window syncs for the app. */
let leading = false

/** What to undo on signing out. @type {Array<() => void>} */
let stops = []

/** @type {ReturnType<typeof setTimeout>|null} */
let soon = null

/** @type {Promise<void>|null} */
let starting = null

/** Whether the rounds wait for an update, which was looked for as they began to. */
let waitsForUpdate = false

/** Whether to tell the writer that some changes wait for an update: once, as the rounds begin to. */
const askedToUpdate = ref(false)

/**
 * Sync's own rows, kept through the storage facade.
 * @type {import('@/cloud/engine.js').State}
 */
const state = {
  get: (table, id) => storage.get(/** @type {any} */ (table), id),
  all: table => storage.all(/** @type {any} */ (table)),
  ofStory: (table, storyId) => storage.ofStory(/** @type {any} */ (table), storyId),
  write: (table, changes) => storage.write(table, changes),
}

/**
 * A row from an older schema, moved forward with the backup's transforms.
 *
 * @param {string} table
 * @param {any} row
 * @param {number} from
 */
function upgrade(table, row, from) {
  const moved = upgradeTables({ [table]: [row] }, from, storage.schemaVersion())
  return moved[table]?.[0] ?? row
}

/** Run a round now, if this window has anything to sync. */
async function round() {
  if (soon) clearTimeout(soon)
  soon = null
  if (!engine || (!leading && heldProjects().length === 0)) return
  const wait = pausedUntil - Date.now()
  if (wait > 0) {
    roundIn(wait)
    return
  }
  const wasFull = engine.status.full
  try {
    await engine.round()
  } catch (error) {
    if (isSignedOut(error)) await signedOutElsewhere()
    else if (isTurnedOff(error)) turnedOff()
    else if (error instanceof CloudError && error.status === 429) {
      pausedUntil = Date.now() + 1000 * (Number(error.extra.retryAfter) || 60)
    } else console.error('Sync failed:', error)
  }
  if (engine && engine.status.full !== wasFull) refreshUsage()
}

/**
 * Whether the server no longer takes this device's session: signed out from
 * another device, most likely.
 * @param {unknown} error
 */
const isSignedOut = error => error instanceof CloudError && error.status === 401

/**
 * Whether the server turned the account off.
 * @param {unknown} error
 */
const isTurnedOff = error =>
  error instanceof CloudError && error.status === 403 && error.extra.disabled === true

/**
 * Stop syncing an account the server turned off, keeping it, and everything
 * here: Sync now tries again.
 */
function turnedOff() {
  const signedIn = account.value
  end()
  account.value = signedIn
  status.value = { ...status.value, phase: 'error', error: TURNED_OFF }
}

/** Ask the server what the account keeps, and whether it wants diagnostics. */
async function refreshUsage() {
  if (!api) return
  try {
    const held = await api.account()
    usage.value = held.usage ?? null
    serverWants = held.diagnostics !== false
    if (held.id != null && held.id !== me.value) await keepAccountId(held.id)
  } catch {
    // Asked again when the settings are next shown.
  }
}

/**
 * Keep the account's id with it, for the comments written here to say who wrote them.
 * @param {number} id
 */
async function keepAccountId(id) {
  me.value = id
  /** @type {SignedIn|undefined} */
  const signedIn = await storage.get('cloudState', 'account')
  if (signedIn && signedIn.accountId !== id) {
    await storage.put('cloudState', { ...signedIn, accountId: id })
  }
}

/** Send the server what the engine counted since the last time. */
async function sendDiagnostics() {
  if (!api || !sendsDiagnostics.value || !serverWants) return
  const report = diagnostics.take({
    app: import.meta.env.VITE_APP_VERSION || 'dev',
    device: deviceName(),
    schema: storage.schemaVersion(),
  })
  if (!report) return
  try {
    await api.diagnostics(report)
  } catch {
    // Lost; the next report counts from here.
  }
}

/**
 * Send diagnostics from this device, or not.
 * @param {boolean} on
 */
function setSendsDiagnostics(on) {
  sendsDiagnostics.value = on
  kept.set(DIAGNOSTICS_KEY, on)
}

/** Let go of an account the server signed this device out of. */
async function signedOutElsewhere() {
  if (!engine) return
  end()
  await forgetAccount()
  notice.value = 'This device was signed out. Sign in again to sync it.'
}

/**
 * Run a round in a while, unless one is due sooner.
 * @param {number} ms
 */
function roundIn(ms) {
  if (soon) return
  soon = setTimeout(round, ms)
}

/**
 * Start syncing as this account.
 * @param {SignedIn} signedIn
 */
function begin(signedIn) {
  account.value = { server: signedIn.server, name: signedIn.name }
  me.value = signedIn.accountId ?? null
  notice.value = null
  const at = createApi(signedIn.server, signedIn.token)
  api = at
  // Named again as the app starts, for a device signed in before names were
  // kept, or one whose name has changed. A server without names is no matter.
  at.nameDevice(deviceName()).catch(() => {})
  diagnostics = createDiagnostics()
  pausedUntil = 0
  refreshUsage()
  const running = createEngine({
    api: at,
    keys: signedIn.keys,
    local: appLocal({ syncsForApp: () => leading }),
    state,
    schema: storage.schemaVersion(),
    upgrade,
    onStatus: next => {
      if (next.phase === 'held' && !waitsForUpdate) {
        lookForUpdate()
        askedToUpdate.value = true
      }
      if (next.phase === 'held' || next.phase === 'idle') waitsForUpdate = next.phase === 'held'
      status.value = next
    },
    onSharing: next => {
      sharing.value = next
    },
    diagnostics,
  })
  engine = running
  const controller = new AbortController()

  stops.push(
    onWrittenForSync(written => {
      running.noteWrite(written)
      roundIn(AFTER_WRITE_MS)
    }),
    // Another window's writes wait in the outbox too.
    onTablesWritten(['cloudOutbox'], () => roundIn(AFTER_WRITE_MS)),
    onNotice('cloud', () => roundIn(0)),
    watchSettings(running),
    provideFiles({
      has: id => running.hasFile(id),
      fetch: (id, progress) => running.fetchFile(id, progress),
      fetchProjects: storyIds => running.fetchProjectFiles(storyIds),
    }),
    () => controller.abort()
  )

  const now = () => roundIn(0)
  const shown = () => {
    if (document.visibilityState === 'visible') roundIn(0)
    else sendDiagnostics()
  }
  window.addEventListener('online', now)
  document.addEventListener('visibilitychange', shown)
  const every = window.setInterval(now, EVERY_MS)
  const report = window.setInterval(sendDiagnostics, DIAGNOSTICS_EVERY_MS)
  stops.push(() => {
    window.removeEventListener('online', now)
    document.removeEventListener('visibilitychange', shown)
    window.clearInterval(every)
    window.clearInterval(report)
  })

  lead(at, controller.signal)
  roundIn(0)
}

/**
 * Have sync send the settings kept outside the database when they change:
 * each group that changed, as a row of the setup. Another window's change
 * reaches this one's settings too, and is sent again; the server already
 * has it, and it goes no further.
 *
 * @param {Engine} running
 * @returns {() => void} Stop watching
 */
function watchSettings(running) {
  const appState = useApplicationState()
  return watch(
    () => settingsRows(appState.settingsForBackup()),
    (now, before) => {
      const changes = now
        .filter((row, at) => stableJson(row) !== stableJson(before?.[at]))
        .map(row => ({
          entityType: SETTINGS,
          id: row.id,
          op: /** @type {const} */ ('put'),
          data: row,
          timestamp: Date.now(),
        }))
      if (changes.length === 0) return
      running.noteWrite({ method: 'write', table: SETTINGS, changes })
      roundIn(AFTER_WRITE_MS)
    }
  )
}

/**
 * Become the window that syncs for the app once no other is, and listen to
 * the server from then on.
 *
 * @param {ReturnType<typeof createApi>} api
 * @param {AbortSignal} signal
 */
function lead(api, signal) {
  const locks = globalThis.navigator?.locks
  const listen = async () => {
    leading = true
    roundIn(0)
    let wait = 1000
    while (!signal.aborted) {
      try {
        await api.listen(() => {
          roundIn(0)
          tellOtherWindows({ type: 'cloud' })
        }, signal)
        wait = 1000
      } catch (error) {
        if (signal.aborted) break
        if (isSignedOut(error)) {
          await signedOutElsewhere()
          break
        }
        if (isTurnedOff(error)) {
          turnedOff()
          break
        }
        diagnostics.count('streamsReopened')
        await new Promise(resolve => setTimeout(resolve, wait))
        wait = Math.min(wait * 2, MOST_WAIT_MS)
      }
    }
    leading = false
  }
  if (!locks) {
    listen()
    return
  }
  locks.request('inksprite-sync', { signal }, listen).catch(() => {
    // Signed out before this window's turn came.
  })
}

/** Stop syncing, keeping what sync keeps. */
function end() {
  for (const stop of stops) stop()
  stops = []
  if (soon) clearTimeout(soon)
  soon = null
  engine = null
  api = null
  leading = false
  account.value = null
  askedToUpdate.value = false
  waitsForUpdate = false
  me.value = null
  sharing.value = { me: null, projects: {} }
}

/** Let go of what sync kept of this device's reading and writing, the account with it. */
async function forgetAccount() {
  for (const table of /** @type {const} */ (['cloudState', 'cloudOutbox', 'cloudRecords'])) {
    const rows = await storage.all(table)
    await storage.remove(
      table,
      rows.map(row => row.id)
    )
  }
  status.value = { phase: 'idle', waiting: 0, last: null, error: null }
  usage.value = null
}

/**
 * Keep the account, and sync every project here as a first sync.
 * @param {SignedIn} signedIn
 */
async function keep(signedIn) {
  await storage.put('cloudState', signedIn)
  begin(signedIn)
  await /** @type {Engine} */ (engine).enqueue()
  await round()
}

/**
 * Sync as the app opens, if this device is signed in, and follow another
 * window signing in or out.
 */
function start() {
  starting ??= (async () => {
    const signedIn = await storage.get('cloudState', 'account')
    if (signedIn) begin(signedIn)
    onTablesWritten(['cloudState'], async () => {
      const now = await storage.get('cloudState', 'account')
      if (now && !engine) begin(now)
      else if (!now && engine) end()
    })
  })()
  return starting
}

/**
 * Make an account on a server, and sync this device to it.
 * @param {{server: string, name: string, passphrase: string, code: string}} details
 * @returns {Promise<string>} The account's recovery code, to show once
 */
async function signUp({ server, name, passphrase, code }) {
  const at = createApi(server)
  const { token, keys, recoveryCode } = await signUpTo(at, {
    name,
    passphrase,
    code,
    device: deviceName(),
  })
  await keep({ id: 'account', server: at.server, name, token, keys })
  return recoveryCode
}

/**
 * Sign this device in to an account, and sync it.
 * @param {{server: string, name: string, passphrase: string}} details
 */
async function signIn({ server, name, passphrase }) {
  const at = createApi(server)
  const { token, keys } = await signInTo(at, { name, passphrase, device: deviceName() })
  await keep({ id: 'account', server: at.server, name, token, keys })
}

/**
 * Sign this device in with a recovery code, setting a new passphrase, and sync it.
 * @param {{server: string, name: string, code: string, passphrase: string}} details
 * @returns {Promise<string>} The new recovery code, to show once
 */
async function recover({ server, name, code, passphrase }) {
  const at = createApi(server)
  const { token, keys, recoveryCode } = await recoverWith(
    at,
    { name, code, passphrase, device: deviceName() },
    signedIn => createApi(at.server, signedIn)
  )
  await keep({ id: 'account', server: at.server, name, token, keys })
  return recoveryCode
}

/**
 * Sync when the writer asks, looking again at every row for any never sent,
 * and starting again where the server had turned the account off.
 */
async function syncNow() {
  if (!engine) {
    const signedIn = await storage.get('cloudState', 'account')
    if (!signedIn) return
    begin(signedIn)
  }
  engine?.checkNextRound()
  pausedUntil = 0
  return round()
}

/** The server, as this device is signed in to it. */
function signedIn() {
  if (!api) throw new Error('This device is not signed in.')
  return api
}

/**
 * Keep a project on this device only. The next round takes it off the
 * server, and the other devices take it as a project deleted.
 *
 * @param {string} storyId
 * @throws {Error} When some of its files are on the server alone and can't
 *   be fetched now
 */
async function keepOnThisDevice(storyId) {
  const running = engine
  if (!running) throw new Error('This device is not signed in.')
  if ((await running.fetchProjectFiles([storyId])) > 0) {
    throw new Error(
      "Some of its files are only on the sync server, and couldn't be downloaded. Try again when you're online."
    )
  }
  await useStoriesStore().updateStory(storyId, { syncOff: Date.now() })
  await useSyncStore().processSync()
  await running.keepOff(storyId)
  startRounds()
}

/**
 * Sync a project kept on this device again: it goes up whole.
 * @param {string} storyId
 */
async function syncProjectAgain(storyId) {
  const running = engine
  if (!running) throw new Error('This device is not signed in.')
  await useStoriesStore().updateStory(storyId, { syncOff: undefined, keptElsewhere: undefined })
  await useSyncStore().processSync()
  await running.syncAgain(storyId)
  startRounds()
}

/** The engine, while this device is signed in. */
function running() {
  if (!engine) throw new Error('This device is not signed in.')
  return engine
}

/**
 * This account as the people it shares with know it: the name they see,
 * and its friend code.
 */
const profile = () => running().profile()

/**
 * Give this account the name the people it shares with see.
 * @param {string} display
 */
const setDisplay = display => running().setDisplay(display)

/**
 * Share a project with the account a friend code is of.
 * @param {string} storyId
 * @param {string} code
 */
async function share(storyId, code) {
  const shared = await running().share(storyId, code)
  tellOtherWindows({ type: 'cloud' })
  return shared
}

/**
 * Take someone out of a project shared.
 * @param {string} storyId
 * @param {number} accountId
 */
async function removeMember(storyId, accountId) {
  await running().removeMember(storyId, accountId)
  tellOtherWindows({ type: 'cloud' })
}

/**
 * Leave a project shared with this account: it goes to the trash here.
 * @param {string} storyId
 */
async function leaveProject(storyId) {
  await useSyncStore().processSync()
  await running().leave(storyId)
  startRounds()
}

/** The writer has seen that some changes wait for an update. */
function putOffUpdate() {
  askedToUpdate.value = false
}

/** A round here, and in the window that syncs for the app if it isn't this one. */
function startRounds() {
  roundIn(0)
  tellOtherWindows({ type: 'cloud' })
}

/**
 * Make a new recovery code, in place of the one there was.
 * @param {string} passphrase
 * @returns {Promise<string>} The code, to show once
 */
const remakeRecovery = passphrase => remakeWith(signedIn(), passphrase)

/**
 * Change the account's passphrase.
 * @param {string} current
 * @param {string} next
 */
const changePassphrase = (current, next) => changeTo(signedIn(), { current, next })

/** Whether the account has a recovery code. */
const hasRecovery = async () => (await signedIn().account()).recovery

/** The devices signed in to the account, this one among them. */
const devices = () => signedIn().devices()

/**
 * Sign another device out of the account.
 * @param {string} id
 */
const signOutDevice = id => signedIn().signOutDevice(id)

/**
 * Sign this device out. What it has stays here; what sync kept of its
 * reading and writing goes, so signing in again is a first sync.
 */
async function signOut() {
  /** @type {SignedIn|undefined} */
  const signedIn = await storage.get('cloudState', 'account')
  end()
  if (signedIn) {
    try {
      await createApi(signedIn.server, signedIn.token).signOut()
    } catch (error) {
      console.error('The sync server could not be told of signing out:', error)
    }
  }
  await forgetAccount()
}

/**
 * @returns {{
 *   account: Readonly<import('vue').Ref<{server: string, name: string}|null>>,
 *   status: Readonly<import('vue').Ref<Status>>,
 *   notice: Readonly<import('vue').Ref<string|null>>,
 *   askedToUpdate: Readonly<import('vue').Ref<boolean>>,
 *   putOffUpdate: typeof putOffUpdate,
 *   usage: Readonly<import('vue').Ref<{used: number, quota: number|null}|null>>,
 *   sendsDiagnostics: Readonly<import('vue').Ref<boolean>>,
 *   setSendsDiagnostics: typeof setSendsDiagnostics,
 *   refreshUsage: typeof refreshUsage,
 *   start: () => Promise<void>,
 *   signUp: typeof signUp,
 *   signIn: typeof signIn,
 *   recover: typeof recover,
 *   signOut: typeof signOut,
 *   syncNow: typeof syncNow,
 *   remakeRecovery: typeof remakeRecovery,
 *   changePassphrase: typeof changePassphrase,
 *   hasRecovery: typeof hasRecovery,
 *   devices: typeof devices,
 *   signOutDevice: typeof signOutDevice,
 *   keepOnThisDevice: typeof keepOnThisDevice,
 *   syncProjectAgain: typeof syncProjectAgain,
 *   profile: typeof profile,
 *   setDisplay: typeof setDisplay,
 *   share: typeof share,
 *   removeMember: typeof removeMember,
 *   leaveProject: typeof leaveProject,
 * }}
 */
export function useCloudSync() {
  return {
    account: readonly(account),
    status: readonly(status),
    notice: readonly(notice),
    askedToUpdate: readonly(askedToUpdate),
    putOffUpdate,
    usage: readonly(usage),
    sendsDiagnostics: readonly(sendsDiagnostics),
    setSendsDiagnostics,
    refreshUsage,
    start,
    signUp,
    signIn,
    recover,
    signOut,
    syncNow,
    remakeRecovery,
    changePassphrase,
    hasRecovery,
    devices,
    signOutDevice,
    keepOnThisDevice,
    syncProjectAgain,
    profile,
    setDisplay,
    share,
    removeMember,
    leaveProject,
  }
}
