import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useApplicationState } from '@/composables/useApplicationState'
import { useChatProfileStore } from '@/stores/chatProfileStore'
import { CHAT_PROFILE_ID, ROLEPLAY_PROFILE_ID, BLANK_PROFILE_ID } from '@/ai/profiles/index.js'
import { groupOn } from '@/ai/tools/choice.js'

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

// The chats loaded in the store, and those kept elsewhere, in other projects.
const loaded = vi.hoisted(() => new Map())
const updateChat = vi.hoisted(() =>
  vi.fn((id, updates) => loaded.set(id, { ...loaded.get(id), ...updates }))
)
vi.mock('@/stores/chatsStore', () => ({
  useChatsStore: () => ({ chats: loaded, updateChat }),
}))
const kept = vi.hoisted(() => /** @type {any[]} */ ([]))
/** The web search setup, and the servers, as kept. */
const rows = vi.hoisted(() => ({ web: /** @type {any} */ (undefined), servers: [] }))
vi.mock('@/storage/index.js', () => ({
  storage: {
    all: vi.fn(async table => (table === 'mcpServers' ? [...rows.servers] : [])),
    get: vi.fn(async table => (table === 'webSearch' ? rows.web : undefined)),
    put: vi.fn(async () => {}),
    updateEach: vi.fn(async (table, change) => {
      let changed = 0
      for (const [at, row] of kept.entries()) {
        const changes = change(row)
        if (!changes) continue
        kept[at] = { ...row, ...changes }
        changed++
      }
      return changed
    }),
  },
}))
vi.mock('@/stores/storiesStore', () => ({
  useStoriesStore: () => ({ getStory: () => null }),
}))

const { giveToolChoices, givenChoice, moveToolSwitches, switchesToMove } = await import(
  '@/composables/useToolChoices.js'
)
const { useMcpServers } = await import('@/composables/useMcpServers.js')

/** A server the writer connected, used in chats on these profiles. */
const server = (id, profiles) => ({
  id,
  name: id,
  prefix: id,
  url: `https://${id}.example/mcp`,
  tools: [],
  prompts: [],
  profiles,
  allowed: [],
  created: 1,
  updated: 1,
})

describe('givenChoice', () => {
  it('switches off what the lists had off, and adds nothing to what was on', () => {
    const legacy = new Map([
      ['web', false],
      ['mcp:a', true],
    ])

    expect(givenChoice({ disabledToolGroups: ['rpg'] }, legacy, undefined)).toEqual({
      disabledToolGroups: ['rpg', 'web'],
    })
    expect(givenChoice({}, new Map([['web', true]]), undefined)).toBeNull()
  })

  it('offers a chat on a profile that offers only some the groups it had on, and no others', () => {
    const legacy = new Map([
      ['web', true],
      ['python', false],
    ])
    const changes = givenChoice({ disabledToolGroups: ['rpg', 'skills', 'experimental'] }, legacy, [
      'documents',
    ])

    expect(changes.onlyToolGroups).toEqual(['documents', 'web'])
    const after = { disabledToolGroups: ['rpg', 'skills', 'experimental'], ...changes }
    expect(groupOn(after, 'web')).toBe(true)
    expect(groupOn(after, 'python')).toBe(false)
    expect(groupOn(after, 'mcp:later')).toBe(false)
  })

  it('changes nothing given the same lists twice', () => {
    const legacy = new Map([['web', false]])
    const once = {
      disabledToolGroups: ['rpg'],
      ...givenChoice({ disabledToolGroups: ['rpg'] }, legacy),
    }

    expect(givenChoice(once, legacy, undefined)).toBeNull()
  })
})

