import { describe, it, expect } from 'vitest'
import {
  SETTINGS_TABLES,
  settingsItems,
  pickWithNeeds,
  pickSettings,
  planImport,
  changesAnything,
  describeImport,
  describeSelection,
  fingerprint,
  settingsFilename,
  rowId,
} from '@/utils/settingsFile.js'
import { keysLeftOut } from '@/utils/backup.js'

/** The outside settings as a fresh install has them. */
const SETTINGS = {
  aiPreset: 'profile_default_chat',
  applyEdits: 'auto',
  nsfwProfiles: false,
  chatProfileId: null,
  roleplayProfileId: null,
  workflows: { convert: { providerId: null, model: null, reasoningEffort: null, onImport: false } },
  narration: { providerId: 'provider_kokoro_default', model: 'kokoro' },
  theme: 'system',
  highlightSpeakers: true,
}

const proxy = {
  id: 'provider_proxy',
  name: 'Team proxy',
  type: 'generic',
  endpoint: 'http://127.0.0.1:4100/v1',
  version: 1,
  created: 100,
  updated: 100,
}
const preset = {
  id: 'profile_team',
  name: 'Team',
  providerId: 'provider_proxy',
  model: 'house-large',
  isDefault: false,
  version: 1,
  created: 100,
  updated: 100,
}
const server = {
  id: 'mcp_tracker',
  name: 'Tracker',
  prefix: 'tracker',
  url: 'https://tracker.example/mcp',
  headers: { Authorization: 'Bearer team-token' },
  tools: [{ name: 'find', exposed: 'tracker_find', inputSchema: {} }],
  prompts: [],
  profiles: ['builtin_profile_chat'],
  allowed: ['find'],
  allowAll: true,
  listedAt: 500,
  created: 100,
  updated: 100,
}
const untouchedKokoro = {
  id: 'provider_kokoro_default',
  name: 'Kokoro',
  type: 'generic',
  endpoint: 'http://localhost:8880/v1',
  isDefault: true,
}
const untouchedOpenRouter = {
  id: 'provider_openrouter_default',
  name: 'OpenRouter',
  type: 'openrouter',
  isDefault: true,
}

/** An install with nothing of the writer's in it. */
const freshInstall = () => ({
  tables: { aiProviders: [untouchedKokoro, untouchedOpenRouter] },
  settings: SETTINGS,
})

describe('settingsItems', () => {
  it('lists the rows of every settings table, then the groups of app settings', () => {
    const items = settingsItems(
      {
        aiProviders: [proxy],
        aiProfiles: [preset],
        chatProfiles: [{ id: 'chatprofile_a', name: 'Plain' }],
        mcpServers: [server],
        skills: [{ id: 'skill_a', name: 'outline' }],
        skillWordings: [{ name: 'write', prompt: 'Shorter.' }],
        webSearch: [{ id: 'web', service: 'exa', keys: {}, profiles: [] }],
      },
      SETTINGS
    )

    expect(items.map(item => [item.kind, item.name])).toEqual([
      ['aiProviders', 'Team proxy'],
      ['aiProfiles', 'Team'],
      ['chatProfiles', 'Plain'],
      ['mcpServers', 'Tracker'],
      ['skills', 'outline'],
      ['skillWordings', '/write'],
      ['webSearch', 'Web search'],
      ['settings', 'Preset in use'],
      ['settings', 'Profiles chats start on'],
      ['settings', 'Narration'],
      ['settings', 'Workflows'],
      ['settings', 'Preferences'],
      ['settings', 'Spelling'],
    ])
    expect(items.find(item => item.kind === 'skillWordings')?.key).toBe('skillWordings/write')
  })

  it('leaves out a built-in connection with nothing of the writer’s in it', () => {
    const items = settingsItems(
      {
        aiProviders: [
          untouchedKokoro,
          untouchedOpenRouter,
          {
            ...untouchedKokoro,
            id: 'provider_lmstudio_default',
            endpoint: 'http://10.0.0.5:1234/v1',
          },
          { ...untouchedOpenRouter, id: 'provider_anthropic_default', apiKey: 'sk-ant' },
        ],
      },
      SETTINGS
    )
    expect(items.filter(item => item.kind === 'aiProviders').map(item => item.key)).toEqual([
      'aiProviders/provider_lmstudio_default',
      'aiProviders/provider_anthropic_default',
    ])
  })

  it('starts with everything picked but the preferences and spelling', () => {
    const items = settingsItems({ aiProviders: [proxy] }, SETTINGS)
    expect(items.filter(item => !item.picked).map(item => item.key)).toEqual([
      'settings/preferences',
      'settings/spelling',
    ])
  })

  it('says what each item is no use without', () => {
    const items = settingsItems(
      { aiProviders: [proxy], aiProfiles: [preset] },
      { ...SETTINGS, aiPreset: 'profile_team', chatProfileId: 'chatprofile_a' }
    )
    const needs = Object.fromEntries(items.map(item => [item.key, item.needs]))
    expect(needs['aiProfiles/profile_team']).toEqual(['aiProviders/provider_proxy'])
    expect(needs['settings/aiPreset']).toEqual(['aiProfiles/profile_team'])
    expect(needs['settings/startingProfiles']).toEqual(['chatProfiles/chatprofile_a'])
    expect(needs['settings/narration']).toEqual(['aiProviders/provider_kokoro_default'])
  })
})

