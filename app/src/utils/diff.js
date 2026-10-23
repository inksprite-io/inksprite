/**
 * @module utils/diff
 * @description The shortest edit from one sequence to another, as steps:
 * what each keeps, what the first loses, what the second adds.
 *
 * Myers' algorithm, which costs time in the sequences' length times the
 * size of the edit, and room in the square of the edit's size: cheap for a
 * few changes in a long text, and given up on past a limit for a rewrite,
 * which the caller handles as one change. What both share at the ends is
 * set aside first, the end before the start, so that a sequence's last item
 * is kept wherever it can be: a Google Doc's last newline cannot be
 * deleted. Within a change, what goes comes before what comes in. Asked
 * to, the start is set aside first instead, which lines an addition up
 * after what it repeats rather than before.
 *
 * `diff3` lays two versions of a sequence against the one both came from:
 * the stretches all three share, and between them those where one side or
 * both changed, for a three-way merge.
 *
 * `pairUp` pairs two sequences whose items are alike rather than equal, a
 * table's rows or columns: as many pairs as can be, in order, the likest.
 */

/**
 * @typedef {{op: 'equal', a: number, b: number}|{op: 'delete', a: number}|{op: 'insert', b: number}} Step
 */

/**
 * The steps from `a` to `b`, items compared with `===`.
 *
 * @param {readonly unknown[]} a
 * @param {readonly unknown[]} b
 * @param {Object} [options]
 * @param {number} [options.maxEdits] - Past this many deletions and
 *   insertions, give up
 * @param {boolean} [options.startFirst] - Set aside what the two share at
 *   the start before what they share at the end
 * @returns {Step[]|null} Null when the edit is over `maxEdits`
 */
export function diffSequences(a, b, { maxEdits = Infinity, startFirst = false } = {}) {
  let end = 0
  let start = 0
  const ends = () => {
    while (
      end < a.length - start &&
      end < b.length - start &&
      a[a.length - 1 - end] === b[b.length - 1 - end]
    ) {
      end++
    }
  }
  const starts = () => {
    while (start < a.length - end && start < b.length - end && a[start] === b[start]) start++
  }
  if (startFirst) {
    starts()
    ends()
  } else {
    ends()
    starts()
  }

  const middle = shortestEdit(a, b, start, a.length - end, start, b.length - end, maxEdits)
  if (!middle) return null

  /** @type {Step[]} */
  const steps = []
  for (let i = 0; i < start; i++) steps.push({ op: 'equal', a: i, b: i })
  // One at a time: spread out, a long text's words are more arguments than
  // a call can take.
  for (const step of middle) steps.push(step)
  for (let i = 0; i < end; i++) {
    steps.push({ op: 'equal', a: a.length - end + i, b: b.length - end + i })
  }
  return deletionsFirst(steps)
}

/**
 * Myers' greedy search for the fewest deletions and insertions between
 * `a[aLo, aHi)` and `b[bLo, bHi)`, then the path back.
 *
 * @param {readonly unknown[]} a
 * @param {readonly unknown[]} b
 * @param {number} aLo
 * @param {number} aHi
 * @param {number} bLo
 * @param {number} bHi
 * @param {number} maxEdits
 * @returns {Step[]|null}
 */
function shortestEdit(a, b, aLo, aHi, bLo, bHi, maxEdits) {
  const n = aHi - aLo
  const m = bHi - bLo
  /** @type {Step[]} */
  const out = []
  if (n === 0 && m === 0) return out
  if (n === 0 || m === 0) {
    if (n + m > maxEdits) return null
    for (let i = aLo; i < aHi; i++) out.push({ op: 'delete', a: i })
    for (let j = bLo; j < bHi; j++) out.push({ op: 'insert', b: j })
    return out
  }

  const limit = Math.min(n + m, maxEdits)
  // How far along `a` each diagonal k = x - y has got, kept for each d.
  /** @type {Int32Array[]} */
  const trace = []
  let v = new Int32Array(3)
  v[1] = 0
  let found = -1
  for (let d = 0; d <= limit; d++) {
    const next = new Int32Array(2 * d + 3)
    for (let k = -d; k <= d; k += 2) {
      // From the diagonal above (an insertion) or the one below (a deletion).
      const down = k === -d || (k !== d && at(v, d - 1, k - 1) < at(v, d - 1, k + 1))
      let x = down ? at(v, d - 1, k + 1) : at(v, d - 1, k - 1) + 1
      let y = x - k
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
        x++
        y++
      }
      next[k + d + 1] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
    trace.push(next)
    v = next
    if (found >= 0) break
  }
  if (found < 0) return null

  // Back from the end, one d at a time.
  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1]
    const k = x - y
    const down = k === -d || (k !== d && at(prev, d - 1, k - 1) < at(prev, d - 1, k + 1))
    const prevK = down ? k + 1 : k - 1
    const prevX = at(prev, d - 1, prevK)
    const prevY = prevX - prevK
    while (x > prevX + (down ? 0 : 1) && y > prevY + (down ? 1 : 0)) {
      x--
      y--
      out.push({ op: 'equal', a: aLo + x, b: bLo + y })
    }
    if (down) {
      y--
      out.push({ op: 'insert', b: bLo + y })
    } else {
      x--
      out.push({ op: 'delete', a: aLo + x })
    }
  }
  while (x > 0 && y > 0) {
    x--
    y--
    out.push({ op: 'equal', a: aLo + x, b: bLo + y })
  }
  return out.reverse()
}

