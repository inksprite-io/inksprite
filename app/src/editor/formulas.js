/**
 * @module editor/formulas
 * @description Formulas in the editor: TeX typeset by KaTeX where it stands,
 * and opened as it is written to be changed. Design:
 * `.llm/math_design.md`.
 *
 * A formula is a leaf holding its TeX (`editor/schema.js`). Its node view
 * draws it typeset, or as written while KaTeX is on its way, or in KaTeX's
 * error colour, KaTeX's message on hover, when KaTeX can't read it.
 *
 * Clicked, or arrowed onto, it opens: a field in its place holding it as it
 * is written, delimiters and all, the caret just inside the end it was come
 * at from, and the formula typeset under it as it is typed. Arrowing out past
 * either end closes it, as do Escape, Enter in a sentence's formula and
 * Mod-Enter in one of its own (where Enter is a new line of TeX), and a click
 * elsewhere. What the field holds is read back as markdown as it closes, one
 * change for Mod-Z to take back: still one formula, it is that formula with
 * its new TeX; a dollar taken out, it is text again; two written, they are
 * two; nothing, and it is gone. A formula an undo puts back is selected, not
 * opened; Enter opens it.
 *
 * Typed, `$…$` becomes a formula when the character after its closing dollar
 * is typed, unless that is a digit (so "$5–$10" stays two prices), or on
 * Enter; `$$…$$` in a sentence too. `$$` at the start of an empty paragraph
 * is a formula of its own, opened. Insert › Formula and Mod-Shift-E put one
 * in at the caret, take the selection's words as its TeX, or in an empty
 * paragraph make one of its own.
 */

/* global HTMLTextAreaElement, queueMicrotask */
import { InputRule } from 'prosemirror-inputrules'
import { isHistoryTransaction } from 'prosemirror-history'
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection } from 'prosemirror-state'
import { loadMath, mathError, mathReady, typesetMath } from '@/utils/math.js'
import { formulaAt } from '@/utils/tex.js'
import { schema } from './schema.js'
import { parseMarkdown, writtenFormula, writtenFormulaBlock } from './markdown.js'

/**
 * @typedef {import('prosemirror-model').Node} Node
 * @typedef {import('prosemirror-model').Fragment} Fragment
 * @typedef {import('prosemirror-state').Command} Command
 * @typedef {import('prosemirror-state').EditorState} EditorState
 * @typedef {import('prosemirror-state').Transaction} Transaction
 * @typedef {import('prosemirror-view').EditorView} EditorView
 * @typedef {import('prosemirror-view').NodeView} NodeView
 *
 * Where the caret goes in a field as it opens: just inside its start or its
 * end.
 * @typedef {'start'|'end'} Side
 */

const { formula, formula_block, paragraph } = schema.nodes

/**
 * The plugin's state: the side of the formula a selection put on it came
 * from, for its field to open with the caret there; null where the selection
 * on it should not open it.
 *
 * @type {PluginKey<Side|null>}
 */
export const formulaKey = new PluginKey('formulas')

/**
 * @param {Node} node
 * @returns {boolean}
 */
const isFormula = node => node.type === formula || node.type === formula_block

/**
 * A formula as its field holds it.
 *
 * @param {Node} node
 * @returns {string}
 */
function asWritten(node) {
  const block = node.type === formula_block
  if (!node.attrs.tex) return block ? '$$\n\n$$' : '$$'
  return block ? writtenFormulaBlock(node.attrs.tex) : writtenFormula(node.attrs.tex)
}

/**
 * Draw a formula: typeset, as written while KaTeX is on its way, or as
 * written in the error colour with what is wrong on hover.
 *
 * @param {HTMLElement} element
 * @param {string} tex
 * @param {boolean} display
 * @param {() => void} again - Drawn again once KaTeX is here
 */
