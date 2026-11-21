import { describe, it, expect } from 'vitest'
import { namesOf, storedPassage, storedPlaces, substitute } from '@/cards/macros.js'

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

  describe('storedPlaces', () => {
    // As the chat reads it: "Elara waits. Elara waits by the gate. Riley waits."
    const text = '{{char}} waits. Elara waits by the gate. {{user}} waits.'
    const filled = substitute(text, names)
    /** The stored text with changes made in the order given. */
    const made = changes =>
      changes.reduce(
        (stored, change) => stored.slice(0, change.from) + change.new + stored.slice(change.to),
        text
      )
    /** The stored text with one place of the filled text changed. */
    const changed = (passage, nth, replacement) => {
      const at = filled
        .split(passage)
        .slice(0, nth + 1)
        .join(passage).length
      return made(storedPlaces(text, names, [at], passage.length, replacement))
    }
    /** And with every place changed. */
    const everyPlace = (passage, replacement) => {
      /** @type {number[]} */
      const places = []
      for (
        let at = filled.indexOf(passage);
        at !== -1;
        at = filled.indexOf(passage, at + passage.length)
      ) {
        places.push(at)
      }
      return made(storedPlaces(text, names, places, passage.length, replacement))
    }

    it('finds one place of several a passage is at, past the macros before it', () => {
      expect(changed('waits', 0, 'rests')).toBe(
        '{{char}} rests. Elara waits by the gate. {{user}} waits.'
      )
      expect(changed('waits', 1, 'rests')).toBe(
        '{{char}} waits. Elara rests by the gate. {{user}} waits.'
      )
      expect(changed('waits', 2, 'rests')).toBe(
        '{{char}} waits. Elara waits by the gate. {{user}} rests.'
      )
    })

    it('takes the macro at a place that is a name, and leaves the name written out alone', () => {
      expect(changed('Elara', 0, 'Mara')).toBe(
        'Mara waits. Elara waits by the gate. {{user}} waits.'
      )
      expect(changed('Elara', 1, 'Mara')).toBe(
        '{{char}} waits. Mara waits by the gate. {{user}} waits.'
      )
    })

    it('takes the whole macro where a place starts or ends inside a name', () => {
      expect(changed('lara waits', 0, 'lara rests')).toBe(
        'Elara rests. Elara waits by the gate. {{user}} waits.'
      )
    })

    it('gives every place the last first, each where it is once the ones after it are changed', () => {
      expect(everyPlace('waits', 'rests')).toBe(
        '{{char}} rests. Elara rests by the gate. {{user}} rests.'
      )
      expect(everyPlace('Elara', 'Mara')).toBe(
        'Mara waits. Mara waits by the gate. {{user}} waits.'
      )
    })

    it('finds a place in a name an earlier change wrote out where it reads', () => {
      // The last "a" of the first name writes the macro out; the one before
      // it is then in the name as written.
      expect(everyPlace('a', 'X')).toBe('ElXrX wXits. ElXrX wXits by the gXte. {{user}} wXits.')
    })
  })
})
