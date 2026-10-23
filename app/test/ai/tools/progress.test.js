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
  it('says what a comment it makes or resolves says, not its markup', () => {
    const thread = {
      status: 'open',
      quote: 'door',
      posts: [{ author: 'model', text: 'Which door?', created: 1 }],
    }
    expect(
      describeEdit({
        documentId: 'd',
        path: 'Chapter 1',
        tool: 'edit_document',
        old: 'the door',
        new: 'the {==door==}{>>cabcd1<<}',
        comments: [{ id: 'cabcd1', before: null, after: thread }],
      })
    ).toEqual({ verb: 'Commenting on', path: 'Chapter 1', prose: 'Which door?' })
    expect(
      describeEdit({
        documentId: 'd',
        path: 'Chapter 1',
        tool: 'edit_document',
        old: 'the {==door==}{>>cabcd1<<}',
        new: 'the door',
        comments: [{ id: 'cabcd1', before: thread, after: { ...thread, status: 'resolved' } }],
      })
    ).toEqual({ verb: 'Resolving a comment in', path: 'Chapter 1', prose: 'Which door?' })
  })

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

  it('names the web: what was searched for, and the page by the end of its address', () => {
    expect(describeRound([call('web_search', { query: 'counting games' })], false)).toBe(
      'Searching the web for “counting games”'
    )
    const save = [call('save_web_page', { url: 'https://example.org/files/maths%20standards.pdf' })]
    expect(describeRound(save, false)).toBe('Saving maths standards.pdf')
    expect(describeRound([call('read_web_page', { url: 'https://example.org/' })], true)).toBe(
      'Read example.org'
    )
    expect(describeRound([call('read_web_page', { url: 'https://exa' })], false)).toBe(
      'Reading exa'
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

describe('a chat that suggests its edits', () => {
  it('says its writing calls suggest, as they are written and once they have run', () => {
    const suggesting = { suggesting: true }
    expect(
      describeProgress('edit_document', '{"path":"Chapter 1","old":"Snow"', suggesting)
    ).toEqual({
      verb: 'Suggesting changes to',
      path: 'Chapter 1',
      old: 'Snow',
    })
    expect(describeProgress('append_document', '{"path":"Chapter 1"}', suggesting).verb).toBe(
      'Suggesting an addition to'
    )
    // What becomes a proposal rather than a suggestion reads as it did.
    expect(describeProgress('create_document', '{"path":"Verse"}', suggesting).verb).toBe(
      'Creating'
    )

    const call = { name: 'edit_document', arguments: '{"path":"Draft/Chapter 1"}' }
    expect(describeRound([call], false, suggesting)).toBe('Suggesting changes to Chapter 1')
    expect(describeRound([call], true, suggesting)).toBe('Suggested changes to Chapter 1')
    expect(describeRound([call, call], true, suggesting)).toBe('Suggested changes to 2 documents')
    expect(describeRound([call], true)).toBe('Edited Chapter 1')
  })

  it('says a recorded edit that was suggested suggested', () => {
    expect(
      describeEdit({
        documentId: 'd',
        path: 'Chapter 1',
        tool: 'edit_document',
        old: 'Snow',
        new: '{--Snow--}{>>s1<<}{++Rain++}{>>s1<<}',
        suggested: true,
      }).verb
    ).toBe('Suggesting changes to')
  })
})
