<template>
  <ContextMenu ref="menu" :model="items" class="editor-menu">
    <template #item="{ item, props, hasSubmenu }">
      <a v-bind="props.action">
        <span v-if="item.icon" v-bind="props.icon" />
        <span v-bind="props.label">{{ item.label }}</span>
        <span v-if="item.shortcut" class="editor-menu-shortcut">{{ item.shortcut }}</span>
        <i v-if="hasSubmenu" class="pi pi-angle-right" v-bind="props.submenuicon" />
      </a>
    </template>
  </ContextMenu>
</template>

<script setup>
import { ref, shallowRef } from 'vue'
import ContextMenu from 'primevue/contextmenu'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import { cellAround, deleteColumn, deleteRow, deleteTable } from 'prosemirror-tables'
import { alignColumn, alignmentAt, insertColumn, insertRow } from '@/editor/tables.js'
import { insertCodeBlock, insertRule, insertTable } from '@/editor/insert.js'
import { forgetWord, lintAt, replaceWith, spellingKey } from '@/editor/spelling.js'
import { pasteMarkdown, readClipboard, selectionMarkdown } from '@/editor/clipboard.js'
import { canLink, linkAround } from '@/editor/links.js'
import { commentAround } from '@/editor/comments.js'
import { keyLabel } from '@/editor/shortcuts.js'
import { SPELLING_KINDS, baseWord } from '@/spelling/engine.js'
import { hasTouchKeyboard } from '@/utils/touch.js'
import { useToast } from '@/composables/useToast'

/**
 * The editor's right-click menu: on a flagged word, the spelling checker's
 * suggestions and dictionaries first, and on a picture its alt text, a look
 * at its own size and a copy saved; then the clipboard, with Markdown both
 * ways and a paste without formatting; links and comments; a picture, a
 * table, a rule or a code block to insert; and in a table, the table's own
 * items, the only way to add a row or a column.
 *
 * Shift with the right button opens the browser's own menu instead, and a
 * touch screen's long press is left to the phone, where it selects. The menu
 * also opens from the keyboard's menu key, at the caret.
 *
 * Cut and Copy run the editor's own copy, as the keys do. A Paste chosen here
 * has no paste event to read, so it reads the clipboard, which a browser may
 * first ask the writer to allow.
 *
 * @typedef {import('prosemirror-view').EditorView} EditorView
 * @typedef {import('prosemirror-state').Command} Command
 * @typedef {import('primevue/menuitem').MenuItem} MenuItem
 */

/**
 * `add-word`, `add-to-project`: a word for the writer's dictionary or the
 * project's. `ignore`: a grammar lint's hash. `link`: the link field for the
 * selection; `copy-link` and `remove-link`, for the link the caret is in.
 * `comment`: the comment field for the selection; `reply-comment` and
 * `resolve-comment`: a comment's id. `insert-picture`:
 * pictures to choose from the disk; `paste-pictures`: the clipboard's.
 * `picture-alt`, `view-picture` and `save-picture`: for the picture selected.
 */
const emit = defineEmits([
  'add-word',
  'add-to-project',
  'ignore',
  'link',
  'copy-link',
  'remove-link',
  'comment',
  'reply-comment',
  'resolve-comment',
  'insert-picture',
  'paste-pictures',
  'picture-alt',
  'view-picture',
  'save-picture',
])

/** How many spelling suggestions are offered. */
const SUGGESTIONS = 5

/** @type {readonly {label: string, align: 'left'|'center'|'right'|null}[]} */
const ALIGNMENTS = [
  { label: 'Left', align: 'left' },
  { label: 'Center', align: 'center' },
  { label: 'Right', align: 'right' },
  { label: 'None', align: null },
]

const toast = useToast()

const menu = ref()
/** @type {import('vue').ShallowRef<MenuItem[]>} */
const items = shallowRef([])

/**
 * Run something from the menu, then put the focus back in the text.
 *
 * @param {EditorView} view
 * @param {() => unknown} action
 */
const then = (view, action) => async () => {
  await action()
  view.focus()
}

/**
 * What the menu offers on a flagged word, if the position is in one.
 *
 * @param {EditorView} view
 * @param {number} pos
 * @returns {MenuItem[]}
 */
