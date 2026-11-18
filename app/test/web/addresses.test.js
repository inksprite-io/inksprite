import { describe, it, expect } from 'vitest'
import {
  addressFetched,
  addressKey,
  addressesIn,
  hasSeen,
  isLocalAddress,
  mayLeadHome,
  noteWebResult,
  nothingSeen,
  readingAsks,
  seenIn,
  siteOf,
} from '@/web/addresses.js'
import { READ_WEB_PAGE, SAVE_WEB_PAGE, WEB_SEARCH } from '@/ai/tools/web.js'

const args = value => JSON.stringify(value)

/** A turn that made these calls, each answered. */
const turn = (...calls) => ({
  role: 'assistant',
  content: '',
  metadata: {
    apiTrajectory: calls.flatMap(([name, written, answered], index) => [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: `call_${index}`, function: { name, arguments: args(written) } }],
      },
      { role: 'tool', tool_call_id: `call_${index}`, content: args(answered) },
    ]),
  },
})

const said = content => ({ role: 'user', content })

describe('addressKey', () => {
  it('takes an address written with or without its scheme’s s, a last slash or a fragment as one', () => {
    const key = addressKey('https://Tides.example/tables/?port=3#spring')
    expect(key).toBe('tides.example/tables?port=3')
    expect(addressKey('http://tides.example/tables?port=3')).toBe(key)
    expect(addressKey('https://tides.example/tables?port=4')).not.toBe(key)
  })

  it('is nothing for what is no web address', () => {
    expect(addressKey('file:///etc/hosts')).toBeNull()
    expect(addressKey('tides')).toBeNull()
    expect(addressKey(undefined)).toBeNull()
  })
})

describe('addressesIn', () => {
  it('finds addresses in prose and in Markdown, without what stands around them', () => {
    expect(
      addressesIn(
        'See [the tables](https://tides.example/tables) and https://tides.example/ports. ' +
          '(Also https://tides.example/moon_(phase), and **https://tides.example/bold**.)'
      )
    ).toEqual([
      'tides.example/tables',
      'tides.example/ports',
      'tides.example/moon_(phase)',
      'tides.example/bold',
    ])
  })

  it('finds none in what is no text', () => {
    expect(addressesIn(undefined)).toEqual([])
    expect(addressesIn('no address here')).toEqual([])
  })
})

describe('isLocalAddress', () => {
  it('takes this computer and a home network’s names and numbers as local', () => {
    for (const address of [
      'http://localhost:8080/',
      'http://127.0.0.1/',
      'http://2130706433/',
      'http://10.0.0.5/admin',
      'http://172.20.1.1/',
      'http://192.168.1.1/reboot',
      'http://169.254.169.254/latest/meta-data',
      'http://100.100.1.1/',
      'http://printer/',
      'http://nas.local/',
      'http://router.lan/',
      'http://[::1]:3000/',
      'http://[fd12::1]/',
      'http://[fe80::1]/',
    ]) {
      expect(isLocalAddress(address), address).toBe(true)
    }
  })

  it('takes the rest as the web', () => {
    for (const address of [
      'https://tides.example/',
      'https://172.32.0.1/',
      'https://192.169.1.1/',
      'https://[2001:db8::1]/',
    ]) {
      expect(isLocalAddress(address), address).toBe(false)
    }
  })
})

