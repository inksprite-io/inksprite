/* global PointerEvent, FocusEvent */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resetWriterPanel, watchWriterPanel, writerPanel } from '@/composables/useWriterPanel.js'

/** The writer's frame: a sidebar, the two panels, and a rail that is neither. */
const frame = ({ sidebarFor = 'editor', editor = true, chat = true } = {}) => {
  document.body.innerHTML = `
    <button data-rail></button>
    <div data-panel-for="${sidebarFor}"><button data-row></button></div>
    <main data-panel="editor"><p data-text>Words</p><input data-field /></main>
    <div data-panel="chat"><textarea data-message></textarea></div>
  `
  const show = (selector, showing) => {
    document.querySelector(selector).getClientRects = () => /** @type {any} */ (showing ? [{}] : [])
  }
  show('[data-panel="editor"]', editor)
  show('[data-panel="chat"]', chat)
  return selector => document.querySelector(selector)
}

/** A click or a touch on something. */
const press = element => element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
/** The focus arriving on something, however it got there. */
const focusOn = element => element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))

describe('useWriterPanel', () => {
  beforeEach(() => {
    watchWriterPanel()
    resetWriterPanel()
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('is the editor until the writer has been anywhere', () => {
    frame()
    expect(writerPanel()).toBe('editor')
  })

  it('is the panel last pressed in', () => {
    const at = frame()
    press(at('[data-message]'))
    expect(writerPanel()).toBe('chat')

    press(at('[data-text]'))
    expect(writerPanel()).toBe('editor')
  })

  it('is the panel the focus last went to, with no press', () => {
    const at = frame()
    focusOn(at('[data-message]'))
    expect(writerPanel()).toBe('chat')

    focusOn(at('[data-field]'))
    expect(writerPanel()).toBe('editor')
  })

  it('takes the outline for the editor, and the list of chats for the chat', () => {
    let at = frame()
    press(at('[data-message]'))
    press(at('[data-row]'))
    expect(writerPanel()).toBe('editor')

    at = frame({ sidebarFor: 'chat' })
    press(at('[data-row]'))
    expect(writerPanel()).toBe('chat')
  })

  it('stays where the writer was through a press anywhere else', () => {
    const at = frame()
    press(at('[data-message]'))
    press(at('[data-rail]'))
    expect(writerPanel()).toBe('chat')
  })

  it('stays in the panel when what was pressed in it has gone from the page', () => {
    const at = frame()
    const message = at('[data-message]')
    press(message)
    message.remove()
    expect(writerPanel()).toBe('chat')
  })

  it('is the other panel when the one the writer was in is not on screen', () => {
    let at = frame({ chat: false })
    press(at('[data-message]'))
    expect(writerPanel()).toBe('editor')

    at = frame({ editor: false })
    press(at('[data-text]'))
    expect(writerPanel()).toBe('chat')
  })
})
