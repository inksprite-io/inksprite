/* global File */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import BackupSection from '../../src/components/writer/settings/BackupSection.vue'
import ExportDialog from '../../src/components/writer/settings/ExportDialog.vue'
import ImportBackupDialog from '../../src/components/writer/settings/ImportBackupDialog.vue'
import SettingsExportDialog from '../../src/components/writer/settings/SettingsExportDialog.vue'

const { backup, confirmRequire, toast } = vi.hoisted(() => ({
  backup: {
    downloadBackup: vi.fn(),
    downloadSettings: vi.fn(),
    listSettings: vi.fn(),
    readDataFile: vi.fn(),
    restoreBackup: vi.fn(),
    addFromBackup: vi.fn(),
    importSettings: vi.fn(),
    importSelection: vi.fn(),
  },
  confirmRequire: vi.fn(),
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('@/composables/useBackup', () => ({ useBackup: () => backup }))
vi.mock('@/composables/useToast', () => ({ useToast: () => toast }))
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require: confirmRequire }) }))

const desktop = vi.hoisted(() => ({ on: false }))
vi.mock('@/platform/desktop.js', () => ({ isDesktop: () => desktop.on }))

const mountSection = () =>
  mount(BackupSection, {
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: Tooltip },
      stubs: {
        Dialog: {
          props: ['visible'],
          template: '<div v-if="visible" data-dialog><slot /><slot name="footer" /></div>',
        },
      },
    },
  })

const buttonNamed = (wrapper, label) => wrapper.findAll('button').find(b => b.text() === label)

/** Pick a file in the hidden input, as the browser would. */
const pickFile = async (wrapper, file) => {
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
}

/** What a dialog the button opens hands over, as if the writer chose it there. */
const exportChosen = async (wrapper, choice, { button = 'Export', dialog = ExportDialog } = {}) => {
  await buttonNamed(wrapper, button).trigger('click')
  const opened = wrapper.findComponent(dialog)
  expect(opened.props('visible')).toBe(true)
  await opened.vm.$emit('export', choice)
  await flushPromises()
}

/** What reading a settings file says it would change. */
const plan = (overrides = {}) => ({
  rows: {},
  settings: {},
  fingerprints: {},
  added: [],
  changed: [],
  ...overrides,
})

