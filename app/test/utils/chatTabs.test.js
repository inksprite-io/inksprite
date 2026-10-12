import { describe, it, expect } from 'vitest'
import { CHAT_TEXT_TITLES, chatTabId, chatTabOf } from '@/utils/chatTabs.js'

describe('chatTabs', () => {
  it("reads back the chat and the text a chat's tab holds", () => {
    expect(chatTabOf(chatTabId('chat_a1', 'prompt'))).toEqual({ chatId: 'chat_a1', text: 'prompt' })
    expect(chatTabOf(chatTabId('chat_a1', 'note'))).toEqual({ chatId: 'chat_a1', text: 'note' })
  })

  it("takes a document's tab for none", () => {
    expect(chatTabOf('doc_V1StGXR8_Z5jdHi6B-myT')).toBeNull()
    expect(chatTabOf('chat:chat_a1:summary')).toBeNull()
    expect(chatTabOf('')).toBeNull()
    expect(chatTabOf(null)).toBeNull()
  })

  it('names each text', () => {
    expect(CHAT_TEXT_TITLES.prompt).toBe('System prompt')
    expect(CHAT_TEXT_TITLES.note).toBe("Author's note")
  })
})
