/* global Event */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { parseMarkdown, serializeMarkdown } from '../../src/editor/markdown.js'
import {
  CHECK_DELAY,
  forgetWord,
  lintAt,
  replaceWith,
  spellingPlugin,
} from '../../src/editor/spelling.js'
import { SPELLING_KINDS, isHyphenated, wordAround } from '../../src/spelling/engine.js'

/** @typedef {import('../../src/spelling/engine.js').LintInfo} LintInfo */

/** The words the stand-in checker flags, and as what. */
const FLAGGED = {
  walkd: 'Spelling',
  teh: 'Typo',
  fooBar: 'Spelling',
  go: 'Agreement',
  Wi: 'Spelling',
  Fi: 'Spelling',
}

/**
 * What the stand-in finds in a text: each flagged word, as a whole word.
 * @param {string} text
 * @returns {LintInfo[]}
 */
const lintsFor = text =>
  [...text.matchAll(/\p{L}+/gu)]
    .filter(([word]) => word in FLAGGED)
    .map(match => ({
      from: match.index ?? 0,
      to: (match.index ?? 0) + match[0].length,
      kind: FLAGGED[/** @type {keyof typeof FLAGGED} */ (match[0])],
      text: match[0],
      message: '',
      suggestions: [`${match[0]}!`],
      ...(match[0] === 'go' ? { hash: '7' } : {}),
      ...hyphenatedWord(text, match.index ?? 0, (match.index ?? 0) + match[0].length),
    }))

/** The whole word, as the engine gives it, for a part of a hyphenated one. */
const hyphenatedWord = (
  /** @type {string} */ text,
  /** @type {number} */ from,
  /** @type {number} */ to
) => {
  const word = wordAround(text, from, to)
  return isHyphenated(word) ? { word } : {}
}

/** A checker that answers from `lintsFor`, and keeps what it was asked. */
const standIn = () => {
  /** @type {Map<string, LintInfo[]>} */
  const cache = new Map()
  /** @type {Set<() => void>} */
  const listeners = new Set()
  let grammar = true
  /** @type {string[][]} */
  const asked = []
  return {
    asked,
    status: ref('ready'),
    active: () => true,
    cached: (/** @type {string} */ text) => cache.get(text),
    lint: async (/** @type {string[]} */ texts) => {
      asked.push(texts)
      for (const text of texts) cache.set(text, lintsFor(text))
    },
    shows: (/** @type {LintInfo} */ lint) => SPELLING_KINDS.has(lint.kind) || grammar,
    subscribe: (/** @type {() => void} */ listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    configure: () => {},
    /** @param {boolean} on */
    setGrammar(on) {
      grammar = on
      listeners.forEach(listener => listener())
    },
  }
}

/** @type {EditorView[]} */
const views = []

/**
 * @param {string} markdown
 * @param {ReturnType<typeof standIn>} checker
 */
const mount = (markdown, checker) => {
  const state = EditorState.create({
    doc: parseMarkdown(markdown),
    plugins: [spellingPlugin(/** @type {any} */ (checker))],
  })
  const view = new EditorView(document.createElement('div'), { state })
  views.push(view)
  return view
}

/** Let the checking run: the timers, and the answers. */
const settle = () => vi.advanceTimersByTimeAsync(CHECK_DELAY * 2)

/** @param {EditorView} view */
const underlined = view =>
  [...view.dom.querySelectorAll('.spelling-error, .grammar-error')].map(
    el => `${el.className}:${el.textContent}`
  )

/** Where a word is in the document. */
const find = (/** @type {EditorState} */ state, /** @type {string} */ word) => {
  let found = -1
  state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text?.includes(word)) {
      found = pos + node.text.indexOf(word)
    }
  })
  if (found === -1) throw new Error(`No "${word}"`)
  return found
}

beforeEach(() => vi.useFakeTimers())

afterEach(() => {
  views.splice(0).forEach(view => view.destroy())
  vi.useRealTimers()
})