describe('pickWithNeeds', () => {
  it('picks what an item needs, and what that needs', () => {
    const items = settingsItems(
      { aiProviders: [proxy], aiProfiles: [preset] },
      { ...SETTINGS, aiPreset: 'profile_team' }
    )
    const picked = pickWithNeeds(new Set(), items, 'settings/aiPreset')
    expect([...picked].sort()).toEqual([
      'aiProfiles/profile_team',
      'aiProviders/provider_proxy',
      'settings/aiPreset',
    ])
  })

  it('leaves alone a need that isn’t in the list', () => {
    // Narration reads through the built-in Kokoro, which every install has.
    const items = settingsItems({}, SETTINGS)
    expect([...pickWithNeeds(new Set(), items, 'settings/narration')]).toEqual([
      'settings/narration',
    ])
  })
})

describe('pickSettings', () => {
  it('keeps only the rows and settings groups picked', () => {
    const { tables, settings } = pickSettings(
      { aiProviders: [proxy, untouchedKokoro], aiProfiles: [preset], mcpServers: [server] },
      { ...SETTINGS, aiPreset: 'profile_team' },
      new Set(['aiProviders/provider_proxy', 'aiProfiles/profile_team', 'settings/aiPreset'])
    )
    expect(tables).toEqual({ aiProviders: [proxy], aiProfiles: [preset] })
    expect(settings).toEqual({ aiPreset: 'profile_team' })
  })

  it('carries every setting of a group', () => {
    const { settings } = pickSettings(
      {},
      SETTINGS,
      new Set(['settings/startingProfiles', 'settings/preferences'])
    )
    expect(settings).toEqual({
      chatProfileId: null,
      roleplayProfileId: null,
      theme: 'system',
      applyEdits: 'auto',
      nsfwProfiles: false,
      highlightSpeakers: true,
    })
  })
})

