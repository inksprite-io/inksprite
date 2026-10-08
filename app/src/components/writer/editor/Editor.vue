<template>
  <!-- Escape in the page puts the find away as well, as it does in the bar. -->
  <div
    ref="root"
    class="h-full w-full flex flex-col items-center min-w-0"
    @keydown.esc="finding && closeFind()"
  >
    <!-- Find and replace, over the page rather than in it. See editor/search. -->
    <FindBar
      v-if="finding"
      ref="findBar"
      class="w-full"
      :query="query"
      :count="search?.matches.length ?? 0"
      :current="search?.current ?? -1"
      replaceable
      :replacement="replacement"
      @update:query="lookFor"
      @update:replacement="replacement = $event"
      @next="step(1)"
      @previous="step(-1)"
      @replace="run(replaceCurrent(replacement))"
      @replace-all="run(replaceAll(replacement))"
      @close="closeFind"
    />
    <ScrollPanel
      ref="scrollPanel"
      class="flex-1 w-full min-h-0 min-w-0 overflow-auto overflow-x-hidden"
    >
      <div class="w-full h-full flex flex-col items-center min-w-0">
        <!-- Positioned, so that what is drawn over the text (the link
             popover, the drop cursor) is placed here and scrolls with it. -->
        <div
          ref="host"
          class="relative flex-1 w-full max-w-[50rem] min-w-0 px-4"
          @contextmenu="openTableMenu"
        >
          <LinkPopover
            v-if="linkPopover"
            v-bind="linkPopover"
            @open="openUrl(linkPopover.href)"
            @edit="editLink"
            @remove="unlink"
            @apply="applyLink"
            @close="closeLink"
          />
        </div>
      </div>
    </ScrollPanel>
    <TableMenu ref="tableMenu" />
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, nextTick, computed, ref, watch } from 'vue'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import 'prosemirror-view/style/prosemirror.css'
import 'prosemirror-gapcursor/style/gapcursor.css'
import ScrollPanel from 'primevue/scrollpanel'

import FindBar from '@/components/common/FindBar.vue'
import TableMenu from './TableMenu.vue'
import LinkPopover from './LinkPopover.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { useEditor } from '@/composables/useEditor.js'
import { useFindKey } from '@/composables/useFindKey.js'
import { find, findNext, replaceAll, replaceCurrent, searchOf } from '@/editor/search.js'
import { useDocuments } from '@/composables/useDocuments'
import { useNarration } from '@/composables/useNarration'
import { TINT, speakerRanges } from '@/tts/highlight.js'
import { linkAround, links, normalizeHref, removeLink, setLink } from '@/editor/links.js'
import { openUrl } from '@/platform/open.js'
import { isTextField } from '@/utils/focus.js'

/**
 * @typedef {Object} Props
 * @property {string} storyId - The ID of the current story
 * @property {string} documentId - The ID of the document being shown
 */
const props = defineProps({
  storyId: { type: String, required: true },
  documentId: { type: String, required: true },
})

// The open documents. This component is keyed by document id and mounts a
// view over one of them; the document stays open, in the registry, when the
// view goes — closing is what closing a tab does.
const editor = useEditor()

// The story's document tree
const api = useDocuments(props.storyId)

const currentDocument = computed(() => api.get(props.documentId))

/** Where the view mounts. @type {import('vue').Ref<HTMLElement|null>} */
const host = ref(null)
/** @type {import('vue').Ref<{ $el: HTMLElement }|null>} */
const scrollPanel = ref(null)
/** @type {EditorView|null} */
let view = null

/**
 * The link the caret is in, shown under it, or the field for making or
 * changing one. See `editor/links`.
 *
 * @type {import('vue').Ref<{ href: string, left: number, top: number, editing: boolean, withText: boolean }|null>}
 */
const linkPopover = ref(null)

/**
 * The typography plugin's spacing, tightened for drafting: its sizes are made
 * for reading articles, with lines 1.75 times the text and close to a blank
 * line between paragraphs. In WebKit the caret and a selection are as tall as
 * the line, so a shorter line shortens them too. The line height has to be
 * important to beat the sizes' own, which come later behind a breakpoint.
 * Every list item holds a paragraph, so a tight list would otherwise be
 * spaced as a loose one.
 */
const COMPACT = [
  'leading-normal!',
  'prose-p:my-[0.67em]',
  'prose-headings:mt-[1.2em] prose-headings:mb-[0.4em] [&>:first-child]:mt-0',
  'prose-ul:my-[0.67em] prose-ol:my-[0.67em] prose-li:my-[0.25em] [&_li>*]:my-0',
  'prose-blockquote:my-[1em] prose-hr:my-[1.5em]',
].join(' ')

