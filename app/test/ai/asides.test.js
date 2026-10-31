import { describe, it, expect } from 'vitest'
import { intoConversation, isAside, lastAside, withoutAsides } from '@/ai/asides.js'

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

describe('lastAside', () => {
  it('finds the question of the aside the conversation ends in', () => {
    const asked = [said('m1', 'user'), said('m2', 'assistant'), aside('q1', 'user')]
    expect(lastAside(asked)).toBe(2)
    expect(lastAside([...asked, aside('a1', 'assistant')])).toBe(2)
  })

  it('is the length of a conversation that does not end in one', () => {
    const past = [
      said('m1', 'user'),
      aside('q1', 'user'),
      aside('a1', 'assistant'),
      said('m2', 'user'),
    ]
    expect(lastAside(past)).toBe(4)
    expect(lastAside([])).toBe(0)
  })

  it('takes an answer whose question has gone for no aside', () => {
    expect(lastAside([said('m1', 'user'), aside('a1', 'assistant')])).toBe(2)
  })
})

describe('intoConversation', () => {
  it('takes the mark off the message and every answer it has had', () => {
    const answer = {
      ...aside('a1', 'assistant'),
      content: 'Later.',
      metadata: { aside: true, model: 'two' },
      alternates: [
        { content: 'Now.', metadata: { aside: true, model: 'one' } },
        { content: 'Later.', metadata: { aside: true, model: 'two' } },
      ],
      alternate: 1,
    }

    const brought = intoConversation(answer)

    expect(isAside(brought)).toBe(false)
    expect(brought).toMatchObject({ id: 'a1', content: 'Later.', alternate: 1 })
    expect(brought.metadata).toEqual({ model: 'two' })
    expect(brought.alternates.map(one => one.metadata)).toEqual([
      { model: 'one' },
      { model: 'two' },
    ])
    expect(isAside(answer)).toBe(true)
  })

  it('leaves a message with no metadata as it was', () => {
    expect(intoConversation(said('m1', 'user'))).toEqual(said('m1', 'user'))
  })
})
