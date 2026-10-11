<template>
  <!-- Escape in the page puts the find away as well, as it does in the bar. -->
  <div
    ref="root"
    class="h-full w-full flex flex-col items-center min-w-0"
    :style="{ paddingBottom: barShown && covered ? `${covered}px` : undefined }"
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
      refinable
      :match-case="matchCase"
      :whole-word="wholeWord"
      replaceable
      :replacement="replacement"
      @update:query="lookFor"
      @update:match-case="refine({ matchCase: $event })"
      @update:whole-word="refine({ wholeWord: $event })"
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
        <!-- Positioned, so that what is drawn over the text (the popovers,
             the drop cursor) is placed here and scrolls with it. -->
        <div
          ref="host"
          class="relative flex-1 w-full max-w-[50rem] min-w-0 px-4"
          @contextmenu="openTableMenu"
        >
          <!-- The view's own element, so that Vue, which adds and removes
               the popovers beside it, finds no node here it did not make. -->
          <div ref="page" />
          <LinkPopover
            v-if="linkPopover"
            v-bind="linkPopover"
            @open="openUrl(linkPopover.href)"
            @edit="editLink"
            @remove="unlink"
            @apply="applyLink"
            @close="closeLink"
          />
          <CommentButton
            v-if="commentButton && !isMobile"
            :left="commentButton.left"
            :top="commentButton.top"
            @comment="commentOn(commentButton.from, commentButton.to)"
          />
          <CommentPopover
            v-if="commentPopover && !isMobile"
            :text="commentPopover.text"
            :left="commentPopover.left"
            :top="commentPopover.top"
            :editing="commentPopover.editing"
            :existing="!!commentPopover.id"
            @edit="commentPopover.id && editComment(commentPopover.id)"
            @resolve="resolveComment"
            @save="saveComment"
            @close="closeComment"
          />
        </div>
      </div>
    </ScrollPanel>
    <!-- On a phone the button, the comment and the field are in a bar at the
         bottom instead, clear of the menu iOS keeps beside a selection, and
         lifted over the keyboard where iOS lets it cover the page. -->
    <div
      v-if="barShown"
      class="w-full flex-none border-t border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-900 px-2 py-1"
      data-comment-bar
    >
      <CommentButton
        v-if="commentButton"
        docked
        @comment="commentOn(commentButton.from, commentButton.to)"
      />
      <CommentPopover
        v-else-if="commentPopover"
        docked
        :text="commentPopover.text"
        :editing="commentPopover.editing"
        :existing="!!commentPopover.id"
        @edit="commentPopover.id && editComment(commentPopover.id)"
        @resolve="resolveComment"
        @save="saveComment"
        @close="closeComment"
      />
    </div>
    <TableMenu ref="tableMenu" />
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, nextTick, computed, ref, watch } from 'vue'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { Plugin, TextSelection } from 'prosemirror-state'
import 'prosemirror-view/style/prosemirror.css'
import 'prosemirror-gapcursor/style/gapcursor.css'
import ScrollPanel from 'primevue/scrollpanel'

import FindBar from '@/components/common/FindBar.vue'
import TableMenu from './TableMenu.vue'
import LinkPopover from './LinkPopover.vue'
import CommentButton from './CommentButton.vue'
import CommentPopover from './CommentPopover.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { useKeyboardCover } from '@/composables/useKeyboardCover.js'
import { useScreenSize } from '@/composables/useScreenSize.js'
import { useEditor } from '@/composables/useEditor.js'
import { useFindKey } from '@/composables/useFindKey.js'
import { find, findNext, replaceAll, replaceCurrent, searchOf } from '@/editor/search.js'
import { isEmptyDocument } from '@/editor/state.js'
import { isShortcutsKey } from '@/editor/shortcuts.js'
import { useDocuments } from '@/composables/useDocuments'
import { useNarration } from '@/composables/useNarration'
import { cleanComment, commentAround, commentRanges, newCommentId } from '@/editor/comments.js'
import {
  currentComment,
  goToComment,
  leaveComment,
  takeUpComment,
} from '@/composables/useComments.js'
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

/** `shortcuts`: the writer asked for the list of keys. */
const emit = defineEmits(['shortcuts'])

// The open documents. This component is keyed by document id and mounts a
// view over one of them; the document stays open, in the registry, when the
// view goes — closing is what closing a tab does.
const editor = useEditor()

// The story's document tree
const api = useDocuments(props.storyId)

const currentDocument = computed(() => api.get(props.documentId))

/** What the popovers are placed in. @type {import('vue').Ref<HTMLElement|null>} */
const host = ref(null)
/** Where the view mounts. @type {import('vue').Ref<HTMLElement|null>} */
const page = ref(null)
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

