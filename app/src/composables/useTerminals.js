/**
 * @module composables/useTerminals
 * @description This window's terminals: which there are, what the program in
 * each calls it, and which rang while it wasn't looked at.
 *
 * A terminal is the window's, not a project's. It is a tab of the chat panel
 * whichever project the window shows (`useChatTabs`), and it is kept by the
 * desktop app's native side, not by the page: it outlives the panel that
 * shows it, another project being opened in the window, and a reload, after
 * which the page asks which it has (`platform/terminal.js`).
 */
import { reactive, ref } from 'vue'
import {
  closeTerminal,
  createTerminal,
  hasTerminal,
  listTerminals,
  onTerminalEvent,
} from '@/platform/terminal.js'

/**
 * @typedef {Object} TerminalInfo
 * @property {string} id
 * @property {string} title - What the program in it calls it; empty until one does
 */

/**
 * @typedef {Object} TerminalsApi
 * @property {import('vue').Ref<boolean>} ready - Whether the window's
 *   terminals have been asked for and are known
 * @property {(id: string) => boolean} has
 * @property {(id: string) => TerminalInfo|undefined} get
 * @property {() => string[]} ids - Every one, as they were made
 * @property {() => Promise<string>} create - Make one, and say its id
 * @property {(id: string) => void} close - End one, and what runs in it
 * @property {(id: string) => boolean} rang - Whether it rang its bell, as a
 *   program does when it wants the writer, and hasn't been looked at since
 * @property {(id: string) => void} seen - It has been looked at
 */

/** @type {Map<string, TerminalInfo>} */
const terminals = reactive(new Map())
/** Those that rang and haven't been looked at since. @type {Set<string>} */
const rung = reactive(new Set())
const ready = ref(false)
let started = false

/** @type {Set<(id: string, failed: boolean) => void>} */
const endedListeners = new Set()

/**
 * Hear of a terminal whose shell ended, while it is still among the window's:
 * it is gone once every listener has heard. `failed` for one that never
 * started.
 *
 * @param {(id: string, failed: boolean) => void} listener
 * @returns {() => void} Stops listening
 */
export function onTerminalEnded(listener) {
  endedListeners.add(listener)
  return () => {
    endedListeners.delete(listener)
  }
}

/**
 * What the native side says of a terminal.
 *
 * @param {string} id
 * @param {import('@/platform/terminal.js').TerminalEvent} event
 */
function onEvent(id, event) {
  const terminal = terminals.get(id)
  if (!terminal) return
  if (event.type === 'title') {
    terminal.title = event.title
  } else if (event.type === 'bell') {
    rung.add(id)
  } else if (event.type === 'exit') {
    for (const listener of endedListeners) listener(id, event.failed === true)
    forget(id)
  }
}

/**
 * @param {string} id
 * @returns {boolean} Whether it was one of the window's
 */
function forget(id) {
  rung.delete(id)
  return terminals.delete(id)
}

/** Ask which terminals the window has, once, and listen for what becomes of them. */
function start() {
  if (started) return
  started = true
  if (!hasTerminal()) {
    ready.value = true
    return
  }
  onTerminalEvent(onEvent)
  listTerminals()
    .then(list => {
      for (const { id, title } of list) terminals.set(id, { id, title })
    })
    .catch(error => console.error('The window’s terminals could not be listed:', error))
    .finally(() => {
      ready.value = true
    })
}

/**
 * Forget the window's terminals and every listener (for testing).
 */
export function clearTerminals() {
  terminals.clear()
  rung.clear()
  endedListeners.clear()
  ready.value = false
  started = false
}

/**
 * The window's terminals.
 *
 * @returns {TerminalsApi}
 */
export function useTerminals() {
  start()

  /** @type {TerminalsApi['create']} */
  const create = async () => {
    const id = await createTerminal()
    terminals.set(id, { id, title: '' })
    return id
  }

  /** @type {TerminalsApi['close']} */
  const close = id => {
    if (!forget(id)) return
    closeTerminal(id).catch(error => console.error('A terminal could not be ended:', error))
  }

  return {
    ready,
    has: id => terminals.has(id),
    get: id => terminals.get(id),
    ids: () => [...terminals.keys()],
    create,
    close,
    rang: id => rung.has(id),
    seen: id => {
      rung.delete(id)
    },
  }
}
