import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { EditorView } from 'prosemirror-view'
import { createEditorState, appendContent } from '../../src/editor/state.js'
import { serializeMarkdown } from '../../src/editor/markdown.js'
import { undo } from 'prosemirror-history'
import {
  DRAW_INTERVAL,
  dropPreviewText,
  endPreview,
  previewBlocks,
  previewsOf,
  setPreviewText,
  startPreview,
} from '../../src/editor/streaming.js'

/**
 * @param {import('prosemirror-state').EditorState} state
 * @param {import('prosemirror-state').Transaction|null} tr
 */
const applied = (state, tr) => {
  if (!tr) throw new Error('No transaction')
  return state.apply(tr)
}

describe('previews in the state', () => {
  it('starts and ends one, leaving the document alone', () => {
    const state = createEditorState('Snow fell.')
    const showing = applied(state, startPreview(state, { id: 'a', suggested: false }))
    expect(previewsOf(showing)).toEqual([{ id: 'a', suggested: false }])
    expect(showing.doc.eq(state.doc)).toBe(true)

    const ended = applied(showing, endPreview(showing, 'a'))
    expect(previewsOf(ended)).toEqual([])
  })

  it('keeps them in the order they started, each once', () => {
    let state = createEditorState('Snow fell.')
    state = applied(state, startPreview(state, { id: 'a', suggested: false }))
    state = applied(state, startPreview(state, { id: 'b', suggested: false }))
    expect(startPreview(state, { id: 'a', suggested: false })).toBeNull()
    expect(previewsOf(state).map(each => each.id)).toEqual(['a', 'b'])
  })

  it('has nothing to end that is not shown', () => {
    const state = createEditorState('Snow fell.')
    expect(endPreview(state, 'a')).toBeNull()
  })

  it('leaves nothing to undo', () => {
    let state = createEditorState('Snow fell.')
    state = applied(state, startPreview(state, { id: 'a', suggested: false }))
    state = applied(state, endPreview(state, 'a'))
    expect(undo(state)).toBe(false)
  })
})

describe('previewBlocks', () => {
  it('reads the text as an append would', () => {
    const blocks = previewBlocks('The gate *stood* open.\n\n- one\n- two', false)
    expect(blocks.map(block => block.type.name)).toEqual(['paragraph', 'bullet_list'])
    expect(blocks[0].textContent).toBe('The gate stood open.')
  })

  it('shows nothing for a text with no words yet', () => {
    expect(previewBlocks('', false)).toEqual([])
    expect(previewBlocks('\n\n', false)).toEqual([])
  })

  it('marks what a suggestion would put in', () => {
    const [paragraph, rule] = previewBlocks('The gate stood open.\n\n---', true)
    expect(paragraph.firstChild?.marks.map(mark => mark.type.name)).toEqual(['insertion'])
    expect(rule.marks.map(mark => mark.type.name)).toEqual(['insertion'])
  })
})

