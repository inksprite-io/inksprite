/**
 * @module composables/useEditorRequest
 * @description Where the editor is asked for from anywhere in the writer.
 *
 * The editor is a panel on the desktop and a tab on a phone, both of which
 * the writer's frame lays out. Anything deeper that opens a tab in it, such
 * as a chat's settings opening its system prompt, asks here, and the frame
 * shows the editor the way the rail or the tab would.
 *
 * One state for the app: every caller shares the same request.
 */

import { readonly, ref } from 'vue'

/** Whether the editor has been asked for since the frame last showed it. */
const requested = ref(false)

/**
 * A heading a link went to, for the editor of its document to go to: by its
 * words, and counted, so each is gone to once.
 *
 * @typedef {{ documentId: string, words: string, seq: number }} HeadingAsked
 */

/** @type {import('vue').Ref<HeadingAsked|null>} */
const heading = ref(null)
let headings = 0
let headingTaken = 0

/** The heading asked for last, for the editors to watch. */
export const headingAsked = readonly(heading)

/**
 * The heading asked for in a document, if no editor has gone to it yet.
 * Asked by an editor when the request changes and when it is made.
 *
 * @param {string} documentId
 * @returns {string|null} Its words
 */
export const takeHeading = documentId => {
  const now = heading.value
  if (!now || now.documentId !== documentId || now.seq === headingTaken) return null
  headingTaken = now.seq
  return now.words
}

/**
 * @returns {{
 *   requested: import('vue').Ref<boolean>,
 *   show: () => void,
 *   take: () => boolean,
 *   goToHeading: (documentId: string, words: string) => void,
 * }}
 */
export function useEditorRequest() {
  const show = () => {
    requested.value = true
  }

  /**
   * Have the editor of a document go to one of its headings, once it shows.
   * @param {string} documentId
   * @param {string} words - The heading's, as a link names it
   */
  const goToHeading = (documentId, words) => {
    heading.value = { documentId, words, seq: ++headings }
  }

  /**
   * Whether the editor was asked for, handed over once.
   * @returns {boolean}
   */
  const take = () => {
    const asked = requested.value
    requested.value = false
    return asked
  }

  return { requested, show, take, goToHeading }
}
