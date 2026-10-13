/* global File */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import DataSection from '../../src/components/writer/settings/DataSection.vue'
import ExportDialog from '../../src/components/writer/settings/ExportDialog.vue'

const { backup, confirmRequire, toast } = vi.hoisted(() => ({
  backup: {
    downloadBackup: vi.fn(),
    downloadSettings: vi.fn(),
    readDataFile: vi.fn(),
    restoreBackup: vi.fn(),
    importSettings: vi.fn(),
  },
  confirmRequire: vi.fn(),
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('@/composables/useBackup', () => ({ useBackup: () => backup }))
vi.mock('@/composables/useToast', () => ({ useToast: () => toast }))
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require: confirmRequire }) }))

const desktop = vi.hoisted(() => ({ on: false }))
const library = vi.hoisted(() => ({ librarySettings: vi.fn(), revealInLibrary: vi.fn() }))
vi.mock('@/platform/desktop.js', () => ({ isDesktop: () => desktop.on }))
vi.mock('@/platform/library.js', () => library)

const mountSection = () =>
  mount(DataSection, {
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

/** What the export dialog hands over, as if the writer chose it there. */
const exportChosen = async (wrapper, choice) => {
  await buttonNamed(wrapper, 'Export').trigger('click')
  const dialog = wrapper.findComponent(ExportDialog)
  expect(dialog.props('visible')).toBe(true)
  await dialog.vm.$emit('export', choice)
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

describe('DataSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    desktop.on = false
  })

  it('has two buttons, Export and Import, and no trash to empty', () => {
    const wrapper = mountSection()
    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Export', 'Import'])
  })

  describe('Export', () => {
    it('saves everything as a backup, and says where it went', async () => {
      backup.downloadBackup.mockResolvedValue({ filename: 'inksprite-backup-2026-09-26.json' })
      const wrapper = mountSection()

      await exportChosen(wrapper, { kind: 'backup', includeApiKeys: false })

      expect(backup.downloadBackup).toHaveBeenCalledWith({ includeApiKeys: false })
      expect(backup.downloadSettings).not.toHaveBeenCalled()
      expect(toast.success).toHaveBeenCalledWith('Saved inksprite-backup-2026-09-26.json')
    })

    it('saves the settings picked, with keys when asked', async () => {
      backup.downloadSettings.mockResolvedValue({ filename: 'inksprite-settings-2026-10-13.json' })
      const wrapper = mountSection()
      const picked = new Set(['aiProfiles/profile_team'])

      await exportChosen(wrapper, { kind: 'settings', picked, includeApiKeys: true })

      expect(backup.downloadSettings).toHaveBeenCalledWith({ picked, includeApiKeys: true })
      expect(backup.downloadBackup).not.toHaveBeenCalled()
      expect(toast.success).toHaveBeenCalledWith('Saved inksprite-settings-2026-10-13.json')
    })

    it('reports an export that failed', async () => {
      backup.downloadBackup.mockRejectedValue(new Error('quota'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const wrapper = mountSection()

      await exportChosen(wrapper, { kind: 'backup', includeApiKeys: false })

      expect(toast.error).toHaveBeenCalledWith('Export failed: quota')
    })
  })

  describe('Import of a backup', () => {
    const readBackup = parsed =>
      backup.readDataFile.mockResolvedValue({ kind: 'backup', backup: parsed, summary: [] })

    it('asks before restoring, then restores', async () => {
      const parsed = {
        app: 'inksprite',
        tables: { chats: [{ id: 'c1' }], messages: [{ id: 'm1' }, { id: 'm2' }] },
      }
      readBackup(parsed)
      backup.restoreBackup.mockResolvedValue(undefined)
      vi.stubGlobal('location', { reload: vi.fn() })
      const wrapper = mountSection()

      await buttonNamed(wrapper, 'Import').trigger('click')
      await pickFile(wrapper, new File(['{}'], 'backup.json'))

      expect(backup.restoreBackup).not.toHaveBeenCalled()
      expect(confirmRequire).toHaveBeenCalledTimes(1)
      expect(confirmRequire.mock.calls[0][0].header).toBe('Replace all data?')
      expect(confirmRequire.mock.calls[0][0].message).toContain('This backup holds 1 chat.')

      await confirmRequire.mock.calls[0][0].accept()

      expect(backup.restoreBackup).toHaveBeenCalledWith(parsed)
      expect(window.location.reload).toHaveBeenCalled()
      vi.unstubAllGlobals()
    })

    it('names the keys a backup left out before restoring it', async () => {
      readBackup({
        app: 'inksprite',
        includesApiKeys: false,
        tables: {
          aiProviders: [{ id: 'p1', name: 'OpenRouter', apiKey: '' }],
          webSearch: [{ id: 'web', keys: { kagi: '' } }],
        },
      })
      const wrapper = mountSection()

      await pickFile(wrapper, new File(['{}'], 'backup.json'))

      expect(confirmRequire.mock.calls[0][0].message).toBe(
        'This backup holds your settings. Keys left out: OpenRouter, Kagi. Everything in inksprite now is replaced.'
      )
    })

    it('says nothing of keys when none were left out', async () => {
      readBackup({ app: 'inksprite', includesApiKeys: true, tables: { chats: [{ id: 'c1' }] } })
      const wrapper = mountSection()

      await pickFile(wrapper, new File(['{}'], 'backup.json'))

      expect(confirmRequire.mock.calls[0][0].message).not.toContain('Keys')
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

    it('asks nothing of a file that changes nothing', async () => {
      backup.readDataFile.mockResolvedValue({
        kind: 'settings',
        backup: { app: 'inksprite', tables: {} },
        plan: plan(),
      })
      const wrapper = mountSection()

      await pickFile(wrapper, new File(['{}'], 'inksprite-settings.json'))

      expect(confirmRequire).not.toHaveBeenCalled()
      expect(toast.info).toHaveBeenCalledWith('Everything in this file is here already.')
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

  describe('the projects folder', () => {
    const settings = enabled => ({ path: '/Projects', enabled, moved: true })

    it('is not offered in a browser', async () => {
      const wrapper = mountSection()
      await flushPromises()

      expect(library.librarySettings).not.toHaveBeenCalled()
      expect(wrapper.find('[data-action="reveal"]').exists()).toBe(false)
    })

    it('is not offered while the projects are kept in the app', async () => {
      desktop.on = true
      library.librarySettings.mockResolvedValue(settings(false))
      const wrapper = mountSection()
      await flushPromises()

      expect(wrapper.find('[data-action="reveal"]').exists()).toBe(false)
    })

    it('is shown beside Export and Import while they are kept in it', async () => {
      desktop.on = true
      library.librarySettings.mockResolvedValue(settings(true))
      const wrapper = mountSection()
      await flushPromises()

      await wrapper.find('[data-action="reveal"]').trigger('click')
      expect(library.revealInLibrary).toHaveBeenCalledWith()
    })

    it('says so when it cannot be shown', async () => {
      desktop.on = true
      library.librarySettings.mockResolvedValue(settings(true))
      library.revealInLibrary.mockRejectedValue(new Error('gone'))
      const wrapper = mountSection()
      await flushPromises()

      await wrapper.find('[data-action="reveal"]').trigger('click')
      await flushPromises()
      expect(toast.error).toHaveBeenCalledWith("The folder couldn't be shown: gone")
    })
  })
})
