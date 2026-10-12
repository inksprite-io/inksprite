import { describe, it, expect } from 'vitest'
import { blocksOf } from '@/tts/script.js'
import { parseHints } from '@/tts/hints.js'
import { parseFilters } from '@/tts/filters.js'
import {
  blockStatesOf,
  sampleOf,
  signatureOf,
  audioKeyOf,
  targetsOf,
  trackKeyOf,
  utterancesOf,
} from '@/tts/reading.js'

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

  it('sends the words the filters leave, and skips a block they take all of', () => {
    const cited = blocksOf('Riley looked up [1].\n\nPage 12\n\nNobody answered.')
    const filters = parseFilters('\\s*\\[\\d+\\]\n^Page \\d+$')
    const hints = parseHints('Riley:Rye-lee')
    const utterances = utterancesOf(cited, [null, null, null], voices, 'narrator', hints, filters)
    expect(utterances.map(u => [u.index, u.text, !!u.skipped])).toEqual([
      [0, 'Rye-lee looked up.', false],
      [1, '', true],
      [2, 'Nobody answered.', false],
    ])
    expect(utterances[0].signature).toBe(signatureOf(narrator, 'Rye-lee looked up.'))
    // A block the filters do not touch keeps its signature, and its audio.
    expect(utterances[2].signature).toBe(
      utterancesOf(cited, [null, null, null], voices, 'narrator', hints)[2].signature
    )
  })
})

describe('audioKeyOf', () => {
  it('is the same for the same signature, and a name any disk takes', async () => {
    const key = await audioKeyOf(signatureOf(narrator, 'Hello.'))
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(await audioKeyOf(signatureOf(narrator, 'Hello.'))).toBe(key)
    expect(await audioKeyOf(signatureOf(narrator, 'Hello!'))).not.toBe(key)
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

  it('changes with the connection and model it is asked of', () => {
    const kokoro = signatureOf(narrator, 'Hello.', 'provider_kokoro_default\nkokoro')
    expect(signatureOf(narrator, 'Hello.', 'provider_kokoro_default\nkokoro')).toBe(kokoro)
    expect(
      signatureOf(narrator, 'Hello.', 'provider_openrouter_default\nhexgrad/kokoro-82m')
    ).not.toBe(kokoro)
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

  it('reads nothing when nothing lacks audio', () => {
    expect(targetsOf(utterances, all)).toEqual([])
  })

  it('reads the blocks asked for, read or not, in document order', () => {
    expect(targetsOf(utterances, all, [2, 0])).toEqual([utterances[0], utterances[2]])
    expect(targetsOf(utterances, none, [1])).toEqual([utterances[1]])
    expect(targetsOf(utterances, none, [])).toEqual(utterances)
  })

  it('never reads a skipped block, asked for or not', () => {
    const skipping = utterancesOf(blocks, [], voices, 'narrator', [], parseFilters('^Nobody.*'))
    expect(targetsOf(skipping, none).map(u => u.index)).toEqual([0, 1])
    expect(targetsOf(skipping, all, [1, 2]).map(u => u.index)).toEqual([1])
  })
})

describe('sampleOf', () => {
  const read = markdown =>
    utterancesOf(blocksOf(markdown), [], voices, 'narrator', [], parseFilters('^Page \\d+$'))
  const opening = read('Short.\n\nA little longer than that.\n\nThe rest of it.')

  it('takes the opening blocks until they say enough', () => {
    expect(sampleOf(opening, 10)).toEqual([0, 1])
    expect(sampleOf(opening, 500)).toEqual([0, 1, 2])
  })

  it('takes at least one block, and none of no document', () => {
    expect(sampleOf(opening, 0)).toEqual([0])
    expect(sampleOf([], 10)).toEqual([])
  })

  it('passes over what is skipped', () => {
    expect(sampleOf(read('Page 1\n\nShort.\n\nPage 2\n\nThe rest of it.'), 10)).toEqual([1, 3])
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

  it('says a block is skipped, whatever else is going on', () => {
    const skipping = utterancesOf(blocks, [], voices, 'narrator', [], parseFilters('^Nobody.*'))
    const reading = { clips: new Set(), current: null, failed: null }
    expect(blockStatesOf(skipping, reading)).toEqual(['missing', 'missing', 'skipped'])
    expect(blockStatesOf(skipping, null)).toEqual(['missing', 'missing', 'skipped'])
  })
})
