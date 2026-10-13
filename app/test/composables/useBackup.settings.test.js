import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

/** The app tables, as storage holds them. */
const tables = vi.hoisted(() => /** @type {Record<string, any[]>} */ ({}))
const storage = vi.hoisted(() => ({
  schemaVersion: () => 28,
  all: vi.fn(async table => tables[table] || []),
  write: vi.fn(async (table, changes) => {
    const rows = tables[table] || (tables[table] = [])
    for (const { id, data } of changes) {
      const at = rows.findIndex(row => (row.id ?? row.name) === id)
      if (at >= 0) rows[at] = data
      else rows.push(data)
    }
  }),
}))
const processSync = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@/storage/index.js', () => ({ storage }))
vi.mock('@/stores/syncStore', () => ({ useSyncStore: () => ({ processSync }) }))

const { useBackup } = await import('@/composables/useBackup.js')
const { useApplicationState } = await import('@/composables/useApplicationState.js')

const proxy = {
  id: 'provider_proxy',
  name: 'Team proxy',
  type: 'generic',
  endpoint: 'http://127.0.0.1:4100/v1',
  apiKey: 'team-secret',
  created: 1,
  updated: 1,
}
const preset = {
  id: 'profile_team',
  name: 'Team',
  providerId: 'provider_proxy',
  model: 'house-large',
  created: 1,
  updated: 1,
}

/** A file the writer picked. */
const fileOf = (/** @type {any} */ contents) => ({ text: async () => JSON.stringify(contents) })

/** A settings file as Export settings writes it. */
const settingsFile = (/** @type {Record<string, any[]>} */ rows, settings = {}) => ({
  app: 'inksprite',
  format: 1,
  dbVersion: 28,
  exported: 1,
  includesApiKeys: false,
  scope: 'settings',
  tables: rows,
  settings,
})

describe('useBackup, settings files', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    for (const table of Object.keys(tables)) delete tables[table]
    window.localStorage.clear()
    useApplicationState().resetState()
  })

  describe('createSettingsBackup', () => {
    it('holds only what was picked, as settings, without keys unless asked', async () => {
      tables.aiProviders = [proxy]
      tables.aiProfiles = [preset]
      tables.stories = [{ id: 's1' }]
      useApplicationState().setActiveAIPresetId('profile_team')

      const backup = await useBackup().createSettingsBackup({
        picked: new Set(['aiProviders/provider_proxy', 'settings/aiPreset']),
      })

      expect(processSync).toHaveBeenCalled()
      expect(backup.scope).toBe('settings')
      expect(backup.dbVersion).toBe(28)
      expect(backup.tables).toEqual({ aiProviders: [{ ...proxy, apiKey: '' }] })
      expect(backup.settings).toEqual({ aiPreset: 'profile_team' })

      const kept = await useBackup().createSettingsBackup({
        picked: new Set(['aiProviders/provider_proxy']),
        includeApiKeys: true,
      })
      expect(kept.tables.aiProviders[0].apiKey).toBe('team-secret')
    })
  })

  describe('listSettings', () => {
    it('lists what there is to put in a file', async () => {
      tables.aiProfiles = [preset]
      const items = await useBackup().listSettings()
      expect(items.map(item => item.key)).toContain('aiProfiles/profile_team')
      expect(items.map(item => item.key)).toContain('settings/preferences')
    })
  })

  describe('readDataFile', () => {
    it('says what importing a settings file would change, writing nothing', async () => {
      const read = await useBackup().readDataFile(
        fileOf(settingsFile({ aiProviders: [proxy], aiProfiles: [preset] }))
      )
      expect(read.kind).toBe('settings')
      expect(read.plan.added.map(item => item.name)).toEqual(['Team proxy', 'Team'])
      expect(storage.write).not.toHaveBeenCalled()
    })

    it('reads a whole backup as one', async () => {
      const read = await useBackup().readDataFile(
        fileOf({ ...settingsFile({ aiProfiles: [preset] }), scope: 'database' })
      )
      expect(read.kind).toBe('backup')
      expect(read.summary).toEqual([{ table: 'aiProfiles', count: 1 }])
    })

    it('sends a project file to the outline', async () => {
      await expect(
        useBackup().readDataFile(fileOf({ ...settingsFile({}), scope: 'project' }))
      ).rejects.toThrow(
        'This file holds one project, not a whole backup. Import it with Import a project'
      )
    })

    it('checks a settings file as settings', async () => {
      await expect(
        useBackup().readDataFile(fileOf({ ...settingsFile({}), dbVersion: 99 }))
      ).rejects.toThrow('Update the app first')
    })
  })

  it('is refused where a project is expected, saying where it goes', async () => {
    await expect(useBackup().readProjectFile(fileOf(settingsFile({})))).rejects.toThrow(
      'This file holds settings, not one project. Import it with Import in Settings › System.'
    )
  })

  describe('importSettings', () => {
    it('writes the rows and settings, and remembers each item', async () => {
      tables.aiProviders = [{ ...proxy, name: 'Old proxy' }]
      const backup = useBackup()
      const { plan } = await backup.readDataFile(
        fileOf(
          settingsFile(
            { aiProviders: [{ ...proxy, apiKey: '' }], aiProfiles: [preset] },
            { aiPreset: 'profile_team', theme: 'dark' }
          )
        )
      )
      await backup.importSettings(plan)

      expect(tables.aiProviders).toEqual([
        expect.objectContaining({ name: 'Team proxy', apiKey: 'team-secret' }),
      ])
      expect(tables.aiProfiles).toEqual([expect.objectContaining({ id: 'profile_team' })])
      expect(useApplicationState().activeAIPresetId.value).toBe('profile_team')
      expect(useApplicationState().theme.value).toBe('dark')
      expect(
        Object.keys(JSON.parse(window.localStorage.getItem('inksprite.settings-imported')))
      ).toEqual([
        'aiProviders/provider_proxy',
        'aiProfiles/profile_team',
        'settings/aiPreset',
        'settings/preferences',
      ])
    })

    it('writes a skill’s wording under the skill’s name', async () => {
      const backup = useBackup()
      const { plan } = await backup.readDataFile(
        fileOf(settingsFile({ skillWordings: [{ name: 'write', prompt: 'Short.', updated: 1 }] }))
      )
      await backup.importSettings(plan)
      expect(storage.write).toHaveBeenCalledWith('skillWordings', [
        expect.objectContaining({ id: 'write', op: 'put' }),
      ])
    })
  })

  describe('planLeftSettings', () => {
    it('skips what a file left by a script hasn’t changed since it was imported', async () => {
      const text = JSON.stringify(settingsFile({ aiProfiles: [preset] }))
      const backup = useBackup()

      const first = await backup.planLeftSettings(text)
      await backup.importSettings(first)
      expect(first.added.map(item => item.name)).toEqual(['Team'])

      tables.aiProfiles[0] = { ...tables.aiProfiles[0], model: 'their-own' }
      const again = await backup.planLeftSettings(text)
      expect(again.added).toEqual([])
      expect(again.changed).toEqual([])
      // Nothing waits to be saved as the app opens, so nothing is flushed.
      expect(processSync).not.toHaveBeenCalled()
    })

    it('refuses text that isn’t a settings file', async () => {
      await expect(useBackup().planLeftSettings('{"app":')).rejects.toThrow('not valid JSON')
    })
  })
})
