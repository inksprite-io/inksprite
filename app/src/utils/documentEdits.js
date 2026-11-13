/**
 * @module utils/documentEdits
 * @description What happens to the model's changes to documents in a chat,
 * as the chat's chip and its settings offer it: Suggesting, for the writer to
 * accept or reject, or Editing, applied at once. Stored as `applyEdits`,
 * `'ask'` or `'auto'`.
 */

/** @type {Array<{value: 'ask'|'auto', label: string, detail: string}>} */
export const DOCUMENT_EDIT_OPTIONS = [
  { value: 'ask', label: 'Suggesting', detail: 'The model suggests changes' },
  { value: 'auto', label: 'Editing', detail: 'The model edits documents' },
]
