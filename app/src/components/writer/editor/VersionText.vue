<template>
  <div ref="scroller" class="overflow-y-auto" data-version-text>
    <div ref="page" class="px-4" />
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import 'prosemirror-view/style/prosemirror.css'
import { COMPARED, versionBetween } from '@/editor/comparison.js'
import { mapHrefs } from '@/editor/links.js'
import { figuresPlugin, pictures } from '@/editor/pictures.js'
import { useDocumentLinks } from '@/composables/useDocumentLinks.js'
import { usePictures } from '@/composables/usePictures.js'

/**
 * A version of a document against its text now, as the editor shows text:
 * headings, emphasis, lists, quotes, code, tables and pictures, and the
 * version's comments and pending suggestions as the editor marks them. What
 * a restore would bring back is tinted, and what it would take out struck
 * through in red (see `editor/comparison`). It opens on the first of them.
 *
 * A view that can't be typed in, over the comparison. A passage copied out of
 * it is the version's own text, what a restore would take out left behind,
 * with its links written from the top of the project as the editor's are.
 * Links don't go anywhere from here.
 *
 * The editor's sheet styles every `.ProseMirror`, so comments, suggestions,
 * tables and pictures look here as they do there; the restore's marks are
 * this view's own.
 *
 * @typedef {Object} Props
 * @property {import('prosemirror-model').Node} doc - The comparison
 * @property {string} storyId
 * @property {string} documentId - The document it is a version of
 */
const props = defineProps({
  doc: { type: Object, required: true },
  storyId: { type: String, required: true },
  documentId: { type: String, required: true },
})

const documentLinks = useDocumentLinks(props.storyId)
const documentPictures = usePictures(props.storyId)

/** @type {import('vue').Ref<HTMLElement|null>} */
const scroller = ref(null)
/** @type {import('vue').Ref<HTMLElement|null>} */
const page = ref(null)
/** @type {EditorView|null} */
let view = null

const plugins = [
  pictures({
    describe: src => documentPictures.describe(src, props.documentId),
    open: node => documentPictures.open(node.attrs.src, props.documentId, node.attrs.alt),
  }),
  figuresPlugin(),
]

/** @param {import('prosemirror-model').Node} doc */
const stateOf = doc => EditorState.create({ doc, plugins })

/**
 * Scrolled to the first thing a restore changes, a third of the way down,
 * when it is below what shows; to the top otherwise.
 */
const toFirstChange = () => {
  const box = scroller.value
  if (!box) return
  const first = box.querySelector(`[data-suggestion-id="${COMPARED}"]`)
  const below = first
    ? first.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
    : 0
  box.scrollTop = below > box.clientHeight * 0.75 ? below - box.clientHeight / 3 : 0
}

onMounted(() => {
  if (!page.value) return
  view = new EditorView(page.value, {
    state: stateOf(/** @type {import('prosemirror-model').Node} */ (props.doc)),
    editable: () => false,
    attributes: {
      class:
        'version-text prose prose-sm font-sans dark:prose-invert max-w-none [&_li>*]:my-0 py-3 focus:outline-none',
    },
    transformCopied: (_slice, editorView) => {
      const { from, to } = editorView.state.selection
      return mapHrefs(versionBetween(editorView.state.doc, from, to), href =>
        documentLinks.copiedHref(href, props.documentId)
      )
    },
    handleDOMEvents: {
      click: (_view, event) => {
        const target = /** @type {Element|null} */ (event.target)
        if (target?.closest?.('a[href]')) event.preventDefault()
        return false
      },
    },
  })
  nextTick(toFirstChange)
})

watch(
  () => props.doc,
  doc => {
    if (!view) return
    // A passage picked in one version is none of the next.
    const picked = window.getSelection()
    if (picked?.anchorNode && view.dom.contains(picked.anchorNode)) picked.removeAllRanges()
    view.updateState(stateOf(/** @type {import('prosemirror-model').Node} */ (doc)))
    nextTick(toFirstChange)
  }
)

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
</script>

<style>
/* What a restore would bring back: tinted, without the underline a
   suggestion put in has. The comparison's marks carry its id, `COMPARED`. */
.ProseMirror.version-text ins.suggestion[data-suggestion-id='~restore'] {
  color: inherit;
  text-decoration: none;
  background-color: rgb(34 197 94 / 0.2);
  border-radius: 0.15em;
}
/* What it would take out: struck through in red, where a suggestion's is
   faded. */
.ProseMirror.version-text del.suggestion[data-suggestion-id='~restore'] {
  color: rgb(185 28 28);
  text-decoration: line-through;
  background-color: rgb(239 68 68 / 0.1);
  border-radius: 0.15em;
}
.dark .ProseMirror.version-text ins.suggestion[data-suggestion-id='~restore'] {
  color: inherit;
  background-color: rgb(34 197 94 / 0.25);
}
.dark .ProseMirror.version-text del.suggestion[data-suggestion-id='~restore'] {
  color: rgb(252 165 165);
  background-color: rgb(239 68 68 / 0.2);
}
/* A block brought back or taken out whole, edged as a suggestion's is. */
.ProseMirror.version-text div.suggestion[data-suggestion-id='~restore'] {
  background-color: rgb(34 197 94 / 0.08);
}
.ProseMirror.version-text div.suggestion[data-suggestion-id='~restore'][data-suggestion='del'] {
  border-left-color: rgb(239 68 68);
  background-color: rgb(239 68 68 / 0.06);
  color: rgb(185 28 28);
  opacity: 1;
}
.dark
  .ProseMirror.version-text
  div.suggestion[data-suggestion-id='~restore'][data-suggestion='del'] {
  color: rgb(252 165 165);
}
/* A comment is only shown here, not opened. */
.ProseMirror.version-text mark.comment {
  cursor: text;
}
</style>
