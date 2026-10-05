import { describe, it, expect, afterEach } from 'vitest'
import { isTextField } from '@/utils/focus.js'

const add = html => {
  document.body.insertAdjacentHTML('beforeend', html)
  return /** @type {HTMLElement} */ (document.body.lastElementChild)
}

describe('isTextField', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('knows a field the writer types into', () => {
    expect(isTextField(add('<input type="text">'))).toBe(true)
    expect(isTextField(add('<input>'))).toBe(true)
    expect(isTextField(add('<textarea></textarea>'))).toBe(true)
    expect(isTextField(add('<div contenteditable="true"></div>'))).toBe(true)
  })

  it('knows what is not one', () => {
    expect(isTextField(add('<button type="button">Go</button>'))).toBe(false)
    expect(isTextField(add('<input type="checkbox">'))).toBe(false)
    expect(isTextField(add('<div tabindex="0"></div>'))).toBe(false)
    expect(isTextField(null)).toBe(false)
    expect(isTextField(document.body)).toBe(false)
  })

  it('looks at whatever has the focus when not told', () => {
    const field = add('<input type="text">')
    field.focus()
    expect(isTextField()).toBe(true)
    field.blur()
    expect(isTextField()).toBe(false)
  })
})
