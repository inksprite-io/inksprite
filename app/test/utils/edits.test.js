import { describe, it, expect, vi } from 'vitest'
import {
  diffEdit,
  diffAppend,
  leastEnough,
  narrowEdit,
  placedEdit,
  reverseEdit,
  applyEdit,
  keepDecisions,
} from '../../src/utils/edits'

/** How many times a text is searched, or cut up to be counted, while something runs. */
const searches = run => {
  const spies = [vi.spyOn(String.prototype, 'indexOf'), vi.spyOn(String.prototype, 'split')]
  try {
    run()
    return spies.reduce((count, spy) => count + spy.mock.calls.length, 0)
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
}

describe('diffEdit', () => {
  it('cuts the pair to what changed', () => {
    expect(diffEdit('Snow fell on the road.', 'Rain lashed the road.')).toEqual({
      old: 'Snow fell on',
      new: 'Rain lashed',
    })
  })

  it('has nothing to say when nothing changed', () => {
    expect(diffEdit('same', 'same')).toBeNull()
  })

  it('takes in context so an insertion can be found again on the way forward', () => {
    expect(diffEdit('One.', 'One.\n\nTwo.')).toEqual({ old: 'One.', new: 'One.\n\nTwo.' })
  })

  it('records what was written onto an empty document as replacing nothing', () => {
    expect(diffEdit('', 'One.')).toEqual({ old: '', new: 'One.' })
  })

  it('takes in context so a deletion can be found on the way back', () => {
    const before = 'The gate was shut. Nobody came. The end.'
    const after = 'The gate was shut. The end.'
    const pair = diffEdit(before, after)
    expect(pair.new).not.toBe('')
    expect(after.split(pair.new).length - 1).toBe(1)
    expect(after.replace(pair.new, pair.old)).toBe(before)
  })

  it('takes in context until what it wrote is found once', () => {
    const before = 'a road. a road. a road.'
    const after = 'a road. a path. a road.'
    const pair = diffEdit(before, after)
    expect(after.split(pair.new).length - 1).toBe(1)
    expect(after.replace(pair.new, pair.old)).toBe(before)
  })

  it('takes in context until what it replaced is found once', () => {
    const before = 'a road. a path. a road.'
    const after = 'a road. a road. a road.'
    const pair = diffEdit(before, after)
    expect(before.split(pair.old).length - 1).toBe(1)
    expect(before.replace(pair.old, pair.new)).toBe(after)
  })

  it('takes in context, in a text that repeats itself, until the pair is at one place alone', () => {
    // Two hundred letters, one changed in the middle. The letters around it
    // are at every other place, one copy over the next, so nothing short of
    // the whole text is at one place and no other: a shorter pair would be
    // put back two letters off.
    const before = 'ab'.repeat(100)
    const after = `${before.slice(0, 100)}X${before.slice(101)}`
    const pair = diffEdit(before, after)
    expect(pair).toEqual({ old: before, new: after })

    // Where the text around the change tells its place sooner, so does the pair.
    const told = `${'ab'.repeat(40)}cd${'ab'.repeat(59)}`
    const short = diffEdit(told, `${told.slice(0, 100)}X${told.slice(101)}`)
    expect(told.indexOf(short.old)).toBe(told.lastIndexOf(short.old))
    expect(short.old.length).toBeLessThan(told.length)
  })

  it('searches a text that repeats itself a few dozen times, however long it is', () => {
    // Stepped up to twenty letters at a time, the pair for a change near the
    // start of a text of one sentence over and over is searched for at
    // every step: hundreds of times in the shorter of these, and four times
    // as many in the longer.
    const change = sentences => {
      const before = 'The tide came in and went out. '.repeat(sentences)
      const after = before.replace('came', 'crept')
      let pair
      const count = searches(() => (pair = diffEdit(before, after)))
      expect(before.split(pair.old).length - 1).toBe(1)
      expect(pair.old.length).toBeGreaterThan(before.length / 2)
      return count
    }
    const [shorter, longer] = [change(500), change(2000)]
    expect(shorter).toBeLessThan(100)
    expect(longer).toBeLessThan(shorter + 20)
  })
})

describe('placedEdit', () => {
  it('gives the pair with where it starts, the same place in both texts', () => {
    expect(placedEdit('Snow fell on the road.', 'Rain lashed the road.')).toEqual({
      old: 'Snow fell on',
      new: 'Rain lashed',
      at: 0,
    })
    const [before, after] = ['a road. a road. a road.', 'a road. a path. a road.']
    const placed = placedEdit(before, after)
    expect(placed).toEqual({ ...diffEdit(before, after), at: expect.any(Number) })
    expect(before.slice(placed.at, placed.at + placed.old.length)).toBe(placed.old)
    expect(after.slice(placed.at, placed.at + placed.new.length)).toBe(placed.new)
    expect(placedEdit('same', 'same')).toBeNull()
  })

  it('gives the same pair told how much the two share, without comparing that again', () => {
    const [head, tail] = ['The gate was shut. '.repeat(40), ' The end.'.repeat(40)]
    const [before, after] = [`${head}Nobody came.${tail}`, `${head}Somebody came by.${tail}`]
    const whole = placedEdit(before, after)
    expect(whole).toEqual({ old: 'Nobody came', new: 'Somebody came by', at: head.length })
    for (const same of [
      { start: head.length, end: tail.length },
      { start: head.length - 7 },
      { end: 12 },
    ]) {
      expect(placedEdit(before, after, same)).toEqual(whole)
    }
    // What it is told they share it takes as said, the same or not.
    expect(placedEdit(`x${before}`, `y${before}`, { start: 1 })).toBeNull()
    const all = { start: head.length, end: tail.length }
    expect(placedEdit(`${head}One.${tail}`, `${head}${tail}`, all)).toEqual(
      placedEdit(`${head}One.${tail}`, `${head}${tail}`)
    )
  })
})

describe('leastEnough', () => {
  it('finds the least count that is enough, and the most where none below it is', () => {
    for (const most of [0, 1, 2, 5, 6, 100]) {
      for (let least = 0; least <= most + 1; least++) {
        expect(leastEnough(most, count => count >= least)).toBe(Math.min(least, most))
      }
    }
  })

  it('asks of few counts where there are many, and never of the most', () => {
    const most = 100_000
    for (const least of [0, 1, 2, 3, 77, 6350, most - 1, most, most + 1]) {
      const asked = []
      const found = leastEnough(most, count => {
        asked.push(count)
        return count >= least
      })
      expect(found).toBe(Math.min(least, most))
      expect(asked.length).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(most)) + 2)
      expect(asked).not.toContain(most)
      expect(new Set(asked).size).toBe(asked.length)
    }
  })
})

