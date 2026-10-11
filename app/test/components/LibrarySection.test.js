import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import LibrarySection from '@/components/writer/settings/LibrarySection.vue'

const library = vi.hoisted(() => ({
  librarySettings: vi.fn(),
  enableLibrary: vi.fn(),
}))
const saved = vi.hoisted(() => ({ flush: vi.fn(), processSync: vi.fn() }))
const toast = vi.hoisted(() => ({ error: vi.fn() }))
const confirm = vi.hoisted(() => ({ require: vi.fn() }))
const open = vi.hoisted(() => ({ keepProjectsInApp: vi.fn() }))
const storage = vi.hoisted(() => ({ storage: { dump: vi.fn() } }))

vi.mock('@/platform/library.js', () => library)
vi.mock('@/storage/open.js', () => open)
vi.mock('@/storage/index.js', () => storage)
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => confirm }))
vi.mock('@/composables/useEditor.js', () => ({ useEditor: () => ({ flush: saved.flush }) }))
vi.mock('@/stores/syncStore.js', () => ({
  useSyncStore: () => ({ processSync: saved.processSync }),
}))
vi.mock('@/composables/useToast.js', () => ({ useToast: () => toast }))

const FOLDER = '/Users/me/Library/Application Support/inksprite/Projects'

const mountSection = async () => {
  const wrapper = mount(LibrarySection, { global: { plugins: [PrimeVue] } })
  await flushPromises()
  return wrapper
}

/** Flip the switch, the way a click does. */
const turn = async (wrapper, on) => {
  wrapper.findComponent({ name: 'ToggleSwitch' }).vm.$emit('update:modelValue', on)
  await flushPromises()
}

describe('LibrarySection', () => {
  const reload = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    library.librarySettings.mockResolvedValue({ path: FOLDER, enabled: true, moved: true })
    saved.processSync.mockResolvedValue(undefined)
    open.keepProjectsInApp.mockResolvedValue(undefined)
    Object.defineProperty(window, 'location', { value: { reload }, configurable: true })
  })

  describe('with the projects kept in the app', () => {
    beforeEach(() => {
      library.librarySettings.mockResolvedValue({ path: FOLDER, enabled: false, moved: false })
      library.enableLibrary.mockResolvedValue(FOLDER)
    })

    it('offers the switch, and nothing about the folder', async () => {
      const wrapper = await mountSection()

      expect(wrapper.findComponent({ name: 'ToggleSwitch' }).props('modelValue')).toBe(false)
      expect(wrapper.find('[data-library-path]').exists()).toBe(false)
    })

    it('asks first, then saves everything and opens again to move them in', async () => {
      const wrapper = await mountSection()

      await turn(wrapper, true)
      expect(confirm.require).toHaveBeenCalledWith(
        expect.objectContaining({ header: 'Keep projects in a folder?' })
      )
      expect(library.enableLibrary).not.toHaveBeenCalled()

      confirm.require.mock.calls[0][0].accept()
      await flushPromises()

      expect(saved.flush).toHaveBeenCalled()
      expect(saved.processSync.mock.invocationCallOrder[0]).toBeLessThan(
        library.enableLibrary.mock.invocationCallOrder[0]
      )
      expect(reload).toHaveBeenCalled()
    })

    it('stays as it is when the writer thinks better of it', async () => {
      const wrapper = await mountSection()

      await turn(wrapper, true)

      expect(library.enableLibrary).not.toHaveBeenCalled()
      expect(reload).not.toHaveBeenCalled()
      expect(wrapper.findComponent({ name: 'ToggleSwitch' }).props('modelValue')).toBe(false)
    })
  })

  it('says where the projects are kept', async () => {
    const wrapper = await mountSection()

    expect(wrapper.findComponent({ name: 'ToggleSwitch' }).props('modelValue')).toBe(true)
    expect(wrapper.find('[data-library-path]').text()).toBe(FOLDER)
  })

  it('asks before keeping the projects in the app again, then copies them back first', async () => {
    const wrapper = await mountSection()

    await turn(wrapper, false)
    expect(confirm.require).toHaveBeenCalledWith(
      expect.objectContaining({ header: 'Keep projects in the app?' })
    )
    expect(open.keepProjectsInApp).not.toHaveBeenCalled()

    confirm.require.mock.calls[0][0].accept()
    await flushPromises()

    expect(saved.processSync.mock.invocationCallOrder[0]).toBeLessThan(
      open.keepProjectsInApp.mock.invocationCallOrder[0]
    )
    expect(open.keepProjectsInApp).toHaveBeenCalledWith(storage.storage)
    expect(reload).toHaveBeenCalled()
  })

  it('says so, and stays on the folder, when the projects cannot be copied back', async () => {
    open.keepProjectsInApp.mockRejectedValue(new Error('disk full'))
    const wrapper = await mountSection()

    await turn(wrapper, false)
    confirm.require.mock.calls[0][0].accept()
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith(
      "The projects couldn't be moved back into the app: disk full"
    )
    expect(reload).not.toHaveBeenCalled()
  })
})
