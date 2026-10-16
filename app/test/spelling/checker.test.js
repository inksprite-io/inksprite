import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChecker } from '../../src/spelling/checker.js'

/** @typedef {import('../../src/spelling/engine.js').LintInfo} LintInfo */

/**
 * A worker that answers as Harper would, from a list of misspellings: each
 * word in `MISSPELT` found in a text is a lint. It answers on the next tick,
 * as a worker does, and keeps what it was sent.
 */
const MISSPELT = ['walkd', 'teh']

const fakeWorker = () => {
  /** @type {any[]} */
  const sent = []
  const worker = {
    sent,
    /** @type {((event: { data: any }) => void)|null} */
    onmessage: null,
    /** @type {((event: any) => void)|null} */
    onerror: null,
    terminate: vi.fn(),
    /** @param {any} message */
    postMessage(message) {
      sent.push(message)
      setTimeout(() => {
        if (message.type === 'configure') worker.onmessage?.({ data: { id: message.id } })
        else worker.onmessage?.({ data: { id: message.id, results: message.texts.map(lintsFor) } })
      })
    },
  }
  return worker
}

/**
 * @param {string} text
 * @returns {LintInfo[]}
 */
const lintsFor = text =>
  MISSPELT.filter(word => text.includes(word)).map(word => ({
    from: text.indexOf(word),
    to: text.indexOf(word) + word.length,
    kind: 'Spelling',
    text: word,
    message: '',
    suggestions: [],
  }))

const CONFIG = { dialect: /** @type {const} */ ('american'), words: [], grammar: true, ignored: [] }

/** @type {ReturnType<typeof fakeWorker>} */
let worker
/** @type {ReturnType<typeof createChecker>} */
let checker

beforeEach(() => {
  worker = fakeWorker()
  checker = createChecker(() => worker)
})

describe('createChecker', () => {
  it('is off until a dialect is chosen, and starts no worker for it', async () => {
    const spawn = vi.fn(() => worker)
    const off = createChecker(spawn)
    expect(off.active()).toBe(false)
    await off.lint(['She walkd.'])
    expect(spawn).not.toHaveBeenCalled()
    expect(off.cached('She walkd.')).toBeUndefined()
  })

  it('tells the worker its settings before the first paragraphs, and keeps the answers', async () => {
    checker.configure({ ...CONFIG, words: ['Tavrek'] })
    await checker.lint(['She walkd.', 'All is well.'])
    expect(worker.sent.map(message => message.type)).toEqual(['configure', 'lint'])
    expect(worker.sent[0]).toMatchObject({ dialect: 'american', words: ['Tavrek'] })
    expect(checker.cached('She walkd.')?.map(lint => lint.text)).toEqual(['walkd'])
    expect(checker.cached('All is well.')).toEqual([])
    expect(checker.status.value).toBe('ready')
  })

  it('tells the worker again only when what it knows changes', async () => {
    checker.configure(CONFIG)
    await checker.lint(['One.'])
    checker.configure({ ...CONFIG, grammar: false })
    await checker.lint(['Two.'])
    checker.configure({ ...CONFIG, grammar: false, words: ['Tavrek'] })
    await checker.lint(['Three.'])
    expect(worker.sent.map(message => message.type)).toEqual([
      'configure',
      'lint',
      'lint',
      'configure',
      'lint',
    ])
  })

  it('forgets what it found when the words change, and not when grammar does', async () => {
    checker.configure(CONFIG)
    await checker.lint(['She walkd.'])
    checker.configure({ ...CONFIG, grammar: false })
    expect(checker.cached('She walkd.')).toBeDefined()
    checker.configure({ ...CONFIG, grammar: false, words: ['walkd'] })
    expect(checker.cached('She walkd.')).toBeUndefined()
  })

  it('drops answers asked for before the words changed', async () => {
    checker.configure(CONFIG)
    const asked = checker.lint(['She walkd.'])
    checker.configure({ ...CONFIG, words: ['walkd'] })
    await asked
    expect(checker.cached('She walkd.')).toBeUndefined()
  })

  it('tells its listeners when what is drawn may change, and not otherwise', () => {
    const listener = vi.fn()
    const stop = checker.subscribe(listener)
    checker.configure(CONFIG)
    checker.configure({ ...CONFIG })
    expect(listener).toHaveBeenCalledTimes(1)
    checker.configure({ ...CONFIG, ignored: ['123'] })
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
    checker.configure(CONFIG)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('shows spelling always, grammar while it is on, and nothing ignored', () => {
    const spelling = { kind: 'Spelling', from: 0, to: 1, text: 'x', message: '', suggestions: [] }
    const grammar = { ...spelling, kind: 'Agreement', hash: '42' }
    checker.configure(CONFIG)
    expect([checker.shows(spelling), checker.shows(grammar)]).toEqual([true, true])
    checker.configure({ ...CONFIG, grammar: false })
    expect([checker.shows(spelling), checker.shows(grammar)]).toEqual([true, false])
    checker.configure({ ...CONFIG, ignored: ['42'] })
    expect(checker.shows(grammar)).toBe(false)
  })

  it('turns itself off when the worker fails, so the browser checks again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const listener = vi.fn()
    checker.subscribe(listener)
    checker.configure(CONFIG)
    worker.postMessage = message => {
      setTimeout(() => worker.onmessage?.({ data: { id: message.id, error: 'no WebAssembly' } }))
    }
    await checker.lint(['She walkd.'])
    expect(checker.status.value).toBe('failed')
    expect(checker.active()).toBe(false)
    expect(worker.terminate).toHaveBeenCalled()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
