/**
 * @module composables/useWriterPanel
 * @description Which of the writer's two panels of tabs the writer is in, the
 * editor or the chat, for a key that acts on a tab: closing one, opening the
 * one closed last again, going to the next.
 *
 * It is the panel last clicked, touched or given the focus, as the find key
 * goes by (`useFindKey`), but remembered as a panel rather than as what was
 * pressed: closing a tab takes what was pressed in it off the page, and the
 * next press of the key still belongs to the same panel. A panel says which
 * it is with `data-panel`, and what picks things for one says so with
 * `data-panel-for`: the outline, whose documents open in the editor, and the
 * list of chats. Anywhere else, the rail or a menu, leaves the writer where
 * they were. A panel that is not on screen is never the one: its tabs can't
 * be seen to be closed.
 */

/* global Element */

/** @typedef {'editor'|'chat'} WriterPanel */

/** The panel last pressed or focused in. Until anything is, the editor. */
/** @type {WriterPanel} */
let last = 'editor'
let listening = false

/**
 * The panel something on the page is in, or picks things for.
 *
 * @param {EventTarget|null} target
 * @returns {WriterPanel|null}
 */
function panelOf(target) {
  if (!(target instanceof Element)) return null
  const within = target.closest('[data-panel], [data-panel-for]')
  const name = within?.getAttribute('data-panel') ?? within?.getAttribute('data-panel-for')
  return name === 'editor' || name === 'chat' ? name : null
}

/** @param {Event} event */
const note = event => {
  last = panelOf(event.target) ?? last
}

/**
 * Whether a panel is on screen, rather than hidden beside the other, folded
 * away, or not there with the AI switched off.
 *
 * @param {WriterPanel} panel
 * @returns {boolean}
 */
const onScreen = panel =>
  (document.querySelector(`[data-panel="${panel}"]`)?.getClientRects().length ?? 0) > 0

/**
 * Start noting where the writer is. Asked by the writer's frame, once.
 */
export function watchWriterPanel() {
  if (listening || typeof document === 'undefined') return
  document.addEventListener('pointerdown', note, true)
  document.addEventListener('focusin', note, true)
  listening = true
}

/**
 * The panel the writer is in: the one last pressed or focused in, unless
 * only the other is on screen.
 *
 * @returns {WriterPanel}
 */
export function writerPanel() {
  /** @type {WriterPanel} */
  const other = last === 'chat' ? 'editor' : 'chat'
  return !onScreen(last) && onScreen(other) ? other : last
}

/** Forget where the writer was (for testing). */
export function resetWriterPanel() {
  last = 'editor'
}
