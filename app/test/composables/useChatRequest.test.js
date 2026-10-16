import { describe, it, expect } from 'vitest'
import { useChatRequest } from '@/composables/useChatRequest.js'

describe('useChatRequest', () => {
  it('hands the chat over once, and only in its own project', () => {
    const request = useChatRequest()
    request.show('story_new', 'chat_1')

    expect(request.take('story_old')).toBeNull()
    expect(useChatRequest().requested.value).toEqual({ storyId: 'story_new', chatId: 'chat_1' })
    expect(request.take('story_new')).toBe('chat_1')
    expect(request.take('story_new')).toBeNull()
  })
})
