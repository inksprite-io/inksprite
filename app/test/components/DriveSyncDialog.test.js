import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { shallowRef } from 'vue'
import PrimeVue from 'primevue/config'
import DriveSyncDialog from '@/components/writer/editor/DriveSyncDialog.vue'
import { parseMarkdown } from '@/editor/markdown.js'

const question = vi.hoisted(() => ({ ref: null }))
vi.mock('@/composables/useDriveSync.js', () => ({
  useSyncQuestion: () => ({ question: question.ref }),
}))

/** The dialog as its header and contents, shown while it is visible. */
const Dialog = {
  props: ['visible', 'header'],
  template:
    '<div v-if="visible" data-stub-dialog><h2>{{ header }}</h2><slot /><slot name="footer" /></div>',
}

const mountDialog = () =>
  mount(DriveSyncDialog, { global: { plugins: [PrimeVue], stubs: { Dialog } } })

/** Blocks, from markdown. */
const blocks = markdown => {
  const out = []
  parseMarkdown(markdown).forEach(node => out.push(node))
  return out
}

describe('DriveSyncDialog', () => {
  beforeEach(() => {
    question.ref = shallowRef(null)
  })

  it('shows nothing while no sync asks anything', () => {
    expect(mountDialog().find('[data-stub-dialog]').exists()).toBe(false)
  })

  it('asks a first sync which side to take whole', async () => {
    const answer = vi.fn()
    question.ref.value = { kind: 'first', title: 'Ch. 3', answer }
    const wrapper = mountDialog()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('h2').text()).toBe('First sync')
    expect(wrapper.find('[data-sync-first]').text()).toContain('“Ch. 3”')
    await wrapper.find('[data-sync-theirs]').trigger('click')
    expect(answer).toHaveBeenCalledWith('theirs')
    await wrapper.find('[data-sync-mine]').trigger('click')
    expect(answer).toHaveBeenLastCalledWith('mine')
    await wrapper.find('[data-sync-cancel]').trigger('click')
    expect(answer).toHaveBeenLastCalledWith(null)
  })

  it('shows each clash both ways, the words that differ marked, and answers the sides chosen', async () => {
    const answer = vi.fn()
    question.ref.value = {
      kind: 'clashes',
      title: 'Ch. 3',
      clashes: [
        {
          base: blocks('The ferry left at six.'),
          mine: blocks('The ferry left at seven.'),
          theirs: blocks('The ferry left at eight.'),
        },
        { base: blocks('It rained.'), mine: [], theirs: blocks('It rained all day.') },
      ],
      answer,
    }
    const wrapper = mountDialog()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('h2').text()).toBe('Both changed the same words')
    const first = wrapper.find('[data-sync-clash="0"]')
    expect(first.find('[data-sync-side="mine"] mark').text()).toBe('seven.')
    expect(first.find('[data-sync-side="theirs"] mark').text()).toBe('eight.')
    expect(first.find('[data-sync-side="mine"]').attributes('aria-pressed')).toBe('true')
    const second = wrapper.find('[data-sync-clash="1"]')
    expect(second.find('[data-sync-side="mine"]').text()).toContain('Deleted')

    await second.find('[data-sync-side="theirs"]').trigger('click')
    expect(second.find('[data-sync-side="theirs"]').attributes('aria-pressed')).toBe('true')
    await wrapper.find('[data-sync-go]').trigger('click')
    expect(answer).toHaveBeenCalledWith(['mine', 'theirs'])
  })
})
