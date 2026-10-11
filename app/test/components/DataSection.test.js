/* global File */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import Checkbox from 'primevue/checkbox'
import DataSection from '../../src/components/writer/settings/DataSection.vue'

const { backup, confirmRequire, toast } = vi.hoisted(() => ({
  backup: { downloadBackup: vi.fn(), readBackupFile: vi.fn(), restoreBackup: vi.fn() },
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

const buttonNamed = (wrapper, label) =>
  wrapper.findAll('button').find(b => b.text().includes(label))

/** Pick a file in the hidden input, as the browser would. */
const pickFile = async (wrapper, file) => {
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
}

describe('DataSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    desktop.on = false
  })

  it('has no trash to empty', () => {
    const wrapper = mountSection()
    expect(buttonNamed(wrapper, 'Purge')).toBeUndefined()
  })

  it('asks before exporting, without keys unless ticked, and says where it went', async () => {
    backup.downloadBackup.mockResolvedValue({ filename: 'inksprite-backup-2026-09-26.json' })
    const wrapper = mountSection()

    await buttonNamed(wrapper, 'Export backup').trigger('click')
    expect(backup.downloadBackup).not.toHaveBeenCalled()
    await wrapper.find('[data-action="export"]').trigger('click')

    expect(backup.downloadBackup).toHaveBeenCalledWith({ includeApiKeys: false })
    expect(toast.success).toHaveBeenCalledWith('Saved inksprite-backup-2026-09-26.json')
    expect(wrapper.find('[data-dialog]').exists()).toBe(false)
  })

  it('includes API keys when the box is ticked', async () => {
    backup.downloadBackup.mockResolvedValue({ filename: 'b.json' })
    const wrapper = mountSection()

    await buttonNamed(wrapper, 'Export backup').trigger('click')
    await wrapper.findComponent(Checkbox).vm.$emit('update:modelValue', true)
    await wrapper.find('[data-action="export"]').trigger('click')

    expect(backup.downloadBackup).toHaveBeenCalledWith({ includeApiKeys: true })
  })

  it('reports an export that failed', async () => {
    backup.downloadBackup.mockRejectedValue(new Error('quota'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mountSection()

    await buttonNamed(wrapper, 'Export backup').trigger('click')
    await wrapper.find('[data-action="export"]').trigger('click')

    expect(toast.error).toHaveBeenCalledWith('Export failed: quota')
  })

  it('asks before restoring, then restores', async () => {
    const parsed = {
      app: 'inksprite',
      tables: { chats: [{ id: 'c1' }], messages: [{ id: 'm1' }, { id: 'm2' }] },
    }
    backup.readBackupFile.mockResolvedValue({
      backup: parsed,
      summary: [{ table: 'messages', count: 4 }],
    })
    backup.restoreBackup.mockResolvedValue(undefined)
    vi.stubGlobal('location', { reload: vi.fn() })
    const wrapper = mountSection()

    await pickFile(wrapper, new File(['{}'], 'backup.json'))

    expect(backup.restoreBackup).not.toHaveBeenCalled()
    expect(confirmRequire).toHaveBeenCalledTimes(1)
    expect(confirmRequire.mock.calls[0][0].message).toContain('This backup holds 1 chat.')

    await confirmRequire.mock.calls[0][0].accept()

    expect(backup.restoreBackup).toHaveBeenCalledWith(parsed)
    expect(window.location.reload).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('reports a file it cannot read', async () => {
    backup.readBackupFile.mockRejectedValue(new Error('Not a backup file.'))
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

    it('is shown beside the backup buttons while they are kept in it', async () => {
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
