import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import CommentBar from '@/components/writer/editor/CommentBar.vue'

/** @type {import('@vue/test-utils').VueWrapper|null} */
let wrapper = null

const POSTS = [
  { author: 'writer', text: 'reword this' },
  { author: 'model', text: 'Shortened it.' },
]

/** The thread of a comment on the text, showing under the line. */
const mountThread = async (props = {}) => {
  wrapper = mount(CommentBar, {
    props: { thread: true, passage: 'cold and narrow', posts: POSTS, ...props },
    attachTo: document.body,
    global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } },
  })
  await flushPromises()
  return wrapper
}

/** The field for a new comment. */
const mountField = async (props = {}) => {
  wrapper = mount(CommentBar, {
    props: { editing: true, ...props },
    attachTo: document.body,
    global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } },
  })
  await flushPromises()
  return wrapper
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('CommentBar', () => {
  describe('a comment on the text', () => {
    it('shows its thread, and leaves the caret in the passage on a press', async () => {
      const popover = await mountThread()
      expect(popover.find('[data-comment-passage]').text()).toBe('cold and narrow')
      expect(popover.findAll('[data-comment-body]').map(body => body.text())).toEqual([
        'reword this',
        'Shortened it.',
      ])
      expect(popover.find('[data-reply-field]').exists()).toBe(false)

      const press = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true })
      popover.find('[data-comment-body]').element.dispatchEvent(press)
      expect(press.defaultPrevented).toBe(true)
    })

    it('asks to be picked on a click, and once picked answers with the focus', async () => {
      const popover = await mountThread()
      await popover.find('[data-comment-body]').trigger('click')
      expect(popover.emitted('activate')).toHaveLength(1)

      await popover.setProps({ editing: true })
      await flushPromises()
      const field = popover.find('[data-reply-field]')
      expect(document.activeElement).toBe(field.element)
      // Picked, a press in it is a press: the field takes the caret.
      const press = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true })
      field.element.dispatchEvent(press)
      expect(press.defaultPrevented).toBe(false)

      await field.setValue('Shorter still.')
      await field.trigger('keydown', { key: 'Enter' })
      expect(popover.emitted('reply')).toEqual([['Shorter still.']])
    })

    it('passes on resolving, changing and deleting', async () => {
      const popover = await mountThread()
      await popover.find('[data-action="resolve-comment"]').trigger('click')
      expect(popover.emitted('resolve')).toHaveLength(1)

      await popover.find('[data-action="post-menu"]').trigger('click')
      await popover.find('[data-action="delete-post"]').trigger('click')
      expect(popover.emitted('delete')).toEqual([[0]])
    })

    it('goes away when picked and the focus or a press goes elsewhere', async () => {
      const popover = await mountThread({ editing: true })
      const elsewhere = document.createElement('input')
      document.body.appendChild(elsewhere)
      elsewhere.focus()
      expect(popover.emitted('close')).toEqual([[false]])

      elsewhere.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
      expect(popover.emitted('close')).toEqual([[false], [false]])
      elsewhere.remove()

      // Escape goes back to the text.
      await popover.find('[data-reply-field]').trigger('keydown', { key: 'Escape' })
      expect(popover.emitted('close').at(-1)).toEqual([true])
    })

    it('keeps the thread at full size on a phone, which iOS would zoom', async () => {
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390)
      const popover = await mountThread({ editing: true })
      expect(popover.find('[data-comment-said]').classes()).toContain('text-base/[1.5rem]')
      expect(popover.find('[data-reply-field]').classes()).toContain('!text-base/[1.5rem]')
    })
  })

  describe('a new comment', () => {
    it('takes it, trimmed, on Enter', async () => {
      const popover = await mountField()
      const field = popover.find('[data-comment-field]')
      expect(document.activeElement).toBe(field.element)
      expect(popover.find('[data-action="save-comment"]').attributes('aria-label')).toBe(
        'Add comment'
      )

      await field.setValue('  too slow?  ')
      await field.trigger('keydown', { key: 'Enter' })

      expect(popover.emitted('save')).toEqual([['too slow?']])
    })

    it('will not save an empty comment', async () => {
      const popover = await mountField()
      expect(popover.find('[data-action="save-comment"]').attributes('disabled')).toBeDefined()

      await popover.find('[data-comment-field]').trigger('keydown', { key: 'Enter' })

      expect(popover.emitted('save')).toBeUndefined()
    })

    it('leaves Shift-Enter to start a new line', async () => {
      const popover = await mountField()
      const field = popover.find('[data-comment-field]')
      await field.setValue('one')
      await field.trigger('keydown', { key: 'Enter', shiftKey: true })
      expect(popover.emitted('save')).toBeUndefined()
    })

    it('leaves Enter to start a new line on a touch screen, for the button to save', async () => {
      vi.stubGlobal('matchMedia', () => ({ matches: true }))
      const popover = await mountField()
      const field = popover.find('[data-comment-field]')
      await field.setValue('one')
      await field.trigger('keydown', { key: 'Enter' })
      expect(popover.emitted('save')).toBeUndefined()

      await popover.find('form').trigger('submit')
      expect(popover.emitted('save')).toEqual([['one']])
    })

    it('keeps its buttons under the field, which has the width', async () => {
      const popover = await mountField()
      const form = popover.find('form')
      expect(form.classes()).toContain('flex-col')
      expect(popover.find('[data-comment-field]').classes()).toContain('w-full')
    })

    it('lets go of the selection in the text as the field opens', async () => {
      const text = document.createElement('p')
      text.textContent = 'a passage'
      document.body.appendChild(text)
      const range = document.createRange()
      range.selectNodeContents(text)
      window.getSelection().addRange(range)

      await mountField()

      const selection = window.getSelection()
      expect(selection.rangeCount === 0 || !text.contains(selection.anchorNode)).toBe(true)
      text.remove()
    })

    it('keeps the field at full size on a phone, which iOS would zoom', async () => {
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390)
      const field = (await mountField()).find('[data-comment-field]')
      expect(field.classes()).toContain('!text-base/[1.5rem]')
    })

    it('goes back to the text on Cancel', async () => {
      const popover = await mountField()
      await popover.find('[data-action="cancel-comment"]').trigger('click')
      expect(popover.emitted('close')).toEqual([[true]])
    })

    it('goes back to the text on Escape, and goes away when the focus does', async () => {
      const popover = await mountField()
      await popover.find('[data-comment-field]').trigger('keydown', { key: 'Escape' })
      expect(popover.emitted('close')).toEqual([[true]])

      const elsewhere = document.createElement('input')
      document.body.appendChild(elsewhere)
      elsewhere.focus()
      expect(popover.emitted('close')).toEqual([[true], [false]])
      elsewhere.remove()
    })
  })
})