/**
 * The comment the caret is in, shown under it, or the field for writing one
 * on a passage or changing what was said: `id` is null for a new one, and
 * `from` and `to` are the passage the field is on. A change to the document
 * from elsewhere while the field is open puts it away, since the range may
 * no longer be the passage.
 *
 * @type {import('vue').Ref<{ id: string|null, text: string, from: number, to: number, left: number, top: number, editing: boolean }|null>}
 */
const commentPopover = ref(null)

/**
 * The field for a new comment on a run of text: the selection, or the one
 * the comment button was offered on.
 *
 * @param {number} from
 * @param {number} to
 */
const commentOn = (from, to) => {
  if (!view || from === to) return false
  commentButton.value = null
  linkPopover.value = null
  commentPopover.value = { id: null, text: '', from, to, editing: true, ...below(view, to, from) }
  return true
}

/**
 * The field for changing a comment already on the text, where the comment
 * was showing or else under the caret.
 *
 * @param {string} id
 */
const editComment = id => {
  if (!view) return false
  const ranges = commentRanges(view.state.doc).filter(range => range.id === id)
  if (ranges.length === 0) return false
  const shown = commentPopover.value
  const place = shown
    ? { left: shown.left, top: shown.top }
    : below(view, view.state.selection.head)
  commentPopover.value = {
    id,
    text: ranges[0].text,
    from: ranges[0].from,
    to: ranges[ranges.length - 1].to,
    editing: true,
    ...place,
  }
  return true
}

/** @param {string} text */
const saveComment = text => {
  const comment = commentPopover.value
  commentPopover.value = null
  if (!view || !comment) return
  const type = view.state.schema.marks.comment
  const id = comment.id || newCommentId()
  const tr = view.state.tr
    .removeMark(comment.from, comment.to, type)
    .addMark(comment.from, comment.to, type.create({ id, text: cleanComment(text) }))
  // The caret after the passage, so what is selected is not offered again.
  tr.setSelection(TextSelection.create(tr.doc, comment.to))
  view.dispatch(tr)
  view.focus()
}

/** Take the comment off; the passage stays as it is. */
const resolveComment = () => {
  const comment = commentPopover.value
  commentPopover.value = null
  if (!view || !comment?.id) return
  const type = view.state.schema.marks.comment
  const tr = view.state.tr
  for (const range of commentRanges(view.state.doc)) {
    if (range.id === comment.id) tr.removeMark(range.from, range.to, type)
  }
  leaveComment(props.documentId)
  view.dispatch(tr)
}

/** @param {boolean} refocus - Back to the text, as Escape goes */
const closeComment = refocus => {
  commentPopover.value = null
  if (refocus) view?.focus()
}

/**
 * Whether the text has changed since the caret last moved. A passage can run
 * for a paragraph, and its comment is not to sit over the line being written.
 */
let typing = false

/**
 * Show the comment the caret is in, while the editor has the focus and the
 * writer is not typing; in a link, the link shows there instead. A field
 * being typed in stays, unless the text changed under it.
 *
 * @param {EditorView} editorView
 * @param {import('prosemirror-state').EditorState} [prevState] - None for the focus coming or going
 */
const showComment = (editorView, prevState) => {
  const { state } = editorView
  const changed = !!prevState && state.doc !== prevState.doc
  if (changed) typing = true
  else if (!prevState || !state.selection.eq(prevState.selection)) typing = false
  if (commentPopover.value?.editing) {
    if (changed) commentPopover.value = null
    return
  }
  const { selection } = state
  const around =
    selection.empty && editorView.hasFocus() && !typing && !linkAround(selection.$from)
      ? commentAround(selection.$from)
      : null
  commentPopover.value = around
    ? { ...around, editing: false, ...below(editorView, selection.head, around.from) }
    : null
}

/**
 * Keep the current comment the one the writer is in: the caret moving into a
 * passage makes its comment current, already in view, and moving out lets it
 * go. Only the writer moving it, in the text — a click, an arrow key — and
 * not the caret carried along by an edit, so that a comment the list went to
 * stays current until they move on from it. Read off the view's update, once
 * the caret is where a click put it: marking the comment redraws the text,
 * and a redraw before then would put the caret back.
 *
 * @param {EditorView} editorView
 * @param {import('prosemirror-state').EditorState} prevState
 */
const followCaret = (editorView, prevState) => {
  const { doc, selection } = editorView.state
  const moved = doc === prevState.doc && !selection.eq(prevState.selection)
  if (!moved || !editorView.hasFocus()) return
  const around = selection.empty ? commentAround(selection.$from) : null
  const current = currentComment.value
  if (!around) leaveComment(props.documentId)
  else if (current?.documentId !== props.documentId || current.id !== around.id) {
    goToComment(props.documentId, around.id)
    takeUpComment(props.documentId)
  }
}

