import { describe, it, expect } from 'vitest'
import {
  ROUND_LIMIT,
  refusedAnswer,
  splitOffered,
  trimRound,
  unofferedAnswer,
} from '@/ai/rounds.js'

const call = (id, name, args = '{}') => ({
  id,
  type: 'function',
  function: { name, arguments: args },
})

describe('trimRound', () => {
  it('runs every call of an ordinary round', () => {
    const calls = [call('a', 'read_document', '{"path":"x"}'), call('b', 'search_documents')]

    expect(trimRound(calls)).toEqual({ run: calls, refused: null, left: 0 })
  })

  it('runs a call asked for again in the same round once, however it was spaced', () => {
    const first = call('a', 'list_documents', '{"path":"Notes"}')
    const { run, refused, left } = trimRound([
      first,
      call('b', 'list_documents', '{ "path": "Notes" }'),
      call('c', 'list_documents', '{"path":"Notes"}'),
    ])

    expect(run).toEqual([first])
    expect(refused?.id).toBe('b')
    expect(left).toBe(2)
  })

  it('runs no more than the limit of distinct calls', () => {
    const calls = Array.from({ length: ROUND_LIMIT + 5 }, (_, i) =>
      call(`c${i}`, 'read_document', JSON.stringify({ path: `doc ${i}` }))
    )
    const { run, refused, left } = trimRound(calls)

    expect(run).toHaveLength(ROUND_LIMIT)
    expect(refused?.id).toBe(`c${ROUND_LIMIT}`)
    expect(left).toBe(5)
  })
})

describe('refusedAnswer', () => {
  it('answers the first call left out for all of them, as an error', () => {
    const answer = refusedAnswer(call('b', 'list_documents'), 253)

    expect(answer.tool_call_id).toBe('b')
    expect(JSON.parse(answer.content).error).toMatch(/^Not run, and nor were 252 more calls/)
    expect(JSON.parse(refusedAnswer(call('b', 'x'), 1).content).error).toMatch(/^Not run: /)
  })
})

describe('splitOffered', () => {
  const offering = (...names) => names.map(name => ({ type: 'function', function: { name } }))

  it('runs the calls to tools the request offered, and holds back the rest', () => {
    const read = call('a', 'read_document')
    const search = call('b', 'web_search', '{"query":"x"}')
    const list = call('c', 'list_documents')

    expect(splitOffered([read, search, list], offering('read_document', 'list_documents'))).toEqual(
      { offered: [read, list], unoffered: [search] }
    )
  })

  it('holds back every call when nothing was offered', () => {
    const search = call('b', 'web_search')

    expect(splitOffered([search], [])).toEqual({ offered: [], unoffered: [search] })
  })
})

describe('unofferedAnswer', () => {
  it('answers the call as an error that names the tool', () => {
    const answer = unofferedAnswer(call('b', 'web_search'))

    expect(answer).toMatchObject({ role: 'tool', tool_call_id: 'b' })
    expect(JSON.parse(answer.content).error).toBe(
      'Not run: web_search is not one of the tools this chat offers now.'
    )
  })
})
