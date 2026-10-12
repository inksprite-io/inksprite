import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import LibrarySection from '@/components/writer/settings/LibrarySection.vue'

const library = vi.hoisted(() => ({ librarySettings: vi.fn() }))
const confirm = vi.hoisted(() => ({ require: vi.fn() }))
const move = vi.hoisted(() => ({ moveIn: vi.fn(), moveOut: vi.fn() }))

vi.mock('@/platform/library.js', () => library)
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => confirm }))
vi.mock('@/composables/useLibraryMove.js', () => ({ useLibraryMove: () => move }))

const FOLDER = '/Users/me/Library/Application Support/inksprite/Projects'

const mountSection = async () => {
  const wrapper = mount(LibrarySection, { global: { plugins: [PrimeVue] } })
  await flushPromises()
  return wrapper
}

const switchOf = wrapper => wrapper.findComponent({ name: 'ToggleSwitch' })

/** Flip the switch, the way a click does. */
const turn = async (wrapper, on) => {
  switchOf(wrapper).vm.$emit('update:modelValue', on)
  await flushPromises()
}

/** Say yes to what the switch asked. */
const accept = async () => {
  confirm.require.mock.calls[0][0].accept()
  await flushPromises()
}

describe('LibrarySection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    library.librarySettings.mockResolvedValue({ path: FOLDER, enabled: true, moved: true })
    move.moveIn.mockResolvedValue(true)
    move.moveOut.mockResolvedValue(true)
  })

  describe('with the projects kept in the app', () => {
    beforeEach(() => {
      library.librarySettings.mockResolvedValue({ path: FOLDER, enabled: false, moved: false })
    })

    it('offers the switch, and nothing about the folder', async () => {
      const wrapper = await mountSection()

      expect(switchOf(wrapper).props('modelValue')).toBe(false)
      expect(wrapper.find('[data-library-path]').exists()).toBe(false)
    })

    it('asks first, then moves them into the folder', async () => {
      const wrapper = await mountSection()

      await turn(wrapper, true)
      expect(confirm.require).toHaveBeenCalledWith(
        expect.objectContaining({ header: 'Keep projects in a folder?' })
      )
      expect(move.moveIn).not.toHaveBeenCalled()

      await accept()

      expect(move.moveIn).toHaveBeenCalled()
      expect(switchOf(wrapper).props('modelValue')).toBe(true)
    })

    it('puts the switch back when they could not be moved', async () => {
      move.moveIn.mockResolvedValue(false)
      const wrapper = await mountSection()

      await turn(wrapper, true)
      await accept()

      expect(switchOf(wrapper).props('modelValue')).toBe(false)
    })

    it('stays as it is when the writer thinks better of it', async () => {
      const wrapper = await mountSection()

      await turn(wrapper, true)

      expect(move.moveIn).not.toHaveBeenCalled()
      expect(switchOf(wrapper).props('modelValue')).toBe(false)
    })
  })

  it('says where the projects are kept', async () => {
    const wrapper = await mountSection()

    expect(switchOf(wrapper).props('modelValue')).toBe(true)
    expect(wrapper.find('[data-library-path]').text()).toBe(FOLDER)
  })

  it('asks before moving the projects back into the app', async () => {
    const wrapper = await mountSection()

    await turn(wrapper, false)
    expect(confirm.require).toHaveBeenCalledWith(
      expect.objectContaining({ header: 'Keep projects in the app?' })
    )
    expect(move.moveOut).not.toHaveBeenCalled()

    await accept()

    expect(move.moveOut).toHaveBeenCalled()
    expect(switchOf(wrapper).props('modelValue')).toBe(false)
  })

  it('stays on the folder when the projects cannot be moved back', async () => {
    move.moveOut.mockResolvedValue(false)
    const wrapper = await mountSection()

    await turn(wrapper, false)
    await accept()

    expect(switchOf(wrapper).props('modelValue')).toBe(true)
  })
})
