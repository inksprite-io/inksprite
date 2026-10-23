// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * A browser's lock manager, shared by every window of the app: a lock is
 * held by one request at a time, and the rest wait for it or, asked
 * `ifAvailable`, go without.
 */
function lockManager() {
  /** @type {Map<string, Array<() => void>>} */
  const waiting = new Map()
  /** @type {Set<string>} */
  const held = new Set()

  const wake = name => {
    const next = waiting.get(name)?.shift()
    if (next) next()
  }

  return {
    async request(name, options, callback) {
      if (held.has(name)) {
        if (options.ifAvailable) return callback(null)
        await new Promise(resolve => {
          const queue = waiting.get(name) || []
          waiting.set(name, queue)
          queue.push(resolve)
        })
      }
      held.add(name)
      try {
        return await callback({ name, mode: 'exclusive' })
      } finally {
        held.delete(name)
        wake(name)
      }
    },
    async query() {
      return { held: [...held].map(name => ({ name, mode: 'exclusive' })), pending: [] }
    },
  }
}

/** A window of the app: the module as each page has its own copy of it. */
const openWindow = async () => {
  vi.resetModules()
  return import('@/platform/windows.js')
}

/** Long enough for a message to reach the other windows. */
const delivered = () => new Promise(resolve => setTimeout(resolve, 20))

/** @type {Array<Awaited<ReturnType<typeof openWindow>>>} */
let windows = []

beforeEach(async () => {
  vi.stubGlobal('navigator', { locks: lockManager() })
  vi.stubGlobal('__INKSPRITE_DESKTOP__', { focusWindow: vi.fn() })
  windows = [await openWindow(), await openWindow()]
})

afterEach(() => {
  for (const window of windows) window.resetWindowsForTesting()
  vi.unstubAllGlobals()
})

describe('a project in one window at a time', () => {
  it('is held by the window that takes it, and not by another until that one lets go', async () => {
    const [a, b] = windows

    expect(await a.takeProject('story_1', 'open')).toEqual({
      held: true,
      stale: false,
      first: true,
    })
    expect(a.holdsProject('story_1')).toBe(true)
    expect((await b.takeProject('story_1', 'open')).held).toBe(false)
    expect(await b.projectsElsewhere()).toEqual(new Set(['story_1']))
    expect(await a.projectsElsewhere()).toEqual(new Set())

    a.letGoOfProject('story_1', 'open')
    expect((await b.takeProject('story_1', 'open')).held).toBe(true)
    expect(a.holdsProject('story_1')).toBe(false)
  })

  it('stays held while it is held for anything: open, or a job running', async () => {
    const [a, b] = windows
    await a.takeProject('story_1', 'open')
    await a.takeProject('story_1', 'job:job_1')

    a.letGoOfProject('story_1', 'open')
    expect(a.holdsProject('story_1', 'open')).toBe(false)
    expect(a.holdsProject('story_1', 'job:job_1')).toBe(true)
    expect((await b.takeProject('story_1', 'open')).held).toBe(false)

    a.letGoOfProject('story_1', 'job:job_1')
    expect((await b.takeProject('story_1', 'open')).held).toBe(true)
  })

  it('is taken once when two takes in one window ask at once', async () => {
    const [a] = windows
    const taken = await Promise.all([
      a.takeProject('story_1', 'open'),
      a.takeProject('story_1', 'job:job_1'),
    ])
    expect(taken.map(take => take.held)).toEqual([true, true])
    expect(a.heldProjects()).toEqual(['story_1'])
  })

  it('says a window is behind on a project another window has had since it did', async () => {
    const [a, b] = windows
    await a.takeProject('story_1', 'open')
    a.letGoOfProject('story_1', 'open')

    // Nobody else had it: what the window kept is as it left it.
    expect(await a.takeProject('story_1', 'open')).toEqual({
      held: true,
      stale: false,
      first: false,
    })
    a.letGoOfProject('story_1', 'open')

    expect(await b.takeProject('story_1', 'open')).toEqual({
      held: true,
      stale: false,
      first: true,
    })
    b.letGoOfProject('story_1', 'open')
    await delivered()

    expect(await a.takeProject('story_1', 'open')).toEqual({
      held: true,
      stale: true,
      first: false,
    })
  })

  it("lets a browser's tabs each take every project, and none be behind", async () => {
    delete globalThis.__INKSPRITE_DESKTOP__
    const [a, b] = windows
    expect((await a.takeProject('story_1', 'open')).held).toBe(true)
    a.letGoOfProject('story_1', 'open')
    expect((await b.takeProject('story_1', 'open')).held).toBe(true)
    expect(await a.projectsElsewhere()).toEqual(new Set())
    await delivered()

    expect(await a.takeProject('story_1', 'open')).toEqual({
      held: true,
      stale: false,
      first: false,
    })
  })
})

describe('asking for a project another window has', () => {
  it('asks the window that has it to show it, and no other', async () => {
    const [a, b] = windows
    const shown = { a: vi.fn(), b: vi.fn() }
    a.onProjectAsked(shown.a)
    b.onProjectAsked(shown.b)
    await a.takeProject('story_1', 'job:job_1')

    b.askForProject('story_1')
    await delivered()
    expect(shown.a).toHaveBeenCalledWith('story_1')
    expect(shown.b).not.toHaveBeenCalled()
  })
})

describe('notices', () => {
  it('reads app tables again when another window writes them, and not others', async () => {
    const [a, b] = windows
    const reload = vi.fn()
    b.onTablesWritten(['aiPrompts'], reload)

    a.tellOtherWindows({ type: 'tables', tables: ['aiProviders'] })
    a.tellOtherWindows({ type: 'tables', tables: ['aiProviders', 'aiPrompts'] })
    await delivered()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('is not heard by the window that told', async () => {
    const [a] = windows
    const heard = vi.fn()
    a.onNotice('projects', heard)
    a.tellOtherWindows({ type: 'projects' })
    await delivered()
    expect(heard).not.toHaveBeenCalled()
  })
})
