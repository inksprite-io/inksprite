<template>
  <div ref="scroller" class="pdf-view h-full w-full min-w-0 overflow-auto" data-pdf-view>
    <div v-if="error" class="h-full flex items-center justify-center px-4 text-center">
      <p class="text-surface-500 dark:text-surface-400" data-pdf-error>{{ error }}</p>
    </div>
    <div v-else ref="stack" class="flex flex-col items-center gap-4 px-4 py-4">
      <div
        v-for="page in pages"
        :key="page.number"
        :ref="el => sheet(page, el)"
        class="relative bg-white shadow-md"
        :style="{ width: `${page.width}px`, height: `${page.height}px` }"
        :data-pdf-page="page.number"
        :aria-label="`Page ${page.number}`"
      >
        <canvas class="block w-full h-full"></canvas>
        <div class="textLayer"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* global Blob, IntersectionObserver */
import { markRaw, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { openPdf } from '@/files/pdf.js'

/**
 * A PDF as its pages and nothing else: no toolbar, no side pane, no print
 * button. The pages are stacked and fit to the panel's width, drawn with
 * pdf.js as they scroll into view and let go again as they scroll out, so an
 * eight-hundred-page dissertation costs what the pages on screen cost. Over
 * each drawn page sits pdf.js's text layer, so a passage can be selected and
 * copied into the chat.
 *
 * The browser's own viewer would have done this for no code, but it brings
 * its whole interface along and takes no instruction to leave it behind
 * outside Chrome. WebKitGTK, on the desktop later, has no viewer at all.
 *
 * @typedef {Object} Props
 * @property {Blob} blob - The file
 */
const props = defineProps({
  blob: { type: Blob, required: true },
})

/**
 * One page's place on the stack: its size at the current width, and what is
 * drawn on it.
 *
 * @typedef {Object} Sheet
 * @property {number} number - Counted from one
 * @property {number} width - CSS pixels, at the current fit
 * @property {number} height
 * @property {number} ratio - height / width, from the page itself
 * @property {HTMLElement|null} el
 * @property {{cancel(): void}|null} drawing - The render in flight, if any
 * @property {{cancel(): void}|null} text - The text layer in flight, if any
 * @property {boolean} drawn
 */

/** How far off screen a page is drawn ahead of time: one screen either way. */
const AHEAD = '100% 0px'

const scroller = ref(null)
const stack = ref(null)
/** @type {import('vue').Ref<Sheet[]>} */
const pages = ref([])
const error = ref('')

/** @type {import('vue').ShallowRef<import('@/files/pdf.js').OpenedPdf|null>} */
const opened = shallowRef(null)
/** @type {IntersectionObserver|null} */
let watcher = null
/** @type {ResizeObserver|null} */
let sizer = null
/** The width pages are fit to now, so a resize to the same width draws nothing again. */
let fitWidth = 0
let gone = false

/** @param {Sheet} page @param {any} el */
const sheet = (page, el) => {
  if (page.el === el) return
  if (page.el && watcher) watcher.unobserve(page.el)
  page.el = el
  if (el && watcher) watcher.observe(el)
}

/** The width a page is drawn at: the panel's, less the gutters. */
const widthNow = () => {
  const panel = scroller.value
  if (!panel) return 0
  return Math.max(0, Math.floor(panel.clientWidth - 32))
}

/** Lay the pages out at this width, without drawing any. */
const layout = width => {
  fitWidth = width
  for (const page of pages.value) {
    page.width = width
    page.height = Math.round(width * page.ratio)
  }
}

/** Open the file and set up a sheet for each page, sized from the first. */
const open = async () => {
  const pdf = await openPdf(await props.blob.arrayBuffer(), { fonts: true })
  if (gone) return void pdf.close()
  opened.value = pdf
  const first = await pdf.document.getPage(1)
  const { width, height } = first.getViewport({ scale: 1 })
  const ratio = height / width
  first.cleanup()
  /** @type {Sheet[]} */
  const sheets = []
  for (let number = 1; number <= pdf.document.numPages; number++) {
    sheets.push({
      number,
      width: 0,
      height: 0,
      ratio,
      el: null,
      drawing: null,
      text: null,
      drawn: false,
    })
  }
  pages.value = sheets
  layout(widthNow())
}

/** Draw a page at the current fit, and its text over it. */
const draw = async page => {
  const pdf = opened.value
  if (!pdf || !page.el || page.drawn || page.drawing) return
  const canvas = page.el.querySelector('canvas')
  const layer = page.el.querySelector('.textLayer')
  if (!canvas || !layer) return

  const source = await pdf.document.getPage(page.number)
  if (gone || page.el === null) return
  const base = source.getViewport({ scale: 1 })
  // A page of another size than the first takes its own; the stack shifts a
  // little, which is better than a page drawn squashed.
  const ratio = base.height / base.width
  if (Math.abs(ratio - page.ratio) > 0.001) {
    page.ratio = ratio
    page.height = Math.round(page.width * ratio)
  }
  const scale = page.width / base.width
  const viewport = source.getViewport({ scale })
  const context = canvas.getContext('2d')
  if (!context) return
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(viewport.width * dpr)
  canvas.height = Math.floor(viewport.height * dpr)

  const task = source.render({
    canvasContext: context,
    viewport,
    transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
  })
  // Kept raw: pdf.js's classes have private fields, which a reactive proxy cannot reach.
  page.drawing = markRaw(task)
  layer.replaceChildren()
  layer.style.setProperty('--scale-factor', String(scale))
  const text = new pdf.lib.TextLayer({
    textContentSource: source.streamTextContent(),
    container: layer,
    viewport,
  })
  page.text = markRaw(text)
  try {
    await Promise.all([task.promise, text.render()])
    page.drawn = true
  } catch (failure) {
    // A cancelled draw is the page scrolling away, not a fault.
    if (!/cancel/i.test(String(failure?.name || failure))) console.error(failure)
  } finally {
    if (page.drawing === task) page.drawing = null
    if (page.text === text) page.text = null
  }
}

/** Let a page's drawing go, so it can be drawn again or forgotten. */
const clear = page => {
  page.drawing?.cancel()
  page.text?.cancel()
  page.drawing = null
  page.text = null
  page.drawn = false
  const canvas = page.el?.querySelector('canvas')
  if (canvas) {
    canvas.width = 0
    canvas.height = 0
  }
  page.el?.querySelector('.textLayer')?.replaceChildren()
}

/** Watch the pages come and go, drawing and clearing as they do. */
const watchPages = () => {
  if (typeof IntersectionObserver === 'undefined') {
    // Nowhere to watch from — under test — so every page is drawn.
    for (const page of pages.value) draw(page)
    return
  }
  watcher = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        const page = pages.value.find(candidate => candidate.el === entry.target)
        if (!page) continue
        if (entry.isIntersecting) draw(page)
        else clear(page)
      }
    },
    { root: scroller.value, rootMargin: AHEAD }
  )
  for (const page of pages.value) if (page.el) watcher.observe(page.el)
}

