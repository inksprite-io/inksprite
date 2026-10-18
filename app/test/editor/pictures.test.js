/* global Blob, File */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { EditorView } from 'prosemirror-view'
import { createEditorState } from '@/editor/state.js'
import { Slice, Fragment } from 'prosemirror-model'
import { serializeMarkdown } from '@/editor/markdown.js'
import { insertPictures, pictures, takePictureUrl, givePictureUrl } from '@/editor/pictures.js'

/** @typedef {import('@/editor/pictures.js').PictureSource} PictureSource */

let made = 0
URL.createObjectURL = vi.fn(() => `blob:picture-${++made}`)
URL.revokeObjectURL = vi.fn()

/** @type {EditorView|null} */
let view = null

afterEach(() => {
  view?.destroy()
  view = null
})

const bytes = () => new Blob(['png'], { type: 'image/png' })

/**
 * A view over `markdown`, its pictures described by `describe`.
 *
 * @param {string} markdown
 * @param {(src: string) => PictureSource} describe
 */
const mount = (markdown, describe) => {
  const open = vi.fn()
  view = new EditorView(document.createElement('div'), {
    state: createEditorState(markdown),
    plugins: [pictures({ describe, open })],
  })
  return { view, open }
}

const settled = () => new Promise(resolve => setTimeout(resolve, 0))

