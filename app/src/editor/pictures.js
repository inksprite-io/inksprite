/**
 * @module editor/pictures
 * @description Pictures in the editor: each drawn by a node view, a
 * paragraph that is only a picture shown as a figure, a picture opened at its
 * own size on Mod-click or a double click, and pictures pasted, dropped or
 * inserted made the document's own.
 *
 * What a picture's path is the editor component's to say (`describe`): one
 * of the document's own, a file document, an address on the web, or nothing
 * there. The view draws what it is told. A picture whose size is known keeps
 * its room while its bytes are read, so the text below stays where it is.
 * One from the web is never fetched: it is a placeholder naming its host,
 * since a picture that loads by itself sends its address the moment it is
 * on screen, and a model can be led to write one with the writer's words in
 * it. The page's Content-Security-Policy refuses it anyway.
 *
 * Bytes are shown on object URLs, one for each picture however many nodes
 * show it, and let go of a little after the last node goes, so that an undo
 * or a redraw does not read them again.
 *
 * A picture comes in as a file: pasted (a screenshot), dropped from the
 * desktop, or chosen from the menu (`insertPictures`). Pasted HTML that
 * carries a picture in an `img`'s source (`data:`) brings it in the same way.
 * Making it the document's own, and saying its path, is the editor
 * component's (`take`), and so is copying one pasted from another document
 * (`adopt`).
 */

/* global Blob, DOMParser */
import { Fragment, Slice } from 'prosemirror-model'
import { Plugin, TextSelection } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { bytesOfDataUrl } from '@/utils/dataUrl.js'

/**
 * @typedef {import('prosemirror-model').Node} Node
 * @typedef {(blob: Blob, name?: string) => string|null} Take - Make a picture the
 *   document's own, and say its path; null when it cannot be
 * @typedef {import('prosemirror-view').EditorView} EditorView
 * @typedef {import('prosemirror-view').NodeView} NodeView
 * @typedef {import('prosemirror-state').EditorState} EditorState
 */

/**
 * What a picture's path is.
 *
 * - `picture` - Bytes to show: `key` names them, `load` reads them, and
 *   `size` is what they measure, when that is known
 * - `web` - An address on the web, on `host`
 * - `missing` - Nothing there that is a picture; `label` says what was asked for
 *
 * @typedef {{kind: 'picture', key: string, load: () => Promise<Blob|null>, size?: {width: number, height: number}}
 *   | {kind: 'web', host: string}
 *   | {kind: 'missing', label: string}} PictureSource
 */

/** How long an object URL outlives the last node showing it. */
const LINGER = 5000

/** How tall a picture is let be, as CSS, and so how wide one whose size is known. */
const TALLEST = '70vh'

/**
 * Object URLs by the key of the bytes they show.
 *
 * @type {Map<string, {url: Promise<string|null>, users: number, timer: ReturnType<typeof setTimeout>|null}>}
 */
const urls = new Map()

/**
 * An object URL for a picture's bytes, made once for all who show it: the
 * nodes in every editor, and the viewer. Each taken is given back.
 *
 * @param {string} key
 * @param {() => Promise<Blob|null>} load
 * @returns {Promise<string|null>}
 */
export function takePictureUrl(key, load) {
  let held = urls.get(key)
  if (!held) {
    const url = load()
      .then(blob => (blob ? URL.createObjectURL(blob) : null))
      .catch(() => null)
    held = { url, users: 0, timer: null }
    urls.set(key, held)
  }
  if (held.timer) clearTimeout(held.timer)
  held.timer = null
  held.users++
  return held.url
}

/** @param {string} key - One taken with `takePictureUrl` */
export function givePictureUrl(key) {
  const held = urls.get(key)
  if (!held || --held.users > 0) return
  held.timer = setTimeout(() => {
    urls.delete(key)
    held.url.then(url => url && URL.revokeObjectURL(url))
  }, LINGER)
}

/**
 * A placeholder in the text where a picture is not shown.
 *
 * @param {string} className
 * @param {string} words
 * @param {string} [title]
 * @returns {HTMLElement}
 */
function placeholder(className, words, title) {
  const element = document.createElement('span')
  element.className = `picture-placeholder ${className}`
  element.setAttribute('role', 'img')
  element.setAttribute('aria-label', words)
  element.textContent = words
  if (title) element.title = title
  return element
}

/**
 * A picture in the text.
 *
 * @implements {NodeView}
 */
class PictureView {
  /**
   * @param {Node} node
   * @param {(src: string) => PictureSource} describe
   */
  constructor(node, describe) {
    this.node = node
    this.describe = describe
    /** @type {string|null} The bytes this view holds a URL for */
    this.key = null
    this.dom = document.createElement('span')
    this.dom.className = 'picture'
    this.draw()
  }