function draw(element, tex, display, again) {
  element.classList.remove('formula-waiting', 'formula-error')
  element.removeAttribute('title')
  const html = tex ? typesetMath(tex, display) : ''
  if (html !== null) {
    element.innerHTML = html
    return
  }
  element.textContent = display ? `$$ ${tex} $$` : `$${tex}$`
  if (mathReady()) {
    element.classList.add('formula-error')
    element.title = mathError(tex, display) ?? ''
  } else {
    element.classList.add('formula-waiting')
    loadMath().then(() => {
      if (mathReady()) again()
    })
  }
}

/**
 * The TeX a field's words hold: what is between their delimiters, or what is
 * left of them without what delimiters they have.
 *
 * @param {string} value
 * @returns {string}
 */
function texIn(value) {
  const words = value.trim()
  const found = formulaAt(words, false)
  if (found) return found.tex.trim()
  return words
    .replace(/^(?:\$\$?|\\\()/, '')
    .replace(/(?:\$\$?|\\\))$/, '')
    .trim()
}

/** The node views drawn, by their element, for a key to open one. */
const views = new WeakMap()

/**
 * A formula in the text, and its field while it is open.
 *
 * @implements {NodeView}
 */
class FormulaView {
  /**
   * @param {Node} node
   * @param {EditorView} view
   * @param {() => number|undefined} getPos
   */
  constructor(node, view, getPos) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.display = node.type === formula_block
    this.dom = document.createElement(this.display ? 'div' : 'span')
    this.dom.className = this.display ? 'formula formula-block' : 'formula'
    this.shown = document.createElement(this.display ? 'div' : 'span')
    this.shown.className = 'formula-shown'
    this.dom.append(this.shown)
    /** @type {HTMLInputElement|HTMLTextAreaElement|null} */
    this.field = null
    /** @type {HTMLElement|null} */
    this.preview = null
    // A click on it once it is selected, as it is after an undo.
    this.dom.addEventListener('click', () => {
      if (this.dom.classList.contains('ProseMirror-selectednode')) this.open('end')
    })
    views.set(this.dom, this)
    this.draw()
  }

  draw() {
    draw(this.shown, this.node.attrs.tex, this.display, () => this.draw())
  }

  /** @param {Node} node */
  update(node) {
    if (node.type !== this.node.type) return false
    const was = this.node
    this.node = node
    if (node.attrs.tex !== was.attrs.tex) this.draw()
    return true
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode')
    const side = formulaKey.getState(this.view.state)
    if (side) this.open(side)
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode')
    // Moved off by something else, a find, say: settled once the view is.
    if (this.field) queueMicrotask(() => this.close(null))
  }

  /**
   * Open the field.
   *
   * @param {Side} side
   */
  open(side) {
    if (this.field || !this.view.editable) return
    const field = document.createElement(this.display ? 'textarea' : 'input')
    field.className = 'formula-field'
    field.spellcheck = false
    field.setAttribute('autocapitalize', 'off')
    field.setAttribute('autocomplete', 'off')
    field.setAttribute('autocorrect', 'off')
    field.setAttribute('aria-label', 'Formula')
    field.value = asWritten(this.node)
    const preview = document.createElement(this.display ? 'div' : 'span')
    preview.className = 'formula-preview'
    preview.setAttribute('aria-hidden', 'true')
    this.field = field
    this.preview = preview
    this.dom.classList.add('formula-editing')
    this.dom.append(field, preview)

    field.addEventListener('input', () => this.fit())
    field.addEventListener('keydown', event => this.key(/** @type {KeyboardEvent} */ (event)))
    field.addEventListener('blur', () => this.close(null))
    this.fit()
    field.focus()
    const opener = this.display ? 3 : field.value.startsWith('\\(') ? 2 : 1
    const at = side === 'start' ? opener : field.value.length - opener
    field.setSelectionRange(at, at)
  }

  /** Size the field to its words, and typeset them beneath it. */
  fit() {
    const { field, preview } = this
    if (!field || !preview) return
    if (field instanceof HTMLTextAreaElement) {
      field.rows = Math.max(3, field.value.split('\n').length)
    } else field.style.width = `${Math.max(field.value.length, 2) + 1}ch`
    const tex = texIn(field.value)
    const html = tex ? typesetMath(tex, this.display) : null
    if (tex && !mathReady()) {
      loadMath().then(() => {
        if (mathReady()) this.fit()
      })
    }
    if (html !== null) {
      preview.innerHTML = html
      preview.classList.remove('formula-error')
    } else {
      preview.textContent = tex ? (mathError(tex, this.display) ?? '') : ''
      preview.classList.toggle('formula-error', !!preview.textContent)
    }
    preview.hidden = !preview.textContent
  }

  /** @param {KeyboardEvent} event */
  key(event) {
    if (event.isComposing) return
    const field = /** @type {HTMLInputElement|HTMLTextAreaElement} */ (event.target)
    const { selectionStart: from, selectionEnd: to, value } = field
    const collapsed = from === to
    const mod = event.metaKey || event.ctrlKey
    /** @type {'before'|'after'|null} */
    let leave = null
    if (event.key === 'Escape') leave = 'after'
    else if (event.key === 'Enter' && (!this.display || mod)) leave = 'after'
    else if (event.key === 'ArrowLeft' && collapsed && from === 0) leave = 'before'
    else if (event.key === 'ArrowRight' && collapsed && to === value.length) leave = 'after'
    else if (
      event.key === 'ArrowUp' &&
      (!this.display || !value.slice(0, from ?? 0).includes('\n'))
    ) {
      leave = 'before'
    } else if (
      event.key === 'ArrowDown' &&
      (!this.display || !value.slice(to ?? 0).includes('\n'))
    ) {
      leave = 'after'
    } else if (event.key === 'Backspace' && value === '') leave = 'before'
    if (!leave || event.shiftKey || event.altKey) return
    event.preventDefault()
    this.close(leave)
  }

  /**
   * Close the field, its words read back into the document, and the caret
   * put beside what they made, or left where it is.
   *
   * @param {'before'|'after'|null} caret
   */
  close(caret) {
    const { field, preview } = this
    if (!field) return
    this.field = null
    this.preview = null
    field.remove()
    preview?.remove()
    this.dom.classList.remove('formula-editing')
    const pos = this.getPos()
    if (pos === undefined || this.view.isDestroyed) return
    const tr = this.view.state.tr.setMeta(formulaKey, null)
    const size = settle(tr, pos, this.node, field.value)
    if (caret) caretBeside(tr, caret === 'before' ? pos : pos + size, caret)
    if (tr.docChanged || caret) this.view.dispatch(tr.scrollIntoView())
    if (caret) this.view.focus()
  }

  /**
   * The field's events are its own.
   *
   * @param {Event} event
   */
  stopEvent(event) {
    const { target } = event
    if (!(target instanceof globalThis.Node)) return false
    return !!(this.field?.contains(target) || this.preview?.contains(target))
  }

  /** What is drawn inside is the view's own, not the document's. */
  ignoreMutation() {
    return true
  }

  destroy() {
    views.delete(this.dom)
  }
}

