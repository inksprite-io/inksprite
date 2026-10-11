/**
 * @module editor/shortcuts
 * @description The editor's keys and typed shortcuts, as the writer is shown
 * them: what each does, and the keys for it spelled the way their keyboard
 * prints them.
 *
 * The bindings themselves are `editor/state`'s and `editor/links`'s; this is
 * the list a person reads, in the order they would look for things, and its
 * test holds it to those.
 */

const isMac = /Mac|iP(hone|ad|od)/.test(
  (typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || ''
)

/**
 * @typedef {Object} Shortcut
 * @property {string} action - What it does
 * @property {string} [keys] - A binding as ProseMirror writes one: `Mod-Shift-b`
 * @property {string} [typed] - Or what is typed for it, shown as typed
 */

/**
 * @typedef {Object} ShortcutGroup
 * @property {string} title
 * @property {Shortcut[]} shortcuts
 */

/** @type {ShortcutGroup[]} */
export const SHORTCUTS = [
  {
    title: 'Text',
    shortcuts: [
      { action: 'Bold', keys: 'Mod-b' },
      { action: 'Italic', keys: 'Mod-i' },
      { action: 'Strikethrough', keys: 'Mod-Shift-s' },
      { action: 'Code', keys: 'Mod-`' },
      { action: 'Link', keys: 'Mod-k' },
      { action: 'Comment', keys: 'Mod-Shift-m' },
    ],
  },
  {
    title: 'Blocks',
    shortcuts: [
      { action: 'Heading 1 to 6', keys: 'Mod-Alt-1' },
      { action: 'Paragraph', keys: 'Mod-Alt-0' },
      { action: 'Bulleted list', keys: 'Mod-Shift-8' },
      { action: 'Numbered list', keys: 'Mod-Shift-7' },
      { action: 'Quote', keys: 'Mod-Shift-b' },
      { action: 'Code block', keys: 'Mod-Alt-c' },
      { action: 'Indent or outdent a list item', keys: 'Tab' },
      { action: 'Line break', keys: 'Shift-Enter' },
    ],
  },
  {
    title: 'Editing',
    shortcuts: [
      { action: 'Undo', keys: 'Mod-z' },
      { action: 'Redo', keys: 'Mod-Shift-z' },
      { action: 'Find and replace', keys: 'Mod-f' },
      { action: 'Keyboard shortcuts', keys: 'Mod-/' },
    ],
  },
  {
    title: 'As you type',
    shortcuts: [
      { action: 'Heading', typed: '# ' },
      { action: 'Bulleted list', typed: '- ' },
      { action: 'Numbered list', typed: '1. ' },
      { action: 'Quote', typed: '> ' },
      { action: 'Code block', typed: '```' },
      { action: 'Rule', typed: '---' },
      { action: 'Bold', typed: '**bold**' },
      { action: 'Italic', typed: '*italic*' },
      { action: 'Code', typed: '`code`' },
      { action: 'Dash', typed: '--' },
      { action: 'Ellipsis', typed: '...' },
      { action: 'Undo a conversion', keys: 'Backspace' },
    ],
  },
]

/** What each part of a binding is called, on a Mac and off one. */
const NAMES = {
  Mod: ['⌘', 'Ctrl'],
  Shift: ['⇧', 'Shift'],
  Alt: ['⌥', 'Alt'],
  Enter: ['↵', 'Enter'],
  Backspace: ['⌫', 'Backspace'],
  Tab: ['⇥', 'Tab'],
}

/**
 * A binding spelled for the keyboard in front of the writer: `⌘⇧B` on a Mac,
 * `Ctrl+Shift+B` elsewhere.
 *
 * @param {string} keys - As ProseMirror writes one: `Mod-Shift-b`
 * @param {boolean} [mac] - Whether to spell it for a Mac; this one's, if not given
 * @returns {string}
 */
export function keyLabel(keys, mac = isMac) {
  // The last part is the key, which may itself be a hyphen.
  const parts = keys.split(/-(?!$)/)
  const named = parts.map(part =>
    part in NAMES ? NAMES[/** @type {keyof NAMES} */ (part)][mac ? 0 : 1] : part.toUpperCase()
  )
  return named.join(mac ? '' : '+')
}

/**
 * Whether a key is the one that shows this list: Mod-/, with or without Shift,
 * since some keyboards reach the slash with it.
 *
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function isShortcutsKey(event) {
  return event.key === '/' && Boolean(isMac ? event.metaKey : event.ctrlKey) && !event.altKey
}