describe('planImport', () => {
  const NOW = 9000

  it('adds what isn’t here, and takes the settings', () => {
    const plan = planImport(
      {
        tables: { aiProviders: [proxy], aiProfiles: [preset] },
        settings: { aiPreset: 'profile_team' },
      },
      freshInstall(),
      { byHand: true, now: NOW }
    )

    expect(plan.rows.aiProviders).toEqual([{ ...proxy, updated: NOW }])
    expect(plan.rows.aiProfiles).toEqual([{ ...preset, updated: NOW }])
    expect(plan.settings).toEqual({ aiPreset: 'profile_team' })
    expect(plan.added.map(item => item.key)).toEqual([
      'aiProviders/provider_proxy',
      'aiProfiles/profile_team',
    ])
    expect(plan.changed.map(item => item.key)).toEqual(['settings/aiPreset'])
    expect(Object.keys(plan.fingerprints).sort()).toEqual([
      'aiProfiles/profile_team',
      'aiProviders/provider_proxy',
      'settings/aiPreset',
    ])
  })

  it('replaces a row that differs, keeping when it was made', () => {
    const here = {
      tables: { aiProviders: [{ ...proxy, created: 50, endpoint: 'http://old/v1' }] },
      settings: SETTINGS,
    }
    const plan = planImport({ tables: { aiProviders: [proxy] } }, here, { byHand: true, now: NOW })

    expect(plan.rows.aiProviders).toEqual([{ ...proxy, created: 50, updated: NOW }])
    expect(plan.changed.map(item => item.name)).toEqual(['Team proxy'])
    expect(plan.added).toEqual([])
  })

  it('changes nothing when what is here is the same', () => {
    const here = {
      tables: { aiProviders: [{ ...proxy, created: 1, updated: 2, version: 7 }] },
      settings: SETTINGS,
    }
    const plan = planImport(
      { tables: { aiProviders: [proxy] }, settings: { theme: 'system' } },
      here,
      { byHand: true, now: NOW }
    )
    expect(changesAnything(plan)).toBe(false)
    expect(plan.rows).toEqual({})
    expect(plan.settings).toEqual({})
  })

  it('keeps a key here that the file left out', () => {
    const here = {
      tables: {
        aiProviders: [{ ...untouchedOpenRouter, apiKey: 'sk-mine' }],
        mcpServers: [{ ...server, headers: { Authorization: 'Bearer mine' } }],
        webSearch: [
          { id: 'web', service: 'exa', keys: { exa: 'exa-mine', kagi: 'kagi-mine' }, profiles: [] },
        ],
      },
      settings: SETTINGS,
    }
    const plan = planImport(
      {
        tables: {
          aiProviders: [{ ...untouchedOpenRouter, apiKey: '', routing: { sort: 'price' } }],
          mcpServers: [
            { ...server, url: 'https://tracker.example/v2', headers: { Authorization: '' } },
          ],
          webSearch: [{ id: 'web', service: 'kagi', keys: { exa: '' }, profiles: [] }],
        },
      },
      here,
      { byHand: false, now: NOW }
    )

    expect(plan.rows.aiProviders[0].apiKey).toBe('sk-mine')
    expect(plan.rows.mcpServers[0].headers).toEqual({ Authorization: 'Bearer mine' })
    expect(plan.rows.webSearch[0].keys).toEqual({ exa: 'exa-mine', kagi: 'kagi-mine' })
  })

  it('by hand, sends no key here to an address the file moved it to', () => {
    const here = {
      tables: {
        aiProviders: [
          { ...untouchedOpenRouter, id: 'provider_anthropic_default', apiKey: 'sk-ant' },
          { ...proxy, apiKey: 'sk-mine' },
        ],
        mcpServers: [{ ...server, headers: { Authorization: 'Bearer mine' } }],
      },
      settings: SETTINGS,
    }
    const plan = planImport(
      {
        tables: {
          aiProviders: [
            {
              ...untouchedOpenRouter,
              id: 'provider_anthropic_default',
              type: 'generic',
              endpoint: 'https://elsewhere.example/v1',
              apiKey: '',
            },
            { ...proxy, endpoint: 'https://elsewhere.example/v1', apiKey: '' },
          ],
          mcpServers: [
            { ...server, url: 'https://elsewhere.example/mcp', headers: { Authorization: '' } },
          ],
        },
      },
      here,
      { byHand: true, now: NOW }
    )

    expect(plan.rows.aiProviders.map(provider => provider.apiKey)).toEqual(['', ''])
    expect(plan.rows.mcpServers[0].headers).toEqual({ Authorization: '' })
    expect(keysLeftOut({ tables: plan.rows })).toEqual([
      untouchedOpenRouter.name,
      'Team proxy',
      'Tracker',
    ])
  })

  it('by hand, keeps a key here for a connection that stays where it was', () => {
    const here = { tables: { aiProviders: [{ ...proxy, apiKey: 'sk-mine' }] }, settings: SETTINGS }
    const plan = planImport(
      { tables: { aiProviders: [{ ...proxy, name: 'Team proxy (EU)', apiKey: '' }] } },
      here,
      { byHand: true, now: NOW }
    )
    expect(plan.rows.aiProviders[0].apiKey).toBe('sk-mine')
  })

  it('takes a key the file has over the one here', () => {
    const here = { tables: { aiProviders: [{ ...proxy, apiKey: 'old' }] }, settings: SETTINGS }
    const plan = planImport({ tables: { aiProviders: [{ ...proxy, apiKey: 'new' }] } }, here, {
      byHand: true,
    })
    expect(plan.rows.aiProviders[0].apiKey).toBe('new')
  })

  it('doesn’t count an empty key against no key as a change', () => {
    const here = { tables: { aiProviders: [proxy] }, settings: SETTINGS }
    const plan = planImport({ tables: { aiProviders: [{ ...proxy, apiKey: '' }] } }, here, {
      byHand: true,
    })
    expect(changesAnything(plan)).toBe(false)
  })

  it('by hand, lets no server’s tools run without asking that didn’t here', () => {
    const plan = planImport({ tables: { mcpServers: [server] } }, freshInstall(), {
      byHand: true,
      now: NOW,
    })
    expect(plan.rows.mcpServers[0].allowed).toEqual([])
    expect(plan.rows.mcpServers[0]).not.toHaveProperty('allowAll')

    const here = {
      tables: { mcpServers: [{ ...server, allowed: ['find'], allowAll: false, url: 'x' }] },
      settings: SETTINGS,
    }
    const replaced = planImport({ tables: { mcpServers: [server] } }, here, { byHand: true })
    expect(replaced.rows.mcpServers[0].allowed).toEqual(['find'])
    expect(replaced.rows.mcpServers[0]).not.toHaveProperty('allowAll')
  })

  it('left by a script, takes the server’s allowances from the file', () => {
    const plan = planImport({ tables: { mcpServers: [server] } }, freshInstall(), {
      byHand: false,
    })
    expect(plan.rows.mcpServers[0]).toMatchObject({ allowed: ['find'], allowAll: true })
  })

  it('doesn’t count a newer listing of a server as a change, and keeps the newer one', () => {
    const relisted = {
      ...server,
      tools: [...server.tools, { name: 'file', exposed: 'tracker_file', inputSchema: {} }],
      listedAt: 900,
    }
    const same = planImport(
      { tables: { mcpServers: [server] } },
      { tables: { mcpServers: [relisted] }, settings: SETTINGS },
      { byHand: false }
    )
    expect(changesAnything(same)).toBe(false)

    const moved = planImport(
      { tables: { mcpServers: [{ ...server, url: 'https://tracker.example/v2' }] } },
      { tables: { mcpServers: [relisted] }, settings: SETTINGS },
      { byHand: false }
    )
    expect(moved.rows.mcpServers[0].url).toBe('https://tracker.example/v2')
    expect(moved.rows.mcpServers[0].tools).toHaveLength(2)
    expect(moved.rows.mcpServers[0].listedAt).toBe(900)
  })

  it('left by a script, skips what the file hasn’t changed since it was last imported', () => {
    const file = { tables: { aiProfiles: [preset] }, settings: { aiPreset: 'profile_team' } }
    const first = planImport(file, freshInstall(), { byHand: false })

    // The writer changed the preset's model, and chose another preset.
    const here = {
      tables: { aiProfiles: [{ ...preset, model: 'their-own' }] },
      settings: { ...SETTINGS, aiPreset: 'profile_default_chat' },
    }
    const again = planImport(file, here, { byHand: false, fingerprints: first.fingerprints })
    expect(changesAnything(again)).toBe(false)
    expect(again.fingerprints).toEqual(first.fingerprints)

    // The team changed the preset; the preset in use is still the writer's.
    const newer = {
      tables: { aiProfiles: [{ ...preset, model: 'house-larger' }] },
      settings: file.settings,
    }
    const update = planImport(newer, here, { byHand: false, fingerprints: first.fingerprints })
    expect(update.rows.aiProfiles[0].model).toBe('house-larger')
    expect(update.settings).toEqual({})
  })

  it('left by a script, brings back nothing the writer deleted until the file changes it', () => {
    const file = { tables: { mcpServers: [server] } }
    const first = planImport(file, freshInstall(), { byHand: false })
    const again = planImport(file, freshInstall(), {
      byHand: false,
      fingerprints: first.fingerprints,
    })
    expect(changesAnything(again)).toBe(false)
  })

  it('by hand, imports a file whole even when it was imported before', () => {
    const file = { tables: { aiProfiles: [preset] } }
    const first = planImport(file, freshInstall(), { byHand: true })
    const here = { tables: { aiProfiles: [{ ...preset, model: 'their-own' }] }, settings: SETTINGS }
    const again = planImport(file, here, { byHand: true, fingerprints: first.fingerprints })
    expect(again.rows.aiProfiles[0].model).toBe('house-large')
  })

  it('keeps the fingerprints of items the file doesn’t have', () => {
    const plan = planImport({ tables: {} }, freshInstall(), {
      byHand: false,
      fingerprints: { 'aiProfiles/elsewhere': 'abc' },
    })
    expect(plan.fingerprints).toEqual({ 'aiProfiles/elsewhere': 'abc' })
  })

  it('passes over rows with no id and tables a setup isn’t made of', () => {
    const plan = planImport(
      {
        tables: {
          aiProviders: [null, 'text', { name: 'No id' }, proxy],
          stories: [{ id: 's1' }],
        },
      },
      freshInstall(),
      { byHand: true }
    )
    expect(Object.keys(plan.rows)).toEqual(['aiProviders'])
    expect(plan.rows.aiProviders.map(row => row.id)).toEqual(['provider_proxy'])
  })

  it('counts a row every install has as a change, even before the app has made it', () => {
    const plan = planImport(
      {
        tables: {
          aiProviders: [{ ...untouchedKokoro, endpoint: 'http://localhost:8881/v1' }],
          aiProfiles: [{ ...preset, id: 'profile_default_chat', name: 'Default' }],
        },
      },
      { tables: {}, settings: SETTINGS },
      { byHand: false }
    )
    expect(plan.added).toEqual([])
    expect(plan.changed.map(item => item.name)).toEqual(['Kokoro', 'Default'])
  })

  it('matches a skill’s wording by the skill’s name', () => {
    const here = {
      tables: { skillWordings: [{ name: 'write', prompt: 'Old.', updated: 1 }] },
      settings: SETTINGS,
    }
    const plan = planImport(
      { tables: { skillWordings: [{ name: 'write', prompt: 'New.', updated: 2 }] } },
      here,
      { byHand: true }
    )
    expect(plan.changed.map(item => item.key)).toEqual(['skillWordings/write'])
  })
})

