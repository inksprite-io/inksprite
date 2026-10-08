/* global HTMLAnchorElement, MouseEvent */
import { describe, it, expect, vi, afterEach } from 'vitest'

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }))

import { openLinkClicked, openUrl } from '@/platform/open.js'

/** The links the page opens itself, by clicking one it made. */
const clicked = () => {
  /** @type {HTMLAnchorElement[]} */
  const anchors = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    anchors.push(this)
  })
  return anchors
}

afterEach(() => {
  delete globalThis.__TAURI_INTERNALS__
  vi.restoreAllMocks()
  tauri.invoke.mockReset()
  document.body.innerHTML = ''
})

describe('openUrl', () => {
  it('opens a web link in a new tab with no opener, in a browser', async () => {
    const anchors = clicked()
    expect(await openUrl('https://example.com/page')).toBe(true)
    expect(anchors).toHaveLength(1)
    expect(anchors[0].href).toBe('https://example.com/page')
    expect(anchors[0].target).toBe('_blank')
    expect(anchors[0].rel).toBe('noopener noreferrer')
  })

  it('hands a mail link to the mail app, not a tab', async () => {
    const anchors = clicked()
    await openUrl('mailto:someone@example.com')
    expect(anchors[0].target).toBe('')
  })

  it('opens nothing but web and mail links', async () => {
    const anchors = clicked()
    expect(await openUrl('javascript:alert(1)')).toBe(false)
    expect(await openUrl('file:///etc/passwd')).toBe(false)
    expect(anchors).toHaveLength(0)
  })

  it('asks the desktop side to open it in the system browser', async () => {
    globalThis.__TAURI_INTERNALS__ = {}
    const anchors = clicked()
    tauri.invoke.mockResolvedValue(undefined)
    await openUrl('https://example.com/page')
    expect(tauri.invoke).toHaveBeenCalledWith('open_in_browser', {
      url: 'https://example.com/page',
    })
    expect(anchors).toHaveLength(0)
  })
})

describe('openLinkClicked', () => {
  /**
   * Click a link with these attributes, inside `inside` if given, and say
   * whether the app took the click.
   */
  const click = (attributes, { inside = null, ...init } = {}) => {
    const anchor = document.createElement('a')
    for (const [name, value] of Object.entries(attributes)) anchor.setAttribute(name, value)
    anchor.textContent = 'a link'
    ;(inside ?? document.body).append(anchor)
    let taken = false
    // Last in line, after the app's: note what it did, then keep the test
    // page where it is.
    const after = event => {
      taken = event.defaultPrevented
      event.preventDefault()
    }
    document.addEventListener('click', openLinkClicked)
    window.addEventListener('click', after)
    anchor.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
    )
    document.removeEventListener('click', openLinkClicked)
    window.removeEventListener('click', after)
    return taken
  }

  it("opens a link to another site in a new tab, never in the app's own", () => {
    const anchors = clicked()
    expect(click({ href: 'https://example.com/elsewhere' })).toBe(true)
    expect(anchors[0].href).toBe('https://example.com/elsewhere')
  })

  it("leaves the app's own links to the router", () => {
    expect(click({ href: '/project/one' })).toBe(false)
  })

  it('leaves what a browser already sends elsewhere', () => {
    expect(click({ href: 'https://example.com', target: '_blank' })).toBe(false)
    expect(click({ href: 'mailto:someone@example.com' })).toBe(false)
    expect(click({ href: 'https://example.com' }, { metaKey: true })).toBe(false)
  })

  it('leaves a link in text being written', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    document.body.append(editor)
    expect(click({ href: 'https://example.com' }, { inside: editor })).toBe(false)
  })

  it('opens every outside link in the system browser from the desktop window', async () => {
    globalThis.__TAURI_INTERNALS__ = {}
    tauri.invoke.mockResolvedValue(undefined)
    // One at a time: a mocked module imported twice at once can come back
    // unmocked the second time.
    expect(click({ href: 'https://example.com', target: '_blank' })).toBe(true)
    await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledTimes(1))
    expect(click({ href: 'mailto:someone@example.com' })).toBe(true)
    await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledTimes(2))
    expect(tauri.invoke).toHaveBeenCalledWith('open_in_browser', { url: 'https://example.com/' })
    expect(tauri.invoke).toHaveBeenCalledWith('open_in_browser', {
      url: 'mailto:someone@example.com',
    })
  })
})