function spellingItems(view, pos) {
  const found = lintAt(view.state, pos)
  if (!found) return []
  const { from, to, lint } = found

  /** @type {MenuItem[]} */
  const suggestions = lint.suggestions.slice(0, SUGGESTIONS).map(text => ({
    label: text || 'Delete',
    class: 'font-medium',
    command: then(view, () => replaceWith(from, to, text)(view.state, view.dispatch)),
  }))

  if (!SPELLING_KINDS.has(lint.kind)) {
    return [
      { label: lint.message, disabled: true, class: 'spelling-message' },
      ...suggestions,
      {
        label: 'Ignore',
        command: then(view, () => {
          view.dispatch(
            view.state.tr
              .setMeta(spellingKey, { drop: other => other.hash === lint.hash })
              .setMeta('addToHistory', false)
          )
          emit('ignore', lint.hash)
        }),
      },
    ]
  }

  // A part of a hyphenated word adds the whole of it, and says so.
  const word = lint.word ?? lint.text
  const named = lint.word ? ` \u201c${baseWord(lint.word)}\u201d` : ''
  /** @param {'add-word'|'add-to-project'} event */
  const add = event =>
    then(view, () => {
      forgetWord(view, word)
      emit(event, word)
    })
  return [
    ...suggestions,
    { label: `Add${named} to dictionary`, command: add('add-word') },
    { label: `Add${named} to project`, command: add('add-to-project') },
  ]
}

/**
 * What the menu offers on a picture, when it was opened on one.
 *
 * @param {EditorView} view
 * @param {boolean} onPicture
 * @returns {MenuItem[]}
 */
function pictureItems(view, onPicture) {
  if (!onPicture) return []
  /** @param {'picture-alt'|'view-picture'|'save-picture'} event */
  const asks = event => then(view, () => emit(event))
  return [
    { label: 'Alt text\u2026', command: () => emit('picture-alt') },
    { label: 'View picture', command: asks('view-picture') },
    { label: 'Save picture\u2026', command: asks('save-picture') },
  ]
}

/**
 * Cut, copy and paste, and Markdown both ways.
 *
 * @param {EditorView} view
 * @returns {MenuItem[]}
 */
function clipboardItems(view) {
  const empty = view.state.selection.empty

  /** @param {'cut'|'copy'} command */
  const viaEditor = command =>
    then(view, () => {
      view.focus()
      document.execCommand(command)
    })

  /** @param {(contents: import('@/editor/clipboard.js').ClipboardContents) => void} paste */
  const reading = paste =>
    then(view, async () => {
      let contents
      try {
        contents = await readClipboard()
      } catch {
        toast.error(`The clipboard can't be read here. Paste with ${keyLabel('Mod-v')} instead.`)
        return
      }
      view.focus()
      paste(contents)
    })

  return [
    { label: 'Cut', shortcut: keyLabel('Mod-x'), disabled: empty, command: viaEditor('cut') },
    { label: 'Copy', shortcut: keyLabel('Mod-c'), disabled: empty, command: viaEditor('copy') },
    {
      label: 'Copy as Markdown',
      disabled: empty,
      command: then(view, () => navigator.clipboard.writeText(selectionMarkdown(view.state))),
    },
    {
      label: 'Paste',
      shortcut: keyLabel('Mod-v'),
      // A picture copied alone has no words with it.
      command: reading(({ html, text, pictures }) => {
        if (pictures.length > 0 && !text.trim()) emit('paste-pictures', pictures)
        else if (html) view.pasteHTML(html)
        else view.pasteText(text)
      }),
    },
    {
      label: 'Paste without formatting',
      command: reading(({ text }) => view.pasteText(text)),
    },
    {
      label: 'Paste from Markdown',
      command: reading(({ text }) => pasteMarkdown(text)(view.state, view.dispatch)),
    },
  ]
}

/**
 * The link and the comment at the selection, or making them.
 *
 * @param {EditorView} view
 * @returns {MenuItem[]}
 */
function markItems(view) {
  const { state } = view
  const { selection } = state
  const link = selection.empty ? linkAround(selection.$from) : null
  const comment = selection.empty ? commentAround(selection.$from) : null
  /** @param {string} event @param {unknown} [detail] */
  const asks = (event, detail) =>
    then(view, () => /** @type {any} */ (emit)(event, ...(detail === undefined ? [] : [detail])))

  return [
    ...(link
      ? [
          { label: 'Edit link\u2026', shortcut: keyLabel('Mod-k'), command: asks('link') },
          { label: 'Copy link', command: asks('copy-link') },
          { label: 'Remove link', command: asks('remove-link') },
        ]
      : [
          {
            label: 'Insert link\u2026',
            shortcut: keyLabel('Mod-k'),
            disabled: !canLink(state),
            command: asks('link'),
          },
        ]),
    ...(comment
      ? [
          {
            label: 'Reply to comment\u2026',
            shortcut: keyLabel('Mod-Shift-m'),
            command: asks('reply-comment', comment.id),
          },
          { label: 'Resolve comment', command: asks('resolve-comment', comment.id) },
        ]
      : [
          {
            label: 'Comment\u2026',
            shortcut: keyLabel('Mod-Shift-m'),
            disabled: selection.empty || !(selection instanceof TextSelection),
            command: asks('comment'),
          },
        ]),
  ]
}