/**
 * A field's words read back into the document in place of its formula: the
 * formula with new TeX, what they read as otherwise, or nothing.
 *
 * @param {Transaction} tr
 * @param {number} pos - The formula's
 * @param {Node} node - The formula
 * @param {string} value - The field's words
 * @returns {number} How much is there now in its place
 */
export function settle(tr, pos, node, value) {
  if (value === asWritten(node)) return node.nodeSize
  const display = node.type === formula_block
  if (!texIn(value)) {
    tr.delete(pos, pos + node.nodeSize)
    return 0
  }
  // No line of TeX is blank, and a sentence's formula has the one line.
  const read = parseMarkdown(
    display ? value.replace(/\n(?:[ \t]*\n)+/g, '\n') : value.replace(/\s*\n\s*/g, ' ')
  )
  const only = read.childCount === 1 ? read.firstChild : null
  const lone = only?.type === paragraph && only.childCount === 1 ? only.firstChild : null
  const tex =
    only?.type === formula_block ? only.attrs.tex : lone?.type === formula ? lone.attrs.tex : null
  if (tex !== null) {
    tr.setNodeAttribute(pos, 'tex', tex)
    return node.nodeSize
  }
  /** @type {Node[]} */
  const made = []
  if (display) read.forEach(block => made.push(block))
  else if (only?.type === paragraph) {
    only.forEach(child =>
      made.push(child.mark(node.marks.reduce((set, mark) => mark.addToSet(set), child.marks)))
    )
  } else made.push(schema.text(value, node.marks))
  const before = tr.doc.content.size
  tr.replaceWith(pos, pos + node.nodeSize, made)
  return node.nodeSize + tr.doc.content.size - before
}