describe('describeImport', () => {
  /** @param {Array<[string, string]>} added @param {Array<[string, string]>} [changed] */
  const plan = (added, changed = []) => ({
    rows: {},
    settings: {},
    fingerprints: {},
    added: added.map(([kind, name]) => ({ key: `${kind}/${name}`, kind, name })),
    changed: changed.map(([kind, name]) => ({ key: `${kind}/${name}`, kind, name })),
  })

  it('names a few of a kind, and counts more', () => {
    expect(
      describeImport(
        plan([
          ['aiProviders', 'Team proxy'],
          ['aiProfiles', 'Team'],
          ['mcpServers', 'Tracker'],
          ['mcpServers', 'Wiki'],
          ['skills', 'a'],
          ['skills', 'b'],
          ['skills', 'c'],
          ['skills', 'd'],
        ])
      )
    ).toBe(
      'Adds the connection Team proxy, the preset Team, the MCP servers Tracker and Wiki and 4 skills.'
    )
  })

  it('says what it changes, the app settings by what they are', () => {
    expect(
      describeImport(
        plan(
          [['webSearch', 'Web search']],
          [
            ['aiProviders', 'Kokoro'],
            ['settings', 'aiPreset'],
            ['settings', 'narration'],
          ]
        )
      )
    ).toBe(
      'Adds the web search setup. Changes the connection Kokoro, the preset in use and the narration connection.'
    )
  })

  it('says it in the past once it has happened', () => {
    expect(describeImport(plan([['aiProfiles', 'Team']]), { done: true })).toBe(
      'Added the preset Team.'
    )
  })
})

