/**
 * @module components/common/settingsLook
 * @description How a dialog looks like Settings: its header on the dialog's
 * own colour, its body on the lighter one Settings' sections sit on, and a
 * rule over its footer, as the welcome's. For PrimeVue Dialog's `pt`.
 */

/**
 * @param {string} [body] - More classes for the body, as a dialog of a fixed
 *   size lays it out
 * @returns {{content: {class: string}, footer: {class: string}}}
 */
export function settingsLook(body = '') {
  return {
    content: { class: `!p-4 bg-surface-0 dark:bg-surface-800 ${body}`.trim() },
    footer: { class: 'border-t border-surface-200 dark:border-surface-700 !pt-3 !pb-3' },
  }
}
