/**
 * @module editor/spelling
 * @description Spelling and grammar in the editor: what the checker found,
 * drawn under the text, and the commands the menu on a flagged word runs.
 *
 * The plugin's state is what is drawn, as decorations, and the stretches of
 * the document changed since they were last checked. Both follow the text
 * through every transaction, so an edit above a paragraph moves its
 * underlines with it. An edit takes away the underlines it touches, so a
 * word being fixed stops being flagged as it is fixed.
 *
 * The plugin's view does the checking. A pause after typing, it takes the
 * changed paragraphs, those on the screen first: one already checked as it
 * now reads is drawn straight from the checker's cache, and the rest are sent
 * to be checked, a few at a time, and drawn when the answers come back. Each
 * paragraph is checked on its own, as a string in which a line break is `\n`,
 * so a lint at offset `i` is at position `start + i`. A paragraph with
 * suggestions in it is checked as it would read with them taken, so what
 * they would take out is not in the string, and its offsets are mapped back
 * (`blockText`). Code blocks are not checked, and a lint that touches inline
 * code is not drawn.
 *
 * Only what is near the screen is checked: Harper takes about a quarter of a
 * millisecond a word, so a novel in one document would keep a core busy for
 * half a minute. The rest waits until the writer scrolls to it.
 *
 * A misspelling at the caret isn't drawn while the writer is typing: the
 * word may not be finished. Moving the caret shows it.
 */

import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { SPELLING_KINDS, baseWord } from '@/spelling/engine.js'
import { spellChecker } from '@/spelling/checker.js'

/**
 * @typedef {import('prosemirror-state').EditorState} EditorState
 * @typedef {import('prosemirror-state').Transaction} Transaction
 * @typedef {import('prosemirror-state').Command} Command
 * @typedef {import('prosemirror-model').Node} Node
 * @typedef {import('prosemirror-view').EditorView} EditorView
 * @typedef {import('@/spelling/engine.js').LintInfo} LintInfo
 * @typedef {import('@/spelling/checker.js').Checker} Checker
 *
 * @typedef {{ from: number, to: number }} Range
 *
 * @typedef {Object} SpellingState
 * @property {DecorationSet} decorations - What is drawn; each decoration's
 *   spec holds its `lint`
 * @property {Range[]} dirty - What has changed since it was last checked
 * @property {boolean} typing - Whether the text changed since the caret last
 *   moved on its own
 *
 * A paragraph's answer, as the view hands it to the state.
 * @typedef {Object} CheckedBlock
 * @property {number} from - The start of its content
 * @property {number} to - The end of its content
 * @property {Decoration[]} decorations
 *
 * @typedef {Object} SpellingMeta
 * @property {boolean} [recheck] - Check the whole document again
 * @property {CheckedBlock[]} [checked] - Paragraphs answered
 * @property {Range[]} [pending] - With `checked`: what is still to check
 * @property {(lint: LintInfo) => boolean} [drop] - Take these underlines away now
 */

/** @type {PluginKey<SpellingState>} */
export const spellingKey = new PluginKey('spelling')

/** How long typing has to pause before what changed is checked, in milliseconds. */
export const CHECK_DELAY = 400

/** How much is sent to the checker at a time: paragraphs, and characters. */
const BATCH_BLOCKS = 20
const BATCH_CHARS = 8000

/** How far either side of the screen is checked, in the document's top-level blocks. */
const NEAR = 40

/** How long scrolling has to pause before what came into view is checked. */
const SCROLL_DELAY = 200

/** What a line break is in the text sent: one character, as it is one position. */
const BREAK = '\n'

/**
 * Join ranges that overlap or touch, in order.
 *
 * @param {Range[]} ranges
 * @returns {Range[]}
 */
const merged = ranges => {
  const sorted = [...ranges].sort((a, b) => a.from - b.from)
  /** @type {Range[]} */
  const out = []
  for (const range of sorted) {
    const last = out[out.length - 1]
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to)
    else out.push({ ...range })
  }
  return out
}

/**
 * What a transaction changed, in the document it leaves.
 *
 * @param {Transaction} tr
 * @returns {Range[]}
 */
const changedRanges = tr => {
  /** @type {Range[]} */
  let ranges = []
  for (const map of tr.mapping.maps) {
    ranges = ranges.map(({ from, to }) => ({ from: map.map(from, -1), to: map.map(to, 1) }))
    map.forEach((_oldFrom, _oldTo, from, to) => ranges.push({ from, to }))
  }
  return ranges
}

