import { describe, it, expect } from 'vitest'
import { parseBid, arbitrate, speakerMessages } from '../../harness/scene.js'

/** @type {any} */
const noah = {
  id: 'noah',
  name: 'Noah',
  sketch: 'He waits.',
  objective: 'Finish.',
  belief: 'She will sit down.',
}
/** @type {any} */
const riley = {
  id: 'riley',
  name: 'Riley',
  sketch: 'She closes distance.',
  objective: 'Stop him.',
  belief: 'He is avoiding it.',
}

describe('parseBid', () => {
  it('reads a plain refusal to speak', () => {
    expect(parseBid('PASS', noah)).toEqual({ pass: true })
  })

  // Each of these was produced by a real model and each one, before the
  // unwrapping, was committed as a line of dialogue reading PASS.
  it.each(['"PASS"', '**PASS**', 'PASS.', 'NOAH: PASS', 'Pass', ' pass '])(
    'reads %s as a refusal rather than a line',
    raw => {
      expect(parseBid(raw, noah)).toEqual({ pass: true })
    }
  )

  it('keeps a line that merely begins with the word pass', () => {
    expect(parseBid('I pass the salt.', noah)).toEqual({
      pass: false,
      line: 'I pass the salt.',
    })
  })

  it('strips the name the model puts back on the front', () => {
    expect(parseBid('NOAH: I missed a comma.', noah).line).toBe('I missed a comma.')
  })

  it('lifts a parenthetical into an action, however it was formatted', () => {
    expect(parseBid('(action: taps the pen)\nI missed a comma.', noah)).toEqual({
      pass: false,
      line: 'I missed a comma.',
      action: 'taps the pen',
    })
    expect(parseBid('I missed a comma.\n(taps the pen)', noah)).toEqual({
      pass: false,
      line: 'I missed a comma.',
      action: 'taps the pen',
    })
  })

  it('treats a beat with no words as a bid, not as nothing', () => {
    expect(parseBid('(goes quiet)', noah)).toEqual({
      pass: false,
      line: '',
      action: 'goes quiet',
    })
  })

  it('unwraps a line the model quoted to itself', () => {
    expect(parseBid('"I missed a comma."', noah).line).toBe('I missed a comma.')
  })

  it('leaves quotes that are part of the line alone', () => {
    const line = 'She said "fine" and left.'
    expect(parseBid(line, noah).line).toBe(line)
  })
})

describe('arbitrate', () => {
  const bid = (/** @type {string} */ speaker) =>
    /** @type {any} */ ({ speaker, pass: false, line: 'x', ms: 1, tokens: 1 })

  it('gives the beat to whoever did not speak last', () => {
    /** @type {any} */
    const state = { turns: [{ speaker: 'riley' }], speakers: { noah, riley } }
    expect(arbitrate([bid('riley'), bid('noah')], state).speaker).toBe('noah')
  })

  it('commits the only live bid', () => {
    /** @type {any} */
    const state = { turns: [{ speaker: 'noah' }], speakers: { noah, riley } }
    expect(arbitrate([bid('noah')], state).speaker).toBe('noah')
  })
})

describe('speakerMessages', () => {
  /** @type {any} */
  const state = {
    turns: [{ speaker: 'riley', line: 'You have read that twice.' }],
    speakers: { noah, riley },
    props: ['the red pen'],
    setting: 'A hot room.',
  }

  it('never puts the other speaker up for inspection', () => {
    const sent = speakerMessages(noah, state)
      .map(message => message.content)
      .join('\n')
    expect(sent).toContain(noah.objective)
    expect(sent).not.toContain(riley.objective)
    expect(sent).not.toContain(riley.belief)
    expect(sent).not.toContain(riley.sketch)
  })

  it('puts the transcript last, closest to generation', () => {
    const user = speakerMessages(noah, state)[1].content
    expect(user.trimEnd().endsWith('NOAH:')).toBe(true)
    expect(user).toContain('RILEY: You have read that twice.')
  })

  it('shows a silence as something that happened', () => {
    /** @type {any} */
    const withSilence = {
      ...state,
      turns: [...state.turns, { speaker: 'noah', line: '', silence: true, action: 'goes quiet' }],
    }
    expect(speakerMessages(riley, withSilence)[1].content).toContain('(NOAH goes quiet.)')
  })
})
