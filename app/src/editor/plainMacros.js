/**
 * @module editor/plainMacros
 * @description Macros picked out in a plain document — `{{char}}`, `{{user}}`
 * and the rest — so that a card reads as the template it is.
 *
 * A mark on each, drawn in the `card-macro` class. Only the lines on screen
 * are looked at, and only the lines that change are looked at again.
 *
 * Loaded with the plain view rather than from `editor/index`, so that
 * CodeMirror is not in the app until a plain document is opened.
 */

import { Decoration, MatchDecorator, ViewPlugin } from '@codemirror/view'

/** Two braces, anything on the line but a brace, and two braces. */
const MACRO = /\{\{[^{}\n]*\}\}/g

const macros = new MatchDecorator({
  regexp: MACRO,
  decoration: Decoration.mark({ class: 'card-macro' }),
})

export const plainMacros = ViewPlugin.fromClass(
  class {
    /** @param {import('@codemirror/view').EditorView} view */
    constructor(view) {
      this.decorations = macros.createDeco(view)
    }

    /** @param {import('@codemirror/view').ViewUpdate} update */
    update(update) {
      this.decorations = macros.updateDeco(update, this.decorations)
    }
  },
  { decorations: plugin => plugin.decorations }
)