describe('diffAppend', () => {
  it('records what arrived at the end, and nothing replaced', () => {
    expect(diffAppend('One.', 'One.\n\nTwo.')).toEqual({ old: '', new: '\n\nTwo.' })
    expect(diffAppend('', 'One.')).toEqual({ old: '', new: 'One.' })
    expect(diffAppend('same', 'same')).toBeNull()
  })

  it('is a pair like any other when the end did not survive as it was', () => {
    const pair = diffAppend('One. ', 'One.\n\nTwo.')
    expect(pair).toEqual(diffEdit('One. ', 'One.\n\nTwo.'))
    expect(pair.old).not.toBe('')
  })
})

describe('narrowEdit', () => {
  it('cuts a pair back to what changed', () => {
    expect(
      narrowEdit({ old: 'e gate was shut. The', new: 'e gate was shut. Nobody came. The' })
    ).toEqual({ old: '', new: 'Nobody came. ' })
    expect(narrowEdit({ old: 'Snow', new: 'Rain' })).toEqual({ old: 'Snow', new: 'Rain' })
    expect(narrowEdit({ old: '', new: '\n\nTwo.' })).toEqual({ old: '', new: '\n\nTwo.' })
  })
})

describe('reverseEdit', () => {
  const edit = { documentId: 'd', path: 'p', tool: 'edit_document', old: 'Snow', new: 'Rain' }

  it('puts the old passage back where the new one is', () => {
    expect(reverseEdit('Rain fell.', edit)).toBe('Snow fell.')
  })

  it('refuses when the new passage is gone or doubled', () => {
    expect(reverseEdit('Sleet fell.', edit)).toBeNull()
    expect(reverseEdit('Rain, Rain.', edit)).toBeNull()
    expect(reverseEdit('anything', { ...edit, new: '' })).toBeNull()
  })

  it('refuses a passage that is at two places, one over the other', () => {
    // "111" is in "1111" at two places, and put back at the first would be a place off.
    expect(reverseEdit('in room 1111', { ...edit, old: '999', new: '111' })).toBeNull()
  })

  it('puts back a change whose words overlap themselves, where it was made', () => {
    for (const [before, after] of [
      ['in room 1999', 'in room 1111'],
      ['He said nooooo to it.', 'He said no way to it.'],
      ['aaaa', 'aaa'],
    ]) {
      const pair = {
        ...edit,
        .../** @type {{old: string, new: string}} */ (diffEdit(before, after)),
      }
      expect(reverseEdit(after, pair)).toBe(before)
      expect(applyEdit(before, pair)).toBe(after)
    }
  })

  it('takes an append off the end, and only the end', () => {
    const append = { ...edit, tool: 'append_document', old: '', new: '\n\nTwo.' }
    expect(reverseEdit('One.\n\nTwo.', append)).toBe('One.')
    expect(reverseEdit('One.\n\nTwo. Three.', append)).toBeNull()
  })

  it('puts the end back as it was when the append took it in as context', () => {
    const append = { ...edit, tool: 'append_document', old: 'One.', new: 'One.\n\nTwo.' }
    expect(reverseEdit('Zero. One.\n\nTwo.', append)).toBe('Zero. One.')
  })

  it('writes a dollar sign back as a dollar sign', () => {
    expect(reverseEdit('x new', { ...edit, old: '$& costs', new: 'new' })).toBe('x $& costs')
  })
})

