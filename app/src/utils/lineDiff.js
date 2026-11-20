/**
 * @module utils/lineDiff
 * @description What changed between two texts, line by line, in the form a
 * patch has: the lines that went marked `-`, those that came `+`, a few
 * around them unmarked, and above each stretch where it sits in both. For a
 * reader that has the first text and is to be told of the second: a model,
 * which reads this form as written.
 */

import { diffSequences } from './diff.js'

/** How many unchanged lines are shown either side of a change. */
const CONTEXT = 2

/** Past this many lines gone and come, two texts are told apart no further. */
const MOST_EDITS = 4000

/**
 * The changes from one text to another, as a patch's hunks.
 *
 * @param {string} before
 * @param {string} after
 * @param {Object} [options]
 * @param {number} [options.context] - Unchanged lines shown either side of a change
 * @param {number} [options.maxEdits] - Past this many lines changed, give up
 * @returns {string|null} Empty when the texts are the same; null when they
 *   differ by more than `maxEdits` lines
 */
export function lineDiff(before, after, { context = CONTEXT, maxEdits = MOST_EDITS } = {}) {
  if (before === after) return ''
  const a = before.split('\n')
  const b = after.split('\n')
  const steps = diffSequences(a, b, { maxEdits })
  if (!steps) return null

  // How many lines of each text come before each step.
  const aAt = new Int32Array(steps.length + 1)
  const bAt = new Int32Array(steps.length + 1)
  steps.forEach((step, at) => {
    aAt[at + 1] = aAt[at] + (step.op === 'insert' ? 0 : 1)
    bAt[at + 1] = bAt[at] + (step.op === 'delete' ? 0 : 1)
  })

  // Shown: each change, and the lines within reach of one.
  const shown = new Uint8Array(steps.length)
  steps.forEach((step, at) => {
    if (step.op === 'equal') return
    const to = Math.min(steps.length - 1, at + context)
    for (let near = Math.max(0, at - context); near <= to; near++) shown[near] = 1
  })

  /** @type {string[]} */
  const out = []
  let at = 0
  while (at < steps.length) {
    if (!shown[at]) {
      at++
      continue
    }
    let end = at
    while (end < steps.length && shown[end]) end++
    const from = [aAt[at] + 1, aAt[end] - aAt[at]]
    const to = [bAt[at] + 1, bAt[end] - bAt[at]]
    out.push(`@@ -${from.join(',')} +${to.join(',')} @@`)
    for (const step of steps.slice(at, end)) {
      if (step.op === 'equal') out.push(` ${a[step.a]}`)
      else if (step.op === 'delete') out.push(`-${a[step.a]}`)
      else out.push(`+${b[step.b]}`)
    }
    at = end
  }
  return out.join('\n')
}