/** The element that scrolls, inside the scroll panel. */
const scroller = () => scrollPanel.value?.$el?.querySelector?.('.p-scrollpanel-content') ?? null

// While the narration is showing beside the editor, each speaker's lines are
// coloured in the text. Decorations, so nothing is written into the document:
// the speakers are an overlay here as they are everywhere.
const narration = useNarration(props.storyId)
const { highlightSpeakers, compactText } = useApplicationState()

/** What the colouring is made from, or null while there is none to do. */
const highlight = computed(() => {
  if (narration.watching.value === 0 || !highlightSpeakers.value) return null
  const speakers = currentDocument.value?.speakers
  return speakers?.length ? { speakers, voices: narration.voices.value } : null
})

/** The last colouring, kept while neither the text nor its sources change. */
let drawn = { doc: null, source: null, set: DecorationSet.empty }

/** @param {import('prosemirror-state').EditorState} state */
const speakerColouring = state => {
  const source = highlight.value
  if (!source) return DecorationSet.empty
  if (drawn.doc !== state.doc || drawn.source !== source) {
    const ranges = speakerRanges(state.doc, source.speakers, source.voices)
    drawn = {
      doc: state.doc,
      source,
      set: DecorationSet.create(
        state.doc,
        ranges.map(({ from, to, color, name }) =>
          Decoration.inline(from, to, {
            style: `background-color: ${color}${TINT}; border-radius: 0.2em;`,
            title: name,
            'data-speaker': name,
          })
        )
      ),
    }
  }
  return drawn.set
}

/**
 * The speakers' colouring, and while the link field is open, the text it will
 * link: the focus is in the field, and the selection would not show.
 *
 * @param {import('prosemirror-state').EditorState} state
 */
const decorations = state => {
  const set = speakerColouring(state)
  const { from, to } = state.selection
  if (!linkPopover.value?.editing || from === to) return set
  return set.add(state.doc, [Decoration.inline(from, to, { class: 'link-target' })])
}

// The colouring changes from outside the editor — a speaker given, a voice
// recoloured, the panel closed — and the view is told to look again, as it
// is when the link field opens or closes.
watch(highlight, () => view?.setProps({ decorations }))
watch(
  () => linkPopover.value?.editing,
  () => view?.setProps({ decorations })
)

/** The editor's own element's, read again whenever the view updates. */
const attributes = () => ({
  class: `flex-1 prose font-sans dark:prose-invert sm:prose lg:prose-lg focus:outline-none pt-[1rem] pb-[50rem] ${compactText.value ? COMPACT : ''}`,
})
watch(compactText, () => view?.setProps({ attributes }))

/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null)
/** @type {import('vue').Ref<{ focus: () => void }|null>} */
const findBar = ref(null)
const finding = ref(false)
const query = ref('')
const replacement = ref('')

/** The search the document holds, while the find is open. */
const search = computed(() => {
  const state = editor.stateOf(props.documentId)
  return finding.value && state ? searchOf(state) : null
})

/**
 * Bring the match the writer is on into view, a third of the way down, unless
 * it is well in view already. ProseMirror would scroll it only as far as the
 * edge.
 */
const reveal = () => {
  const element = scroller()
  const found = search.value
  const match = found?.matches[found.current]
  if (!view || !element || !match) return
  const at = view.coordsAtPos(match.from)
  const box = element.getBoundingClientRect()
  const margin = Math.min(48, box.height / 4)
  if (at.top >= box.top + margin && at.bottom <= box.bottom - margin) return
  element.scrollTop += at.top - box.top - box.height / 3
}

/**
 * Run a search command against the document, through the view, so that a
 * replacement keeps a previewed tab as an edit would. Then show where it left
 * the writer.
 *
 * @param {import('prosemirror-state').Command} command
 */
const run = command => {
  if (!view) return
  command(view.state, view.dispatch)
  reveal()
}

/** @param {string} text */
const lookFor = text => {
  query.value = text
  run(find(text))
}

/** @param {1|-1} direction */
const step = direction => run(findNext(direction))

/**
 * Open the find, or go back to it, looking for what is selected if that is a
 * few words on one line, and otherwise for what was looked for last.
 *
 * @returns {boolean}
 */
const openFind = () => {
  if (!view) return false
  const { from, to } = view.state.selection
  const selected = view.state.doc.textBetween(from, to, '\n')
  if (selected && !selected.includes('\n') && selected.length <= 200) query.value = selected
  finding.value = true
  lookFor(query.value)
  nextTick(() => findBar.value?.focus())
  return true
}