describe('pictures in the editor', () => {
  it('draws a picture from its bytes, its room kept from its size', async () => {
    const load = vi.fn(async () => bytes())
    const { view } = mount('![A map](.images/doc_a1/map.png "The quarter")', () => ({
      kind: 'picture',
      key: 'doc_a1/map.png',
      load,
      size: { width: 800, height: 600 },
    }))
    const picture = /** @type {HTMLElement} */ (view.dom.querySelector('.picture'))
    const image = /** @type {HTMLImageElement} */ (picture.querySelector('img'))

    expect(image.alt).toBe('A map')
    expect(image.title).toBe('The quarter')
    expect(picture.style.aspectRatio).toBe('800 / 600')
    await settled()
    expect(image.getAttribute('src')).toMatch(/^blob:picture-/)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('reads the bytes once for every node that shows them', async () => {
    const load = vi.fn(async () => bytes())
    const { view } = mount('![](a.png) and ![](a.png)', () => ({
      kind: 'picture',
      key: 'shared',
      load,
    }))
    await settled()
    const sources = [...view.dom.querySelectorAll('img')].map(image => image.getAttribute('src'))
    expect(sources[0]).toBe(sources[1])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('never fetches a picture from the web, and names its host', () => {
    const { view } = mount('![](https://example.com/gate.png)', () => ({
      kind: 'web',
      host: 'example.com',
    }))
    expect(view.dom.querySelector('img')).toBe(null)
    expect(view.dom.querySelector('.picture-web')?.textContent).toBe('Picture from example.com')
  })

  it('says a picture is missing when it is not there, or has no bytes', async () => {
    const { view } = mount('![](Maps/gone.png) ![](b.png)', src =>
      src === 'b.png'
        ? { kind: 'picture', key: 'empty', load: async () => null }
        : { kind: 'missing', label: 'Maps/gone.png' }
    )
    await settled()
    const missing = [...view.dom.querySelectorAll('.picture-missing')]
    expect(missing.map(element => element.textContent)).toEqual([
      'Missing picture',
      'Missing picture',
    ])
    expect(/** @type {HTMLElement} */ (missing[0]).title).toBe('Maps/gone.png')
  })

  it('opens a picture on a double click and on Mod-click, and leaves a linked one to its link', () => {
    const { view, open } = mount('![](a.png) [![](b.png)](https://example.com)', () => ({
      kind: 'missing',
      label: '',
    }))
    const first = view.state.doc.firstChild?.firstChild
    const linked = view.state.doc.firstChild?.lastChild
    const click = (/** @type {boolean} */ mod) =>
      /** @type {MouseEvent} */ (
        /** @type {unknown} */ ({ metaKey: mod, ctrlKey: false, preventDefault: vi.fn() })
      )

    view.someProp('handleDoubleClickOn', handle => handle(view, 1, first, 1, click(false), true))
    expect(open).toHaveBeenCalledWith(first)
    open.mockClear()

    view.someProp('handleClickOn', handle => handle(view, 1, first, 1, click(false), true))
    expect(open).not.toHaveBeenCalled()
    view.someProp('handleClickOn', handle => handle(view, 1, first, 1, click(true), true))
    expect(open).toHaveBeenCalledTimes(1)
    open.mockClear()

    view.someProp('handleClickOn', handle => handle(view, 1, linked, 1, click(true), true))
    expect(open).not.toHaveBeenCalled()
  })
})

describe('pictures coming in', () => {
  const png = (/** @type {string} */ name) => new File(['png'], name, { type: 'image/png' })

  /** A view whose `take` names each picture for its file, as the editor's does. */
  const taking = (/** @type {string} */ markdown) => {
    const take = vi.fn((/** @type {Blob} */ blob, /** @type {string|undefined} */ name) =>
      blob.type.startsWith('image/') ? `.images/doc_a1/${name || 'image.png'}` : null
    )
    view = new EditorView(document.createElement('div'), {
      state: createEditorState(markdown),
      plugins: [
        pictures({ describe: () => ({ kind: 'missing', label: '' }), open: vi.fn(), take }),
      ],
    })
    return { view, take }
  }

  /** A clipboard or a drop holding these files, and this HTML. */
  const transfer = (/** @type {File[]} */ files, html = '') =>
    /** @type {DataTransfer} */ (
      /** @type {unknown} */ ({
        files,
        types: html ? ['text/html', 'Files'] : ['Files'],
        getData: (/** @type {string} */ type) => (type === 'text/html' ? html : ''),
      })
    )

  const paste = (/** @type {EditorView} */ editorView, /** @type {DataTransfer} */ data) => {
    const event = /** @type {ClipboardEvent} */ (/** @type {unknown} */ ({ clipboardData: data }))
    return editorView.someProp('handlePaste', handle => handle(editorView, event, Slice.empty))
  }

  it('pastes a screenshot as a picture of its own, where the caret is', () => {
    const { view, take } = taking('The gate stood.')
    expect(paste(view, transfer([png('image.png')]))).toBe(true)
    expect(take).toHaveBeenCalledWith(expect.any(File), 'image.png')
    expect(serializeMarkdown(view.state.doc)).toBe('The gate stood.![](.images/doc_a1/image.png)')
  })

  it("leaves a page's words with their pictures to the editor's own paste", () => {
    const { view, take } = taking('Words.')
    const html = '<p>The gate <img src="https://example.com/a.png"> stood.</p>'
    expect(paste(view, transfer([png('a.png')], html))).toBeFalsy()
    expect(take).not.toHaveBeenCalled()
  })

  it('pastes a picture copied alone, its HTML only the picture', () => {
    const { view } = taking('Words.')
    const html = '<img src="https://example.com/a.png">'
    expect(paste(view, transfer([png('a.png')], html))).toBe(true)
  })

  it('drops pictures from the desktop where they land, each its own', () => {
    const { view } = taking('The gate stood.')
    view.posAtCoords = () => ({ pos: 5, inside: -1 })
    const event = /** @type {DragEvent} */ (
      /** @type {unknown} */ ({
        dataTransfer: transfer([png('gate.png'), png('wall.png')]),
        clientX: 0,
        clientY: 0,
      })
    )
    const dropped = view.someProp('handleDrop', handle => handle(view, event, Slice.empty, false))
    expect(dropped).toBe(true)
    expect(serializeMarkdown(view.state.doc)).toBe(
      'The ![](.images/doc_a1/gate.png)![](.images/doc_a1/wall.png)gate stood.'
    )
  })

  it('leaves a drag within the text, and files that are not pictures, alone', () => {
    const { view } = taking('Words.')
    const event = /** @type {DragEvent} */ (
      /** @type {unknown} */ ({ dataTransfer: transfer([png('a.png')]), clientX: 0, clientY: 0 })
    )
    expect(
      view.someProp('handleDrop', handle => handle(view, event, Slice.empty, true))
    ).toBeFalsy()
    const pdf = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })
    expect(paste(view, transfer([pdf]))).toBeFalsy()
  })

  it("makes a picture carried in pasted HTML the document's own, and drops one it cannot keep", () => {
    const { view, take } = taking('Words.')
    const image = view.state.schema.nodes.image
    const slice = new Slice(
      Fragment.from(
        view.state.schema.nodes.paragraph.create(null, [
          image.create({ src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'A seal' }),
          image.create({ src: 'data:text/plain;base64,aGk=' }),
          image.create({ src: 'https://example.com/b.png' }),
        ])
      ),
      1,
      1
    )
    /** @type {Slice} */
    let pasted = slice
    view.someProp('transformPasted', transform => {
      pasted = transform(pasted, view, false)
    })
    const sources = []
    pasted.content.descendants(node => {
      if (node.type === image) sources.push([node.attrs.src, node.attrs.alt])
    })
    expect(sources).toEqual([
      ['.images/doc_a1/image.png', 'A seal'],
      ['https://example.com/b.png', null],
    ])
    expect(take).toHaveBeenCalledTimes(2)
  })

  it('copies a picture pasted from another document, once however often it comes', () => {
    const adopt = vi.fn((/** @type {string} */ src) => src.replace('doc_b2', 'doc_a1'))
    view = new EditorView(document.createElement('div'), {
      state: createEditorState('Words.'),
      plugins: [
        pictures({ describe: () => ({ kind: 'missing', label: '' }), open: vi.fn(), adopt }),
      ],
    })
    const image = view.state.schema.nodes.image
    const slice = new Slice(
      Fragment.from(
        view.state.schema.nodes.paragraph.create(null, [
          image.create({ src: '.images/doc_b2/gate.png' }),
          image.create({ src: '.images/doc_b2/gate.png' }),
        ])
      ),
      1,
      1
    )
    /** @type {Slice} */
    let pasted = slice
    view.someProp('transformPasted', transform => {
      pasted = transform(pasted, view, false)
    })
    const sources = []
    pasted.content.descendants(node => {
      if (node.type === image) sources.push(node.attrs.src)
    })
    expect(sources).toEqual(['.images/doc_a1/gate.png', '.images/doc_a1/gate.png'])
    expect(adopt).toHaveBeenCalledTimes(1)
  })

  it('inserts pictures chosen from the disk at the selection', () => {
    const { view, take } = taking('The gate.')
    expect(insertPictures(view, [png('map.png')], take)).toBe(true)
    expect(serializeMarkdown(view.state.doc)).toBe('The gate.![](.images/doc_a1/map.png)')
  })
})

describe('figures', () => {
  const figures = (/** @type {import('prosemirror-state').EditorState} */ state) => {
    const view = new EditorView(document.createElement('div'), { state })
    const found = [...view.dom.querySelectorAll('.figure')].map(element => element.textContent)
    const count = view.dom.querySelectorAll('.figure').length
    view.destroy()
    return { found, count }
  }

  it('marks a paragraph that is only a picture, and not one with words', () => {
    const state = createEditorState('![](a.png)\n\nWords ![](b.png)\n\n![](c.png)')
    expect(figures(state).count).toBe(2)
  })

  it('keeps them as the text changes', () => {
    let state = createEditorState('![](a.png)\n\nWords')
    expect(figures(state).count).toBe(1)

    // Words typed beside the picture make it part of a sentence.
    state = state.apply(state.tr.insertText('See ', 1))
    expect(figures(state).count).toBe(0)

    // And taken away again, a figure once more.
    state = state.apply(state.tr.delete(1, 5))
    expect(figures(state).count).toBe(1)

    // A picture put alone in the second paragraph.
    const second = state.doc.child(0).nodeSize
    const picture = state.schema.nodes.image.create({ src: 'd.png' })
    state = state.apply(state.tr.replaceWith(second + 1, second + 6, picture))
    expect(figures(state).count).toBe(2)
  })
})

describe('object URLs', () => {
  it('lets a URL go a little after the last one showing it is done', async () => {
    vi.useFakeTimers()
    try {
      const url = await takePictureUrl('lingering', async () => bytes())
      givePictureUrl('lingering')
      expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(url)

      // Taken again in time, it is the same URL.
      expect(await takePictureUrl('lingering', async () => bytes())).toBe(url)
      givePictureUrl('lingering')
      await vi.runAllTimersAsync()
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
    } finally {
      vi.useRealTimers()
    }
  })
})
