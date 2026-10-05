import { describe, it, expect } from 'vitest'
import {
  diffEdit,
  diffAppend,
  narrowEdit,
  reverseEdit,
  applyEdit,
  keepDecisions,
} from '../../src/utils/edits'

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
