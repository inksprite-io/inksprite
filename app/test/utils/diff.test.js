import { describe, it, expect } from 'vitest'
import { diff3, diffSequences, deletionsFirst } from '@/utils/diff.js'

/** The fewest deletions and insertions from `a` to `b`, by the textbook table. */
function fewestEdits(a, b) {
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  return a.length + b.length - 2 * lcs[0][0]
}

/** Check that steps take `a` to `b`, in order, keeping only what is the same. */
function check(a, b, steps) {
  let i = 0
  let j = 0
  const out = []
  for (const step of steps) {
    if (step.op === 'equal') {
      expect(step.a).toBe(i++)
      expect(step.b).toBe(j++)
      expect(a[step.a]).toBe(b[step.b])
      out.push(a[step.a])
    } else if (step.op === 'delete') {
      expect(step.a).toBe(i++)
    } else {
      expect(step.b).toBe(j++)
      out.push(b[step.b])
    }
  }
  expect(i).toBe(a.length)
  expect(j).toBe(b.length)
  expect(out).toEqual(b)
}

/** A seeded generator, so a failure can be run again. */
function random(seed) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

describe('diffSequences', () => {
  it('takes one sequence to the other in the fewest edits', () => {
    const next = random(7)
    for (let round = 0; round < 400; round++) {
      const length = () => Math.floor(next() * 14)
      const pick = () => 'abcd'[Math.floor(next() * 4)]
      const a = Array.from({ length: length() }, pick)
      const b = Array.from({ length: length() }, pick)
      const steps = diffSequences(a, b)
      expect(steps).not.toBeNull()
      check(a, b, steps ?? [])
      const edits = (steps ?? []).filter(step => step.op !== 'equal').length
      expect(edits, `${a.join('')} → ${b.join('')}`).toBe(fewestEdits(a, b))
    }
  })

  it('keeps the last item where it can, and puts what goes before what comes', () => {
    const steps = diffSequences(['A', '\n', 'B', '\n'], ['A', '\n'])
    expect(steps).toEqual([
      { op: 'equal', a: 0, b: 0 },
      { op: 'delete', a: 1 },
      { op: 'delete', a: 2 },
      { op: 'equal', a: 3, b: 1 },
    ])
    expect(diffSequences([...'cat'], [...'dog'])?.map(step => step.op)).toEqual([
      'delete',
      'delete',
      'delete',
      'insert',
      'insert',
      'insert',
    ])
  })

  it('gives up past the edits it is allowed', () => {
    expect(diffSequences([...'abcdef'], [...'uvwxyz'], { maxEdits: 4 })).toBeNull()
    expect(diffSequences([...'abcdef'], [...'abXdef'], { maxEdits: 4 })).not.toBeNull()
    expect(diffSequences([], [...'abcdef'], { maxEdits: 4 })).toBeNull()
  })

  it('handles empty sequences and the same sequence', () => {
    expect(diffSequences([], [])).toEqual([])
    expect(diffSequences(['x'], ['x'])).toEqual([{ op: 'equal', a: 0, b: 0 }])
    expect(diffSequences(['x'], [])).toEqual([{ op: 'delete', a: 0 }])
  })
})

describe('deletionsFirst', () => {
  it('moves each change’s insertions after its deletions', () => {
    expect(
      deletionsFirst([
        { op: 'insert', b: 0 },
        { op: 'delete', a: 0 },
        { op: 'equal', a: 1, b: 1 },
        { op: 'delete', a: 2 },
      ])
    ).toEqual([
      { op: 'delete', a: 0 },
      { op: 'insert', b: 0 },
      { op: 'equal', a: 1, b: 1 },
      { op: 'delete', a: 2 },
    ])
  })
})

