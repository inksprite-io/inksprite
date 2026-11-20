/**
 * @module utils/terminalFrame
 * @description What a terminal's frame tells the page around it, read on the
 * page's side: a shortcut pressed in the frame, for the page to act on.
 */

/**
 * A shortcut as a frame said it was pressed, as what a key event is made
 * from. Only one with Command held is the app's to act on: everything else
 * typed in a terminal is its shell's. Null for anything else.
 *
 * @param {any} said
 * @returns {{key: string, code: string, metaKey: true, ctrlKey: boolean, shiftKey: boolean, altKey: boolean}|null}
 */
export function appShortcutFrom(said) {
  if (typeof said !== 'object' || said === null || said.metaKey !== true) return null
  const { key, code } = said
  if (typeof key !== 'string' || typeof code !== 'string') return null
  if (key.length > 20 || code.length > 20) return null
  return {
    key,
    code,
    metaKey: true,
    ctrlKey: said.ctrlKey === true,
    shiftKey: said.shiftKey === true,
    altKey: said.altKey === true,
  }
}
