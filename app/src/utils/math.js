/**
 * @module utils/math
 * @description Typesetting the math a model writes, with KaTeX.
 *
 * Models write formulas in TeX, and `utils/markdown.js` finds them; this turns
 * one into HTML. KaTeX is most of a megabyte with its fonts and most chats
 * never need it, so it is loaded the first time a formula is asked for. Until
 * it is here a formula has nothing to show and is left as it was written. It
 * is kept in a ref, so a computed that rendered a formula then renders it
 * again once it arrives.
 *
 * What KaTeX writes is safe to put in the page as long as `trust` stays false:
 * no `\href`, `\url`, `\includegraphics` or `\html…`, and a color is checked
 * before it goes into a style. A formula KaTeX cannot read has nothing to show
 * either.
 *
 * Copying out of typeset math copies its TeX, between the delimiters it came
 * in, rather than the glyphs and the MathML beside them that the browser
 * would otherwise put on the clipboard twice over.
 */

/* global Element */
import { shallowRef } from 'vue'

/** @typedef {typeof import('katex').default} Katex */

/** KaTeX, once something has asked for it. */
const katex = /** @type {import('vue').ShallowRef<Katex|null>} */ (shallowRef(null))

/** @type {Promise<void>|null} */
let loading = null

/**
 * Formulas already typeset, by mode and TeX. A reply being written renders
 * again on every word, and so would every formula in it.
 *
 * @type {Map<string, string|null>}
 */
const remembered = new Map()

/** How many formulas to remember before starting again. */
const REMEMBER = 500

/**
 * Load KaTeX, its stylesheet and fonts. Once is enough; every later call has
 * the same promise.
 *
 * @returns {Promise<void>}
 */
export function loadMath() {
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')])
    .then(([module]) => {
      document.addEventListener('copy', copyTex)
      katex.value = module.default
    })
    .catch(error => console.error('Failed to load KaTeX:', error))
  return loading
}

/**
 * Whether formulas can be typeset yet. Reactive, so what counted on it hears
 * when they can.
 *
 * @returns {boolean}
 */
export const mathReady = () => katex.value !== null

/**
 * A formula as HTML, or null where there is nothing to show yet: KaTeX is
 * still on its way, which this sets going, or it cannot read the TeX.
 *
 * @param {string} tex - The TeX, without its delimiters
 * @param {boolean} display - On a line of its own, rather than in a sentence
 * @returns {string|null}
 */
export function typesetMath(tex, display) {
  const engine = katex.value
  if (!engine) {
    loadMath()
    return null
  }
  const key = `${display ? 'D' : 'I'}${tex}`
  if (remembered.has(key)) return remembered.get(key) ?? null
  /** @type {string|null} */
  let html = null
  try {
    html = engine.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: false,
      // In ems. No rule or space a model asks for is wider than the chat.
      maxSize: 20,
    })
  } catch {
    // Not TeX after all, or TeX KaTeX does not know.
  }
  if (remembered.size >= REMEMBER) remembered.clear()
  remembered.set(key, html)
  return html
}

/**
 * The formula a node is in, if it is in one.
 *
 * @param {Node} node
 * @returns {Element|null}
 */
const formulaAround = node =>
  (node instanceof Element ? node : node.parentElement)?.closest('.katex') ?? null

/**
 * Put a selection that has math in it on the clipboard with each formula as
 * its TeX. A selection that starts or ends inside a formula takes the whole
 * of it.
 *
 * The plain text is read from the selection laid out in the page, off screen,
 * so its paragraphs and lines come apart as they do in any copy.
 *
 * @param {ClipboardEvent} event
 */
function copyTex(event) {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !event.clipboardData) return
  const range = selection.getRangeAt(0).cloneRange()
  const first = formulaAround(range.startContainer)
  if (first) range.setStartBefore(first)
  const last = formulaAround(range.endContainer)
  if (last) range.setEndAfter(last)
  const fragment = range.cloneContents()
  const formulas = fragment.querySelectorAll('.katex')
  if (!formulas.length) return

  for (const formula of formulas) {
    const tex = formula.querySelector('annotation')?.textContent ?? ''
    const display = formula.parentElement?.closest('.katex-display')
    if (!display) {
      formula.replaceWith(`$${tex}$`)
      continue
    }
    const paragraph = document.createElement('p')
    paragraph.textContent = `$$${tex}$$`
    display.replaceWith(paragraph)
  }
  const holder = document.createElement('div')
  holder.style.cssText = 'position: fixed; left: -10000px; top: 0; white-space: normal'
  holder.append(fragment)
  document.body.append(holder)
  try {
    event.clipboardData.setData('text/plain', holder.innerText ?? holder.textContent ?? '')
    event.clipboardData.setData('text/html', holder.innerHTML)
  } finally {
    holder.remove()
  }
  event.preventDefault()
}