describe('applyEdit', () => {
  const edit = { documentId: 'd', path: 'p', tool: 'edit_document', old: 'Snow', new: 'Rain' }

  it('puts the new passage where the old one is', () => {
    expect(applyEdit('Snow fell.', edit)).toBe('Rain fell.')
  })

  it('refuses when the old passage is gone or doubled', () => {
    expect(applyEdit('Sleet fell.', edit)).toBeNull()
    expect(applyEdit('Snow, Snow.', edit)).toBeNull()
  })

  it('writes onto an empty document what was written onto one, and nowhere else', () => {
    const onto = { ...edit, old: '', new: 'One.' }
    expect(applyEdit('', onto)).toBe('One.')
    expect(applyEdit('Something.', onto)).toBeNull()
  })

  it('puts an append back on the end, where the end still reads as it did', () => {
    const append = { ...edit, tool: 'append_document', old: 'One.', new: 'One.\n\nTwo.' }
    expect(applyEdit('Zero. One.', append)).toBe('Zero. One.\n\nTwo.')
    expect(applyEdit('Zero. One. Three.', append)).toBeNull()
    // A record from before appends took in context goes on the end regardless.
    expect(applyEdit('Anything.', { ...append, old: '', new: '\n\nTwo.' })).toBe(
      'Anything.\n\nTwo.'
    )
  })

  it('undoes what reverseEdit did, and the other way round', () => {
    const before = 'The gate was shut. Nobody came. The end.'
    const after = 'The gate was shut. The end.'
    const pair = { ...edit, ...diffEdit(before, after) }
    expect(reverseEdit(after, pair)).toBe(before)
    expect(applyEdit(before, pair)).toBe(after)
  })

  it('writes a dollar sign as a dollar sign', () => {
    expect(applyEdit('x old', { ...edit, old: 'old', new: '$& costs' })).toBe('x $& costs')
  })
})

describe('keepDecisions', () => {
  const proposed = id => ({
    id,
    documentId: 'doc_1',
    path: 'p',
    tool: 'edit_document',
    old: 'a',
    new: 'b',
    status: 'proposed',
  })

  it("keeps a decision the writer made on the turn's own copy", () => {
    const accepted = { ...proposed('e1'), old: 'applied a', new: 'applied b', status: 'accepted' }
    const rejected = { ...proposed('e2'), status: 'rejected' }
    const out = keepDecisions(
      [proposed('e1'), proposed('e2'), proposed('e3')],
      [accepted, rejected]
    )
    expect(out).toEqual([accepted, rejected, proposed('e3')])
  })

  it("leaves the turn's copy alone when nothing has been decided", () => {
    const fresh = [proposed('e1')]
    expect(keepDecisions(fresh, undefined)).toBe(fresh)
    expect(keepDecisions(fresh, [])).toBe(fresh)
    expect(keepDecisions(fresh, [proposed('e1')])).toBe(fresh)
  })

  it('matches by id, not by place', () => {
    const accepted = { ...proposed('e2'), status: 'accepted' }
    expect(
      keepDecisions([proposed('e2')], [{ ...proposed('e1'), status: 'accepted' }, accepted])
    ).toEqual([accepted])
    // A record from before changes had names is left as it is.
    const { id: _id, ...unnamed } = proposed('x')
    expect(keepDecisions([unnamed], [{ ...unnamed, status: 'accepted' }])).toEqual([unnamed])
  })
})
