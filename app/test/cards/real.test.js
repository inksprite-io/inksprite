import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { cardFromPng } from '@/cards/png.js'
import { shapeOf, readCard, readLorebook } from '@/cards/card.js'

/**
 * Cards and books as they actually come off the sites people share them on.
 *
 * Kept out of the repository — someone else's work, several megabytes each —
 * so this skips where they are not. It is worth having anyway: the reader was
 * written against the spec and passing its own tests, and the first run over
 * real files found three things wrong with it, including every standalone
 * lorebook being read as a character.
 *
 * `app/harness/test-cards/`, and the names are not fixed. What is asserted is
 * what has to be true of any card: it is recognised, it is read without
 * throwing, and something came out.
 */
const DIR = 'harness/test-cards'
const files = existsSync(DIR) ? readdirSync(DIR).filter(name => /\.(png|json)$/.test(name)) : []

describe.skipIf(files.length === 0)('the cards people actually share', () => {
  /** @param {string} name */
  const parse = name => {
    const bytes = readFileSync(join(DIR, name))
    return name.endsWith('.png') ? cardFromPng(bytes) : JSON.parse(bytes.toString('utf8'))
  }

  it.each(files)('knows what %s is', name => {
    // Neither extension says which: a card and a book are both .json, and a
    // book can carry a description of its own that reads like a character's.
    expect(shapeOf(parse(name))).toMatch(/^(card|lorebook)$/)
  })

  it.each(files)('reads %s without losing what it is for', name => {
    const value = parse(name)

    if (shapeOf(value) === 'lorebook') {
      const book = readLorebook(value)
      expect(book.entries.length).toBeGreaterThan(0)
      expect(book.entries.every(entry => entry.content)).toBe(true)
      return
    }

    const card = readCard(value)
    expect(card.name).toBeTruthy()
    expect(card.title).toBeTruthy()
    // A card with no description and no greeting is a card with nothing in it.
    expect(card.description || card.greetings.length).toBeTruthy()
    expect(card.lore.every(entry => entry.content && entry.title)).toBe(true)
  })
})