/**
 * A menu item that runs a command, and is greyed where it can't run.
 *
 * @param {EditorView} view
 * @param {string} label
 * @param {Command} command
 * @returns {MenuItem}
 */
const commandItem = (view, label, command) => ({
  label,
  disabled: !command(view.state),
  command: then(view, () => command(view.state, view.dispatch)),
})

/**
 * Blocks otherwise only typed: a table, a rule, a code block. In a table, the
 * table's rows and columns added and taken away, a column's alignment, and
 * the table gone. No key adds a row or a column; this is where they're added.
 *
 * @param {EditorView} view
 * @returns {MenuItem[]}
 */
function blockItems(view) {
  /** @type {MenuItem[]} */
  const items = [
    {
      label: 'Insert',
      items: [
        {
          label: 'Picture\u2026',
          disabled: !!view.state.selection.$from.parent.type.spec.code,
          command: () => emit('insert-picture'),
        },
        commandItem(view, 'Table', insertTable),
        commandItem(view, 'Horizontal rule', insertRule),
        commandItem(view, 'Code block', insertCodeBlock),
      ],
    },
  ]
  if (!cellAround(view.state.selection.$from)) return items

  const current = alignmentAt(view.state)
  return [
    ...items,
    {
      label: 'Table',
      items: [
        commandItem(view, 'Insert row above', insertRow('above')),
        commandItem(view, 'Insert row below', insertRow('below')),
        commandItem(view, 'Insert column left', insertColumn('left')),
        commandItem(view, 'Insert column right', insertColumn('right')),
        { separator: true },
        {
          label: 'Align column',
          items: ALIGNMENTS.map(({ label, align }) => ({
            ...commandItem(view, label, alignColumn(align)),
            disabled: align === current,
          })),
        },
        { separator: true },
        commandItem(view, 'Delete row', deleteRow),
        commandItem(view, 'Delete column', deleteColumn),
        commandItem(view, 'Delete table', deleteTable),
      ],
    },
  ]
}

/**
 * Where the menu goes for the menu key: under the caret.
 *
 * @param {EditorView} view
 * @param {MouseEvent} event
 */
const atCaret = (view, event) => {
  const { left, bottom } = view.coordsAtPos(view.state.selection.head)
  return {
    pageX: left + window.scrollX,
    pageY: bottom + window.scrollY,
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation(),
  }
}

/**
 * Open the menu for a right-click, or the menu key. A click outside the
 * selection puts the caret where it was, so the menu acts there.
 *
 * @param {EditorView} view
 * @param {MouseEvent} event
 * @returns {boolean} Whether it opened; if not, the browser's menu opens
 */
const open = (view, event) => {
  if (hasTouchKeyboard()) return false
  // The right button, or a Control-click on a Mac; anything else is a key.
  const pointer = event.button === 2 || event.ctrlKey
  if (pointer && event.shiftKey) return false

  const at = pointer ? view.posAtCoords({ left: event.clientX, top: event.clientY }) : null
  if (pointer && !at) return false
  // On a picture, the menu is for it, selected.
  const picture =
    at && at.inside >= 0 && view.state.doc.nodeAt(at.inside)?.type.name === 'image'
      ? at.inside
      : null
  if (picture !== null) {
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, picture)))
  } else if (at) {
    const { selection } = view.state
    const inside = selection.ranges.some(
      ({ $from, $to }) => $from.pos <= at.pos && at.pos <= $to.pos
    )
    if (!inside) {
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))))
    }
  }
  const onPicture =
    view.state.selection instanceof NodeSelection && view.state.selection.node.type.name === 'image'

  const sections = [
    pictureItems(view, onPicture),
    spellingItems(view, at ? at.pos : view.state.selection.head),
    clipboardItems(view),
    markItems(view),
    blockItems(view),
  ].filter(section => section.length > 0)
  items.value = sections.flatMap((section, i) =>
    i > 0 ? [{ separator: true }, ...section] : section
  )
  menu.value?.show(pointer ? event : atCaret(view, event))
  return true
}

defineExpose({ open })
</script>

<style>
.editor-menu .editor-menu-shortcut {
  margin-left: auto;
  padding-left: 1.5rem;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}
/* Harper's account of a grammar lint can run to a sentence or two. */
.editor-menu .spelling-message {
  max-width: 18rem;
  opacity: 1;
}
.editor-menu .spelling-message .p-contextmenu-item-label {
  font-size: 0.75rem;
  line-height: 1.4;
  white-space: normal;
}
</style>
