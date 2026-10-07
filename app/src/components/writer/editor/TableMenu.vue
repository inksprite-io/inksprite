<template>
  <ContextMenu ref="menu" :model="items" />
</template>

<script setup>
import { ref, shallowRef } from 'vue'
import ContextMenu from 'primevue/contextmenu'
import { TextSelection } from 'prosemirror-state'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  cellAround,
  deleteColumn,
  deleteRow,
  deleteTable,
} from 'prosemirror-tables'
import { alignColumn, alignmentAt } from '@/editor/tables.js'

/**
 * What a right-click in a table offers: rows and columns added and taken
 * away, a column's alignment, and the table gone. Anywhere else the browser's
 * own menu opens, as it always did.
 *
 * @typedef {import('prosemirror-view').EditorView} EditorView
 * @typedef {import('prosemirror-state').Command} Command
 * @typedef {import('primevue/menuitem').MenuItem} MenuItem
 */

/** @type {readonly {label: string, icon: string, align: 'left'|'center'|'right'|null}[]} */
const ALIGNMENTS = [
  { label: 'Left', icon: 'pi pi-align-left', align: 'left' },
  { label: 'Center', icon: 'pi pi-align-center', align: 'center' },
  { label: 'Right', icon: 'pi pi-align-right', align: 'right' },
  { label: 'None', icon: 'pi pi-minus', align: null },
]

const menu = ref()
/** @type {import('vue').ShallowRef<MenuItem[]>} */
const items = shallowRef([])

/**
 * Open the menu, if the pointer is on a table. The cell under it is where the
 * menu acts: the caret goes there, unless what is selected already takes it
 * in.
 *
 * @param {EditorView} view
 * @param {MouseEvent} event
 * @returns {boolean} Whether it opened
 */
const open = (view, event) => {
  const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (!at) return false
  const $at = view.state.doc.resolve(at.pos)
  if (!cellAround($at)) return false

  const { selection } = view.state
  if (!selection.ranges.some(({ $from, $to }) => $from.pos <= at.pos && at.pos <= $to.pos)) {
    view.dispatch(view.state.tr.setSelection(TextSelection.near($at)))
  }

  /**
   * @param {string} label
   * @param {string} icon
   * @param {Command} command
   * @returns {MenuItem}
   */
  const item = (label, icon, command) => ({
    label,
    icon,
    disabled: !command(view.state),
    command: () => {
      command(view.state, view.dispatch)
      view.focus()
    },
  })

  const current = alignmentAt(view.state)
  items.value = [
    item('Insert row above', 'pi pi-arrow-up', addRowBefore),
    item('Insert row below', 'pi pi-arrow-down', addRowAfter),
    item('Insert column left', 'pi pi-arrow-left', addColumnBefore),
    item('Insert column right', 'pi pi-arrow-right', addColumnAfter),
    { separator: true },
    {
      label: 'Align column',
      icon: 'pi pi-align-left',
      items: ALIGNMENTS.map(({ label, icon, align }) => ({
        ...item(label, icon, alignColumn(align)),
        disabled: align === current,
      })),
    },
    { separator: true },
    item('Delete row', 'pi pi-minus', deleteRow),
    item('Delete column', 'pi pi-minus', deleteColumn),
    item('Delete table', 'pi pi-trash', deleteTable),
  ]
  menu.value?.show(event)
  return true
}

defineExpose({ open })
</script>