/**
 * A paragraph's text as it is sent to be checked, read as it would be with
 * its suggestions taken: what one would put in is checked, as the words on
 * offer, and what one would take out is left out, so the words either side
 * are read together as they would then stand. A deleted word takes its space
 * with it, so blanking it instead would leave a run of spaces to be flagged.
 *
 * @param {Node} node - A textblock
 * @returns {{ text: string, offsets: number[]|null }} `offsets[i]` is where
 *   the text's `i`th character is in the paragraph; null when it is at `i`
 */
export const blockText = node => {
  let taken = false
  node.forEach(child => {
    taken ||= child.marks.some(mark => mark.type.name === 'deletion')
  })
  if (!taken) {
    return { text: node.textBetween(0, node.content.size, undefined, BREAK), offsets: null }
  }
  let text = ''
  /** @type {number[]} */
  const offsets = []
  node.forEach((child, offset) => {
    if (child.marks.some(mark => mark.type.name === 'deletion')) return
    const part = child.isText ? (child.text ?? '') : BREAK
    text += part
    for (let i = 0; i < part.length; i++) offsets.push(offset + i)
  })
  return { text, offsets }
}

/**
 * Where the inline code in a paragraph is, as offsets into its text.
 *
 * @param {Node} node
 * @returns {Range[]}
 */
const codeIn = node => {
  /** @type {Range[]} */
  const ranges = []
  node.forEach((child, offset) => {
    if (child.marks.some(mark => mark.type.spec.code)) {
      ranges.push({ from: offset, to: offset + child.nodeSize })
    }
  })
  return ranges
}

/**
 * The underlines for a paragraph's lints: those the checker shows, and none
 * on inline code. One across what a suggestion would take out runs over it.
 *
 * @param {Node} node
 * @param {number} start - Where its content starts
 * @param {LintInfo[]} lints
 * @param {Checker} checker
 * @param {number[]|null} offsets - Where the checked text's characters are
 *   in the paragraph, as `blockText` gives them
 * @returns {Decoration[]}
 */
const underlines = (node, start, lints, checker, offsets) => {
  const code = codeIn(node)
  const at = (/** @type {number} */ i) => (offsets ? offsets[i] : i)
  return lints
    .filter(lint => lint.from < lint.to && checker.shows(lint))
    .map(lint => ({ lint, from: at(lint.from), to: at(lint.to - 1) + 1 }))
    .filter(({ from, to }) => !code.some(range => from < range.to && range.from < to))
    .map(({ lint, from, to }) =>
      Decoration.inline(
        start + from,
        start + to,
        { class: SPELLING_KINDS.has(lint.kind) ? 'spelling-error' : 'grammar-error' },
        { lint }
      )
    )
}

/**
 * The textblocks a set of ranges falls in, in document order.
 *
 * @param {Node} doc
 * @param {Range[]} ranges
 * @returns {{ pos: number, node: Node }[]}
 */
const blocksIn = (doc, ranges) => {
  const size = doc.content.size
  /** @type {Map<number, Node>} */
  const blocks = new Map()
  for (const range of ranges) {
    const from = Math.max(0, Math.min(range.from - 1, size))
    const to = Math.min(size, Math.max(range.to + 1, from))
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true
      blocks.set(pos, node)
      return false
    })
  }
  return [...blocks].sort((a, b) => a[0] - b[0]).map(([pos, node]) => ({ pos, node }))
}

/**
 * The stretch of the document on the screen, as near as the view can say.
 * Null when it can't, as in a test.
 *
 * @param {EditorView} view
 * @returns {Range|null}
 */
const onScreen = view => {
  try {
    const box = view.dom.getBoundingClientRect()
    const top = Math.max(box.top, 0)
    const bottom = Math.min(box.bottom, window.innerHeight)
    if (!(bottom > top) || !(box.width > 0)) return null
    const left = box.left + box.width / 2
    const from = view.posAtCoords({ left, top: top + 1 })?.pos
    const to = view.posAtCoords({ left, top: bottom - 1 })?.pos
    return from == null || to == null ? null : { from, to }
  } catch {
    return null
  }
}

/**
 * The top-level block a position is in, or the one it is before, and where
 * that block starts.
 *
 * @param {Node} doc
 * @param {number} pos
 * @returns {{ index: number, offset: number }}
 */
const topLevel = (doc, pos) => {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
  return { index: $pos.index(0), offset: $pos.depth > 0 ? $pos.before(1) : $pos.pos }
}

/**
 * The stretch of the document near the screen: what is on it, and `NEAR`
 * top-level blocks either side.
 *
 * @param {Node} doc
 * @param {Range} screen
 * @returns {Range}
 */
