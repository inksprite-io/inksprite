import { describe, it, expect } from 'vitest'
import { namesOf, storedPassage, substitute } from '@/cards/macros.js'

describe('cards/macros', () => {
  const names = { char: 'Elara', user: 'Riley' }

  describe('namesOf', () => {
    it("takes the chat's two names", () => {
      expect(namesOf({ userName: 'Riley', characterName: 'Elara' })).toEqual(names)
    })

    it('has none for a chat that reads the macros as written', () => {
      expect(namesOf({})).toBeNull()
      expect(namesOf({ userName: '  ' })).toBeNull()
      expect(namesOf(null)).toBeNull()
    })

    it('takes one without the other', () => {
      expect(namesOf({ characterName: 'Elara' })).toEqual({ char: 'Elara', user: '' })
    })
  })

  describe('substitute', () => {
    it('puts both names in', () => {
      expect(substitute('{{char}} looks at {{user}}.', names)).toBe('Elara looks at Riley.')
    })

    it('accepts the spacing and casing authors actually write', () => {
      expect(substitute('{{ char }} and {{USER}} and {{Char}}', names)).toBe(
        'Elara and Riley and Elara'
      )
    })

    it('leaves every other macro for the model to read', () => {
      // A date frozen when the chat started is wrong by tomorrow, and a coin
      // flip fixed then always comes up the same.
      const text = '{{original}} {{date}} {{random::heads::tails}} {{roll:d20}} {{persona}}'
      expect(substitute(text, names)).toBe(text)
    })

    it('leaves a macro it has no name for', () => {
      expect(substitute('{{char}} and {{user}}', { char: 'Elara', user: '' })).toBe(
        'Elara and {{user}}'
      )
    })

    it('fills nothing in without names', () => {
      expect(substitute('{{char}}', null)).toBe('{{char}}')
    })

    it('puts a name with a dollar sign in as written', () => {
      expect(substitute('Hello, {{user}}.', { char: '', user: "$&$'" })).toBe("Hello, $&$'.")
    })

    it('has nothing to do with an empty string', () => {
      expect(substitute('', names)).toBe('')
      expect(substitute(undefined, names)).toBe('')
    })
  })

  describe('storedPassage', () => {
    const text = '{{char}} draws her sword. {{user}} steps back.'

    it('finds a quote of the filled text where the document has macros', () => {
      expect(storedPassage(text, names, 'Elara draws her sword.', 'Elara sheathes it.')).toEqual({
        count: 1,
        old: '{{char}} draws her sword.',
        new: 'Elara sheathes it.',
      })
    })

    it('leaves a quote with no name in it as it is', () => {
      expect(storedPassage(text, names, 'her sword', 'her bow')).toEqual({
        count: 1,
        old: 'her sword',
        new: 'her bow',
      })
    })

    it('finds a passage after a macro, where the offsets have moved', () => {
      expect(storedPassage(text, names, 'steps back.', 'holds.')).toMatchObject({
        old: 'steps back.',
      })
      expect(storedPassage(text, names, 'Riley steps', 'Riley leaps')).toMatchObject({
        old: '{{user}} steps',
        new: 'Riley leaps',
      })
    })

    it('takes the whole macro where a quote starts or ends inside a name', () => {
      expect(storedPassage(text, names, 'lara draws', 'lara lowers')).toEqual({
        count: 1,
        old: '{{char}} draws',
        new: 'Elara lowers',
      })
      expect(storedPassage(text, names, 'sword. Ril', 'sword! Ril')).toEqual({
        count: 1,
        old: 'sword. {{user}}',
        new: 'sword! Riley',
      })
    })

    it('counts as the model sees it, however the document spells the two', () => {
      const mixed = 'Elara waits. {{char}} waits.'
      expect(storedPassage(mixed, names, 'Elara waits.', 'Elara leaves.')).toMatchObject({
        count: 2,
      })
    })

    it('says when the quote is not there', () => {
      expect(storedPassage(text, names, 'Sam steps back.', 'x')).toMatchObject({ count: 0 })
    })

    it('reads macros of any spelling', () => {
      expect(
        storedPassage('{{ Char }} nods.', names, 'Elara nods.', 'Elara shrugs.')
      ).toMatchObject({ old: '{{ Char }} nods.' })
    })
  })
})
