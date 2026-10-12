import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CHAT_TITLE,
  isDefaultChatTitle,
  chatPreview,
  plainTitle,
  shownChatTitle,
} from '@/utils/chatTitle.js'

describe('isDefaultChatTitle', () => {
  it('knows the default and the ones before it', () => {
    expect(isDefaultChatTitle(DEFAULT_CHAT_TITLE)).toBe(true)
    expect(isDefaultChatTitle('Untitled Chat')).toBe(true)
    expect(isDefaultChatTitle('New Chat')).toBe(true)
  })

  it('takes no title for the default', () => {
    expect(isDefaultChatTitle('')).toBe(true)
    expect(isDefaultChatTitle('  ')).toBe(true)
    expect(isDefaultChatTitle(null)).toBe(true)
    expect(isDefaultChatTitle(undefined)).toBe(true)
  })

  it('leaves a real name alone', () => {
    expect(isDefaultChatTitle('The Lighthouse')).toBe(false)
  })
})

describe('shownChatTitle', () => {
  it('shows every default as the one default', () => {
    expect(shownChatTitle('Untitled Chat')).toBe(DEFAULT_CHAT_TITLE)
    expect(shownChatTitle('')).toBe(DEFAULT_CHAT_TITLE)
    expect(shownChatTitle('The Lighthouse')).toBe('The Lighthouse')
  })
})

describe('plainTitle', () => {
  it('takes off a heading, quote or list marker', () => {
    expect(plainTitle('## Part 1')).toBe('Part 1')
    expect(plainTitle('> A Quiet Harbour')).toBe('A Quiet Harbour')
    expect(plainTitle('- Plot Ideas')).toBe('Plot Ideas')
    expect(plainTitle('1. Plot Ideas')).toBe('Plot Ideas')
  })

  it('takes off emphasis, code and links', () => {
    expect(plainTitle('**Not** a *Drill*')).toBe('Not a Drill')
    expect(plainTitle('__Bold__ and _slanted_ and ~~gone~~')).toBe('Bold and slanted and gone')
    expect(plainTitle('The `keeper` File')).toBe('The keeper File')
    expect(plainTitle('[The Map](https://example.com)')).toBe('The Map')
  })

  it('keeps underscores inside words', () => {
    expect(plainTitle('Fixing snake_case_names')).toBe('Fixing snake_case_names')
  })

  it('takes off a label and quotes', () => {
    expect(plainTitle('Title: Plot Ideas')).toBe('Plot Ideas')
    expect(plainTitle('"Plot Ideas"')).toBe('Plot Ideas')
    expect(plainTitle('“Plot Ideas”')).toBe('Plot Ideas')
  })

  it('leaves a plain title as it is', () => {
    expect(plainTitle('  Plot Ideas  ')).toBe('Plot Ideas')
    expect(plainTitle('')).toBe('')
  })
})

describe('chatPreview', () => {
  it('runs the lines together without their markdown', () => {
    expect(chatPreview('**Pick up** where we left off.\n\n## Notes\n- the *tide* table')).toBe(
      'Pick up where we left off. Notes the tide table'
    )
  })

  it('cuts a long message at a hundred characters', () => {
    const preview = chatPreview('word '.repeat(40))
    expect(preview).toHaveLength(101)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('leaves out any HTML', () => {
    expect(chatPreview('<b>Hello</b> there')).toBe('Hello there')
  })
})
