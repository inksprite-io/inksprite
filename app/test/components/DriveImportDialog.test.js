/* global DOMException */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import DriveImportDialog from '@/components/writer/tree/DriveImportDialog.vue'
import { PopupBlockedError } from '@/drive/errors.js'

const drive = vi.hoisted(() => ({ choose: vi.fn(), importPicked: vi.fn() }))
const toast = vi.hoisted(() => ({ add: vi.fn() }))

vi.mock('@/composables/useDriveImport.js', () => ({ useDriveImport: () => drive }))
vi.mock('primevue/usetoast', () => ({ useToast: () => toast }))

/** The dialog as its contents, shown while it is visible. */
const Dialog = {
  props: ['visible'],
  template: '<div v-if="visible" data-stub-dialog><slot /><slot name="footer" /></div>',
}

const IMPORTED = { documents: 1, folders: 0, cards: 0, scans: 0, images: 2, skipped: [] }

/** A promise and the means to settle it, for a step the test holds open. */
function held() {
  /** @type {(value?: any) => void} */
  let resolve = () => {}
  /** @type {(error: any) => void} */
  let reject = () => {}
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/** A wait that ends, as a stopped one does, when its signal is aborted. */
const untilStopped = signal =>
  new Promise((_, reject) =>
    signal?.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')))
  )

const mountDialog = () =>
  mount(DriveImportDialog, {
    props: { storyId: 'story_1' },
    global: { plugins: [PrimeVue], stubs: { Dialog } },
  })

const shown = wrapper => wrapper.find('[data-stub-dialog]')

describe('DriveImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    drive.importPicked.mockResolvedValue(IMPORTED)
  })

  it('opens Google’s page from the click that opened it, waits, then imports into its folder', async () => {
    const picking = held()
    drive.choose.mockReturnValue(picking.promise)
    drive.importPicked.mockImplementation(async (ids, token, { onStep }) => {
      onStep('downloading', 1, 1)
      return IMPORTED
    })
    const wrapper = mountDialog()

    wrapper.vm.open('folder_1')
    // Asked for within the call, with nothing awaited first.
    expect(drive.choose).toHaveBeenCalledTimes(1)
    await flushPromises()
    expect(wrapper.find('[data-drive-status]').text()).toBe('Waiting for Google…')

    picking.resolve({ token: 'tok', ids: ['a'] })
    await flushPromises()

    expect(drive.importPicked).toHaveBeenCalledWith(
      ['a'],
      'tok',
      expect.objectContaining({ parentId: 'folder_1', signal: expect.any(Object) })
    )
    expect(toast.add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'success',
        detail: 'Imported 1 document. 2 images left out.',
      })
    )
    expect(shown(wrapper).exists()).toBe(false)
  })

  it('closes when the writer cancelled on Google’s page, or picked nothing', async () => {
    drive.choose.mockResolvedValue(null)
    const wrapper = mountDialog()

    wrapper.vm.open('folder_1')
    await flushPromises()

    expect(drive.importPicked).not.toHaveBeenCalled()
    expect(shown(wrapper).exists()).toBe(false)
  })

  it('stops waiting on Cancel, by its signal', async () => {
    /** @type {AbortSignal|undefined} */
    let signal
    drive.choose.mockImplementation(options => {
      signal = options.signal
      return untilStopped(signal)
    })
    const wrapper = mountDialog()

    wrapper.vm.open('folder_1')
    await flushPromises()
    await wrapper.find('[data-drive-cancel]').trigger('click')
    await flushPromises()

    expect(signal?.aborted).toBe(true)
    expect(shown(wrapper).exists()).toBe(false)
    expect(wrapper.find('[data-drive-error]').exists()).toBe(false)
  })

  it('says why Google’s page did not open, with a button to try again from a click', async () => {
    drive.choose.mockRejectedValueOnce(new PopupBlockedError())
    const wrapper = mountDialog()

    wrapper.vm.open('folder_1')
    await flushPromises()

    expect(wrapper.find('[data-drive-error]').text()).toBe('The browser blocked Google’s window.')

    drive.choose.mockResolvedValue({ token: 'tok', ids: ['a'] })
    await wrapper.find('[data-drive-retry]').trigger('click')
    await flushPromises()
    expect(drive.importPicked).toHaveBeenCalled()
  })

  it('says where the download is, and stops it by its signal', async () => {
    drive.choose.mockResolvedValue({ token: 'tok', ids: ['a', 'b', 'c'] })
    /** @type {AbortSignal|undefined} */
    let signal
    drive.importPicked.mockImplementation((ids, token, options) => {
      signal = options.signal
      options.onStep('downloading', 1, 3)
      return untilStopped(signal)
    })
    const wrapper = mountDialog()

    wrapper.vm.open('folder_1')
    await flushPromises()
    expect(wrapper.find('[data-drive-status]').text()).toBe('Downloading 1 of 3…')
    expect(wrapper.find('[data-drive-cancel]').text()).toBe('Stop')

    await wrapper.find('[data-drive-cancel]').trigger('click')
    await flushPromises()

    expect(signal?.aborted).toBe(true)
    expect(wrapper.find('[data-drive-error]').text()).toBe(
      'Stopped. Whatever was written before stays.'
    )
    expect(shown(wrapper).exists()).toBe(true)
  })
})
