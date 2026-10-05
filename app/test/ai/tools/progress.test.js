import { describe, it, expect } from 'vitest'
import { describeProgress, describeEdit, describeRound } from '@/ai/tools/progress.js'

describe('describeProgress', () => {
  it('names an edit by its path, the passage going, and the prose so far', () => {
    expect(
      describeProgress(
        'edit_document',
        '{"path":"manuscript/Chapter 1","old":"Snow fell.","new":"Rain lashed the ro'
      )
    ).toEqual({
      verb: 'Editing',
      path: 'manuscript/Chapter 1',
      old: 'Snow fell.',
      prose: 'Rain lashed the ro',
    })
  })

  it('knows where each writing tool keeps its prose', () => {
    expect(describeProgress('append_document', '{"path":"a","text":"More."}')).toEqual({
      verb: 'Adding to',
      path: 'a',
      prose: 'More.',
    })
    expect(describeProgress('create_document', '{"path":"a","content":"Once"}')).toEqual({
      verb: 'Creating',
      path: 'a',
      prose: 'Once',
    })
    expect(
      describeProgress('update_document', '{"path":"a","updates":{"content":"Rewritten')
    ).toEqual({ verb: 'Updating', path: 'a', prose: 'Rewritten' })
  })

  it('says only what has arrived', () => {
    expect(describeProgress('edit_document', '{"pa')).toEqual({ verb: 'Editing' })
    expect(describeProgress('edit_document', '')).toEqual({ verb: 'Editing' })
    expect(describeProgress('edit_document', '{"path":"a","old":"x"')).toEqual({
      verb: 'Editing',
      path: 'a',
      old: 'x',
    })
  })

  it('names any other call, with its path if it has one', () => {
    expect(describeProgress('roll_dice', '{"dice":"2d6"}')).toEqual({ verb: 'Calling roll_dice' })
    expect(describeProgress('read_document', '{"path":"notes"}')).toEqual({
      verb: 'Calling read_document',
      path: 'notes',
    })
  })
})

describe('describeEdit', () => {
  it('says a listing as what it does', () => {
    expect(describeProgress('list_documents', '{"path":"notes"}')).toEqual({
      verb: 'Listing',
      path: 'notes',
    })
    expect(describeProgress('list_documents', '{}')).toEqual({ verb: 'Listing' })
  })

  it('describes a recorded change the way a call in flight is described', () => {
    expect(
      describeEdit({ documentId: 'd', path: 'a', tool: 'edit_document', old: 'Snow', new: 'Rain' })
    ).toEqual({ verb: 'Editing', path: 'a', old: 'Snow', prose: 'Rain' })
    expect(
      describeEdit({
        documentId: 'd',
        path: 'a',
        tool: 'update_document',
        old: 'whole',
        new: 'New.',
      })
    ).toEqual({ verb: 'Updating', path: 'a', prose: 'New.' })
    expect(
      describeEdit({
        documentId: '',
        path: 'Verse',
        tool: 'create_document',
        old: '',
        new: 'Once.',
      })
    ).toEqual({ verb: 'Creating', path: 'Verse', prose: 'Once.' })
  })

  it('shows an accepted change as what changed, without what finds it', () => {
    expect(
      describeEdit({
        documentId: 'd',
        path: 'a',
        tool: 'edit_document',
        old: 'e gate was shut. The',
        new: 'e gate was shut. Nobody came. The',
        status: 'accepted',
      })
    ).toEqual({ verb: 'Editing', path: 'a', prose: 'Nobody came. ' })
    // A proposal is the passages the model wrote, shown whole.
    expect(
      describeEdit({
        documentId: 'd',
        path: 'a',
        tool: 'edit_document',
        old: 'The gate was shut.',
        new: 'The gate was shut. Nobody came.',
        status: 'proposed',
      })
    ).toEqual({
      verb: 'Editing',
      path: 'a',
      old: 'The gate was shut.',
      prose: 'The gate was shut. Nobody came.',
    })
  })
})

describe('describeRound', () => {
  const call = (name, args = {}) => ({ name, arguments: JSON.stringify(args) })

  it('names the one document a call is about, by the end of its path', () => {
    const read = [call('read_document', { path: 'Notes/Characters/Vivi' })]
    expect(describeRound(read, false)).toBe('Reading Vivi')
    expect(describeRound(read, true)).toBe('Read Vivi')
  })

  it('names what a search was for', () => {
    expect(describeRound([call('search_documents', { query: 'lamp oil' })], true)).toBe(
      'Searched for “lamp oil”'
    )
  })

  it('says what a call without an object does', () => {
    expect(describeRound([call('roll_dice', { notation: '2d6' })], false)).toBe('Rolling dice')
  })

  it('counts the documents a round read together', () => {
    const reads = [call('read_document', { path: 'A' }), call('read_document', { path: 'B' })]
    expect(describeRound(reads, true)).toBe('Read 2 documents')
  })

  it('counts a mixed round as tools', () => {
    const mixed = [call('read_document', { path: 'A' }), call('roll_dice')]
    expect(describeRound(mixed, false)).toBe('Running 2 tools')
  })

  it('falls back to the name of a tool it has no words for', () => {
    expect(describeRound([call('mystery_tool')], true)).toBe('Ran mystery_tool')
  })

  it('reads arguments that are still arriving', () => {
    expect(describeRound([{ name: 'read_document', arguments: '{"path": "Chap' }], false)).toBe(
      'Reading Chap'
    )
  })
})