  /** Draw what the node's path is, in place of what was drawn. */
  draw() {
    this.release()
    this.dom.replaceChildren()
    this.dom.removeAttribute('style')
    this.dom.classList.remove('picture-loading')
    const { src, alt, title } = this.node.attrs
    const source = this.describe(src)
    if (source.kind === 'web') {
      this.dom.append(placeholder('picture-web', `Picture from ${source.host}`, src))
      return
    }
    if (source.kind === 'missing') {
      this.dom.append(placeholder('picture-missing', 'Missing picture', source.label))
      return
    }

    const image = document.createElement('img')
    image.alt = alt || ''
    if (title) image.title = title
    image.decoding = 'async'
    image.draggable = false
    const { size } = source
    if (size?.width && size.height) {
      // The room it will take, kept while it loads.
      const ratio = size.width / size.height
      this.dom.style.width = `min(100%, ${size.width}px, calc(${TALLEST} * ${ratio}))`
      this.dom.style.aspectRatio = `${size.width} / ${size.height}`
    }
    this.dom.classList.add('picture-loading')
    this.dom.append(image)

    const key = source.key
    this.key = key
    // No bytes, or bytes the engine cannot decode: an iPhone's HEIC in Chromium.
    const fail = () => {
      if (this.key !== key) return
      this.release()
      this.dom.replaceChildren(placeholder('picture-missing', 'Missing picture', src))
      this.dom.removeAttribute('style')
      this.dom.classList.remove('picture-loading')
    }
    image.onload = () => this.dom.classList.remove('picture-loading')
    image.onerror = fail
    takePictureUrl(key, source.load).then(url => {
      if (this.key !== key) return
      if (url) image.src = url
      else fail()
    })
  }

  /** @param {Node} node */
  update(node) {
    if (node.type !== this.node.type) return false
    const was = this.node
    this.node = node
    if (node.attrs.src !== was.attrs.src) this.draw()
    else {
      const image = this.dom.querySelector('img')
      if (image) {
        image.alt = node.attrs.alt || ''
        if (node.attrs.title) image.title = node.attrs.title
        else image.removeAttribute('title')
      }
    }
    return true
  }

  /** What is drawn inside is the view's own, not the document's. */
  ignoreMutation() {
    return true
  }

  release() {
    if (this.key) givePictureUrl(this.key)
    this.key = null
  }

  destroy() {
    this.release()
  }
}

/**
 * Whether a textblock is a figure: a picture and nothing else.
 *
 * @param {Node} node
 */
const isFigure = node => node.childCount === 1 && node.firstChild?.type.name === 'image'

/**
 * The figures in a document, marked for the page to set apart.
 *
 * @param {Node} doc
 * @returns {DecorationSet}
 */
function figuresIn(doc) {
  /** @type {Decoration[]} */
  const found = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (isFigure(node)) found.push(figure(pos, node))
    return false
  })
  return DecorationSet.create(doc, found)
}

/** @param {number} pos @param {Node} node */
const figure = (pos, node) =>
  Decoration.node(pos, pos + node.nodeSize, { class: 'figure' }, { figure: true })

/**
 * The figures after a change: those it touched looked at again, the rest
 * moved along with the text.
 *
 * @param {import('prosemirror-state').Transaction} tr
 * @param {DecorationSet} set
 * @returns {DecorationSet}
 */
function figuresAfter(tr, set) {
  let next = set.map(tr.mapping, tr.doc)
  const { doc } = tr
  tr.mapping.maps.forEach((map, index) => {
    const after = tr.mapping.slice(index + 1)
    map.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
      const from = Math.max(0, Math.min(after.map(newFrom, -1), doc.content.size))
      const to = Math.min(doc.content.size, Math.max(after.map(newTo, 1), from + 1))
      doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isTextblock) return true
        // Its own, not the one before that only touches it.
        const own = next.find(pos, pos + node.nodeSize, spec => spec.figure)
        next = next.remove(own.filter(decoration => decoration.from === pos))
        if (isFigure(node)) next = next.add(doc, [figure(pos, node)])
        return false
      })
    })
  })
  return next
}

/**
 * The pictures among a clipboard's or a drop's files.
 *
 * @param {DataTransfer|null|undefined} transfer
 * @returns {File[]}
 */
const picturesIn = transfer =>
  [...(transfer?.files || [])].filter(file => file.type.startsWith('image/'))

/**
 * Whether HTML has words in it, besides any pictures: a page's text copied
 * with its pictures, rather than one picture copied alone.
 *
 * @param {string} html
 */
const hasWords = html =>
  !!new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim()

/**
 * Pictures from files, made the document's own, each named for its file.
 *
 * @param {import('prosemirror-model').Schema} schema
 * @param {Array<File|Blob>} files
 * @param {Take} take
 * @returns {Node[]}
 */
const picturesFrom = (schema, files, take) =>
  files.flatMap(file => {
    const src = take(file, 'name' in file ? file.name : undefined)
    return src ? [schema.nodes.image.create({ src })] : []
  })

/**
 * Put pictures in where the selection is, as the menu's Insert › Picture…
 * does, each made the document's own.
 *
 * @param {EditorView} view
 * @param {Array<File|Blob>} files
 * @param {Take} take
 * @returns {boolean} Whether any went in
 */
export function insertPictures(view, files, take) {
  const nodes = picturesFrom(view.state.schema, files, take)
  if (nodes.length === 0) return false
  const tr = view.state.tr.replaceSelection(new Slice(Fragment.from(nodes), 0, 0))
  view.dispatch(tr.scrollIntoView())
  return true
}