/**
 * Put the caret beside a formula, in the text before or after it. A formula
 * of its own with no text on that side gets a paragraph there to go on in.
 *
 * @param {Transaction} tr
 * @param {number} pos - Its edge
 * @param {'before'|'after'} side
 */
function caretBeside(tr, pos, side) {
  const dir = side === 'before' ? -1 : 1
  const $pos = tr.doc.resolve(pos)
  /** @type {Selection|null} */
  let found = $pos.parent.inlineContent ? TextSelection.create(tr.doc, pos) : null
  found ??= Selection.findFrom($pos, dir, true)
  if (!found && $pos.parent.canReplaceWith($pos.index(), $pos.index(), paragraph)) {
    tr.insert(pos, paragraph.create())
    found = TextSelection.create(tr.doc, pos + 1)
  }
  tr.setSelection(found ?? Selection.near($pos, dir))
}

/**
 * TeX typed in a sentence, with what typography made of it as it was typed
 * put back: a prime is no apostrophe.
 *
 * @param {string} tex
 * @returns {string}
 */
const untypeset = tex =>
  tex
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2014/g, '--')
    .replace(/\u2026/g, '...')
    .trim()

/** A formula between single dollars, ending where the caret is. */
const SINGLE_BEFORE = /\$(?![\s$])((?:\\.|[^\\$\n\ufffc])+?)(?<!\s)\$$/

/** A formula between double dollars in a sentence, ending where the caret is. */
const DOUBLE_BEFORE = /\$\$((?:(?!\$\$)[^\ufffc])+?)\$\$$/

/**
 * A formula made of what was typed, from `start` to `end`, with the marks
 * the words had.
 *
 * @param {EditorState} state
 * @param {number} start
 * @param {number} end
 * @param {string} tex
 * @returns {Transaction|null}
 */
function typed(state, start, end, tex) {
  const clean = untypeset(tex)
  if (!clean) return null
  const node = formula.create({ tex: clean }, null, state.doc.resolve(start + 1).marks())
  return state.tr.replaceWith(start, end, node)
}

/**
 * `$…$` typed: a formula once the character after its closing dollar is,
 * unless that is a digit or another dollar.
 *
 * @param {RegExp} before
 * @returns {InputRule}
 */
const closedBy = before =>
  new InputRule(
    new RegExp(`${before.source.slice(0, -1)}([^\\d$])$`),
    (state, match, start, end) => {
      const tr = typed(state, start, end, match[1])
      return tr && tr.insertText(match[2])
    },
    { inCodeMark: false }
  )

/**
 * `$$` at the start of an empty paragraph: a formula of its own there, opened.
 *
 * @type {InputRule}
 */
const ownLineRule = new InputRule(
  /^\$\$$/,
  (state, _match, start) => {
    const $start = state.doc.resolve(start)
    if ($start.parent.type !== paragraph || $start.parent.textContent !== '$') return null
    return made(state, $start)
  },
  { inCodeMark: false }
)

/**
 * A formula of its own in place of the empty paragraph a position is in,
 * selected for its field to open; null where it can't go there.
 *
 * @param {EditorState} state
 * @param {import('prosemirror-model').ResolvedPos} $in
 * @returns {Transaction|null}
 */
