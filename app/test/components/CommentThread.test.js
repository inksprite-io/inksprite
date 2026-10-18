import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import CommentThread from '@/components/writer/comments/CommentThread.vue'

/** @type {import('@vue/test-utils').VueWrapper|null} */
let wrapper = null

const POSTS = [
  { author: 'writer', text: 'Does this sentence make sense?' },
  { author: 'model', text: 'Yes, but say a bit more.' },
  { author: 'writer', text: 'Which part?' },
]

const mountThread = async (props = {}) => {
  wrapper = mount(CommentThread, {
    props: { passage: 'The ferry left at noon.', posts: POSTS, ...props },
    attachTo: document.body,
    global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } },
  })
  await flushPromises()
  return wrapper
}

/** Open a post's menu. */
const openMenu = async (thread, index) => {
  await thread
    .findAll('[data-comment-post]')
    [index].find('[data-action="post-menu"]')
    .trigger('click')
  await flushPromises()
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
})

describe('CommentThread', () => {
  it('shows the passage with Resolve, then each post under its name', async () => {
    const thread = await mountThread()
    expect(thread.find('[data-comment-passage]').text()).toBe('The ferry left at noon.')
    const posts = thread.findAll('[data-comment-post]')
    expect(posts.map(post => post.find('[data-comment-author]').text())).toEqual([
      'You',
      'Assistant',
      'You',
    ])
    expect(posts.map(post => post.find('[data-comment-body]').text())).toEqual([
      'Does this sentence make sense?',
      'Yes, but say a bit more.',
      'Which part?',
    ])
    // The name is shown for a comment alone too.
    wrapper.unmount()
    const alone = await mountThread({ posts: POSTS.slice(0, 1) })
    expect(alone.find('[data-comment-author]').text()).toBe('You')

    await alone.find('[data-action="resolve-comment"]').trigger('click')
    expect(alone.emitted('resolve')).toHaveLength(1)
    // Resolving is not picking the thread.
    expect(alone.emitted('activate')).toBeUndefined()
  })

  it('offers Reopen in place of Resolve once resolved, and strikes through a passage gone', async () => {
    const resolved = await mountThread({ state: 'resolved' })
    expect(resolved.find('[data-action="resolve-comment"]').exists()).toBe(false)
    await resolved.find('[data-action="reopen-comment"]').trigger('click')
    expect(resolved.emitted('reopen')).toHaveLength(1)
    wrapper.unmount()

    const stale = await mountThread({ state: 'stale' })
    expect(stale.find('[data-comment-passage] s').text()).toBe('The ferry left at noon.')
  })

  it('is picked by a click, and answered once picked', async () => {
    const thread = await mountThread()
    expect(thread.find('[data-reply-field]').exists()).toBe(false)
    await thread.find('[data-comment-body]').trigger('click')
    expect(thread.emitted('activate')).toHaveLength(1)

    await thread.setProps({ active: true, autofocus: true })
    await flushPromises()
    const field = thread.find('[data-reply-field]')
    expect(document.activeElement).toBe(field.element)

    await field.setValue('  The timetable.  ')
    await field.trigger('keydown', { key: 'Enter' })
    expect(thread.emitted('reply')).toEqual([['The timetable.']])
    expect(field.element.value).toBe('')
    // A click in the field is not a pick of the thread.
    await field.trigger('click')
    expect(thread.emitted('activate')).toHaveLength(1)

    await field.trigger('keydown', { key: 'Escape' })
    expect(thread.emitted('close')).toHaveLength(1)
  })

  it("offers Edit and Delete on the writer's posts, and Delete alone on the model's", async () => {
    const thread = await mountThread()
    await openMenu(thread, 0)
    const items = () =>
      thread.findAll('[data-post-menu] [role="menuitem"]').map(item => item.text())
    expect(items()).toEqual(['Edit', 'Delete'])

    await openMenu(thread, 1)
    expect(items()).toEqual(['Delete'])

    // Nothing to change in a resolved thread.
    await thread.setProps({ state: 'resolved' })
    await openMenu(thread, 1)
    await openMenu(thread, 0)
    expect(items()).toEqual(['Delete'])
  })

  it("changes a writer's post in place", async () => {
    const thread = await mountThread()
    await openMenu(thread, 2)
    await thread.find('[data-action="edit-post"]').trigger('click')
    await flushPromises()

    expect(thread.emitted('activate')).toHaveLength(1)
    const field = thread.find('[data-edit-field]')
    expect(field.element.value).toBe('Which part?')
    expect(document.activeElement).toBe(field.element)

    await field.setValue('Which part, exactly?')
    await field.trigger('keydown', { key: 'Enter' })
    expect(thread.emitted('edit')).toEqual([[2, 'Which part, exactly?']])
    expect(thread.find('[data-edit-field]').exists()).toBe(false)
  })

  it('leaves a post as it was on Escape', async () => {
    const thread = await mountThread()
    await openMenu(thread, 0)
    await thread.find('[data-action="edit-post"]').trigger('click')
    await flushPromises()
    await thread.find('[data-edit-field]').trigger('keydown', { key: 'Escape' })
    expect(thread.find('[data-edit-field]').exists()).toBe(false)
    expect(thread.emitted('edit')).toBeUndefined()
    expect(thread.emitted('close')).toBeUndefined()
  })

  it('deletes a post by its place: the first is the comment', async () => {
    const thread = await mountThread()
    await openMenu(thread, 1)
    await thread.find('[data-action="delete-post"]').trigger('click')
    await openMenu(thread, 0)
    await thread.find('[data-action="delete-post"]').trigger('click')
    expect(thread.emitted('delete')).toEqual([[1], [0]])
  })

  it('closes its menu on a press elsewhere, or on Escape', async () => {
    const thread = await mountThread()
    await openMenu(thread, 0)
    expect(thread.find('[data-post-menu]').exists()).toBe(true)
    document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(thread.find('[data-post-menu]').exists()).toBe(false)

    await openMenu(thread, 0)
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(thread.find('[data-post-menu]').exists()).toBe(false)

    // The dots that opened it close it.
    await openMenu(thread, 0)
    await openMenu(thread, 0)
    expect(thread.find('[data-post-menu]').exists()).toBe(false)
  })

  it('shows Cancel and Send under the reply field once something is written', async () => {
    const thread = await mountThread({ active: true })
    expect(thread.find('[data-action="send-reply"]').exists()).toBe(false)
    const field = thread.find('[data-reply-field]')
    await field.setValue('The timetable.')
    expect(thread.find('[data-action="send-reply"]').exists()).toBe(true)

    await thread.find('[data-action="cancel-reply"]').trigger('click')
    expect(field.element.value).toBe('')
    expect(thread.emitted('close')).toHaveLength(1)
  })

  it('keeps the focus in a picked thread when a change is left or kept', async () => {
    const thread = await mountThread({ active: true })
    await openMenu(thread, 0)
    await thread.find('[data-action="edit-post"]').trigger('click')
    await flushPromises()
    await thread.find('[data-action="cancel-edit"]').trigger('click')
    await flushPromises()
    expect(thread.find('[data-edit-field]').exists()).toBe(false)
    expect(document.activeElement).toBe(thread.find('[data-reply-field]').element)
  })

  it('shows every post of a thread', async () => {
    const thread = await mountThread()
    expect(thread.findAll('[data-comment-post]')).toHaveLength(3)
  })
})