/**
 * A diagonal's reach after `d` steps, from the array kept for it.
 *
 * @param {Int32Array} v
 * @param {number} d
 * @param {number} k
 * @returns {number}
 */
function at(v, d, k) {
  return v[k + d + 1] ?? 0
}

/**
 * Each change's deletions before its insertions, each kept in order.
 *
 * @template {{op: string}} T
 * @param {T[]} steps
 * @returns {T[]}
 */
export function deletionsFirst(steps) {
  /** @type {T[]} */
  const out = []
  /** @type {T[]} */
  let added = []
  for (const step of steps) {
    if (step.op === 'insert') added.push(step)
    else if (step.op === 'delete') out.push(step)
    else {
      for (const each of added) out.push(each)
      out.push(step)
      added = []
    }
  }
  for (const each of added) out.push(each)
  return out
}

/**
 * A stretch of a sequence in three versions, as `diff3` lays them out: one
 * all three share, or one between where a side differs from the base. Each
 * range is `[from, to)`.
 *
 * @typedef {Object} Chunk
 * @property {boolean} stable - All three have the same items here
 * @property {[number, number]} base
 * @property {[number, number]} mine
 * @property {[number, number]} theirs
 */

/**
 * Two versions of a sequence against the one both came from, in
 * stretches: those all three share, and those between, where one side or
 * both changed. Items compared with `===`.
 *
 * @param {readonly unknown[]} base
 * @param {readonly unknown[]} mine
 * @param {readonly unknown[]} theirs
 * @param {Object} [options]
 * @param {number} [options.maxEdits] - Past this many deletions and
 *   insertions on either side, give up
 * @param {boolean} [options.startFirst] - Line each side up against the
 *   base from the start first (`diffSequences`)
 * @returns {Chunk[]|null} Null when either side's edit is over `maxEdits`
 */
export function diff3(base, mine, theirs, options) {
  const toMine = matches(base, mine, options)
  const toTheirs = matches(base, theirs, options)
  if (!toMine || !toTheirs) return null
  /** @type {Chunk[]} */
  const chunks = []
  let i = 0
  let j = 0
  let k = 0
  while (i < base.length || j < mine.length || k < theirs.length) {
    let n = 0
    while (i + n < base.length && toMine[i + n] === j + n && toTheirs[i + n] === k + n) n++
    if (n > 0) {
      chunks.push({ stable: true, base: [i, i + n], mine: [j, j + n], theirs: [k, k + n] })
      i += n
      j += n
      k += n
      continue
    }
    // On to the next item of the base both sides kept.
    let next = i
    while (next < base.length && (toMine[next] < 0 || toTheirs[next] < 0)) next++
    const [toI, toJ, toK] =
      next < base.length
        ? [next, toMine[next], toTheirs[next]]
        : [base.length, mine.length, theirs.length]
    chunks.push({ stable: false, base: [i, toI], mine: [j, toJ], theirs: [k, toK] })
    i = toI
    j = toJ
    k = toK
  }
  return chunks
}

/**
 * Where each item of `a` is in `b`, or -1 where `b` lost it.
 *
 * @param {readonly unknown[]} a
 * @param {readonly unknown[]} b
 * @param {{maxEdits?: number, startFirst?: boolean}} [options]
 * @returns {Int32Array|null}
 */
function matches(a, b, options) {
  const steps = diffSequences(a, b, options)
  if (!steps) return null
  const out = new Int32Array(a.length).fill(-1)
  for (const step of steps) if (step.op === 'equal') out[step.a] = step.b
  return out
}

/**
 * Two sequences paired in order, as many pairs as can be and the likest:
 * the pairs whose total, one for each and its likeness, is greatest. Where
 * that leaves one over, it is the last.
 *
 * @param {number} n
 * @param {number} m
 * @param {(i: number, j: number) => number} likenessOf - 0 or more
 * @returns {Array<[number, number]>}
 */
export function pairUp(n, m, likenessOf) {
  const like = Array.from({ length: n }, (_, i) =>
    Array.from({ length: m }, (_, j) => 1 + likenessOf(i, j))
  )
  const best = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      best[i][j] = Math.max(best[i - 1][j], best[i][j - 1], best[i - 1][j - 1] + like[i - 1][j - 1])
    }
  }
  /** @type {Array<[number, number]>} */
  const out = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    if (best[i][j] === best[i][j - 1]) j--
    else if (best[i][j] === best[i - 1][j]) i--
    else {
      out.push([i - 1, j - 1])
      i--
      j--
    }
  }
  return out.reverse()
}

/**
 * How many items two lists share, each counted once: empty ones aside.
 *
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number}
 */
export function sharedCount(a, b) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const text of a) if (text) counts.set(text, (counts.get(text) ?? 0) + 1)
  let shared = 0
  for (const text of b) {
    const left = counts.get(text) ?? 0
    if (left > 0) {
      shared++
      counts.set(text, left - 1)
    }
  }
  return shared
}