describe('diff3', () => {
  /** Check that the chunks lay all three out end to end, the stable ones alike. */
  function tiles(base, mine, theirs, chunks) {
    const at = { base: 0, mine: 0, theirs: 0 }
    const versions = { base, mine, theirs }
    for (const chunk of chunks) {
      for (const side of ['base', 'mine', 'theirs']) {
        expect(chunk[side][0]).toBe(at[side])
        at[side] = chunk[side][1]
      }
      if (chunk.stable) {
        const items = side => versions[side].slice(...chunk[side])
        expect(items('mine')).toEqual(items('base'))
        expect(items('theirs')).toEqual(items('base'))
      }
    }
    expect(at).toEqual({ base: base.length, mine: mine.length, theirs: theirs.length })
  }

  /** The chunks in short: a stable one as its items, a changed one as each side's. */
  function laid(base, mine, theirs) {
    const chunks = diff3(base, mine, theirs)
    tiles(base, mine, theirs, chunks)
    return chunks.map(chunk =>
      chunk.stable
        ? base.slice(...chunk.base).join('')
        : [base, mine, theirs].map((side, i) =>
            side.slice(...chunk[['base', 'mine', 'theirs'][i]]).join('')
          )
    )
  }

  it('finds one stretch when nothing changed, and none for three empty', () => {
    expect(laid([...'abc'], [...'abc'], [...'abc'])).toEqual(['abc'])
    expect(diff3([], [], [])).toEqual([])
  })

  it('parts changes with something kept between them', () => {
    expect(laid([...'abcde'], [...'aXcde'], [...'abcdY'])).toEqual([
      'a',
      ['b', 'X', 'b'],
      'cd',
      ['e', 'e', 'Y'],
    ])
  })

  it('gives changes that meet one stretch', () => {
    expect(laid([...'abcd'], [...'aXcd'], [...'abYd'])).toEqual(['a', ['bc', 'Xc', 'bY'], 'd'])
  })

  it('lays out insertions at the start and the end, and a side emptied', () => {
    expect(laid([...'ab'], [...'Xab'], [...'abY'])).toEqual([['', 'X', ''], 'ab', ['', '', 'Y']])
    expect(laid([...'ab'], [], [...'ab'])).toEqual([['ab', '', 'ab']])
  })

  it('gives up past the edits allowed', () => {
    expect(diff3([...'abc'], [...'xyz'], [...'abc'], { maxEdits: 2 })).toBeNull()
  })

  it('merges changes apart into what each side meant, on random edits', () => {
    const next = random(7)
    const letters = 'abcdefgh'
    for (let round = 0; round < 300; round++) {
      const base = Array.from(
        { length: 4 + Math.floor(next() * 30) },
        () => letters[Math.floor(next() * letters.length)]
      )
      // Mine edits the first half, theirs the second; a kept item between.
      const cut = Math.floor(base.length / 2)
      const edit = (part, mark) => {
        const out = [...part]
        for (let k = 0; k < 3; k++) {
          const at = Math.floor(next() * (out.length + 1))
          if (next() < 0.5 && out.length > 0) out.splice(Math.min(at, out.length - 1), 1)
          else out.splice(at, 0, mark)
        }
        return out
      }
      const mine = [...edit(base.slice(0, cut), 'M'), '|', ...base.slice(cut)]
      const theirs = [...base.slice(0, cut), '|', ...edit(base.slice(cut), 'T')]
      const withBar = [...base.slice(0, cut), '|', ...base.slice(cut)]
      const chunks = diff3(withBar, mine, theirs)
      tiles(withBar, mine, theirs, chunks)
      const merged = []
      for (const chunk of chunks) {
        const items = (side, list) => list.slice(...chunk[side])
        const [b, m, t] = [items('base', withBar), items('mine', mine), items('theirs', theirs)]
        if (chunk.stable || t.join('') === b.join('')) merged.push(...m)
        else if (m.join('') === b.join('')) merged.push(...t)
        else throw new Error(`round ${round}: both changed one stretch`)
      }
      expect(merged.join(''), `round ${round}`).toBe(
        [...mine.slice(0, mine.indexOf('|') + 1), ...theirs.slice(theirs.indexOf('|') + 1)].join('')
      )
    }
  })
})
