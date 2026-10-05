import { describe, it, expect, afterEach } from 'vitest'
import { consultationsIn, isConsultation } from '@/ai/skills/consultations.js'
import { setLibrarySkills } from '@/ai/skills/index.js'

const call = (id, name, args = '{}') => ({
  id,
  type: 'function',
  function: { name, arguments: args },
})

describe('isConsultation', () => {
  afterEach(() => setLibrarySkills([]))

  it('goes by the record a skill’s result keeps', () => {
    expect(
      isConsultation('scene', { role: 'tool', content: '{}', _consultation: { calls: [] } })
    ).toBe(true)
    expect(isConsultation('oracle', { role: 'tool', content: '{}' })).toBe(false)
  })

  it('counts a built-in from a turn before results kept a record', () => {
    expect(isConsultation('director', { role: 'tool', content: '{}' })).toBe(true)
  })

  it('does not take a lookup for a skill of the writer’s that shares its name', () => {
    setLibrarySkills([{ id: 'sk_1', text: '---\nname: oracle\ndescription: A.\n---\nBody.' }])

    expect(isConsultation('oracle', { role: 'tool', content: '{"answer":"Yes"}' })).toBe(false)
  })
})

describe('consultationsIn', () => {
  it('shows each skill once, answered, and drops the copy still in flight', () => {
    const views = consultationsIn(
      [
        { role: 'assistant', content: null, tool_calls: [call('call_d', 'director')] },
        {
          role: 'tool',
          tool_call_id: 'call_d',
          content: '{"error":"The Director had nothing to say."}',
          _consultation: { calls: [] },
        },
      ],
      [{ id: 'call_d', name: 'director', arguments: '{}' }]
    )

    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({
      label: 'Director',
      pending: false,
      answer: '',
      error: 'The Director had nothing to say.',
    })
  })

  it('is empty for a turn that called no skill', () => {
    expect(consultationsIn(undefined, undefined)).toEqual([])
  })
})
