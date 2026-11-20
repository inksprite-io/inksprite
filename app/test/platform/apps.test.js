import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  addApp,
  answerApps,
  canConnectApps,
  forgetReads,
  forgetReadsOf,
  keepRead,
  keptRead,
  keptReads,
  listApps,
  offerAppExport,
  removeApp,
  setAppsEnabled,
  setAppsPort,
  updateApp,
} from '@/platform/apps.js'

const BRIDGE = '__INKSPRITE_DESKTOP__'

afterEach(() => {
  delete globalThis[BRIDGE]
})

/** The native side's end, stood in for. */
const bridge = () => {
  const apps = {
    list: vi.fn(async () => ({ port: 4657, connections: [], listening: false })),
    add: vi.fn(async name => ({ id: 'app_1', name })),
    update: vi.fn(async (id, patch) => ({ id, ...patch })),
    remove: vi.fn(async () => {}),
    setPort: vi.fn(async port => ({ port })),
    setEnabled: vi.fn(async enabled => ({ enabled })),
    read: vi.fn(async () => ({ revision: 'r1' })),
    reads: vi.fn(async () => [{ revision: 'r1' }]),
    keep: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
    offer: vi.fn(async () => ({ id: 'the-id' })),
    answer: vi.fn(),
  }
  globalThis[BRIDGE] = { apps }
  return apps
}

describe('platform/apps', () => {
  it('is for the desktop app, and one new enough to have it', () => {
    expect(canConnectApps()).toBe(false)
    globalThis[BRIDGE] = {}
    expect(canConnectApps()).toBe(false)
    bridge()
    expect(canConnectApps()).toBe(true)
  })

  it('says so when asked anywhere else', () => {
    expect(() => listApps()).toThrow('only to the desktop app')
    globalThis[BRIDGE] = {}
    expect(() => addApp('Claude Code')).toThrow('only to the desktop app')
  })

  it('asks the native side for the connections and their changes', async () => {
    const apps = bridge()

    expect(await listApps()).toEqual({ port: 4657, connections: [], listening: false })
    expect(await addApp('Claude Code')).toEqual({ id: 'app_1', name: 'Claude Code' })
    await updateApp('app_1', { projects: ['story_a'] })
    await removeApp('app_1')
    expect(await setAppsPort(5000)).toEqual({ port: 5000 })
    expect(await setAppsEnabled(false)).toEqual({ enabled: false })

    expect(apps.update).toHaveBeenCalledWith('app_1', { projects: ['story_a'] })
    expect(apps.remove).toHaveBeenCalledWith('app_1')
  })

  it('has the native side hold a file for a connection’s app to fetch', async () => {
    const apps = bridge()
    const file = { name: 'Plan.md', bytes: new Uint8Array([1]) }

    expect(await offerAppExport('app_1', file)).toEqual({ id: 'the-id' })
    expect(apps.offer).toHaveBeenCalledWith('app_1', file)
  })

  it('keeps and reads back what a connection has of a document', async () => {
    const apps = bridge()

    await keepRead('app_1', 'doc_1', { revision: 'r1' })
    expect(apps.keep).toHaveBeenCalledWith('app_1', 'doc_1', { revision: 'r1' })
    expect(await keptRead('app_1', 'doc_1')).toEqual({ revision: 'r1' })
    expect(await keptReads('app_1', ['revision'])).toEqual([{ revision: 'r1' }])
    expect(apps.reads).toHaveBeenCalledWith('app_1', ['revision'])
  })

  it('has the native side let go of what a connection had of documents', async () => {
    const apps = bridge()

    await forgetReads({ connection: 'app_1', documents: ['doc_1'] })
    expect(apps.forget).toHaveBeenCalledWith({ connection: 'app_1', documents: ['doc_1'] })
  })

  it('tells of documents deleted for good together, and of a project at once', async () => {
    const apps = bridge()

    // A folder's documents go one after another, in one turn.
    forgetReadsOf({ document: 'doc_1' })
    forgetReadsOf({ document: 'doc_2' })
    forgetReadsOf({ document: 'doc_1' })
    expect(apps.forget).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(apps.forget).toHaveBeenCalledTimes(1))
    expect(apps.forget).toHaveBeenCalledWith({ documents: ['doc_1', 'doc_2'] })

    // The next ones are told of on their own, once, however often named.
    forgetReadsOf({ document: 'doc_3' })
    forgetReadsOf({ document: 'doc_3' })
    await vi.waitFor(() => expect(apps.forget).toHaveBeenCalledTimes(2))
    expect(apps.forget).toHaveBeenLastCalledWith({ documents: ['doc_3'] })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(apps.forget).toHaveBeenCalledTimes(2)

    forgetReadsOf({ project: 'story_a' })
    await vi.waitFor(() => expect(apps.forget).toHaveBeenCalledWith({ project: 'story_a' }))
  })

  it('deletes all the same where nothing can be told: in a browser, and when the telling fails', async () => {
    // In a browser there is no native side, and nothing kept.
    expect(() => forgetReadsOf({ document: 'doc_1' })).not.toThrow()
    expect(() => forgetReadsOf({ project: 'story_a' })).not.toThrow()
    // Nor does a native side that can't be asked stop a document's deleting.
    Object.defineProperty(globalThis, BRIDGE, {
      configurable: true,
      get() {
        throw new Error('No bridge to ask.')
      },
    })
    expect(() => forgetReadsOf({ document: 'doc_1' })).not.toThrow()
    delete globalThis[BRIDGE]

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const apps = bridge()
    apps.forget.mockRejectedValue(new Error('The disk is full.'))
    forgetReadsOf({ document: 'doc_1' })
    await vi.waitFor(() => expect(error).toHaveBeenCalled())

    // A native side from before it could be told: said to the console, no more.
    delete apps.forget
    forgetReadsOf({ document: 'doc_2' })
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(2))
    error.mockRestore()
  })

  it('answers an app with a signal that is aborted when the app gives up', async () => {
    const apps = bridge()
    const answer = vi.fn(async () => ({ response: { ok: true } }))
    answerApps(answer)

    const [answering] = apps.answer.mock.calls[0]
    /** @type {() => void} */
    let stop = () => {}
    const app = { id: 'app_1' }
    const message = { id: 1, method: 'ping' }
    expect(await answering(app, message, given => (stop = given))).toEqual({
      response: { ok: true },
    })

    const [asked, sent, signal] = answer.mock.calls[0]
    expect(asked).toBe(app)
    expect(sent).toBe(message)
    expect(signal.aborted).toBe(false)
    stop()
    expect(signal.aborted).toBe(true)
  })
})
