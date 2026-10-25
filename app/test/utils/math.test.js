import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * The modules as a page that has typeset nothing yet has them: KaTeX not
 * loaded, nothing remembered.
 */
const fresh = async () => {
  vi.resetModules()
  return {
    ...(await import('vue')),
    ...(await import('../../src/utils/markdown.js')),
    ...(await import('../../src/utils/math.js')),
  }
}

describe('math', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.getSelection()?.removeAllRanges()
  })

  it('shows a formula as written until KaTeX is here, then typesets it', async () => {
    const { computed, renderMarkdown, loadMath, mathReady } = await fresh()
    const html = computed(() => renderMarkdown('Area $\\pi r^2$ here'))

    expect(html.value).toBe('<p>Area $\\pi r^2$ here</p>\n')
    expect(mathReady()).toBe(false)

    // Asking for the formula set KaTeX loading. What rendered it hears when
    // it is here.
    await loadMath()
    expect(mathReady()).toBe(true)
    expect(html.value).toContain('<span class="katex">')
    expect(html.value).toContain('<annotation encoding="application/x-tex">\\pi r^2</annotation>')
  })

  it('loads nothing for text with no math in it', async () => {
    const { renderMarkdown, mathReady } = await fresh()

    renderMarkdown('It cost $5 and $10.')

    expect(mathReady()).toBe(false)
  })

  describe('copying', () => {
    /** @type {Awaited<ReturnType<typeof fresh>>} */
    let modules

    beforeEach(async () => {
      modules = await fresh()
      await modules.loadMath()
    })

    /**
     * Copy what is selected in some rendered markdown, as the browser would.
     *
     * @param {string} markdown
     * @param {(root: HTMLElement) => Range} select
     */
    const copy = (markdown, select) => {
      const root = document.createElement('div')
      root.innerHTML = modules.renderMarkdown(markdown)
      document.body.append(root)
      const selection = /** @type {Selection} */ (window.getSelection())
      selection.removeAllRanges()
      selection.addRange(select(root))
      /** @type {Record<string, string>} */
      const data = {}
      const event = new window.Event('copy', { cancelable: true })
      Object.defineProperty(event, 'clipboardData', {
        value: {
          setData: (/** @type {string} */ type, /** @type {string} */ value) =>
            (data[type] = value),
        },
      })
      document.dispatchEvent(event)
      return { data, prevented: event.defaultPrevented }
    }

    it('copies a formula as its TeX', () => {
      const { data, prevented } = copy('So $x^2$ and\n\n$$y = 1$$', root => {
        const range = document.createRange()
        range.selectNodeContents(root)
        return range
      })

      expect(prevented).toBe(true)
      expect(data['text/plain']).toContain('So $x^2$ and')
      expect(data['text/plain']).toContain('$$y = 1$$')
      expect(data['text/html']).toBe('<p>So $x^2$ and</p>\n<p>$$y = 1$$</p>\n')
    })

    it('takes the whole of a formula a selection starts inside', () => {
      const { data } = copy('So $x^2$ and on', root => {
        const range = document.createRange()
        const inside = /** @type {Element} */ (root.querySelector('.katex-html'))
        range.setStart(inside, 0)
        const end = /** @type {Text} */ (root.querySelector('p')?.lastChild)
        range.setEnd(end, end.length)
        return range
      })

      expect(data['text/plain']).toBe('$x^2$ and on')
    })

    it('leaves a copy with no math in it to the browser', () => {
      const { data, prevented } = copy('Just words', root => {
        const range = document.createRange()
        range.selectNodeContents(root)
        return range
      })

      expect(prevented).toBe(false)
      expect(data).toEqual({})
    })
  })
})
