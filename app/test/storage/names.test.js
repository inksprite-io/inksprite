/* global TextEncoder */
import { describe, it, expect } from 'vitest'
import {
  safeName,
  nameKey,
  splitExtension,
  claimName,
  prefixWidth,
  withPrefix,
  readPrefix,
  stemFits,
} from '@/storage/names.js'

describe('a name from a title', () => {
  it('turns what no system takes into hyphens', () => {
    expect(safeName('Act 1: The Door / Part 2?')).toBe('Act 1- The Door - Part 2-')
    expect(safeName('tab\there')).toBe('tab here')
  })

  it('never hides the file, nor ends it as Windows would not', () => {
    expect(safeName('.hidden')).toBe('hidden')
    expect(safeName('trailing. ')).toBe('trailing')
  })

  it('steers clear of the names Windows keeps for devices', () => {
    expect(safeName('CON')).toBe('CON_')
    expect(safeName('aux.c')).toBe('aux_.c')
    expect(safeName('console')).toBe('console')
  })

  it('calls nothing Untitled', () => {
    expect(safeName('')).toBe('Untitled')
    expect(safeName(' ... ')).toBe('Untitled')
  })

  it('cuts a long title on a character’s edge', () => {
    const name = safeName('é'.repeat(200))
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(180)
    expect(name).toBe('é'.repeat(90))
  })

  it('makes the same name from a name it made', () => {
    for (const title of ['A: b', '.x', 'CON', 'é'.repeat(200), 'ok']) {
      expect(safeName(safeName(title))).toBe(safeName(title))
    }
  })
})

describe('names in a folder', () => {
  it('are told apart as a disk that ignores case would', () => {
    expect(nameKey('Café')).toBe(nameKey('CAFÉ'))
  })

  it('take (2) and on when one is in use, before the extension', () => {
    const taken = new Set()
    expect(claimName(taken, 'Map', '.png')).toBe('Map.png')
    expect(claimName(taken, 'map', '.png')).toBe('map (2).png')
    expect(claimName(taken, 'Map', '.png')).toBe('Map (3).png')
  })

  it('split at the extension, a leading dot being none', () => {
    expect(splitExtension('Map.v2.png')).toEqual({ stem: 'Map.v2', extension: '.png' })
    expect(splitExtension('.env')).toEqual({ stem: '.env', extension: '' })
    expect(splitExtension('Notes')).toEqual({ stem: 'Notes', extension: '' })
  })

  it('carry their place in an ordered folder, and give it back', () => {
    expect(prefixWidth(9)).toBe(2)
    expect(prefixWidth(100)).toBe(3)
    expect(withPrefix(3, 2, 'Chapter 3')).toBe('03 - Chapter 3')
    expect(readPrefix('03 - Chapter 3')).toEqual({ place: 3, rest: 'Chapter 3' })
    expect(readPrefix('Chapter 3')).toEqual({ place: null, rest: 'Chapter 3' })
  })

  it('fit their title, or say the file was renamed elsewhere', () => {
    expect(stemFits('Act 1: Door', 'Act 1- Door')).toBe(true)
    expect(stemFits('Elara', 'Elara (2)')).toBe(true)
    expect(stemFits('Elara', 'Elara Voss')).toBe(false)
    expect(stemFits('Elara', 'Elara (two)')).toBe(false)
  })
})
