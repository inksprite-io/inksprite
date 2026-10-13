import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'

const settingsFileText = vi.hoisted(() => vi.fn())
const backup = vi.hoisted(() => ({ planLeftSettings: vi.fn(), importSettings: vi.fn() }))
const toast = vi.hoisted(() => ({ showToast: vi.fn() }))

vi.mock('@/platform/settingsFile.js', () => ({ settingsFileText }))
vi.mock('@/composables/useBackup.js', () => ({ useBackup: () => backup }))
vi.mock('@/composables/useToast.js', () => ({ useToast: () => toast }))

const { importSettingsFile, useSettingsFileNotice } = await import(
  '@/composables/useSettingsFile.js'
)

/** What the app says once it is up. */
const mountApp = () =>
  mount(
    defineComponent({
      setup() {
        useSettingsFileNotice()
        return () => null
      },
    })
  )

const plan = (/** @type {any} */ overrides = {}) => ({
  rows: {},
  settings: {},
  fingerprints: {},
  added: [],
  changed: [],
  ...overrides,
})

describe('importSettingsFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    backup.importSettings.mockResolvedValue(undefined)
  })

  it('does nothing without a file', async () => {
    settingsFileText.mockResolvedValue(null)
    await importSettingsFile()
    mountApp()

    expect(backup.planLeftSettings).not.toHaveBeenCalled()
    expect(toast.showToast).not.toHaveBeenCalled()
  })

  it('imports the file and says what it changed once the app is up', async () => {
    settingsFileText.mockResolvedValue('{"the":"file"}')
    const changes = plan({
      added: [{ key: 'aiProfiles/profile_team', kind: 'aiProfiles', name: 'Team' }],
    })
    backup.planLeftSettings.mockResolvedValue(changes)

    await importSettingsFile()
    expect(backup.planLeftSettings).toHaveBeenCalledWith('{"the":"file"}')
    expect(backup.importSettings).toHaveBeenCalledWith(changes)
    expect(toast.showToast).not.toHaveBeenCalled()

    mountApp()
    expect(toast.showToast).toHaveBeenCalledWith({
      type: 'success',
      message: 'Settings imported. Added the preset Team.',
      duration: 10000,
    })

    // Said once.
    mountApp()
    expect(toast.showToast).toHaveBeenCalledTimes(1)
  })

  it('records a file that changed nothing, and says nothing', async () => {
    settingsFileText.mockResolvedValue('{}')
    backup.planLeftSettings.mockResolvedValue(plan({ fingerprints: { 'a/b': 'c' } }))

    await importSettingsFile()
    mountApp()

    expect(backup.importSettings).toHaveBeenCalled()
    expect(toast.showToast).not.toHaveBeenCalled()
  })

  it('opens the app anyway on a file it can’t read, and says why until closed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    settingsFileText.mockResolvedValue('nonsense')
    backup.planLeftSettings.mockRejectedValue(new Error('That file is not valid JSON.'))

    await expect(importSettingsFile()).resolves.toBeUndefined()
    mountApp()

    expect(backup.importSettings).not.toHaveBeenCalled()
    expect(toast.showToast).toHaveBeenCalledWith({
      type: 'error',
      message: "The settings file couldn't be imported. That file is not valid JSON.",
      duration: 0,
    })
  })
})