describe('a preview in a view', () => {
  /** @type {EditorView|null} */
  let view = null
  /** @type {HTMLElement} */
  let place

  beforeEach(() => {
    vi.useFakeTimers()
    place = document.createElement('div')
    document.body.append(place)
  })

  afterEach(() => {
    view?.destroy()
    view = null
    place.remove()
    dropPreviewText('a')
    dropPreviewText('b')
    vi.useRealTimers()
  })

  /** @param {string} markdown */
  const viewOf = markdown => {
    const made = new EditorView(place, {
      state: createEditorState(markdown),
      dispatchTransaction: tr => made.updateState(made.state.apply(tr)),
    })
    view = made
    return made
  }

  /** @param {EditorView} on @param {import('prosemirror-state').Transaction|null} tr */
  const run = (on, tr) => {
    if (tr) on.dispatch(tr)
  }

  const shownText = () => place.querySelector('.streaming-text')

  it('draws the text after the last block as it comes', () => {
    const on = viewOf('Snow fell on the road.')
    run(on, startPreview(on.state, { id: 'a', suggested: false }))
    setPreviewText('a', 'The gate')
    vi.advanceTimersByTime(DRAW_INTERVAL)

    const shown = shownText()
    expect(shown?.previousElementSibling?.textContent).toBe('Snow fell on the road.')
    expect(shown?.textContent).toBe('The gate')

    setPreviewText('a', 'The gate stood open.\n\nNobody')
    vi.advanceTimersByTime(DRAW_INTERVAL)
    expect([...(shown?.children ?? [])].map(child => child.textContent)).toEqual([
      'The gate stood open.',
      'Nobody',
    ])
    expect(serializeMarkdown(on.state.doc)).toBe('Snow fell on the road.')
  })

  it('redraws only from the block that changed', () => {
    const on = viewOf('Snow fell.')
    setPreviewText('a', 'One.\n\nTwo')
    run(on, startPreview(on.state, { id: 'a', suggested: false }))
    const first = shownText()?.firstElementChild

    setPreviewText('a', 'One.\n\nTwo and three.')
    vi.advanceTimersByTime(DRAW_INTERVAL)
    expect(shownText()?.firstElementChild).toBe(first)
    expect(shownText()?.lastElementChild?.textContent).toBe('Two and three.')
  })

  it('draws at most once a while, however fast the text comes', () => {
    const on = viewOf('Snow fell.')
    run(on, startPreview(on.state, { id: 'a', suggested: false }))
    setPreviewText('a', 'One')
    setPreviewText('a', 'One two')
    setPreviewText('a', 'One two three')
    expect(shownText()?.textContent).toBe('')
    vi.advanceTimersByTime(DRAW_INTERVAL)
    expect(shownText()?.textContent).toBe('One two three')
  })

  it('goes when it ends, and the append puts the same text there', () => {
    const on = viewOf('Snow fell.')
    setPreviewText('a', 'The gate stood open.')
    run(on, startPreview(on.state, { id: 'a', suggested: false }))
    const drawn = shownText()?.innerHTML

    run(on, appendContent(on.state, 'The gate stood open.'))
    run(on, endPreview(on.state, 'a'))
    expect(shownText()).toBeNull()
    expect(on.dom.lastElementChild?.outerHTML).toBe(drawn)
  })

  it('stands in for an empty document, whose line the append replaces', () => {
    const on = viewOf('')
    setPreviewText('a', 'The gate stood open.')
    run(on, startPreview(on.state, { id: 'a', suggested: false }))
    expect(on.dom.firstElementChild?.classList.contains('streaming-hidden')).toBe(true)

    run(on, endPreview(on.state, 'a'))
    expect(place.querySelector('.streaming-hidden')).toBeNull()
  })

  it('shows two in the order they started', () => {
    const on = viewOf('Snow fell.')
    setPreviewText('a', 'First.')
    setPreviewText('b', 'Second.')
    run(on, startPreview(on.state, { id: 'a', suggested: false }))
    run(on, startPreview(on.state, { id: 'b', suggested: false }))
    expect([...place.querySelectorAll('.streaming-text')].map(each => each.textContent)).toEqual([
      'First.',
      'Second.',
    ])
  })

  it('stays at the end while the writer types', () => {
    const on = viewOf('Snow fell.')
    setPreviewText('a', 'The gate stood open.')
    run(on, startPreview(on.state, { id: 'a', suggested: false }))
    run(on, on.state.tr.insertText(' Still.', on.state.doc.content.size - 1))
    expect(serializeMarkdown(on.state.doc)).toBe('Snow fell. Still.')
    expect(on.dom.lastElementChild?.classList.contains('streaming-text')).toBe(true)
  })

  it('shows a suggested one as a suggestion that puts it in', () => {
    const on = viewOf('Snow fell.')
    setPreviewText('a', 'The gate stood open.')
    run(on, startPreview(on.state, { id: 'a', suggested: true }))
    expect(shownText()?.querySelector('ins.suggestion')?.textContent).toBe('The gate stood open.')
  })
})
