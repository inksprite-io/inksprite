/**
 * @module ai/tools/streamedAppends
 * @description A turn's append_document calls shown in their documents as
 * the model writes them.
 *
 * A call's arguments come a token at a time. Once its path has come whole,
 * the document is looked up as the tool will look it up, and from then on,
 * while the editor has that document open, the text as far as it has come is
 * shown at its end (`editor/streaming`). Nothing is written until the call
 * runs. Its preview ends once it has run, whatever it did; with the round,
 * for a call the round leaves out; and with the turn, however that ends.
 */

import { partialFields } from '@/utils/partialJson.js'
import { useEditor } from '@/composables/useEditor.js'
import { dropPreviewText, setPreviewText } from '@/editor/streaming.js'
import { appendTarget, appendedText } from './documents.js'

const APPEND = 'append_document'

/** Previews made so far, for each to have an id of its own. */
let made = 0

/**
 * One call being shown.
 * @typedef {Object} Streamed
 * @property {string} id - Its preview's
 * @property {{documentId: string, suggested: boolean}|null|undefined} target -
 *   Where it goes; undefined while that is looked up, null where it is not shown
 * @property {string} text - As far as it has come, as the tool will write it
 * @property {boolean} ended
 */

/**
 * @typedef {Object} StreamedAppends
 * @property {(calls: Array<{name: string, arguments?: string|null}>) => void} update -
 *   The round's calls as far as they have come, in the order the model makes them
 * @property {(calls: object[], running: object[]) => void} settle - The round's
 *   calls whole, in the same order, and those of them that will run
 * @property {(call: object) => void} ran - One of those has run
 * @property {() => void} end - The round is over, or the turn: every preview goes
 */

/**
 * Show a turn's appends as they are written.
 *
 * @param {Object} turn
 * @param {string|null|undefined} turn.storyId
 * @param {string} [turn.chatId]
 * @param {boolean} [turn.propose] - The chat asks before changing documents
 * @returns {StreamedAppends}
 */
export function streamAppends({ storyId, chatId, propose = false }) {
  const editor = useEditor()
  /** The round's, by their place in it. @type {Map<number, Streamed>} */
  let calls = new Map()
  /** The round's that will run, by the call. @type {Map<object, Streamed>} */
  let running = new Map()

  /** @param {Streamed} streamed */
  const show = streamed => {
    if (streamed.ended || !streamed.target) return
    setPreviewText(streamed.id, streamed.text)
    editor.showPreview(streamed.target.documentId, streamed.id, streamed.target.suggested)
  }

  /** @param {Streamed} streamed */
  const stop = streamed => {
    if (streamed.ended) return
    streamed.ended = true
    editor.endPreview(streamed.id)
    dropPreviewText(streamed.id)
  }

  /**
   * @param {string} path
   * @returns {Streamed}
   */
  const begin = path => {
    /** @type {Streamed} */
    const streamed = { id: `append-${++made}`, target: undefined, text: '', ended: false }
    appendTarget(/** @type {string} */ (storyId), chatId, path, propose).then(
      target => {
        streamed.target = target
        show(streamed)
      },
      error => {
        streamed.target = null
        console.warn('Could not find where an append goes:', error)
      }
    )
    return streamed
  }

  return {
    update(toolCalls) {
      if (!storyId) return
      toolCalls.forEach((call, index) => {
        if (call?.name !== APPEND) return
        const fields = partialFields(call.arguments)
        let streamed = calls.get(index)
        if (!streamed) {
          // A path still coming may be the front of another document's.
          if (!fields.path?.done) return
          streamed = begin(fields.path.value)
          calls.set(index, streamed)
        }
        streamed.text = appendedText(fields.text?.value)
        // Each time, since the writer may open the document partway.
        show(streamed)
      })
    },

    settle(toolCalls, run) {
      toolCalls.forEach((call, index) => {
        const streamed = calls.get(index)
        if (!streamed) return
        if (run.includes(call)) running.set(call, streamed)
        else stop(streamed)
      })
    },

    ran(call) {
      const streamed = running.get(call)
      if (streamed) stop(streamed)
    },

    end() {
      for (const streamed of calls.values()) stop(streamed)
      calls = new Map()
      running = new Map()
    },
  }
}
