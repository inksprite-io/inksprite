import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import CommentPopover from '@/components/writer/editor/CommentPopover.vue'

/** @type {import('@vue/test-utils').VueWrapper|null} */
let wrapper = null

const mountPopover = async (props = {}) => {
  wrapper = mount(CommentPopover, {
    props: { text: 'reword this', left: 10, top: 20, ...props },
    attachTo: document.body,
    global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } },
  })
  await flushPromises()
  return wrapper
}

/** Text laid out a line to each line of it, as happy-dom does not lay it out at all. */
const layOutLines = () =>
  vi.spyOn(window.HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
    /** @this {HTMLElement} */
    function () {
      const text = this instanceof window.HTMLTextAreaElement ? this.value : this.textContent || ''
      return text.split('\n').length * 19.2
    }
  )

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('CommentPopover', () => {
  it('shows what was said, to change or resolve', async () => {
    const popover = await mountPopover()
    expect(popover.find('[data-comment-text]').text()).toBe('reword this')

    await popover.find('[data-action="edit-comment"]').trigger('click')
    await popover.find('[data-action="resolve-comment"]').trigger('click')

    expect(popover.emitted('edit')).toHaveLength(1)
    expect(popover.emitted('resolve')).toHaveLength(1)
  })

  it('takes a new comment, trimmed, on Enter', async () => {
    const popover = await mountPopover({ text: '', editing: true })
    const field = popover.find('[data-comment-field]')
    expect(document.activeElement).toBe(field.element)
    expect(popover.find('[data-action="save-comment"]').attributes('aria-label')).toBe(
      'Add comment'
    )

    await field.setValue('  too slow?  ')
    await field.trigger('keydown', { key: 'Enter' })

    expect(popover.emitted('save')).toEqual([['too slow?']])
  })

  it('starts from what was said, for a comment already on the text', async () => {
    const popover = await mountPopover({ editing: true, existing: true })
    expect(popover.find('[data-comment-field]').element.value).toBe('reword this')
    expect(popover.find('[data-action="save-comment"]').attributes('aria-label')).toBe('Save')
  })

  it('will not save an empty comment', async () => {
    const popover = await mountPopover({ text: '', editing: true })
    expect(popover.find('[data-action="save-comment"]').attributes('disabled')).toBeDefined()

    await popover.find('[data-comment-field]').trigger('keydown', { key: 'Enter' })

    expect(popover.emitted('save')).toBeUndefined()
  })

  it('leaves Shift-Enter to start a new line', async () => {
    const popover = await mountPopover({ text: '', editing: true })
    const field = popover.find('[data-comment-field]')
    await field.setValue('one')
    await field.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(popover.emitted('save')).toBeUndefined()
  })

  it('leaves Enter to start a new line on a touch screen, for the button to save', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const popover = await mountPopover({ text: '', editing: true })
    const field = popover.find('[data-comment-field]')
    await field.setValue('one')
    await field.trigger('keydown', { key: 'Enter' })
    expect(popover.emitted('save')).toBeUndefined()

    await popover.find('form').trigger('submit')
    expect(popover.emitted('save')).toEqual([['one']])
  })

  it('shows a comment of more than one line as its lines', async () => {
    const popover = await mountPopover({ text: 'one\ntwo' })
    const shown = popover.find('[data-comment-text]')
    expect(shown.text()).toBe('one\ntwo')
    expect(shown.classes()).toContain('whitespace-pre-line')
  })

  it('puts the buttons beside a comment of one line, and under one that runs on with its icon', async () => {
    layOutLines()
    const popover = await mountPopover({ text: 'one' })
    expect(popover.attributes('data-stacked')).toBeUndefined()
    expect(popover.find('.pi-comment').classes()).not.toContain('row-start-2')

    await popover.setProps({ text: 'one\ntwo' })
    await flushPromises()
    expect(popover.attributes('data-stacked')).toBeDefined()
    expect(popover.find('.pi-comment').classes()).toContain('row-start-2')
  })

  it('moves the buttons under the field once what is written runs on, and back', async () => {
    layOutLines()
    const popover = await mountPopover({ text: '', editing: true })
    const field = popover.find('[data-comment-field]')
    expect(popover.attributes('data-stacked')).toBeUndefined()

    await field.setValue('one\ntwo')
    await flushPromises()
    expect(popover.attributes('data-stacked')).toBeDefined()

    await field.setValue('one')
    await flushPromises()
    expect(popover.attributes('data-stacked')).toBeUndefined()
  })

  it('keeps the width of the comment it was opened on, and no other', async () => {
    vi.spyOn(window.HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(402)
    const popover = await mountPopover({ text: 'a comment as wide as the box' })

    await popover.setProps({ editing: true, existing: true })
    await flushPromises()
    expect(popover.element.style.minWidth).toBe('402px')

    await popover.setProps({ editing: false })
    await flushPromises()
    expect(popover.element.style.minWidth).toBe('')
  })

  it('opens a new comment at its own width', async () => {
    vi.spyOn(window.HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(402)
    const popover = await mountPopover({ text: '', editing: true })
    expect(popover.element.style.minWidth).toBe('')
  })

  it('lets go of the selection in the text as the field opens', async () => {
    const text = document.createElement('p')
    text.textContent = 'a passage'
    document.body.appendChild(text)
    const range = document.createRange()
    range.selectNodeContents(text)
    window.getSelection().addRange(range)

    await mountPopover({ text: '', editing: true })

    const selection = window.getSelection()
    expect(selection.rangeCount === 0 || !text.contains(selection.anchorNode)).toBe(true)
    text.remove()
  })

  it('keeps the field and the comment at full size on a phone, which iOS would zoom', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390)
    const field = (await mountPopover({ text: '', editing: true })).find('[data-comment-field]')
    expect(field.classes()).toContain('!text-base/[1.5rem]')
    wrapper.unmount()

    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280)
    const shown = (await mountPopover()).find('[data-comment-text]')
    expect(shown.classes()).toContain('text-[0.9375rem]/[1.375rem]')
  })

  it('goes back to the text on Cancel', async () => {
    const popover = await mountPopover({ text: '', editing: true })
    await popover.find('[data-action="cancel-comment"]').trigger('click')
    expect(popover.emitted('close')).toEqual([[true]])
  })

  it('goes back to the text on Escape, and goes away when the focus does', async () => {
    const popover = await mountPopover({ text: '', editing: true })
    await popover.find('[data-comment-field]').trigger('keydown', { key: 'Escape' })
    expect(popover.emitted('close')).toEqual([[true]])

    const elsewhere = document.createElement('input')
    document.body.appendChild(elsewhere)
    elsewhere.focus()
    expect(popover.emitted('close')).toEqual([[true], [false]])
    elsewhere.remove()
  })
})
