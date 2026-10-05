import { describe, it, expect } from 'vitest'
import { compactedRuns, groupTurns, textLines } from '@/utils/turns.js'

const said = (id, role) => ({ id, role, content: id })

describe('groupTurns', () => {
  it('folds a run from one side into a single turn', () => {
    // What the writer makes by rolling an oracle, saying a sentence, and giving
    // a direction after it: three messages, one turn.
    const turns = groupTurns([
      said('m1', 'user'),
      said('m2', 'user'),
      said('m3', 'user'),
      said('m4', 'assistant'),
    ])

    expect(turns.map(turn => turn.messages.length)).toEqual([3, 1])
    expect(turns[0]).toMatchObject({ id: 'm1', role: 'user' })
  })

  it('folds pushed turns on the assistant side too', () => {
    // The same fold the request gets. A scene opened a paragraph at a time is
    // still one turn when it reaches the model, and should read as one here.
    const turns = groupTurns([said('m1', 'assistant'), said('m2', 'assistant'), said('m3', 'user')])

    expect(turns.map(turn => turn.role)).toEqual(['assistant', 'user'])
  })

  it('keeps alternating turns apart', () => {
    const turns = groupTurns([said('m1', 'user'), said('m2', 'assistant'), said('m3', 'user')])

    expect(turns).toHaveLength(3)
  })

  it('gives a consultation a turn of its own, beside the narration', () => {
    // It sits in the assistant's slot but it is not the Game Master, and one
    // name over both would say an interpretation was the next scene.
    const asked = { id: 'm2', role: 'assistant', metadata: { command: { name: 'interpret' } } }
    const turns = groupTurns([said('m1', 'assistant'), asked, said('m3', 'assistant')])

    expect(turns.map(turn => turn.command)).toEqual([undefined, 'interpret', undefined])
    expect(turns).toHaveLength(3)
  })

  it('keeps two of the same consultation together', () => {
    const asked = name => ({ id: name, role: 'assistant', metadata: { command: { name } } })
    const turns = groupTurns([asked('interpret'), asked('interpret')])

    expect(turns).toHaveLength(1)
  })

  it("leaves the writer's own commands in the turn they were run in", () => {
    // An oracle belongs beside the sentence it settles, which is the whole
    // point of judging a submission line by line.
    const rolled = { id: 'm2', role: 'user', metadata: { command: { name: 'oracle' } } }
    const turns = groupTurns([said('m1', 'user'), rolled, said('m3', 'user')])

    expect(turns).toHaveLength(1)
    expect(turns[0].command).toBeUndefined()
  })

  it('never lets a turn span the edge of what a summary stands for', () => {
    // Half a turn replaced by a summary is not a thing the conversation can be
    // in, and the line has to fall somewhere the reader can see it.
    const turns = groupTurns(
      [said('m1', 'user'), said('m2', 'user'), said('m3', 'user'), said('m4', 'user')],
      new Set([1, 2])
    )

    // One speaker throughout, and still three turns: the opening a summary
    // kept is not folded into what came after it, nor that into what follows.
    expect(turns.map(turn => turn.messages.map(m => m.id))).toEqual([['m1'], ['m2', 'm3'], ['m4']])
    expect(turns.map(turn => turn.compacted)).toEqual([false, true, false])
  })

  it('leaves everything uncompacted when nothing is', () => {
    const turns = groupTurns([said('m1', 'user'), said('m2', 'assistant')])

    expect(turns.every(turn => turn.compacted === false)).toBe(true)
  })

  it('finds nothing in nothing', () => {
    expect(groupTurns([])).toEqual([])
    expect(groupTurns(null)).toEqual([])
  })
})

describe('compactedRuns', () => {
  const said = (id, role) => ({ id, role, content: id })
  const five = [
    said('m1', 'assistant'),
    said('m2', 'user'),
    said('m3', 'assistant'),
    said('m4', 'user'),
    said('m5', 'assistant'),
  ]

  it('draws a line under the run a summary stands for, saying how long it was', () => {
    const runs = compactedRuns(groupTurns(five, new Set([1, 2])))

    // Above the fourth turn, which is where the summary would be: two messages.
    expect([...runs]).toEqual([[3, 2]])
  })

  it('counts an older summary in the run the newest one stands for', () => {
    const older = {
      id: 's1',
      role: 'assistant',
      content: 'They set out.',
      metadata: { command: { name: 'compact', input: '', keep: 2, result: 'They set out.' } },
    }
    const turns = groupTurns([five[0], five[1], older, five[3], five[4]], new Set([1, 2, 3]))

    // One line, above the fifth message: the newest summary would be there, and
    // the older one is among what it stands for, not a line of its own.
    expect([...compactedRuns(turns)]).toEqual([[4, 3]])
  })

  it('draws none when nothing was replaced', () => {
    expect(compactedRuns(groupTurns(five)).size).toBe(0)
    expect(compactedRuns([]).size).toBe(0)
  })
})

describe('textLines', () => {
  it('wraps each line at the width', () => {
    expect(textLines('x'.repeat(10), 10)).toBe(1)
    expect(textLines('x'.repeat(11), 10)).toBe(2)
    expect(textLines(`${'x'.repeat(25)}\nshort`, 10)).toBe(4)
  })

  it('counts a line for each break between paragraphs', () => {
    expect(textLines('one\n\ntwo\n\nthree', 80)).toBe(5)
  })

  it('counts nothing for blank lines themselves, or for no text', () => {
    expect(textLines('one\n   \n\n\ntwo', 80)).toBe(3)
    expect(textLines('', 80)).toBe(0)
  })
})
