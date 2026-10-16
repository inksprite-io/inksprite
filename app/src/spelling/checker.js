/**
 * @module spelling/checker
 * @description The page's side of the checker: the worker, started the first
 * time a paragraph is asked about, the settings it runs on, and what it has
 * found, kept by the text of the paragraph it was found in.
 *
 * The editor asks for paragraphs and reads the answers back out of the cache
 * (`editor/spelling`). An answer is for a text, not a place, so it is good
 * wherever that text still stands when it comes, and an edit made while it
 * was on its way costs nothing but another question.
 *
 * A change to the dialect or the words empties the cache: what was found
 * before may be wrong now. Grammar switched on or off, or a lint ignored,
 * only changes what is drawn of what was found. Either way every editor is
 * told, and draws again.
 */

/* global Worker */

import { ref } from 'vue'
import { SPELLING_KINDS } from './engine.js'

/** @typedef {import('./engine.js').Dialect} Dialect */
/** @typedef {import('./engine.js').LintInfo} LintInfo */

/**
 * What the checker runs on.
 *
 * @typedef {Object} CheckerConfig
 * @property {Dialect|null} dialect - Null for off: the browser's own checker
 *   instead
 * @property {string[]} words - Words it knows besides its own: the writer's,
 *   the project's, and the project's names
 * @property {boolean} grammar - Whether grammar is drawn as well as spelling
 * @property {string[]} ignored - Hashes of the lints ignored in the project
 */

/**
 * The part of a `Worker` the checker uses, so a test can hand it another.
 *
 * @typedef {Object} WorkerLike
 * @property {(message: any) => void} postMessage
 * @property {((event: { data: any }) => void)|null} onmessage
 * @property {((event: any) => void)|null} onerror
 * @property {() => void} terminate
 */

/**
 * @typedef {'idle'|'loading'|'ready'|'failed'} CheckerStatus
 */

/** How many paragraphs' answers are kept: a long novel's, several times over. */
const CACHE_SIZE = 20000

/** @returns {WorkerLike} */
const startWorker = () =>
  /** @type {WorkerLike} */ (
    /** @type {unknown} */ (new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }))
  )

/**
 * A checker. The app has one, `spellChecker`; a test makes its own with a
 * worker of its own.
 *
 * @param {() => WorkerLike} [spawn]
 */
export function createChecker(spawn = startWorker) {
  /** @type {import('vue').Ref<CheckerStatus>} */
  const status = ref('idle')

  /** @type {CheckerConfig} */
  let config = { dialect: null, words: [], grammar: true, ignored: [] }
  /** @type {Set<string>} */
  let ignored = new Set()

  /**
   * Bumped whenever what Harper knows changes. An answer asked for before is
   * not kept.
   */
  let generation = 0
  /** The generation the worker was last told about, or -1 for none yet. */
  let told = -1

  /** @type {Map<string, LintInfo[]>} */
  const cache = new Map()

  /** @type {Set<() => void>} */
  const listeners = new Set()

  /** @type {WorkerLike|null} */
  let worker = null
  let nextId = 1
  /** @type {Map<number, { resolve: (data: any) => void, reject: (error: Error) => void }>} */
  const waiting = new Map()

  const notify = () => listeners.forEach(listener => listener())

  /** @param {unknown} error */
  const fail = error => {
    if (status.value === 'failed') return
    console.error('The spelling checker could not start:', error)
    status.value = 'failed'
    for (const { reject } of waiting.values()) reject(new Error('The spelling checker stopped'))
    waiting.clear()
    worker?.terminate()
    worker = null
    notify()
  }

  /**
   * @param {any} message
   * @returns {Promise<any>}
   */
  const post = message =>
    new Promise((resolve, reject) => {
      if (!worker) {
        reject(new Error('The spelling checker is not running'))
        return
      }
      const id = nextId++
      waiting.set(id, { resolve, reject })
      worker.postMessage({ ...message, id })
    })

  const start = () => {
    if (worker || status.value === 'failed') return
    status.value = 'loading'
    try {
      worker = spawn()
    } catch (error) {
      fail(error)
      return
    }
    worker.onmessage = ({ data }) => {
      const pending = waiting.get(data?.id)
      if (!pending) return
      waiting.delete(data.id)
      if (data.error) pending.reject(new Error(data.error))
      else pending.resolve(data)
    }
    worker.onerror = event => fail(event?.message ?? event)
  }

  /**
   * Whether the checker is on: a dialect chosen, and the worker not failed.
   * Off, the editor leaves spelling to the browser.
   */
  const active = () => config.dialect !== null && status.value !== 'failed'

  /**
   * Change what the checker runs on. Nothing happens if nothing changed.
   *
   * @param {CheckerConfig} next
   */
  const configure = next => {
    const known =
      next.dialect !== config.dialect || next.words.join('\n') !== config.words.join('\n')
    const shown =
      next.grammar !== config.grammar || next.ignored.join('\n') !== config.ignored.join('\n')
    if (!known && !shown) return
    config = { ...next, words: [...next.words], ignored: [...next.ignored] }
    ignored = new Set(config.ignored)
    if (known) {
      generation++
      cache.clear()
    }
    notify()
  }

  /**
   * What was found in a paragraph, if it has been checked as it now reads.
   *
   * @param {string} text
   * @returns {LintInfo[]|undefined}
   */
  const cached = text => cache.get(text)

  /**
   * @param {string} text
   * @param {LintInfo[]} lints
   */
  const remember = (text, lints) => {
    cache.delete(text)
    cache.set(text, lints)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value)
  }

  /**
   * Check paragraphs, and keep what is found. Resolves once they are in the
   * cache, or once it is clear they won't be: the settings changed while they
   * were being checked, or the checker failed.
   *
   * @param {string[]} texts
   * @returns {Promise<void>}
   */
  const lint = async texts => {
    if (!active() || texts.length === 0) return
    start()
    const asked = generation
    try {
      if (told !== generation) {
        told = generation
        await post({ type: 'configure', dialect: config.dialect, words: config.words })
      }
      const { results } = await post({ type: 'lint', texts })
      status.value = 'ready'
      if (asked !== generation) return
      texts.forEach((text, i) => remember(text, results[i] ?? []))
    } catch (error) {
      fail(error)
    }
  }

  /**
   * Whether a lint is drawn: a misspelling always, grammar while it is on,
   * and neither once ignored.
   *
   * @param {LintInfo} lint
   * @returns {boolean}
   */
  const shows = lint =>
    (SPELLING_KINDS.has(lint.kind) || config.grammar) && !(lint.hash && ignored.has(lint.hash))

  /**
   * Be told when what is drawn may have changed.
   *
   * @param {() => void} listener
   * @returns {() => void} Stops telling it
   */
  const subscribe = listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return { status, active, configure, cached, lint, shows, subscribe }
}

/** @typedef {ReturnType<typeof createChecker>} Checker */

/** The app's checker. */
export const spellChecker = createChecker()