describe('fingerprint', () => {
  it('is the same for the same data, whatever order its keys are in', () => {
    expect(fingerprint({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      fingerprint({ b: [1, { d: 3, c: 2 }], a: 1 })
    )
  })

  it('differs when the data does', () => {
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }))
    expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]))
  })
})

describe('settingsFilename', () => {
  it('is dated', () => {
    expect(settingsFilename(new Date(2026, 9, 3))).toBe('inksprite-settings-2026-10-03.json')
  })
})

describe('rowId', () => {
  it('is a wording’s name and every other row’s id', () => {
    expect(rowId('skillWordings', { name: 'write', id: 'x' })).toBe('write')
    expect(rowId('aiProviders', { id: 'p', name: 'P' })).toBe('p')
    expect(rowId('aiProviders', { id: '' })).toBeUndefined()
    expect(SETTINGS_TABLES).toContain('skillWordings')
  })
})

describe('describeSelection', () => {
  const nothing = { added: [], changed: [] }
  const preset = { key: 'aiProfiles/profile_team', kind: 'aiProfiles', name: 'Team' }
  const inUse = { key: 'settings/aiPreset', kind: 'settings', name: 'Preset in use' }

  it('adds the projects and cards with the settings, and says what it changes', () => {
    expect(
      describeSelection({
        projects: ['Thief'],
        cards: ['Wren', 'Tal'],
        plan: { added: [preset], changed: [inUse] },
      })
    ).toBe(
      'Adds the project Thief, the character cards Wren and Tal and the preset Team. Changes the preset in use.'
    )
  })

  it('counts them when there are many', () => {
    expect(describeSelection({ projects: ['A', 'B', 'C', 'D'], cards: [], plan: nothing })).toBe(
      'Adds 4 projects.'
    )
  })

  it('says it of an import that has happened', () => {
    expect(
      describeSelection({ projects: ['Thief (2)'], cards: [], plan: nothing }, { done: true })
    ).toBe('Added the project Thief (2).')
  })

  it('says nothing of a file that adds and changes nothing', () => {
    expect(describeSelection({ projects: [], cards: [], plan: nothing })).toBe('')
  })
})
