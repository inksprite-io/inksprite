import { describe, it, expect } from 'vitest'
import { canSave, savedContent, savedTitle, wholeRead } from '@/mcp/saved.js'

describe('canSave', () => {
  it('keeps an answer, and not a failure or nothing', () => {
    expect(canSave('ENG-123: Auth rework')).toBe(true)
    expect(canSave('[{"id":1}]')).toBe(true)
    expect(canSave('{"error":"It needs you to sign in."}')).toBe(false)
    expect(canSave('   ')).toBe(false)
    expect(canSave(null)).toBe(false)
  })
})

describe('savedTitle', () => {
  it('takes the first heading or line, cut short', () => {
    expect(savedTitle('# Auth rework\n\nThe plan.', 'Linear get_issue')).toBe('Auth rework')
    expect(savedTitle('\n\nENG-123: Auth rework\nStatus: open', 'x')).toBe('ENG-123: Auth rework')
    // Too long for a title: the name before its colon, or its words up to
    // the length, cut between words.
    expect(
      savedTitle('kenning: A compound that names a thing by what it does or resembles.', 'x')
    ).toBe('kenning')
    const cut = savedTitle(`${'word '.repeat(30)}`, 'x')
    expect(cut.length).toBeLessThanOrEqual(60)
    expect(cut.endsWith('word')).toBe(true)
  })

  it('falls back to the tool for JSON, which has no line worth naming it by', () => {
    expect(savedTitle('{"id":"ENG-123"}', 'Linear get_issue')).toBe('Linear get_issue')
  })
})

describe('savedContent', () => {
  const date = new Date('2026-10-03T12:00:00Z')

  it('says where it came from and when, then the answer as it read', () => {
    expect(
      savedContent({
        result: 'ENG-123: Auth rework\n\nMove sessions to tokens.',
        server: 'Linear',
        tool: 'get_issue',
        args: { id: 'ENG-123' },
        date,
      })
    ).toBe(
      '*From Linear: get_issue (id: "ENG-123"), saved 3 October 2026.*\n\nENG-123: Auth rework\n\nMove sessions to tokens.\n'
    )
  })

  it('keeps JSON as a block of JSON', () => {
    const content = savedContent({
      result: '{"id":"ENG-123"}',
      server: 'Linear',
      tool: 'get_issue',
      args: {},
      date,
    })

    expect(content).toContain('*From Linear: get_issue, saved 3 October 2026.*')
    expect(content).toContain('```json\n{\n  "id": "ENG-123"\n}\n```')
  })
})

describe('a web page the model read', () => {
  const page = (extra = {}) =>
    JSON.stringify({
      url: 'https://example.org/harbour',
      title: 'Harbour notes',
      from: 0,
      to: 16,
      length: 16,
      next: null,
      content: 'The mole is old.',
      ...extra,
    })

  it('is titled by the page, or by its site when it has no title', () => {
    expect(savedTitle(page(), 'Web read_web_page')).toBe('Harbour notes')
    expect(savedTitle(page({ title: undefined }), 'Web read_web_page')).toBe('example.org')
  })

  it('is saved as its text, under a line giving its address', () => {
    const content = savedContent({
      result: page(),
      server: 'Web',
      tool: 'read_web_page',
      args: { url: 'https://example.org/harbour' },
      date: new Date(2026, 9, 10),
    })

    expect(content).toBe(
      '*From https://example.org/harbour, saved 10 October 2026.*\n\nThe mole is old.\n'
    )
  })

  it('says which part of a long page it is', () => {
    const content = savedContent({
      result: page({ from: 40000, to: 80000, length: 120000, content: 'Middle.' }),
      server: 'Web',
      tool: 'read_web_page',
      args: {},
      date: new Date(2026, 9, 10),
    })

    expect(content.split('\n')[0]).toBe(
      '*From https://example.org/harbour (characters 40,001–80,000 of 120,000), saved 10 October 2026.*'
    )
  })

  it('can be saved, as any answer that is not an error', () => {
    expect(canSave(page())).toBe(true)
  })

  it('is saved whole from a slice, given the whole page', () => {
    const slice = page({ from: 16, to: 32, length: 48, next: 32, content: 'The quay is new.' })
    const whole = 'The mole is old. The quay is new. The light is red.'
    const content = savedContent({
      result: wholeRead(slice, whole),
      server: 'Web',
      tool: 'read_web_page',
      args: {},
      date: new Date(2026, 9, 10),
    })

    expect(content).toBe(`*From https://example.org/harbour, saved 10 October 2026.*\n\n${whole}\n`)
    expect(savedTitle(wholeRead(slice, whole), 'Web read_web_page')).toBe('Harbour notes')
  })
})