/**
 * Where the comment button is, and the run of text it was offered on. Taken
 * when it is shown, since a tap on it can let go of a phone's selection.
 *
 * @type {import('vue').Ref<{left: number, top: number, from: number, to: number}|null>}
 */
const commentButton = ref(null)

/** Whether the mouse is down making a selection, which is offered once it lets go. */
let selecting = false

/**
 * Offer to comment on the selected text, while the editor has the focus and
 * no comment is being written. A selection of something other than text — a
 * table's cells, the whole document — is left to the shortcut.
 *
 * @param {EditorView} editorView
 */
const showCommentButton = editorView => {
  const { selection } = editorView.state
  const offered =
    selection instanceof TextSelection &&
    !selection.empty &&
    !selecting &&
    !commentPopover.value?.editing &&
    editorView.hasFocus()
  commentButton.value = offered
    ? { ...below(editorView, selection.to), from: selection.from, to: selection.to }
    : null
}

const onMouseUp = () => {
  selecting = false
  // ProseMirror reads the selection the mouse left a moment after it lets go.
  requestAnimationFrame(() => view && showCommentButton(view))
}

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
 * The speakers' colouring, and while the link or comment field is open, the
 * text it is on: the focus is in the field, and the selection would not show.
 * A document with nothing in it shows where to start.
 *
 * @param {import('prosemirror-state').EditorState} state
 */
const decorations = state => {
  let set = currentMarking(state, speakerColouring(state))
  if (isEmptyDocument(state.doc)) {
    set = set.add(state.doc, [
      Decoration.node(0, state.doc.firstChild.nodeSize, {
        class: 'placeholder',
        'data-placeholder': PLACEHOLDER,
      }),
    ])
  }
  const target = fieldTarget(state)
  if (!target) return set
  return set.add(state.doc, [Decoration.inline(target.from, target.to, { class: 'field-target' })])
}

/** What an empty document shows, in the line the writing starts on. */
const PLACEHOLDER = 'Start writing…'

/**
 * What the open field acts on: the comment field's passage, or the
 * selection the link field will link.
 *
 * @param {import('prosemirror-state').EditorState} state
 * @returns {{from: number, to: number}|null}
 */
const fieldTarget = state => {
  if (commentPopover.value?.editing) return commentPopover.value
  const { from, to } = state.selection
  return linkPopover.value?.editing && from !== to ? { from, to } : null
}

/**
 * The comment gone to last, marked over its highlight while it is this
 * document's: the one the comments list picked, or the one the caret is in.
 *
 * @param {import('prosemirror-state').EditorState} state
 * @param {DecorationSet} set
 */
const currentMarking = (state, set) => {
  const current = currentComment.value
  if (current?.documentId !== props.documentId) return set
  const ranges = commentRanges(state.doc).filter(range => range.id === current.id)
  if (ranges.length === 0) return set
  return set.add(
    state.doc,
    ranges.map(range => Decoration.inline(range.from, range.to, { class: 'comment-current' }))
  )
}

/**
 * Bring the current comment into view when it was gone to in this document
 * and nothing has yet: the list picked it with the document showing, or the
 * going opened the document.
 */
const goToCurrent = () => {
  if (!view) return
  const going = takeUpComment(props.documentId)
  const range = going && commentRanges(view.state.doc).find(range => range.id === going.id)
  if (range) bringIntoView(range.from)
}

watch(currentComment, () => {
  view?.setProps({ decorations })
  goToCurrent()
})

// The colouring changes from outside the editor — a speaker given, a voice
// recoloured, the panel closed — and the view is told to look again, as it
// is when the link or comment field opens or closes.
watch(highlight, () => view?.setProps({ decorations }))
watch([() => !!linkPopover.value?.editing, () => !!commentPopover.value?.editing], () =>
  view?.setProps({ decorations })
)

/**
 * The editor's own element's, read again whenever the view updates. The room
 * under the text lets its last line come up to the middle of the screen, and
 * no further, so a short document has nothing to scroll.
 */
const attributes = () => ({
  class: `flex-1 prose font-sans dark:prose-invert sm:prose lg:prose-lg focus:outline-none pt-[1rem] pb-[50vh] ${compactText.value ? COMPACT : ''}`,
})
watch(compactText, () => view?.setProps({ attributes }))

/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null)

const { isMobile } = useScreenSize()
/** How much of the editor the keyboard covers, which iOS lets it. */
const covered = useKeyboardCover(root)

/** The phone's comment bar is up: the button, a comment, or the field. */
const barShown = computed(() => isMobile.value && !!(commentButton.value || commentPopover.value))