describe('giving profiles and chats their tools', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    useApplicationState().resetState()
    vi.clearAllMocks()
    loaded.clear()
    kept.length = 0
    rows.web = { id: 'web', service: 'exa', keys: {}, profiles: [CHAT_PROFILE_ID] }
    rows.servers = [server('wiki', [CHAT_PROFILE_ID]), server('notes', [])]
    await useChatProfileStore().ensureInitialized()
  })

  it('switches off on each profile what its lists had off', async () => {
    const mine = useChatProfileStore().createProfile({ name: 'Mine', settings: { prompt: 'x' } })

    await giveToolChoices()

    const app = useApplicationState()
    // Default searched and had the wiki; not the notes.
    expect(app.builtInProfiles.value[CHAT_PROFILE_ID].disabledToolGroups).toEqual(['mcp:notes'])
    // The writer's own had none of them.
    expect(useChatProfileStore().getProfile(mine.id).settings.disabledToolGroups).toEqual([
      'web',
      'mcp:wiki',
      'mcp:notes',
    ])
    // Roleplay offers only some, and the lists gave it none of these.
    const roleplay = app.builtInProfiles.value[ROLEPLAY_PROFILE_ID]
    expect(roleplay?.onlyToolGroups ?? ['documents']).toEqual(['documents'])
    expect(app.toolsGiven.value).toBe(true)
  })

  it('gives each chat what it chose, and what its profile had where it chose nothing', async () => {
    loaded.set('c_default', { id: 'c_default', profileId: CHAT_PROFILE_ID })
    loaded.set('c_chose', {
      id: 'c_chose',
      profileId: CHAT_PROFILE_ID,
      web: false,
      mcpServers: ['notes'],
    })
    kept.push({
      id: 'c_roleplay',
      profileId: ROLEPLAY_PROFILE_ID,
      disabledToolGroups: ['rpg', 'skills', 'experimental'],
      web: true,
    })

    await giveToolChoices()

    expect(loaded.get('c_default').disabledToolGroups).toEqual(['mcp:notes'])
    expect(loaded.get('c_chose').disabledToolGroups).toEqual(['web', 'mcp:wiki'])
    // On a profile that offers only some: what it had on, and nothing added later.
    const roleplay = kept[0]
    expect(roleplay.onlyToolGroups).toEqual(['documents', 'web'])
    expect(groupOn(roleplay, 'mcp:wiki')).toBe(false)
    expect(groupOn(roleplay, 'mcp:later')).toBe(false)
    // The old fields stay, for an app from before.
    expect(roleplay.web).toBe(true)
  })

  it('leaves the web alone where no service is chosen, for it to be on once one is', async () => {
    rows.web = { id: 'web', keys: {}, profiles: [] }
    loaded.set('c1', { id: 'c1', profileId: CHAT_PROFILE_ID })

    await giveToolChoices()

    expect(loaded.get('c1').disabledToolGroups).toEqual(['mcp:notes'])
  })

  it('closes Blank and Roleplay chats to what comes later, with no lists at all', async () => {
    rows.web = undefined
    rows.servers = []
    loaded.set('c_blank', {
      id: 'c_blank',
      profileId: BLANK_PROFILE_ID,
      disabledToolGroups: ['documents', 'rpg', 'skills', 'experimental'],
    })
    loaded.set('c_default', { id: 'c_default', profileId: CHAT_PROFILE_ID })

    await giveToolChoices()

    expect(loaded.get('c_blank').onlyToolGroups).toEqual([])
    expect(loaded.has('c_default') && loaded.get('c_default').disabledToolGroups).toBeUndefined()
  })

  it('runs once on a device', async () => {
    useApplicationState().setToolsGiven(true)
    loaded.set('c1', { id: 'c1', profileId: CHAT_PROFILE_ID })

    await giveToolChoices()

    expect(updateChat).not.toHaveBeenCalled()
  })
})

describe('moving the tools switched off one by one to the whole app', () => {
  /** A server with a tool, as kept. */
  const wiki = {
    ...server('wiki', []),
    tools: [{ name: 'edit', exposed: 'wiki__edit', inputSchema: {} }],
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    useApplicationState().resetState()
    vi.clearAllMocks()
    rows.web = undefined
    rows.servers = [wiki]
    await useChatProfileStore().ensureInitialized()
    await useMcpServers().ready()
  })

  it('moves a tool of the web’s, the RPG’s or a server’s, and leaves a document’s, a skill’s and what is no tool', () => {
    expect(
      switchesToMove([
        'read_web_page',
        'oracle',
        'wiki__edit',
        'delete_document',
        'interpret',
        'gone__tool',
      ])
    ).toEqual(['read_web_page', 'oracle', 'wiki__edit'])
    expect(switchesToMove(undefined)).toEqual([])
  })

  it('takes Default’s as the whole app’s, off the profile, and nothing a second time', async () => {
    const app = useApplicationState()
    app.setBuiltInProfile(CHAT_PROFILE_ID, {
      disabledTools: ['oracle', 'wiki__edit', 'delete_document'],
    })

    await moveToolSwitches()

    expect(app.toolsOff.value).toEqual(['oracle'])
    expect(useMcpServers().servers.value[0].off).toEqual(['edit'])
    expect(app.builtInProfiles.value[CHAT_PROFILE_ID].disabledTools).toEqual(['delete_document'])

    // Switched back on, it stays on: there is nothing left to move.
    app.setToolOff('oracle', false)
    await moveToolSwitches()
    expect(app.toolsOff.value).toEqual([])
  })

  it('takes nothing from a profile of the writer’s own', async () => {
    useChatProfileStore().createProfile({
      name: 'Mine',
      settings: { prompt: 'x', disabledTools: ['oracle'] },
    })

    await moveToolSwitches()

    expect(useApplicationState().toolsOff.value).toEqual([])
  })
})
