import { describe, it, expect } from 'vitest'
import { isAside, withoutAsides } from '@/ai/asides.js'

/** A message of the conversation. */
const said = (id, role) => ({ id, role })
/** A message said on the side: a question of the writer's, or the answer to one. */
const aside = (id, role) => ({ id, role, metadata: { aside: true } })

const ids = messages => messages.map(message => message.id)

describe('isAside', () => {
  it('reads it off the message', () => {
    expect(isAside(aside('q', 'user'))).toBe(true)
    expect(isAside(aside('a', 'assistant'))).toBe(true)
    expect(isAside(said('m', 'user'))).toBe(false)
    expect(isAside(null)).toBe(false)
  })
})

describe('withoutAsides', () => {
  const chat = [
    said('m1', 'user'),
    said('m2', 'assistant'),
    aside('q1', 'user'),
    aside('a1', 'assistant'),
    said('m3', 'user'),
  ]

  it('leaves out a question asked on the side and its answer', () => {
    expect(ids(withoutAsides(chat))).toEqual(['m1', 'm2', 'm3'])
    expect(ids(withoutAsides(chat, { answering: true }))).toEqual(['m1', 'm2', 'm3'])
  })

  it('hands back the same conversation when there is nothing to leave out', () => {
    const plain = [said('m1', 'user'), said('m2', 'assistant')]
    expect(withoutAsides(plain)).toBe(plain)
  })

  it('keeps the question being answered, and its answer as far as it has got', () => {
    const asking = [...chat, said('m4', 'assistant'), aside('q2', 'user')]
    expect(ids(withoutAsides(asking, { answering: true }))).toEqual(['m1', 'm2', 'm3', 'm4', 'q2'])

    const answering = [...asking, aside('a2', 'assistant')]
    expect(ids(withoutAsides(answering, { answering: true }))).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
      'q2',
      'a2',
    ])
  })

  it('shows an aside none of the asides before it', () => {
    const again = [said('m1', 'user'), aside('q1', 'user'), aside('a1', 'assistant')]
    const asking = [...again, aside('q2', 'user')]
    expect(ids(withoutAsides(asking, { answering: true }))).toEqual(['m1', 'q2'])
  })

  it('keeps none for a reader that is not answering one', () => {
    const asking = [said('m1', 'user'), said('m2', 'assistant'), aside('q1', 'user')]
    expect(ids(withoutAsides(asking))).toEqual(['m1', 'm2'])
  })
})