/**
 * What the bar holds, for keeping what it is about in sight above it: the
 * bar takes the bottom of the screen, and the text scrolls over less.
 */
const inBar = computed(() => {
  if (!isMobile.value) return ''
  if (commentPopover.value) return commentPopover.value.editing ? 'field' : 'comment'
  return commentButton.value ? 'button' : ''
})
watch(inBar, holds => {
  if (holds) nextTick(() => view?.dispatch(view.state.tr.scrollIntoView()))
})

/** @type {import('vue').Ref<{ focus: () => void }|null>} */
const findBar = ref(null)
const finding = ref(false)
const query = ref('')
const matchCase = ref(false)
const wholeWord = ref(false)
const replacement = ref('')

/** The search the document holds, while the find is open. */
const search = computed(() => {
  const state = editor.stateOf(props.documentId)
  return finding.value && state ? searchOf(state) : null
})

/**
 * Bring a place in the text into view, a third of the way down, unless it is
 * well in view already. ProseMirror would scroll it only as far as the edge.
 *
 * @param {number} pos
 */
const bringIntoView = pos => {
  const element = scroller()
  if (!view || !element) return
  const at = view.coordsAtPos(pos)
  const box = element.getBoundingClientRect()
  const margin = Math.min(48, box.height / 4)
  if (at.top >= box.top + margin && at.bottom <= box.bottom - margin) return
  element.scrollTop += at.top - box.top - box.height / 3
}

/** Bring the match the writer is on into view. */
const reveal = () => {
  const found = search.value
  const match = found?.matches[found.current]
  if (match) bringIntoView(match.from)
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
  run(find(text, { matchCase: matchCase.value, wholeWord: wholeWord.value }))
}

/**
 * Look for the same thing another way.
 * @param {{matchCase?: boolean, wholeWord?: boolean}} change
 */
const refine = change => {
  if ('matchCase' in change) matchCase.value = change.matchCase
  if ('wholeWord' in change) wholeWord.value = change.wholeWord
  lookFor(query.value)
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
  if (!alive || !page.value) return

  const id = props.documentId
  const state = editor.open(id, currentDocument.value?.content || '')
  view = new EditorView(page.value, {
    state,
    plugins: [
      links({ edit: editLink, open: openUrl, update: showLink }),
      new Plugin({
        view: () => ({
          update: (editorView, prevState) => {
            showCommentButton(editorView)
            showComment(editorView, prevState)
            followCaret(editorView, prevState)
          },
        }),
      }),
    ],
    decorations,
    dispatchTransaction: tr => {
      editor.dispatch(id, tr)
      // Writing in a preview is keeping it.
      if (tr.docChanged) api.keep(id)
    },
    attributes,
    handleDOMEvents: {
      blur: editorView => {
        editor.flush(id)
        commentButton.value = null
        showComment(editorView)
        return false
      },
      focus: editorView => {
        showCommentButton(editorView)
        showComment(editorView)
        return false
      },
      mousedown: () => {
        selecting = true
        window.addEventListener('mouseup', onMouseUp, { once: true })
        return false
      },
    },
    // Mod-Shift-M comments on the selection, or changes the comment the caret
    // is in. The editor's to catch, since the mark and the selection live in
    // the view's state. Mod-/ asks for the list of keys.
    handleKeyDown: (editorView, event) => {
      if (isShortcutsKey(event)) {
        event.preventDefault()
        emit('shortcuts')
        return true
      }
      const mod = event.metaKey || event.ctrlKey
      if (!mod || !event.shiftKey || event.key.toLowerCase() !== 'm') return false
      const { selection } = editorView.state
      const around = selection.empty ? commentAround(selection.$from) : null
      const opened = around ? editComment(around.id) : commentOn(selection.from, selection.to)
      if (opened) event.preventDefault()
      return opened
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
  goToCurrent()
})

onBeforeUnmount(() => {
  alive = false
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('mouseup', onMouseUp)
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

<style>
/* An empty document's first line says where to start, in the text's own
   colour faded, and takes up no room of its own. */
.ProseMirror .placeholder::before {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
  color: color-mix(in srgb, currentColor 40%, transparent);
}

/* A commented passage: marked in the text, with the comment on hover. */
.ProseMirror mark.comment {
  background-color: rgb(250 204 21 / 0.25);
  border-bottom: 2px solid rgb(234 179 8);
  border-radius: 0.15em;
  color: inherit;
  cursor: pointer;
  padding: 0 0.05em;
}
.ProseMirror mark.comment:hover {
  background-color: rgb(250 204 21 / 0.45);
}
/* The comment gone to last, from the comments list or the caret: drawn over
   its highlight, inside the mark. */
.ProseMirror .comment-current {
  background-color: rgb(250 204 21 / 0.45);
  border-radius: 0.15em;
}
</style>