/**
 * Pictures dropped from the desktop, put in where they were dropped.
 *
 * @param {EditorView} view
 * @param {DragEvent} event
 * @param {Take} take
 * @returns {boolean}
 */
function dropPictures(view, event, take) {
  const files = picturesIn(event.dataTransfer)
  const at = files.length > 0 && view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (!at) return false
  const nodes = picturesFrom(view.state.schema, files, take)
  if (nodes.length === 0) return false
  // Fitted in where it lands, a paragraph made around it between blocks.
  const tr = view.state.tr.replaceRange(at.pos, at.pos, new Slice(Fragment.from(nodes), 0, 0))
  const after = TextSelection.near(tr.doc.resolve(tr.mapping.map(at.pos, 1)))
  view.dispatch(tr.setSelection(after).scrollIntoView())
  view.focus()
  return true
}

/**
 * A pasted slice with each picture made the document's own: one carried in
 * its source (`data:image/…`) taken in, and one that cannot be dropped; one
 * another document has copied (`adopt`), once however often it comes.
 *
 * @param {Slice} slice
 * @param {Take} [take]
 * @param {(src: string) => string} [adopt]
 * @returns {Slice}
 */
function adoptPictures(slice, take, adopt) {
  let changed = false
  /** @type {Map<string, string>} Each path the slice has, as it is pasted */
  const adopted = new Map()
  /** @param {Node} node @returns {Node|null} */
  const own = node => {
    const { src } = node.attrs
    let next = src
    if (/^data:/i.test(src)) {
      const held = take && bytesOfDataUrl(src)
      next = held
        ? take(new Blob([/** @type {BlobPart} */ (held.bytes)], { type: held.mime }))
        : null
    } else if (adopt) {
      next = adopted.get(src) ?? adopt(src)
      adopted.set(src, next)
    }
    if (next === src) return node
    changed = true
    return next ? node.type.create({ ...node.attrs, src: next }, null, node.marks) : null
  }
  /** @param {Fragment} fragment @returns {Fragment} */
  const map = fragment => {
    /** @type {Node[]} */
    const nodes = []
    fragment.forEach(node => {
      const kept = node.type.name === 'image' ? own(node) : node
      if (kept) nodes.push(kept.isLeaf ? kept : kept.copy(map(kept.content)))
    })
    return Fragment.from(nodes)
  }
  const content = map(slice.content)
  return changed ? new Slice(content, slice.openStart, slice.openEnd) : slice
}

/**
 * The figures, for every editor state: a paragraph that is only a picture,
 * marked for the page to set apart. Kept as the text changes, only the
 * textblocks a change touched looked at again.
 *
 * @returns {Plugin}
 */
export function figuresPlugin() {
  return new Plugin({
    state: {
      init: (_config, state) => figuresIn(state.doc),
      apply: (tr, set) => (tr.docChanged ? figuresAfter(tr, set) : set),
    },
    props: {
      decorations(state) {
        return this.getState(state)
      },
    },
  })
}

/**
 * Pictures, for a view: drawn, opened, and taken in.
 *
 * @param {Object} options
 * @param {(src: string) => PictureSource} options.describe - What a picture's path is
 * @param {(node: Node) => void} options.open - Show a picture at its own size,
 *   or the page its address names: Mod-click, or a double click. A linked
 *   picture's Mod-click is its link's.
 * @param {Take} [options.take] - Make a picture pasted or dropped the
 *   document's own; without it, files pasted or dropped are left to the editor
 * @param {(src: string) => string} [options.adopt] - The path a picture pasted
 *   in from another document takes here: a copy of its own
 * @returns {Plugin}
 */
export function pictures({ describe, open, take, adopt }) {
  /** @param {Node} node @param {MouseEvent} event */
  const opens = (node, event) => {
    if (node.type.name !== 'image') return false
    open(node)
    event.preventDefault()
    return true
  }
  return new Plugin({
    props: {
      nodeViews: {
        image: node => new PictureView(node, describe),
      },
      handleClickOn(_view, _pos, node, _nodePos, event) {
        if (!(event.metaKey || event.ctrlKey)) return false
        if (node.marks.some(mark => mark.type.name === 'link')) return false
        return opens(node, event)
      },
      handleDoubleClickOn(_view, _pos, node, _nodePos, event) {
        return opens(node, event)
      },
      // A screenshot, or a picture copied alone. A page's words with its
      // pictures are the page's HTML, which the editor reads.
      handlePaste(view, event) {
        const files = take ? picturesIn(event.clipboardData) : []
        if (files.length === 0) return false
        const html = event.clipboardData?.getData('text/html') || ''
        if (html && hasWords(html)) return false
        return insertPictures(view, files, /** @type {Take} */ (take))
      },
      handleDrop(view, event, _slice, moved) {
        if (moved || !take) return false
        return dropPictures(view, /** @type {DragEvent} */ (event), take)
      },
      transformPasted(slice) {
        return take || adopt ? adoptPictures(slice, take, adopt) : slice
      },
    },
  })
}
