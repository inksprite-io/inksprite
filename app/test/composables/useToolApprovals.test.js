import { describe, it, expect, afterEach } from 'vitest'
import {
  askApproval,
  asksFirst,
  denyWaiting,
  siteAsking,
  useToolApprovals,
} from '@/composables/useToolApprovals.js'
import { setWebSearch } from '@/web/config.js'
import { seenIn } from '@/web/addresses.js'

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

  describe('of a page’s address', () => {
    const seen = seenIn([{ role: 'user', content: 'See https://tides.example/start' }])
    const at = url => JSON.stringify({ url })
    const made = at('https://collector.example/?q=secret')

    it('asks before a read at an address the model put together, naming its site', () => {
      expect(asksFirst('read_web_page', made, seen)).toBe(true)
      expect(siteAsking('read_web_page', made, seen)).toBe('collector.example')
      expect(asksFirst('read_web_page', at('https://tides.example/start'), seen)).toBe(false)
    })

    it('asks no more of a site always allowed, or once reading never asks', () => {
      setWebSearch({ id: 'web', keys: {}, allowedSites: ['collector.example'] })
      expect(asksFirst('read_web_page', made, seen)).toBe(false)

      setWebSearch({ id: 'web', keys: {}, readWithoutAsking: true })
      expect(asksFirst('read_web_page', made, seen)).toBe(false)
    })

    it('asks before a page is kept at such an address, even once keeping never asks', () => {
      setWebSearch({ id: 'web', keys: {}, saveWithoutAsking: true })
      expect(asksFirst('save_web_page', made, seen)).toBe(true)
      expect(asksFirst('save_web_page', at('https://tides.example/start'), seen)).toBe(false)
    })

    it('keeps a page the chat has read without asking about its address again', () => {
      const read = seenIn([
        { role: 'user', content: 'Find the tables.' },
        {
          role: 'assistant',
          content: '',
          metadata: {
            apiTrajectory: [
              {
                role: 'assistant',
                content: '',
                tool_calls: [{ id: 'r1', function: { name: 'read_web_page', arguments: made } }],
              },
              { role: 'tool', tool_call_id: 'r1', content: JSON.stringify({ content: 'Tables.' }) },
            ],
          },
        },
      ])
      setWebSearch({ id: 'web', keys: {}, saveWithoutAsking: true })
      expect(asksFirst('save_web_page', made, read)).toBe(false)
      // Reading it again is still the model's own address, and asks.
      expect(asksFirst('read_web_page', made, read)).toBe(true)
    })

    it('asks about the writer’s own network until they say reading there never asks', () => {
      const home = at('http://192.168.1.10/status')
      setWebSearch({ id: 'web', keys: {}, readWithoutAsking: true })
      expect(asksFirst('read_web_page', home, seen)).toBe(true)

      setWebSearch({ id: 'web', keys: {}, readLocalWithoutAsking: true })
      expect(asksFirst('read_web_page', home, seen)).toBe(false)
      // Which says nothing of an address on the web that the model put together.
      expect(asksFirst('read_web_page', made, seen)).toBe(true)
    })

    it('asks nothing of a page at home that won’t be kept, reading there being off', () => {
      setWebSearch({ id: 'web', keys: {}, readLocalOff: true })
      expect(asksFirst('save_web_page', at('http://localhost:3000/notes'), seen)).toBe(false)
      expect(asksFirst('save_web_page', at('https://tides.example/start'), seen)).toBe(true)
    })

    it('carries the site with the call that waits', async () => {
      const call = { id: 'c9', function: { name: 'read_web_page', arguments: made } }
      const decided = askApproval('m9', call, undefined, 'collector.example')
      expect(useToolApprovals('m9').pending.value[0]).toMatchObject({ site: 'collector.example' })
      denyWaiting('m9')
      expect(await decided).toBe('deny')
    })
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
