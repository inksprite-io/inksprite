import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isTranscript, readTranscript } from '@/cards/transcript.js'

/**
 * Chats as SillyTavern actually writes them.
 *
 * Kept out of the repository, like the cards they were played on, so this
 * skips where they are not. `app/harness/test-chats/`, and the names are not
 * fixed. What is asserted is what has to be true of any chat: it is
 * recognised, everyone in it said something, and it is in order.
 */
const DIR = 'harness/test-chats'
const files = existsSync(DIR) ? readdirSync(DIR).filter(name => /\.jsonl$/.test(name)) : []

describe.skipIf(files.length === 0)('the chats SillyTavern actually writes', () => {
  /** @param {string} name */
  const text = name => readFileSync(join(DIR, name), 'utf8')

  it.each(files)('knows what %s is', name => {
    expect(isTranscript(text(name))).toBe(true)
  })

  it.each(files)('reads %s into a conversation', name => {
    const read = readTranscript(text(name), name)

    expect(read.title).toBeTruthy()
    expect(read.title).not.toMatch(/@\d+h/)
    expect(read.character).toBeTruthy()
    expect(read.messages.length).toBeGreaterThan(0)
    expect(read.messages.every(message => message.content.trim())).toBe(true)
    expect(
      read.messages.every(
        (message, at) => at === 0 || message.created > read.messages[at - 1].created
      )
    ).toBe(true)
  })

  it.each(files)('leaves no macro unfilled in %s', name => {
    const { messages } = readTranscript(text(name), name)
    const everything = messages.flatMap(message => [
      message.content,
      ...(message.alternates || []).map(answer => answer.content),
    ])

    expect(everything.filter(content => /\{\{\s*(user|char)\s*\}\}/i.test(content))).toEqual([])
  })

  it.each(files)('shows the answer %s was showing', name => {
    const { messages } = readTranscript(text(name), name)

    for (const message of messages.filter(message => message.alternates)) {
      expect(message.alternates[message.alternate].content).toBe(message.content)
    }
  })
})
