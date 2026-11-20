import { describe, it, expect, beforeEach, vi } from 'vitest'

const platform = vi.hoisted(() => ({
  listApps: vi.fn(),
  addApp: vi.fn(),
  updateApp: vi.fn(),
  removeApp: vi.fn(),
  setAppsPort: vi.fn(),
}))
vi.mock('@/platform/apps.js', () => platform)

import { appAddress, claudeCodeCommand, useConnectedApps } from '@/composables/useConnectedApps.js'

const connection = (patch = {}) => ({
  id: 'app_1',
  name: 'Claude Code',
  token: 'the-token',
  projects: ['story_a'],
  edit: 'suggesting',
  comment: true,
  created: 1,
  ...patch,
})

const listed = (connections = [connection()]) => ({
  port: 4657,
  connections,
  listening: connections.length > 0,
  problem: null,
  called: {},
})

beforeEach(async () => {
  vi.clearAllMocks()
  platform.listApps.mockResolvedValue(listed())
  platform.updateApp.mockImplementation(async (id, patch) => connection({ id, ...patch }))
  await useConnectedApps().load()
})

describe('useConnectedApps', () => {
  it('reads the connections from the native side, the same list wherever it is read', async () => {
    expect(useConnectedApps().state.value).toEqual(listed())
    expect(useConnectedApps().state).toBe(useConnectedApps().state)
  })

  it('makes a connection, and reads again whether its app can get in', async () => {
    const made = connection({ id: 'app_2', name: 'Another', projects: [] })
    platform.addApp.mockResolvedValue(made)
    platform.listApps.mockResolvedValue(listed([connection(), made]))
    const apps = useConnectedApps()

    expect(await apps.add('Another')).toEqual(made)

    expect(platform.addApp).toHaveBeenCalledWith('Another')
    expect(apps.state.value.connections).toEqual([connection(), made])
  })

  it('ticks a project for a connection and unticks it, keeping the others', async () => {
    const apps = useConnectedApps()

    await apps.setProject('app_1', 'story_b', true)
    expect(platform.updateApp).toHaveBeenLastCalledWith('app_1', {
      projects: ['story_a', 'story_b'],
    })
    expect(apps.state.value.connections[0].projects).toEqual(['story_a', 'story_b'])

    await apps.setProject('app_1', 'story_a', false)
    expect(platform.updateApp).toHaveBeenLastCalledWith('app_1', { projects: ['story_b'] })

    // Ticked twice, it is there once.
    await apps.setProject('app_1', 'story_b', true)
    expect(platform.updateApp).toHaveBeenLastCalledWith('app_1', { projects: ['story_b'] })
  })

  it('renames a connection, and leaves it alone for the name it has or none', async () => {
    const apps = useConnectedApps()

    await apps.rename('app_1', 'Claude Code')
    await apps.rename('app_1', '   ')
    await apps.rename('app_none', 'Other')
    expect(platform.updateApp).not.toHaveBeenCalled()

    await apps.rename('app_1', 'The agent')
    expect(platform.updateApp).toHaveBeenCalledWith('app_1', { name: 'The agent' })
    expect(apps.state.value.connections[0].name).toBe('The agent')
  })

  it('says how a connection may edit, and whether it comments', async () => {
    const apps = useConnectedApps()

    await apps.setEdit('app_1', 'editing')
    expect(platform.updateApp).toHaveBeenLastCalledWith('app_1', { edit: 'editing' })
    expect(apps.state.value.connections[0].edit).toBe('editing')

    await apps.setComment('app_1', false)
    expect(platform.updateApp).toHaveBeenLastCalledWith('app_1', { comment: false })
    expect(apps.state.value.connections[0].comment).toBe(false)
  })

  it('removes a connection, and reads again whether anything is listened for', async () => {
    platform.listApps.mockResolvedValue(listed([]))
    const apps = useConnectedApps()

    await apps.remove('app_1')

    expect(platform.removeApp).toHaveBeenCalledWith('app_1')
    expect(apps.state.value).toMatchObject({ connections: [], listening: false })
  })

  it('moves to another port, and shows what came of it', async () => {
    platform.setAppsPort.mockResolvedValue({ ...listed(), port: 5000 })
    const apps = useConnectedApps()

    await apps.setPort(5000)

    expect(apps.state.value.port).toBe(5000)
  })
})

describe('what an app is set up with', () => {
  it('is an address on this computer', () => {
    expect(appAddress(4657)).toBe('http://127.0.0.1:4657/mcp')
  })

  it('is, for Claude Code, the command that adds it with its token', () => {
    expect(claudeCodeCommand(4657, 'the-token')).toBe(
      'claude mcp add --transport http inksprite http://127.0.0.1:4657/mcp --header "Authorization: Bearer the-token"'
    )
  })
})