describe('BackupSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    desktop.on = false
  })

  it('has three buttons, Export, Export settings and Import, and no trash to empty', () => {
    const wrapper = mountSection()
    expect(wrapper.findAll('button').map(button => button.text())).toEqual([
      'Export',
      'Export settings',
      'Import',
    ])
  })

  describe('Export', () => {
    it('saves everything, with keys when asked, and leaves the download to say so', async () => {
      backup.downloadBackup.mockResolvedValue({ filename: 'inksprite-backup-2026-10-26.zip' })
      const wrapper = mountSection()

      await exportChosen(wrapper, { includeApiKeys: true })

      expect(backup.downloadBackup).toHaveBeenCalledWith({ includeApiKeys: true })
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('reports a backup that failed', async () => {
      backup.downloadBackup.mockRejectedValue(new Error('quota'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const wrapper = mountSection()

      await exportChosen(wrapper, { includeApiKeys: false })

      expect(toast.error).toHaveBeenCalledWith("The backup couldn't be saved. quota")
    })
  })

  describe('Export settings', () => {
    const settings = { button: 'Export settings', dialog: SettingsExportDialog }

    it('saves the settings ticked, with keys when asked', async () => {
      backup.downloadSettings.mockResolvedValue({ filename: 'inksprite-settings-2026-10-26.json' })
      const wrapper = mountSection()
      const picked = new Set(['aiProfiles/profile_team'])

      await exportChosen(wrapper, { picked, includeApiKeys: true }, settings)

      expect(backup.downloadSettings).toHaveBeenCalledWith({ picked, includeApiKeys: true })
    })

    it('reports a settings file that failed', async () => {
      backup.downloadSettings.mockRejectedValue(new Error('quota'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const wrapper = mountSection()

      await exportChosen(wrapper, { picked: new Set(), includeApiKeys: false }, settings)

      expect(toast.error).toHaveBeenCalledWith("The settings couldn't be saved. quota")
    })
  })

  describe('Import of a backup', () => {
    const addable = { projects: [], cards: { rows: [], files: [] } }
    const readBackup = parsed =>
      backup.readDataFile.mockResolvedValue({
        kind: 'backup',
        backup: parsed,
        summary: [],
        addable,
      })

    /** Pick a backup, and the dialog it opens. */
    const picked = async wrapper => {
      await pickFile(wrapper, new File(['{}'], 'backup.json'))
      await flushPromises()
      return wrapper.findComponent(ImportBackupDialog)
    }

    it('asks what to do, and restores in place of everything when asked to', async () => {
      const parsed = {
        app: 'inksprite',
        tables: { chats: [{ id: 'c1' }], messages: [{ id: 'm1' }, { id: 'm2' }] },
      }
      readBackup(parsed)
      backup.restoreBackup.mockResolvedValue(undefined)
      vi.stubGlobal('location', { reload: vi.fn() })
      const wrapper = mountSection()

      await buttonNamed(wrapper, 'Import').trigger('click')
      const dialog = await picked(wrapper)

      expect(backup.restoreBackup).not.toHaveBeenCalled()
      expect(dialog.props('visible')).toBe(true)
      expect(dialog.props('message')).toBe('This backup holds 1 chat.')
      expect(dialog.props('addable')).toEqual(addable)

      await dialog.vm.$emit('replace')
      await dialog.vm.$emit('update:visible', false)
      await flushPromises()

      expect(backup.restoreBackup).toHaveBeenCalledWith(parsed)
      expect(window.location.reload).toHaveBeenCalled()
      vi.unstubAllGlobals()
    })

    it('adds what was ticked beside what is here, and says what it added', async () => {
      readBackup({ app: 'inksprite', tables: { stories: [{ id: 's1' }] } })
      backup.addFromBackup.mockResolvedValue({ projects: ['Thief (2)'], cards: ['Wren'] })
      const wrapper = mountSection()
      const dialog = await picked(wrapper)
      const taken = { projects: [{ story: { id: 's1' } }], cards: { rows: [], files: [] } }

      await dialog.vm.$emit('add', taken)
      await dialog.vm.$emit('update:visible', false)
      await flushPromises()

      expect(backup.addFromBackup).toHaveBeenCalledWith(taken)
      expect(backup.restoreBackup).not.toHaveBeenCalled()
      expect(toast.success).toHaveBeenCalledWith(
        'Added the project Thief (2) and the character card Wren.'
      )
      expect(wrapper.findComponent(ImportBackupDialog).props('visible')).toBe(false)
    })

    it('does nothing when cancelled', async () => {
      readBackup({ app: 'inksprite', tables: { chats: [{ id: 'c1' }] } })
      const wrapper = mountSection()
      const dialog = await picked(wrapper)

      await dialog.vm.$emit('update:visible', false)
      await flushPromises()

      expect(backup.restoreBackup).not.toHaveBeenCalled()
      expect(backup.addFromBackup).not.toHaveBeenCalled()
      expect(wrapper.findComponent(ImportBackupDialog).props('visible')).toBe(false)
    })

    it('names the keys a backup left out before taking it', async () => {
      readBackup({
        app: 'inksprite',
        includesApiKeys: false,
        tables: {
          aiProviders: [{ id: 'p1', name: 'OpenRouter', apiKey: '' }],
          webSearch: [{ id: 'web', keys: { kagi: '' } }],
        },
      })
      const wrapper = mountSection()

      const dialog = await picked(wrapper)

      expect(dialog.props('message')).toBe(
        'This backup holds your settings. Keys left out: OpenRouter, Kagi.'
      )
    })

    it('says nothing of keys when none were left out', async () => {
      readBackup({ app: 'inksprite', includesApiKeys: true, tables: { chats: [{ id: 'c1' }] } })
      const wrapper = mountSection()

      const dialog = await picked(wrapper)

      expect(dialog.props('message')).not.toContain('Keys')
    })
  })

  describe('Import of settings', () => {
    it('says what it adds and changes, and the keys it leaves out, before importing', async () => {
      const changes = plan({
        rows: { aiProviders: [{ id: 'provider_proxy', name: 'Team proxy', apiKey: '' }] },
        added: [{ key: 'aiProviders/provider_proxy', kind: 'aiProviders', name: 'Team proxy' }],
        changed: [{ key: 'settings/aiPreset', kind: 'settings', name: 'Preset in use' }],
      })
      backup.readDataFile.mockResolvedValue({
        kind: 'settings',
        backup: { app: 'inksprite', includesApiKeys: false, tables: {} },
        plan: changes,
      })
      backup.importSettings.mockResolvedValue(undefined)
      vi.stubGlobal('location', { reload: vi.fn() })
      const wrapper = mountSection()

      await pickFile(wrapper, new File(['{}'], 'inksprite-settings.json'))

      const asked = confirmRequire.mock.calls[0][0]
      expect(asked.header).toBe('Import settings?')
      expect(asked.message).toBe(
        'Adds the connection Team proxy. Changes the preset in use. Keys left out: Team proxy.'
      )
      expect(backup.importSettings).not.toHaveBeenCalled()
      expect(backup.restoreBackup).not.toHaveBeenCalled()

      await asked.accept()
      expect(backup.importSettings).toHaveBeenCalledWith(changes)
      expect(window.location.reload).toHaveBeenCalled()
      vi.unstubAllGlobals()
    })

    it('does nothing with a file that changes nothing', async () => {
      backup.readDataFile.mockResolvedValue({
        kind: 'settings',
        backup: { app: 'inksprite', tables: {} },
        plan: plan(),
      })
      const wrapper = mountSection()

      await pickFile(wrapper, new File(['{}'], 'inksprite-settings.json'))

      expect(confirmRequire).not.toHaveBeenCalled()
      expect(backup.importSettings).not.toHaveBeenCalled()
      expect(toast.info).not.toHaveBeenCalled()
    })
  })

  describe('Import of a selection', () => {
    /** A selection of one project and one card, and the settings it changes. */
    const readSelection = (changes = plan()) =>
      backup.readDataFile.mockResolvedValue({
        kind: 'selection',
        backup: { app: 'inksprite', includesApiKeys: false, tables: {} },
        selection: {
          projects: [
            {
              story: { id: 'story_a' },
              documents: [{ id: 'root_story_a', title: 'Thief' }],
            },
          ],
          cards: { rows: [{ id: 'libcard_wren', title: 'Wren' }], files: [] },
          plan: changes,
        },
      })

    it('says what it adds and changes before importing', async () => {
      readSelection(
        plan({ changed: [{ key: 'settings/aiPreset', kind: 'settings', name: 'Preset in use' }] })
      )
      backup.importSelection.mockResolvedValue({
        projects: ['Thief (2)'],
        cards: [],
        settingsChanged: true,
      })
      vi.stubGlobal('location', { reload: vi.fn() })
      const wrapper = mountSection()

      await pickFile(wrapper, new File(['{}'], 'inksprite-export.json'))

      const asked = confirmRequire.mock.calls[0][0]
      expect(asked.header).toBe('Import?')
      expect(asked.message).toBe(
        'Adds the project Thief and the character card Wren. Changes the preset in use.'
      )
      expect(backup.importSelection).not.toHaveBeenCalled()

      await asked.accept()
      expect(backup.importSelection).toHaveBeenCalledTimes(1)
      // Settings went past the stores, so the page reads them again.
      expect(window.location.reload).toHaveBeenCalled()
      vi.unstubAllGlobals()
    })

    it('takes one that only adds without asking, and says what it added by the names it was given', async () => {
      readSelection()
      backup.importSelection.mockResolvedValue({
        projects: ['Thief (2)'],
        cards: [],
        settingsChanged: false,
      })
      vi.stubGlobal('location', { reload: vi.fn() })
      const wrapper = mountSection()

      await pickFile(wrapper, new File(['{}'], 'inksprite-export.json'))
      await flushPromises()

      expect(confirmRequire).not.toHaveBeenCalled()
      expect(backup.importSelection).toHaveBeenCalledTimes(1)
      expect(window.location.reload).not.toHaveBeenCalled()
      expect(toast.success).toHaveBeenCalledWith('Added the project Thief (2).')
      vi.unstubAllGlobals()
    })
  })

  it('reports a file it cannot read', async () => {
    backup.readDataFile.mockRejectedValue(new Error('Not a backup file.'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mountSection()

    await pickFile(wrapper, new File(['nope'], 'notes.txt'))

    expect(confirmRequire).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Not a backup file.')
  })

  it('leaves showing the projects’ folder to the outline, in the desktop app too', async () => {
    desktop.on = true
    const wrapper = mountSection()
    await flushPromises()
    expect(wrapper.findAll('button').map(button => button.text())).toEqual([
      'Export',
      'Export settings',
      'Import',
    ])
  })
})
