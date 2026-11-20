import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  addApp,
  answerApps,
  appRead,
  appReads,
  canConnectApps,
  keepAppRead,
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
    apps.read = vi.fn(async () => ({ revision: 'r1' }))
    apps.reads = vi.fn(async () => [{ revision: 'r1' }])
    apps.keep = vi.fn(async () => {})

    await keepAppRead('app_1', 'doc_1', { revision: 'r1' })
    expect(apps.keep).toHaveBeenCalledWith('app_1', 'doc_1', { revision: 'r1' })
    expect(await appRead('app_1', 'doc_1')).toEqual({ revision: 'r1' })
    expect(await appReads('app_1')).toEqual([{ revision: 'r1' }])
  })

  it('has nothing kept in a desktop app from before reads were', async () => {
    bridge()

    await keepAppRead('app_1', 'doc_1', { revision: 'r1' })
    expect(await appRead('app_1', 'doc_1')).toBeNull()
    expect(await appReads('app_1')).toEqual([])
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