/** Fit the pages to the panel again when its width changes. */
const watchWidth = () => {
  if (typeof ResizeObserver === 'undefined' || !scroller.value) return
  sizer = new ResizeObserver(async () => {
    const panel = scroller.value
    const width = widthNow()
    if (!panel || !width || width === fitWidth) return
    // Every sheet scales alike, so the place kept is a fraction of the whole.
    const place = panel.scrollHeight > 0 ? panel.scrollTop / panel.scrollHeight : 0
    for (const page of pages.value) clear(page)
    layout(width)
    await nextTick()
    if (gone) return
    panel.scrollTop = place * panel.scrollHeight
    // Watched afresh, so the pages on screen are drawn at the new fit.
    for (const page of pages.value) {
      if (!page.el || !watcher) continue
      watcher.unobserve(page.el)
      watcher.observe(page.el)
    }
  })
  sizer.observe(scroller.value)
}

onMounted(async () => {
  try {
    await open()
  } catch (failure) {
    error.value = 'This PDF could not be opened.'
    console.error(failure)
    return
  }
  if (gone) return
  watchWidth()
  // The sheets are in the DOM once Vue has drawn the list.
  await new Promise(resolve => requestAnimationFrame(resolve))
  if (!gone) watchPages()
})

onBeforeUnmount(() => {
  gone = true
  watcher?.disconnect()
  sizer?.disconnect()
  for (const page of pages.value) clear(page)
  opened.value?.close()
  opened.value = null
})
</script>

<style>
/* pdf.js's text layer, as its own stylesheet lays it out: transparent text
   placed over the drawing, sized by the page's scale, selectable. */
.pdf-view .textLayer {
  --user-unit: 1;
  --total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
  color-scheme: only light;
  position: absolute;
  text-align: initial;
  inset: 0;
  overflow: clip;
  opacity: 1;
  line-height: 1;
  letter-spacing: normal;
  word-spacing: normal;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: CanvasText;
  z-index: 0;
}
.pdf-view .textLayer :is(span, br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  user-select: text;
}
.pdf-view .textLayer > :not(.markedContent),
.pdf-view .textLayer .markedContent span:not(.markedContent) {
  z-index: 1;
  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
.pdf-view .textLayer .markedContent {
  display: contents;
}
.pdf-view .textLayer span[role='img'] {
  user-select: none;
  cursor: default;
}
.pdf-view .textLayer ::selection {
  background: rgb(0 0 255 / 0.25);
}
.pdf-view .textLayer br::selection {
  background: transparent;
}
.pdf-view .textLayer .endOfContent {
  display: block;
  position: absolute;
  inset: 100% 0 0;
  z-index: 0;
  cursor: default;
  user-select: none;
}
.pdf-view .textLayer.selecting .endOfContent {
  top: 0;
}
</style>