const nearScreen = (doc, screen) => {
  const top = topLevel(doc, screen.from)
  const bottom = topLevel(doc, screen.to)
  let from = top.offset
  for (let i = top.index - 1; i >= Math.max(0, top.index - NEAR); i--) {
    from -= doc.child(i).nodeSize
  }
  let to = bottom.offset
  for (let i = bottom.index; i < Math.min(doc.childCount, bottom.index + NEAR + 1); i++) {
    to += doc.child(i).nodeSize
  }
  return { from, to }
}

/**
 * Split ranges into what falls inside a stretch and what falls outside it.
 *
 * @param {Range[]} ranges
 * @param {Range} stretch
 * @returns {{ inside: Range[], outside: Range[] }}
 */
const splitBy = (ranges, stretch) => {
  /** @type {Range[]} */
  const inside = []
  /** @type {Range[]} */
  const outside = []
  for (const { from, to } of ranges) {
    if (from < stretch.from) outside.push({ from, to: Math.min(to, stretch.from) })
    if (to > stretch.to) outside.push({ from: Math.max(from, stretch.to), to })
    const a = Math.max(from, stretch.from)
    const b = Math.min(to, stretch.to)
    if (a <= b) inside.push({ from: a, to: b })
  }
  return { inside, outside }
}

/**
 * Blocks in the order to check them: those on the screen, then those below
 * it, then those above.
 *
 * @param {{ pos: number, node: Node }[]} blocks
 * @param {Range|null} screen
 */
const inOrder = (blocks, screen) => {
  if (!screen) return blocks
  const rank = (/** @type {{ pos: number, node: Node }} */ { pos, node }) =>
    pos + node.nodeSize > screen.from && pos < screen.to ? 0 : pos >= screen.to ? 1 : 2
  return [...blocks].sort((a, b) => rank(a) - rank(b) || a.pos - b.pos)
}

/**
 * The plugin, drawing what a checker finds.
 *
 * @param {Checker} [checker]
 * @returns {Plugin<SpellingState>}
 */
