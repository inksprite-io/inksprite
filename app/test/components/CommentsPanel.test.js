import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import CommentsPanel from '@/components/writer/comments/CommentsPanel.vue'

const { comments } = vi.hoisted(() => ({ comments: {} }))
vi.mock('@/composables/useComments.js', () => ({ useComments: () => comments }))

const GROUPS = [
  {
    documentId: 'doc_1',
    path: 'Chapters/One',
    comments: [
      { id: 'cabcd1', passage: 'cold and narrow', comment: 'reword this' },
      { id: 'cabcd2', passage: 'walked', comment: 'too slow?' },
    ],
  },
  { documentId: 'doc_2', path: 'Notes', comments: [{ id: 'cabcd3', passage: 'x', comment: 'y' }] },
]

const mountPanel = (props = {}) =>
  mount(CommentsPanel, {
    props: { storyId: 'story_1', documentId: 'doc_1', ...props },
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: Tooltip },
      stubs: { ScrollPanel: { template: '<div><slot /></div>' } },
    },
  })

describe('CommentsPanel', () => {
  beforeEach(() => {
    comments.groups = ref(GROUPS)
    comments.current = ref(null)
    comments.goTo = vi.fn()
    comments.resolve = vi.fn()
  })

  it('lists the comments by document, each with its passage and what was said', () => {
    const wrapper = mountPanel()
    const sections = wrapper.findAll('[data-comments-document]')

    expect(sections.map(section => section.find('button').text())).toEqual([
      'Chapters/One',
      'Notes',
    ])
    // The document open in the editor is marked.
    expect(sections.map(section => section.find('button').attributes('data-open'))).toEqual([
      'true',
      undefined,
    ])
    const first = wrapper.find('[data-comment-entry="cabcd1"]')
    expect(first.text()).toContain('cold and narrow')
    expect(first.text()).toContain('reword this')
  })

  it('says so when there are none', () => {
    comments.groups = ref([])
    expect(mountPanel().find('[data-notice="no-comments"]').exists()).toBe(true)
  })

  it('goes to a comment, opening its document', async () => {
    const wrapper = mountPanel()
    await wrapper
      .find('[data-comment-entry="cabcd2"] [data-action="go-to-comment"]')
      .trigger('click')

    expect(comments.goTo).toHaveBeenCalledWith('doc_1', 'cabcd2')
    expect(wrapper.emitted('open-document')).toEqual([['doc_1']])
  })

  it('cuts a comment short until it is picked, and again when it is picked again', async () => {
    const wrapper = mountPanel()
    const entry = () => wrapper.find('[data-comment-entry="cabcd2"]')
    expect(entry().find('[data-comment-said]').classes()).toContain('line-clamp-4')

    await entry().find('[data-action="go-to-comment"]').trigger('click')
    expect(entry().find('[data-comment-said]').classes()).not.toContain('line-clamp-4')
    expect(wrapper.find('[data-comment-entry="cabcd1"] [data-comment-said]').classes()).toContain(
      'line-clamp-4'
    )

    await entry().find('[data-action="go-to-comment"]').trigger('click')
    expect(entry().find('[data-comment-said]').classes()).toContain('line-clamp-4')
    expect(comments.goTo).toHaveBeenCalledTimes(2)
  })

  it('opens a document from its name', async () => {
    const wrapper = mountPanel()
    await wrapper.find('[data-comments-document="doc_2"] button').trigger('click')
    expect(wrapper.emitted('open-document')).toEqual([['doc_2']])
    expect(comments.goTo).not.toHaveBeenCalled()
  })

  it('resolves one without going to it', async () => {
    const wrapper = mountPanel()
    await wrapper
      .find('[data-comment-entry="cabcd3"] [data-action="resolve-comment"]')
      .trigger('click')

    expect(comments.resolve).toHaveBeenCalledWith('doc_2', 'cabcd3')
    expect(wrapper.emitted('open-document')).toBeUndefined()
  })

  it('marks the current comment', () => {
    comments.current = ref({ documentId: 'doc_1', id: 'cabcd2', seq: 1 })
    const wrapper = mountPanel()
    expect(wrapper.find('[data-comment-entry="cabcd2"]').classes()).toContain('ring-2')
    expect(wrapper.find('[data-comment-entry="cabcd1"]').classes()).not.toContain('ring-2')
  })
})
