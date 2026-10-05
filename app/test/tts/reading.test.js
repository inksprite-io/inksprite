import { describe, it, expect } from 'vitest'
import { blocksOf } from '@/tts/script.js'
import { parseHints } from '@/tts/hints.js'
import { blockStatesOf, signatureOf, targetsOf, trackKeyOf, utterancesOf } from '@/tts/reading.js'

const narrator = { id: 'narrator', name: 'Narrator', voice: 'af_heart', speed: 1 }
const riley = { id: 'riley', name: 'Riley', voice: 'af_nicole', speed: 1.1 }
const voices = [narrator, riley]

const MARKDOWN = 'Riley looked up.\n\n"Hello," she said. "How are you?"\n\nNobody answered.'
const blocks = blocksOf(MARKDOWN)

/** What is asked for, as who says what. */
const shape = utterances => utterances.map(u => [u.index, u.voice.id, u.text])

describe('utterancesOf', () => {
  it('asks for each block, in its speaker’s voice or the default', () => {
    expect(shape(utterancesOf(blocks, [null, 'riley', null], voices, 'narrator', []))).toEqual([
      [0, 'narrator', 'Riley looked up.'],
      [1, 'riley', '"Hello," she said. "How are you?"'],
      [2, 'narrator', 'Nobody answered.'],
    ])
  })

  it('reads a speaker no longer among the voices as the default', () => {
    const utterances = utterancesOf(blocks, [null, 'gone', null], voices, 'narrator', [])
    expect(utterances[1].voice).toBe(narrator)
  })

  it('sends the words with the hints applied, and signs what it sends', () => {
    const hints = parseHints('Riley:Rye-lee')
    const [first] = utterancesOf(blocks, [null, null, null], voices, 'narrator', hints)
    expect(first.text).toBe('Rye-lee looked up.')
    expect(first.signature).toBe(signatureOf(narrator, 'Rye-lee looked up.'))
  })
})

describe('signatureOf', () => {
  it('changes with the words, the voice asked for, and the speed', () => {
    const base = signatureOf(narrator, 'Hello.')
    expect(signatureOf(narrator, 'Hello.')).toBe(base)
    expect(signatureOf(narrator, 'Hello!')).not.toBe(base)
    expect(signatureOf({ ...narrator, voice: 'af_sky' }, 'Hello.')).not.toBe(base)
    expect(signatureOf({ ...narrator, speed: 1.2 }, 'Hello.')).not.toBe(base)
  })

  it('does not change with what the writer calls the voice', () => {
    expect(signatureOf({ ...narrator, name: 'Reader', color: '#ef4444' }, 'Hello.')).toBe(
      signatureOf(narrator, 'Hello.')
    )
  })

  it('reads an absent speed as one', () => {
    const { speed: _speed, ...unset } = narrator
    expect(signatureOf(unset, 'Hello.')).toBe(signatureOf(narrator, 'Hello.'))
  })
})

describe('targetsOf', () => {
  const utterances = utterancesOf(blocks, [null, 'riley', null], voices, 'narrator', [])
  const none = () => false
  const all = () => true

  it('reads everything the first time', () => {
    expect(targetsOf(utterances, none)).toEqual(utterances)
  })

  it('reads only what has no audio', () => {
    const has = signature => signature !== utterances[2].signature
    expect(targetsOf(utterances, has)).toEqual([utterances[2]])
  })

  it('reads all of it again when nothing lacks audio', () => {
    expect(targetsOf(utterances, all)).toEqual(utterances)
  })

  it('reads the blocks asked for, read or not, in document order', () => {
    expect(targetsOf(utterances, all, [2, 0])).toEqual([utterances[0], utterances[2]])
    expect(targetsOf(utterances, none, [1])).toEqual([utterances[1]])
    expect(targetsOf(utterances, all, [])).toEqual(utterances)
  })
})

describe('trackKeyOf', () => {
  const utterances = utterancesOf(blocks, [null, 'riley', null], voices, 'narrator', [])

  it('is the same for the same utterances in the same places', () => {
    expect(trackKeyOf(utterances)).toBe(trackKeyOf([...utterances]))
  })

  it('changes when one is left out, reworded, or moved', () => {
    const key = trackKeyOf(utterances)
    expect(trackKeyOf(utterances.slice(1))).not.toBe(key)

    const moved = utterancesOf(
      blocksOf(`A new opening.\n\n${MARKDOWN}`),
      [null, null, 'riley', null],
      voices,
      'narrator',
      []
    ).slice(1)
    expect(moved.map(u => u.signature)).toEqual(utterances.map(u => u.signature))
    expect(trackKeyOf(moved)).not.toBe(key)
  })
})

describe('blockStatesOf', () => {
  const utterances = utterancesOf(blocks, [null, 'riley', null], voices, 'narrator', [])

  it('has read nothing of a document never read', () => {
    expect(blockStatesOf(utterances, null)).toEqual(['missing', 'missing', 'missing'])
  })

  it('says where each block stands', () => {
    const reading = {
      clips: new Set([utterances[1].signature]),
      current: utterances[2].signature,
      failed: utterances[0].signature,
    }
    expect(blockStatesOf(utterances, reading)).toEqual(['failed', 'ready', 'running'])
  })

  it('shows a block being read again as being read', () => {
    const reading = {
      clips: new Set(utterances.map(u => u.signature)),
      current: utterances[1].signature,
      failed: null,
    }
    expect(blockStatesOf(utterances, reading)).toEqual(['ready', 'running', 'ready'])
  })
})