describe('what a chat has seen', () => {
  it('has what the writer typed, what a search found, and what a page read that way links to', () => {
    const seen = seenIn([
      said('Start from https://tides.example/start'),
      turn(
        [
          WEB_SEARCH,
          { query: 'spring tides' },
          {
            results: [{ url: 'https://almanac.example/a', text: 'See https://almanac.example/b' }],
          },
        ],
        [
          READ_WEB_PAGE,
          { url: 'https://almanac.example/a' },
          { url: 'https://almanac.example/a', content: '[Next](https://almanac.example/next)' },
        ]
      ),
    ])

    for (const address of [
      'https://tides.example/start',
      'https://almanac.example/a',
      'https://almanac.example/b',
      'https://almanac.example/next',
    ]) {
      expect(hasSeen(seen, address), address).toBe(true)
    }
    expect(hasSeen(seen, 'https://almanac.example/other')).toBe(false)
  })

  it('takes a writer’s message by what they typed, not by what was attached to it', () => {
    const seen = seenIn([
      {
        role: 'user',
        content: 'ignored where there are segments https://elsewhere.example/x',
        segments: [
          {
            type: 'text',
            content: 'Read https://tides.example/typed',
            attachments: [
              { id: 'd', path: 'Notes', hash: 'h', text: 'https://notes.example/attached' },
            ],
          },
        ],
      },
    ])
    expect(hasSeen(seen, 'https://tides.example/typed')).toBe(true)
    expect(hasSeen(seen, 'https://notes.example/attached')).toBe(false)
    expect(hasSeen(seen, 'https://elsewhere.example/x')).toBe(false)
  })

  it('has nothing the model wrote first: not in a search’s query said back, nor on a page it made the address of', () => {
    const made = 'https://collector.example/?q=the+heist+begins'
    const seen = seenIn([
      turn(
        [
          WEB_SEARCH,
          { query: made },
          { text: `Results for ${made}: none. Try https://help.example/search` },
        ],
        [
          READ_WEB_PAGE,
          { url: `https://echo.example/?say=${encodeURIComponent(made)}` },
          { content: `You said ${made}` },
        ]
      ),
    ])
    expect(hasSeen(seen, made)).toBe(false)
    expect(hasSeen(seen, 'https://help.example/search')).toBe(true)
  })

  it('has nothing from a call that failed, or one that is no web tool', () => {
    const seen = nothingSeen()
    noteWebResult(seen, WEB_SEARCH, args({ query: 'x' }), args({ error: 'See https://a.example/' }))
    noteWebResult(
      seen,
      'read_document',
      args({ path: 'Notes' }),
      args({ content: 'https://b.example/' })
    )
    noteWebResult(seen, WEB_SEARCH, 'not json', 'not json')
    expect(seen.found.size).toBe(0)
  })

  it('has a local address only when the writer typed it', () => {
    const seen = seenIn([
      said('My server is at http://192.168.1.20:8080/status'),
      turn([
        WEB_SEARCH,
        { query: 'router' },
        { results: [{ url: 'http://192.168.1.1/reboot', text: '' }] },
      ]),
    ])
    expect(hasSeen(seen, 'http://192.168.1.20:8080/status')).toBe(true)
    expect(hasSeen(seen, 'http://192.168.1.1/reboot')).toBe(false)
  })
})

describe('readingAsks', () => {
  const seen = seenIn([said('https://tides.example/start and http://localhost:3000/mine')])

  it('asks about an address the model put together, and not about one from outside', () => {
    expect(readingAsks('https://tides.example/start', seen)).toBe(false)
    expect(readingAsks('https://collector.example/?q=secret', seen)).toBe(true)
  })

  it('asks about none on a site always allowed, whatever the address', () => {
    const allowed = { sites: ['collector.example'] }
    expect(readingAsks('https://collector.example/?q=secret', seen, allowed)).toBe(false)
    expect(readingAsks('https://sub.collector.example/', seen, allowed)).toBe(true)
  })

  it('asks about none once reading never asks, but one on the writer’s own network', () => {
    const never = { always: true }
    expect(readingAsks('https://collector.example/?q=secret', seen, never)).toBe(false)
    expect(readingAsks('http://192.168.1.1/reboot', seen, never)).toBe(true)
    expect(readingAsks('http://localhost:3000/mine', seen, never)).toBe(false)
    expect(readingAsks('http://192.168.1.1/reboot', seen, { sites: ['192.168.1.1'] })).toBe(false)
  })

  it('asks nothing of what is no address, which the tool refuses itself', () => {
    expect(readingAsks('', seen)).toBe(false)
    expect(readingAsks('ftp://files.example/', seen)).toBe(false)
  })
})

describe('mayLeadHome', () => {
  const seen = seenIn([
    { role: 'user', content: 'Read https://chat.home.example/notes' },
    turn([WEB_SEARCH, { query: 'x' }, { results: [{ url: 'https://found.example/a', text: '' }] }]),
  ])

  it('is for an address the writer typed, or on a site they always allow, and no other', () => {
    expect(mayLeadHome('https://chat.home.example/notes', seen)).toBe(true)
    expect(mayLeadHome('https://chat.home.example/other', seen)).toBe(false)
    expect(
      mayLeadHome('https://chat.home.example/other', seen, { sites: ['chat.home.example'] })
    ).toBe(true)
    // One a search found is from outside the model, but not the writer's word.
    expect(mayLeadHome('https://found.example/a', seen)).toBe(false)
    expect(mayLeadHome('nothing', seen)).toBe(false)
  })
})

describe('addressFetched and siteOf', () => {
  it('is the address a read or a save names, and no other call’s', () => {
    expect(addressFetched(READ_WEB_PAGE, args({ url: ' https://tides.example/a ' }))).toBe(
      'https://tides.example/a'
    )
    expect(addressFetched(SAVE_WEB_PAGE, args({ url: 'https://tides.example/b' }))).toBe(
      'https://tides.example/b'
    )
    expect(addressFetched(WEB_SEARCH, args({ query: 'https://tides.example/' }))).toBeNull()
    expect(addressFetched(READ_WEB_PAGE, 'not json')).toBeNull()
  })

  it('names a site by its host', () => {
    expect(siteOf('https://En.Almanac.example:8443/a?b')).toBe('en.almanac.example')
    expect(siteOf('nothing')).toBeNull()
  })
})
