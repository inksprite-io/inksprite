import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  clearChatActivity,
  isWorking,
  onStoppedWorking,
  reportWorking,
} from '@/composables/useChatActivity.js'

describe('useChatActivity', () => {
  beforeEach(() => clearChatActivity())

  it('knows which chats the model is working in', () => {
    reportWorking('story_1', 'chat_1', true)
    expect(isWorking('chat_1')).toBe(true)
    expect(isWorking('chat_2')).toBe(false)
    reportWorking('story_1', 'chat_1', false)
    expect(isWorking('chat_1')).toBe(false)
  })

  it('tells its listeners when the model stops, and only then', () => {
    const stopped = vi.fn()
    const stop = onStoppedWorking(stopped)

    reportWorking('story_1', 'chat_1', false)
    expect(stopped).not.toHaveBeenCalled()

    reportWorking('story_1', 'chat_1', true)
    reportWorking('story_1', 'chat_1', false)
    expect(stopped).toHaveBeenCalledWith('story_1', 'chat_1')

    stop()
    reportWorking('story_1', 'chat_1', true)
    reportWorking('story_1', 'chat_1', false)
    expect(stopped).toHaveBeenCalledTimes(1)
  })
})