describe('spellingPlugin', () => {
  it('underlines what the checker finds: spelling, and grammar', async () => {
    const view = mount('She walkd to teh door.\n\nHe go home.', standIn())
    await settle()
    expect(underlined(view)).toEqual([
      'spelling-error:walkd',
      'spelling-error:teh',
      'grammar-error:go',
    ])
  })

  it('puts the underline where the word is after a line break', async () => {
    const view = mount('A line\\\nshe walkd home.', standIn())
    await settle()
    const from = find(view.state, 'walkd')
    expect(lintAt(view.state, from)).toMatchObject({ from, to: from + 5 })
    expect(underlined(view)).toEqual(['spelling-error:walkd'])
  })

  it('leaves code alone', async () => {
    const checker = standIn()
    const view = mount('```\nwalkd teh\n```\n\nCall `fooBar` and walkd.', checker)
    await settle()
    expect(underlined(view)).toEqual(['spelling-error:walkd'])
    expect(checker.asked.flat()).toEqual(['Call fooBar and walkd.'])
  })

  it('asks only about the paragraphs an edit touched', async () => {
    const checker = standIn()
    const view = mount('She walkd.\n\nAll is well.', checker)
    await settle()
    checker.asked.length = 0
    view.dispatch(view.state.tr.insertText(' Teh end', view.state.doc.content.size - 1))
    await settle()
    expect(checker.asked).toEqual([['All is well. Teh end']])
  })

  it('takes away an underline an edit touches, at once, and moves the rest', async () => {
    const view = mount('She walkd to teh door.', standIn())
    await settle()
    const from = find(view.state, 'walkd')
    view.dispatch(view.state.tr.insertText('e', from + 4))
    expect(underlined(view)).toEqual(['spelling-error:teh'])
    const teh = find(view.state, 'teh')
    expect(lintAt(view.state, teh)?.from).toBe(teh)
  })

  it('holds back a misspelling at the caret while the writer types', async () => {
    const view = mount('She walked home.', standIn())
    await settle()
    const end = view.state.doc.content.size - 1
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
    // Typed: the caret goes with the text, after it.
    view.dispatch(view.state.tr.insertText(' teh'))
    await settle()
    expect(underlined(view)).toEqual([])
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    expect(underlined(view)).toEqual(['spelling-error:teh'])
  })

  it('draws nothing from an answer to text that has since changed', async () => {
    const checker = standIn()
    /** @type {() => void} */
    let answer = () => {}
    const asked = checker.lint
    checker.lint = texts =>
      new Promise(resolve => {
        answer = () => asked(texts).then(resolve)
      })
    const view = mount('She walkd home.', checker)
    await settle()
    view.dispatch(view.state.tr.insertText('e', find(view.state, 'walkd') + 4))
    answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(underlined(view)).toEqual([])
  })

  it('draws again when the checker says what it shows has changed', async () => {
    const checker = standIn()
    const view = mount('She walkd. He go home.', checker)
    await settle()
    checker.setGrammar(false)
    await settle()
    expect(underlined(view)).toEqual(['spelling-error:walkd'])
  })
})

describe('a long document', () => {
  /**
   * A view that says the screen shows the document from one position to
   * another: what the plugin reads its layout from.
   *
   * @param {EditorView} view
   * @param {() => [number, number]} shown
   */
  const showing = (view, shown) => {
    view.dom.getBoundingClientRect = () =>
      /** @type {DOMRect} */ ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 })
    view.posAtCoords = ({ top }) => ({ pos: top < 300 ? shown()[0] : shown()[1], inside: -1 })
  }

  /** Where the paragraph at an index starts. */
  const startOf = (/** @type {EditorView} */ view, /** @type {number} */ index) => {
    let pos = 0
    for (let i = 0; i < index; i++) pos += view.state.doc.child(i).nodeSize
    return pos
  }

  it('checks what is near the screen, and the rest as it is scrolled to', async () => {
    const checker = standIn()
    const paragraphs = Array.from({ length: 300 }, (_, i) => `Paragraph ${i} walkd.`)
    const view = mount(paragraphs.join('\n\n'), checker)
    let shown = [0, 10]
    showing(view, () => [startOf(view, shown[0]), startOf(view, shown[1])])
    await settle()
    const asked = () => new Set(checker.asked.flat())
    expect(asked().has('Paragraph 0 walkd.')).toBe(true)
    expect(asked().has('Paragraph 50 walkd.')).toBe(true)
    expect(asked().has('Paragraph 60 walkd.')).toBe(false)
    expect(asked().has('Paragraph 250 walkd.')).toBe(false)

    shown = [240, 250]
    document.dispatchEvent(new Event('scroll'))
    await settle()
    expect(asked().has('Paragraph 250 walkd.')).toBe(true)
    expect(asked().has('Paragraph 150 walkd.')).toBe(false)
    expect(underlined(view).length).toBe(asked().size)
  })
})

describe('commands', () => {
  it('puts a suggestion in place of the word, keeping its marks', async () => {
    const view = mount('She **walkd** home.', standIn())
    await settle()
    const found = lintAt(view.state, find(view.state, 'walkd'))
    if (!found) throw new Error('No lint')
    replaceWith(found.from, found.to, 'walked')(view.state, view.dispatch)
    expect(serializeMarkdown(view.state.doc)).toBe('She **walked** home.')
  })

  it('takes the text out for an empty suggestion', async () => {
    const view = mount('the the end', standIn())
    const from = find(view.state, 'the the')
    replaceWith(from, from + 4, '')(view.state, view.dispatch)
    expect(serializeMarkdown(view.state.doc)).toBe('the end')
  })

  it('takes away a word’s underlines at once as it goes into a dictionary', async () => {
    const view = mount('She walkd. He walkd too, and teh rest.', standIn())
    await settle()
    forgetWord(view, 'walkd’s')
    expect(underlined(view)).toEqual(['spelling-error:teh'])
  })

  it('takes away both parts of a hyphenated word as it goes into a dictionary', async () => {
    const view = mount('The Wi-Fi was down. Wi is short.', standIn())
    await settle()
    forgetWord(view, 'Wi-Fi')
    expect(underlined(view)).toEqual(['spelling-error:Wi'])
  })

  it('finds no lint where nothing is flagged', async () => {
    const view = mount('All is well.', standIn())
    await settle()
    expect(lintAt(view.state, 3)).toBe(null)
  })
})