export function spellingPlugin(checker = spellChecker) {
  return new Plugin({
    key: spellingKey,
    state: {
      /** @returns {SpellingState} */
      init: (_config, state) => ({
        decorations: DecorationSet.empty,
        dirty: [{ from: 0, to: state.doc.content.size }],
        typing: false,
      }),
      apply(tr, value, _old, state) {
        /** @type {SpellingMeta|undefined} */
        const meta = tr.getMeta(spellingKey)
        let { decorations, dirty, typing } = value
        if (tr.docChanged) {
          decorations = decorations.map(tr.mapping, tr.doc)
          const changed = changedRanges(tr)
          dirty = [
            ...dirty.map(({ from, to }) => ({
              from: tr.mapping.map(from, -1),
              to: tr.mapping.map(to, 1),
            })),
            ...changed,
          ]
          const touched = changed.flatMap(({ from, to }) => decorations.find(from, to))
          if (touched.length > 0) decorations = decorations.remove(touched)
          typing = true
        } else if (tr.selectionSet) {
          typing = false
        }
        if (meta?.recheck) dirty = [{ from: 0, to: state.doc.content.size }]
        if (meta?.checked) {
          const old = meta.checked.flatMap(({ from, to }) => decorations.find(from, to))
          decorations = decorations.remove(old).add(
            state.doc,
            meta.checked.flatMap(block => block.decorations)
          )
          dirty = meta.pending ?? []
        }
        if (meta?.drop) {
          const drop = meta.drop
          const gone = decorations.find(undefined, undefined, spec => drop(spec.lint))
          if (gone.length > 0) decorations = decorations.remove(gone)
        }
        return { decorations, dirty: merged(dirty), typing }
      },
    },
    props: {
      decorations(state) {
        if (!checker.active()) return null
        const value = spellingKey.getState(state)
        if (!value) return null
        if (!value.typing) return value.decorations
        const head = state.selection.head
        const hidden = value.decorations.find(head, head, spec =>
          SPELLING_KINDS.has(spec.lint.kind)
        )
        return hidden.length > 0 ? value.decorations.remove(hidden) : value.decorations
      },
    },
    view(editorView) {
      let alive = true
      /** Whether paragraphs are with the checker. */
      let busy = false
      /**
       * Whether the last pass left nothing near the screen to check: what is
       * left waits for an edit or a scroll.
       */
      let idle = false
      /** @type {ReturnType<typeof setTimeout>|null} */
      let timer = null

      /** @param {number} delay */
      const schedule = delay => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(check, delay)
      }

      /** @param {SpellingMeta} meta */
      const send = meta => {
        if (!alive) return
        editorView.dispatch(
          editorView.state.tr.setMeta(spellingKey, meta).setMeta('addToHistory', false)
        )
      }

      const check = () => {
        timer = null
        if (!alive || busy || !checker.active()) return
        // A transaction now would end what an input method is composing.
        if (editorView.composing) {
          schedule(CHECK_DELAY)
          return
        }
        const { state } = editorView
        const value = spellingKey.getState(state)
        if (!value || value.dirty.length === 0) return

        // Without a layout to go by, as in a test, the whole document is near.
        const screen = onScreen(editorView)
        const { inside, outside } = screen
          ? splitBy(value.dirty, nearScreen(state.doc, screen))
          : { inside: value.dirty, outside: [] }

        /** @type {CheckedBlock[]} */
        const checked = []
        /** @type {Range[]} */
        const pending = []
        /** @type {string[]} */
        const wanted = []
        let characters = 0
        for (const { pos, node } of inOrder(blocksIn(state.doc, inside), screen)) {
          const from = pos + 1
          const to = pos + node.nodeSize - 1
          if (node.type.spec.code) {
            checked.push({ from, to, decorations: [] })
            continue
          }
          // With a batch to send already, the rest waits for the next pass.
          if (wanted.length >= BATCH_BLOCKS || characters >= BATCH_CHARS) {
            pending.push({ from, to })
            continue
          }
          const { text, offsets } = blockText(node)
          const lints = text.trim() ? checker.cached(text) : []
          if (lints) {
            checked.push({
              from,
              to,
              decorations: underlines(node, from, lints, checker, offsets),
            })
            continue
          }
          pending.push({ from, to })
          wanted.push(text)
          characters += text.length
        }

        idle = wanted.length === 0
        if (wanted.length > 0) {
          busy = true
          checker.lint(wanted).finally(() => {
            busy = false
            if (alive && !timer) schedule(0)
          })
        }
        // What was drawn goes in, and what is left to check stays, near the
        // screen or not: nothing, if the changes were all between paragraphs.
        if (checked.length > 0 || (inside.length > 0 && pending.length === 0)) {
          send({ checked, pending: [...pending, ...outside] })
        }
      }

      const onScroll = () => {
        if (!alive || busy || spellingKey.getState(editorView.state)?.dirty.length === 0) return
        idle = false
        schedule(SCROLL_DELAY)
      }
      document.addEventListener('scroll', onScroll, { capture: true, passive: true })

      const recheck = () => {
        idle = false
        send({ recheck: true })
      }
      const unsubscribe = checker.subscribe(recheck)
      // What was drawn may be out of date: the dictionary may have changed
      // while no view was showing the document. A checker that is off has
      // nothing to draw until it is turned on, which it says.
      const first = checker.active() ? setTimeout(recheck, 0) : undefined

      return {
        update(view, prevState) {
          const value = spellingKey.getState(view.state)
          if (!value || value.dirty.length === 0) return
          if (view.state.doc !== prevState.doc) {
            idle = false
            schedule(CHECK_DELAY)
          } else if (!timer && !busy && !idle) schedule(0)
        },
        destroy() {
          alive = false
          document.removeEventListener('scroll', onScroll, { capture: true })
          unsubscribe()
          clearTimeout(first)
          if (timer) clearTimeout(timer)
        },
      }
    },
  })
}

/**
 * The underline at a position, and what it is for: the one the position is
 * in or at either end of.
 *
 * @param {EditorState} state
 * @param {number} pos
 * @returns {{ from: number, to: number, lint: LintInfo }|null}
 */
export function lintAt(state, pos) {
  const value = spellingKey.getState(state)
  const found = value?.decorations.find(pos, pos)[0]
  return found ? { from: found.from, to: found.to, lint: found.spec.lint } : null
}

/**
 * Put a suggestion in place of the text it is for.
 *
 * @param {number} from
 * @param {number} to
 * @param {string} text - Empty takes the text out
 * @returns {Command}
 */
export const replaceWith = (from, to, text) => (state, dispatch) => {
  if (dispatch) dispatch(state.tr.insertText(text, from, to).scrollIntoView())
  return true
}

/**
 * Take away the underlines for a word, at once, as it goes into a
 * dictionary: the checker takes a moment to check again.
 *
 * @param {EditorView} view
 * @param {string} word
 */
export function forgetWord(view, word) {
  const base = baseWord(word)
  view.dispatch(
    view.state.tr
      .setMeta(spellingKey, {
        drop: (/** @type {LintInfo} */ lint) =>
          SPELLING_KINDS.has(lint.kind) && baseWord(lint.word ?? lint.text) === base,
      })
      .setMeta('addToHistory', false)
  )
}
