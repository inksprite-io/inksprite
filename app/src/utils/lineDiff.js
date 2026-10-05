/**
 * @module utils/lineDiff
 * @description What changed between two versions of a text, line by line.
 *
 * For showing a writer what a rewrite did, not for applying it: only the
 * lines that changed, in runs, each run the lines that went and the lines
 * that came in their place. A settled document differs from the one typed in
 * a bullet here and an escape there, and a run per place is what reads.
 */

/**
 * @typedef {Object} LineChange
 * @property {string[]} removed - The lines that went, in order
 * @property {string[]} added - The lines in their place, in order
 */

/**
 * Past this many lines on each side of the part that differs, the lines are
 * not matched up one by one: the table that matches them grows with the
 * square, and a change that big is one run anyway.
 */
const MAX_MATCHED = 2000

/**
 * The runs of lines that differ between two texts.
 *
 * The lines both share at either end are set aside first, which on a
 * rewrite of a few lines leaves little to match. What is left is matched by
 * the longest run of lines both keep in order, and every stretch between two
 * kept lines is a change.
 *
 * @param {string} before
 * @param {string} after
 * @returns {LineChange[]} Empty when nothing changed
 */
export function changedLines(before, after) {
  if (before === after) return []

  const a = before.split('\n')
  const b = after.split('\n')

  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end++
  }

  const left = a.slice(start, a.length - end)
  const right = b.slice(start, b.length - end)
  if (left.length > MAX_MATCHED || right.length > MAX_MATCHED) {
    return [{ removed: left, added: right }]
  }

  // How many lines the two share, in order, from each point onward.
  const kept = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0))
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      kept[i][j] =
        left[i] === right[j] ? kept[i + 1][j + 1] + 1 : Math.max(kept[i + 1][j], kept[i][j + 1])
    }
  }

  /** @type {LineChange[]} */
  const changes = []
  /** @type {LineChange} */
  let run = { removed: [], added: [] }
  const close = () => {
    if (run.removed.length || run.added.length) changes.push(run)
    run = { removed: [], added: [] }
  }

  let i = 0
  let j = 0
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      close()
      i++
      j++
    } else if (j >= right.length || (i < left.length && kept[i + 1][j] >= kept[i][j + 1])) {
      run.removed.push(left[i++])
    } else {
      run.added.push(right[j++])
    }
  }
  close()

  return changes
}
