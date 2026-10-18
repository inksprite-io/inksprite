import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import CommentsPanel from '@/components/writer/comments/CommentsPanel.vue'

const { comments } = vi.hoisted(() => ({ comments: {} }))
vi.mock('@/composables/useComments.js', () => ({ useComments: () => comments }))

const said = (text, author = 'writer') => ({ author, text, created: 1 })
const listed = (id, passage, state, ...posts) => ({
  id,
  passage,
  state,
  thread: { status: state === 'resolved' ? 'resolved' : 'open', quote: passage, posts },
})

const GROUPS = [
  {
    documentId: 'doc_1',
    path: 'Chapters/One',
    comments: [
      listed('cabcd1', 'cold and narrow', 'open', said('reword this')),
      listed('cabcd2', 'walked', 'open', said('too slow?'), said('Shortened it.', 'model')),
    ],
    stale: [listed('cgone1', 'old lines', 'stale', said('check'))],
    resolved: [listed('cdone1', 'done', 'resolved', said('fixed'))],
  },
  {
    documentId: 'doc_2',
    path: 'Notes',
    comments: [listed('cabcd3', 'x', 'open', said('y'))],
    stale: [],
    resolved: [],
  },
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
    comments.leave = vi.fn()
    comments.resolve = vi.fn()
    comments.reply = vi.fn()
    comments.editPost = vi.fn()
    comments.reopen = vi.fn(() => true)
    comments.deletePost = vi.fn()
    comments.draft = ref(null)
    comments.replyRequest = ref(0)
    comments.addDraft = vi.fn()
    comments.cancelDraft = vi.fn()
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

  /** Pick a thread, as a click on what was said picks it. */
  const pickEntry = (wrapper, id) =>
    wrapper.find(`[data-comment-entry="${id}"] [data-comment-body]`).trigger('click')

  it('goes to a comment, opening its document, and makes it the current one', async () => {
    const wrapper = mountPanel()
    await pickEntry(wrapper, 'cabcd2')

    expect(comments.goTo).toHaveBeenCalledWith('doc_1', 'cabcd2')
    expect(wrapper.emitted('open-document')).toEqual([['doc_1']])
  })

  it('opens the field to reply under the current comment alone, however it came to be', async () => {
    comments.current = ref({ documentId: 'doc_1', id: 'cabcd2', seq: 1 })
    const wrapper = mountPanel()
    const fields = () =>
      wrapper
        .findAll('[data-reply-field]')
        .map(field => field.element.closest('[data-comment-entry]').dataset.commentEntry)
    expect(fields()).toEqual(['cabcd2'])

    // Picked again, it stays as it is.
    await pickEntry(wrapper, 'cabcd2')
    expect(comments.goTo).not.toHaveBeenCalled()
    expect(fields()).toEqual(['cabcd2'])

    // Another made current takes the field.
    comments.current.value = { documentId: 'doc_1', id: 'cabcd1', seq: 2 }
    await wrapper.vm.$nextTick()
    expect(fields()).toEqual(['cabcd1'])

    // Escape in it puts it down.
    await wrapper
      .find('[data-comment-entry="cabcd1"] [data-reply-field]')
      .trigger('keydown', { key: 'Escape' })
    expect(comments.leave).toHaveBeenCalledWith('doc_1')
  })

  it('shows every post of a thread', () => {
    comments.groups = ref([
      {
        ...GROUPS[0],
        comments: [
          listed(
            'cabcd1',
            'cold and narrow',
            'open',
            said('one'),
            said('two', 'model'),
            said('three')
          ),
        ],
      },
    ])
    const wrapper = mountPanel()
    expect(wrapper.findAll('[data-comment-entry="cabcd1"] [data-comment-post]')).toHaveLength(3)
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

  it('says who said each thing', () => {
    const wrapper = mountPanel()
    const authors = entry =>
      wrapper.findAll(`[data-comment-entry="${entry}"] [data-comment-author]`).map(a => a.text())
    expect(authors('cabcd1')).toEqual(['You'])
    expect(authors('cabcd2')).toEqual(['You', 'Assistant'])
  })

  it('strikes through a comment whose passage is gone, and opens no document for it', async () => {
    const wrapper = mountPanel()
    const stale = wrapper.find('[data-comment-entry="cgone1"]')
    expect(stale.find('[data-comment-passage] s').text()).toBe('old lines')
    await pickEntry(wrapper, 'cgone1')
    expect(comments.goTo).toHaveBeenCalledWith('doc_1', 'cgone1')
    expect(wrapper.emitted('open-document')).toBeUndefined()
    await stale.find('[data-action="resolve-comment"]').trigger('click')
    expect(comments.resolve).toHaveBeenCalledWith('doc_1', 'cgone1')
  })

  it('answers a comment where it is listed', async () => {
    comments.current = ref({ documentId: 'doc_1', id: 'cabcd1', seq: 1 })
    const wrapper = mountPanel()
    const entry = () => wrapper.find('[data-comment-entry="cabcd1"]')
    await entry().find('[data-reply-field]').setValue('Done.')
    await entry().find('[data-reply-field]').trigger('keydown', { key: 'Enter' })
    expect(comments.reply).toHaveBeenCalledWith('doc_1', 'cabcd1', 'Done.')
  })

  it("changes one of the writer's posts from its menu, and deletes a reply alone", async () => {
    const wrapper = mountPanel()
    const entry = () => wrapper.find('[data-comment-entry="cabcd2"]')
    const menuOf = async index => {
      await entry()
        .findAll('[data-comment-post]')
        [index].find('[data-action="post-menu"]')
        .trigger('click')
    }

    await menuOf(0)
    await entry().find('[data-action="edit-post"]').trigger('click')
    const field = entry().find('[data-edit-field]')
    expect(field.element.value).toBe('too slow?')
    await field.setValue('too slow, surely?')
    await field.trigger('keydown', { key: 'Enter' })
    expect(comments.editPost).toHaveBeenCalledWith('doc_1', 'cabcd2', 0, 'too slow, surely?')

    await menuOf(1)
    expect(entry().find('[data-action="edit-post"]').exists()).toBe(false)
    await entry().find('[data-action="delete-post"]').trigger('click')
    expect(comments.deletePost).toHaveBeenCalledWith('doc_1', 'cabcd2', 1)
  })

  it('lists the resolved ones when asked, to reopen or delete', async () => {
    const wrapper = mountPanel()
    expect(wrapper.find('[data-comment-entry="cdone1"]').exists()).toBe(false)
    await wrapper.find('[data-action="show-resolved"]').trigger('click')
    const done = () => wrapper.find('[data-comment-entry="cdone1"]')
    expect(done().attributes('data-state')).toBe('resolved')
    expect(done().find('[data-action="resolve-comment"]').exists()).toBe(false)

    comments.reopen.mockReturnValueOnce(false)
    await done().find('[data-action="reopen-comment"]').trigger('click')
    expect(comments.reopen).toHaveBeenCalledWith('doc_1', 'cdone1')
    expect(done().find('[data-notice="unplaced"]').exists()).toBe(true)

    await done().find('[data-action="post-menu"]').trigger('click')
    await done().find('[data-action="delete-post"]').trigger('click')
    expect(comments.deletePost).toHaveBeenCalledWith('doc_1', 'cdone1', 0)
  })

  it("writes a new comment in its place among its document's comments, and scrolls to it", async () => {
    const scrolled = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrolled
    comments.draft = ref({ documentId: 'doc_1', passage: 'the old pier' })
    comments.groups = ref([{ ...GROUPS[0], draftAt: 1 }, GROUPS[1]])
    const wrapper = mountPanel()
    await flushPromises()

    const order = wrapper
      .findAll('[data-comments-document="doc_1"] [data-comment-entry]')
      .map(entry => entry.attributes('data-comment-entry'))
    expect(order).toEqual(['cabcd1', 'draft', 'cabcd2', 'cgone1'])
    expect(scrolled).toHaveBeenCalledWith({ block: 'center' })

    const draft = wrapper.find('[data-comment-entry="draft"]')
    expect(draft.find('[data-comment-passage]').text()).toBe('the old pier')
    await draft.find('[data-draft-field]').setValue('Which pier?')
    await draft.find('[data-draft-field]').trigger('keydown', { key: 'Enter' })
    expect(comments.addDraft).toHaveBeenCalledWith('Which pier?')

    await draft.find('[data-action="cancel-comment"]').trigger('click')
    expect(comments.cancelDraft).toHaveBeenCalled()
    delete window.HTMLElement.prototype.scrollIntoView
  })

  it('lists a document with no comments yet while one is being written on it', () => {
    comments.draft = ref({ documentId: 'doc_3', passage: 'the old pier' })
    comments.groups = ref([
      ...GROUPS,
      { documentId: 'doc_3', path: 'Fresh', comments: [], stale: [], resolved: [], draftAt: 0 },
    ])
    const wrapper = mountPanel()
    expect(
      wrapper.find('[data-comments-document="doc_3"] [data-comment-entry="draft"]').exists()
    ).toBe(true)
  })

  it("gives the current comment's reply field the focus when a reply is asked for", async () => {
    comments.current = ref({ documentId: 'doc_1', id: 'cabcd2', seq: 1 })
    const wrapper = mount(CommentsPanel, {
      props: { storyId: 'story_1', documentId: 'doc_1' },
      attachTo: document.body,
      global: {
        plugins: [PrimeVue],
        directives: { tooltip: Tooltip },
        stubs: { ScrollPanel: { template: '<div><slot /></div>' } },
      },
    })
    comments.replyRequest.value++
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(document.activeElement).toBe(
      wrapper.find('[data-comment-entry="cabcd2"] [data-reply-field]').element
    )
    wrapper.unmount()
  })

  it('says there are no open ones when the only ones are resolved', () => {
    comments.groups = ref([{ ...GROUPS[0], comments: [], stale: [] }])
    expect(mountPanel().find('[data-notice="no-comments"]').text()).toBe(
      'No open comments in this project.'
    )
  })

  it('marks the current comment', () => {
    comments.current = ref({ documentId: 'doc_1', id: 'cabcd2', seq: 1 })
    const wrapper = mountPanel()
    expect(wrapper.find('[data-comment-entry="cabcd2"]').classes()).toContain('ring-2')
    expect(wrapper.find('[data-comment-entry="cabcd1"]').classes()).not.toContain('ring-2')
  })
})