function made(state, $in) {
  if ($in.depth === 0) return null
  const index = $in.index($in.depth - 1)
  if (!$in.node($in.depth - 1).canReplaceWith(index, index + 1, formula_block)) return null
  const before = $in.before()
  const tr = state.tr.replaceWith(before, $in.after(), formula_block.create())
  return tr.setSelection(NodeSelection.create(tr.doc, before)).setMeta(formulaKey, 'start')
}

/** @type {InputRule[]} */
export const formulaRules = [ownLineRule, closedBy(DOUBLE_BEFORE), closedBy(SINGLE_BEFORE)]

/**
 * A formula typed just before the caret, made one: what Enter does first, as
 * typing a character after it would.
 *
 * @param {EditorState} state
 * @returns {Transaction|null}
 */
function typedBeforeCaret(state) {
  const { $cursor } = /** @type {TextSelection} */ (state.selection)
  if (!$cursor || $cursor.parent.type.spec.code) return null
  if ($cursor.marks().some(mark => mark.type.spec.code)) return null
  const text = $cursor.parent.textBetween(0, $cursor.parentOffset, null, '\ufffc')
  for (const pattern of [DOUBLE_BEFORE, SINGLE_BEFORE]) {
    const match = pattern.exec(text)
    if (match) return typed(state, $cursor.pos - match[0].length, $cursor.pos, match[1])
  }
  return null
}

/**
 * Put a formula in, opened: at the caret, or with the selection's words as
 * its TeX, or of its own in place of an empty paragraph.
 *
 * @type {Command}
 */
export const insertFormula = (state, dispatch) => {
  const { selection } = state
  const { $from, $to } = selection
  if (!(selection instanceof TextSelection) || $from.parent !== $to.parent) return false
  const line = $from.parent
  if (!line.inlineContent || line.type.spec.code) return false
  if ($from.marks().some(mark => mark.type.spec.code)) return false
  if (selection.empty && line.type === paragraph && line.content.size === 0) {
    const tr = made(state, $from)
    if (tr) {
      dispatch?.(tr.scrollIntoView())
      return true
    }
  }
  if (!line.canReplaceWith($from.index(), $to.indexAfter(), formula)) return false
  if (dispatch) {
    const tex = state.doc.textBetween($from.pos, $to.pos, ' ', '').trim()
    const tr = state.tr.replaceWith(
      $from.pos,
      $to.pos,
      formula.create({ tex }, null, $from.marks())
    )
    tr.setSelection(NodeSelection.create(tr.doc, $from.pos))
    dispatch(tr.setMeta(formulaKey, tex ? 'end' : 'start').scrollIntoView())
  }
  return true
}

/**
 * Formulas drawn, opened and typed.
 *
 * @returns {Plugin}
 */
export function formulasPlugin() {
  return new Plugin({
    key: formulaKey,
    state: {
      init: () => null,
      apply(tr, _side, before, after) {
        const asked = tr.getMeta(formulaKey)
        if (asked !== undefined) return asked
        const { selection } = after
        if (!(selection instanceof NodeSelection) || !isFormula(selection.node)) return null
        if (selection.eq(before.selection) || isHistoryTransaction(tr)) return null
        if (tr.getMeta('pointer')) return 'end'
        return before.selection.head <= selection.from ? 'start' : 'end'
      },
    },
    props: {
      nodeViews: {
        formula: (node, view, getPos) => new FormulaView(node, view, getPos),
        formula_block: (node, view, getPos) => new FormulaView(node, view, getPos),
      },
      handleKeyDown(view, event) {
        if (event.key !== 'Enter' || event.shiftKey || event.altKey) return false
        if (event.metaKey || event.ctrlKey) return false
        const { selection } = view.state
        if (selection instanceof NodeSelection && isFormula(selection.node)) {
          const shown = views.get(view.nodeDOM(selection.from))
          if (!shown || !view.editable) return false
          shown.open('end')
          return true
        }
        // Made first, then Enter does what it does.
        const tr = typedBeforeCaret(view.state)
        if (tr) view.dispatch(tr)
        return false
      },
    },
  })
}
