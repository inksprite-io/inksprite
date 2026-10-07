import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import GoogleCallback from '@/components/oauth/GoogleCallback.vue'

/** What was handed to the window that asked. */
const relayed = []
vi.stubGlobal(
  'BroadcastChannel',
  class {
    postMessage(message) {
      relayed.push(message)
    }
    close() {}
  }
)

describe('GoogleCallback', () => {
  beforeEach(() => {
    relayed.length = 0
    vi.spyOn(window, 'close').mockImplementation(() => {})
    window.history.replaceState(
      {},
      '',
      '/connect/google#state=s1&access_token=tok&picked_file_ids=a%2Cb'
    )
  })

  it('hands what Google sent back to the window that asked, takes it out of the address, and closes', () => {
    mount(GoogleCallback)

    expect(relayed).toEqual([{ fragment: 'state=s1&access_token=tok&picked_file_ids=a%2Cb' }])
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/connect/google')
    expect(window.close).toHaveBeenCalled()
  })
})
