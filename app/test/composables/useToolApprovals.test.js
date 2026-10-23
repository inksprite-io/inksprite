import { describe, it, expect, afterEach } from 'vitest'
import {
  askApproval,
  asksFirst,
  denyWaiting,
  useToolApprovals,
} from '@/composables/useToolApprovals.js'
import { setWebSearch } from '@/web/config.js'

describe('asksFirst', () => {
  afterEach(() => setWebSearch(null))

  it('asks before a page is saved, until the writer says not to', () => {
    expect(asksFirst('save_web_page')).toBe(true)

    setWebSearch({ id: 'web', keys: {}, profiles: [], saveWithoutAsking: true })
    expect(asksFirst('save_web_page')).toBe(false)
  })

  it('runs the app’s own tools without asking', () => {
    expect(asksFirst('read_web_page')).toBe(false)
    expect(asksFirst('create_document')).toBe(false)
  })
})

describe('a question a tool asks as it runs', () => {
  it('waits beside the call with the question, and is denied when the turn stops', async () => {
    const decided = askApproval(
      'm1',
      { id: 'c1', function: { name: 'explore_documents', arguments: '{}' } },
      'Explore the project? 60 documents, about 1.5M tokens in 34 requests.'
    )
    const { pending } = useToolApprovals('m1')

    expect(pending.value).toEqual([
      {
        id: 'c1',
        messageId: 'm1',
        name: 'explore_documents',
        arguments: '{}',
        question: 'Explore the project? 60 documents, about 1.5M tokens in 34 requests.',
      },
    ])

    denyWaiting('m1')
    expect(await decided).toBe('deny')
    expect(pending.value).toEqual([])
  })
})