/** Put the find away, with the caret on the match the writer was on. */
const closeFind = () => {
  if (!finding.value) return
  finding.value = false
  if (!view) return
  find('')(view.state, view.dispatch)
  view.focus()
}

useFindKey(() => root.value, openFind)
defineExpose({ openFind })

/** @type {import('vue').Ref<InstanceType<typeof TableMenu>|null>} */
const tableMenu = ref(null)

/**
 * A right-click in a table opens its menu; anywhere else, the browser's.
 *
 * @param {MouseEvent} event
 */
const openTableMenu = event => {
  if (view && tableMenu.value?.open(view, event)) event.preventDefault()
}

/**
 * Where in the page a popover goes: under the line `pos` is on, and from
 * `from` if that starts on the same line, as the start of a link does.
 *
 * @param {EditorView} editorView
 * @param {number} pos
 * @param {number} [from]
 */
const below = (editorView, pos, from = pos) => {
  const box = /** @type {HTMLElement} */ (host.value).getBoundingClientRect()
  const at = editorView.coordsAtPos(pos)
  const start = editorView.coordsAtPos(from)
  const left = start.bottom > at.top ? start.left : at.left
  return { left: left - box.left, top: at.bottom - box.top + 4 }
}

/**
 * Show the link the caret is in, while the editor has the focus. A field
 * being typed in stays.
 *
 * @param {EditorView} editorView
 */
const showLink = editorView => {
  if (linkPopover.value?.editing) return
  const { selection } = editorView.state
  const around = selection.empty && editorView.hasFocus() ? linkAround(selection.$from) : null
  linkPopover.value = around
    ? {
        href: around.href,
        editing: false,
        withText: false,
        ...below(editorView, selection.head, around.from),
      }
    : null
}

/** The field for the link at the selection: Mod-K, or Edit. */
const editLink = () => {
  if (!view) return
  const { selection } = view.state
  const around = linkAround(selection.$from)
  linkPopover.value = {
    href: around?.href ?? '',
    editing: true,
    withText: selection.empty && !around,
    ...below(view, selection.to, selection.empty ? around?.from : selection.from),
  }
}

/**
 * Make or change the link; an empty address takes it off.
 *
 * @param {{ href: string, text: string }} link
 */
const applyLink = ({ href, text }) => {
  linkPopover.value = null
  if (!view) return
  const address = normalizeHref(href)
  if (address) setLink(address, text.trim())(view.state, view.dispatch)
  else removeLink(view.state, view.dispatch)
  view.focus()
}

const unlink = () => {
  if (view) removeLink(view.state, view.dispatch)
}

/** @param {boolean} refocus - Back to the text, as Escape goes */
const closeLink = refocus => {
  linkPopover.value = null
  if (refocus) view?.focus()
}

/** The tab going to the background is the last chance to write the document out. */
const onVisibilityChange = () => {
  if (document.hidden) editor.flush(props.documentId)
}

let alive = true

onMounted(async () => {
  // Ensure data is ready first (prevents races)
  await api.init()
  if (!alive || !host.value) return

  const id = props.documentId
  const state = editor.open(id, currentDocument.value?.content || '')
  view = new EditorView(host.value, {
    state,
    plugins: [links({ edit: editLink, open: openUrl, update: showLink })],
    decorations,
    dispatchTransaction: tr => {
      editor.dispatch(id, tr)
      // Writing in a preview is keeping it.
      if (tr.docChanged) api.keep(id)
    },
    attributes,
    handleDOMEvents: {
      blur: () => {
        editor.flush(id)
        return false
      },
    },
  })
  editor.attach(id, view)
  document.addEventListener('visibilitychange', onVisibilityChange)
  // The caret comes here, unless the writer is typing somewhere else — naming
  // this very document in the tree, say — in which case it stays there.
  if (!isTextField()) view.focus()

  // A tab coming back is scrolled to where it was left. The content has to be
  // laid out first for the height to be there to scroll to.
  await nextTick()
  const element = scroller()
  if (element) element.scrollTop = editor.scrollTop(id)
})

onBeforeUnmount(() => {
  alive = false
  document.removeEventListener('visibilitychange', onVisibilityChange)
  const id = props.documentId
  const element = scroller()
  if (element) editor.rememberScroll(id, element.scrollTop)
  editor.flush(id)
  // The search goes with the find, which is this view's: the document stays
  // open without it.
  if (finding.value && view) find('')(view.state, view.dispatch)
  editor.attach(id, null)
  view?.destroy()
  view = null
})
</script>
