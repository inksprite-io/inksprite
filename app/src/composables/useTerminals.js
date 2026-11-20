/**
 * @module composables/useTerminals
 * @description The app's terminals, as this window knows them: which there
 * are, the project each is in, what the program in each calls it, and which
 * rang while it wasn't looked at.
 *
 * A terminal is a project's. It is a tab of that project's chat panel
 * (`useChatTabs`) and of no other's, and it is kept by the desktop app's
 * native side, not by the page (`platform/terminal.js`): its shell runs on
 * while another project is open, while its window is shut and through a
 * reload, and whichever window opens the project next shows it as it stands.
 * So every window hears what becomes of every terminal, and keeps them all.
 *
 * A terminal ends with its project: one whose project this window has seen
 * go, to the trash or for good, is ended here.
 */
import { reactive, ref, watchEffect } from 'vue'
import {
  closeTerminal,
  createTerminal,
  hasTerminal,
  listTerminals,
  onTerminalEvent,
  terminalSeen,
} from '@/platform/terminal.js'
import { useStoriesStore } from '@/stores/storiesStore.js'

/**
 * @typedef {Object} TerminalInfo
 * @property {string} id
 * @property {string} project - The project it is in, by its id
 * @property {string} title - What the program in it calls it; empty until one does
 */

/**
 * @typedef {Object} TerminalsApi
 * @property {import('vue').Ref<boolean>} ready - Whether the terminals there
 *   are have been asked for and are known
 * @property {(id: string) => TerminalInfo|undefined} get
 * @property {(project: string) => string[]} of - A project's, as they were made
 * @property {(project: string) => Promise<string>} create - Make one in a
 *   project, and say its id
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
/** What stops the watch for projects that go. @type {(() => void)|null} */
let stopWatching = null

/** @type {Set<(id: string, project: string, failed: boolean) => void>} */
const endedListeners = new Set()

/**
 * Hear of a terminal that is gone, its shell ended or its tab closed in
 * another window, while it is still among those known here: it is forgotten
 * once every listener has heard. `failed` for one whose shell never started.
 *
 * @param {(id: string, project: string, failed: boolean) => void} listener
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
  if (event.type === 'made') {
    if (!terminals.has(id)) terminals.set(id, { id, project: event.project, title: '' })
    return
  }
  const terminal = terminals.get(id)
  if (!terminal) return
  if (event.type === 'title') {
    terminal.title = event.title
  } else if (event.type === 'bell') {
    rung.add(id)
  } else if (event.type === 'seen') {
    rung.delete(id)
  } else if (event.type === 'exit') {
    for (const listener of endedListeners) listener(id, terminal.project, event.failed === true)
    forget(id)
  }
}

/**
 * @param {string} id
 * @returns {boolean} Whether it was known here
 */
function forget(id) {
  rung.delete(id)
  return terminals.delete(id)
}

/**
 * End a terminal, and what runs in it.
 *
 * @param {string} id
 */
function close(id) {
  if (!forget(id)) return
  closeTerminal(id).catch(error => console.error('A terminal could not be ended:', error))
}

/**
 * End the terminals of a project that goes, to the trash or for good. Only
 * of one this window has seen there: a project another window has just made
 * is not yet among this window's, and is not gone.
 */
function watchProjects() {
  const stories = useStoriesStore()
  /** The projects of terminals that this window has seen there. @type {Set<string>} */
  const there = new Set()
  stopWatching = watchEffect(() => {
    if (!stories.isInitialized) return
    for (const { id, project } of [...terminals.values()]) {
      if (stories.stories.has(project) || stories.isFresh(project)) there.add(project)
      else if (there.has(project)) close(id)
    }
  })
}

/** Ask which terminals there are, once, and listen for what becomes of them. */
function start() {
  if (started) return
  started = true
  if (!hasTerminal()) {
    ready.value = true
    return
  }
  onTerminalEvent(onEvent)
  watchProjects()
  listTerminals()
    .then(list => {
      for (const { id, project, title, rang } of list) {
        terminals.set(id, { id, project, title })
        if (rang) rung.add(id)
      }
    })
    .catch(error => console.error('The terminals could not be listed:', error))
    .finally(() => {
      ready.value = true
    })
}

/**
 * Forget the terminals and every listener (for testing).
 */
export function clearTerminals() {
  stopWatching?.()
  stopWatching = null
  terminals.clear()
  rung.clear()
  endedListeners.clear()
  ready.value = false
  started = false
}

/**
 * The app's terminals, as this window knows them.
 *
 * @returns {TerminalsApi}
 */
export function useTerminals() {
  start()

  /** @type {TerminalsApi['create']} */
  const create = async project => {
    const id = await createTerminal(project)
    if (!terminals.has(id)) terminals.set(id, { id, project, title: '' })
    return id
  }

  return {
    ready,
    get: id => terminals.get(id),
    of: project =>
      [...terminals.values()].filter(terminal => terminal.project === project).map(({ id }) => id),
    create,
    close,
    rang: id => rung.has(id),
    seen: id => {
      if (!rung.delete(id)) return
      terminalSeen(id).catch(error => console.error('A terminal could not be marked seen:', error))
    },
  }
}
