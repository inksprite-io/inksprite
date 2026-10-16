import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import CardLinkDialog from '@/components/writer/cards/CardLinkDialog.vue'

// A plain function rather than a spy: with a vi.fn rejecting here, the test
// failed with the error the dialog had caught and shown.
/** @type {(link: string) => Promise<any>} */
let addLink = async () => ADDED
/** @type {string[]} */
const asked = []
vi.mock('@/stores/cardLibraryStore.js', () => ({
  useCardLibraryStore: () => ({
    addLink: link => {
      asked.push(link)
      return addLink(link)
    },
  }),
}))

const mountDialog = () =>
  mount(CardLinkDialog, {
    props: { visible: true },
    global: {
      plugins: [PrimeVue],
      stubs: { Dialog: { template: '<div><slot /><slot name="footer" /></div>' } },
    },
  })

const ADDED = { added: [{ id: 'libcard_1', title: 'Maren' }], duplicates: [], skipped: [] }

describe('CardLinkDialog', () => {
  beforeEach(() => {
    asked.length = 0
    addLink = async () => ADDED
  })

  it('adds the card a link leads to, and closes', async () => {
    const wrapper = mountDialog()
    await wrapper.find('input[data-card-link]').setValue('https://botbooru.com/character/12345')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(asked).toEqual(['https://botbooru.com/character/12345'])
    expect(wrapper.emitted('added')).toEqual([[ADDED]])
    expect(wrapper.emitted('update:visible')).toEqual([[false]])
  })

  it('says under the field why nothing was added, and stays open to fix it', async () => {
    addLink = async () => {
      throw new Error('Web imports from botbooru.com only work in the desktop app.')
    }
    const wrapper = mountDialog()
    await wrapper.find('input[data-card-link]').setValue('https://botbooru.com/character/1')
    await wrapper.find('[data-action="add-link"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-link-problem]').text()).toBe(
      'Web imports from botbooru.com only work in the desktop app.'
    )
    expect(wrapper.emitted('update:visible')).toBeUndefined()

    await wrapper.find('input[data-card-link]').setValue('https://botbooru.com/character/2')
    expect(wrapper.find('[data-link-problem]').exists()).toBe(false)
  })

  it('has nothing to add without a link', () => {
    const wrapper = mountDialog()
    expect(wrapper.find('[data-action="add-link"]').attributes('disabled')).toBeDefined()
  })
})
