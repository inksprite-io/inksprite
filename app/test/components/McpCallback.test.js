import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import McpCallback from '@/components/oauth/McpCallback.vue'

const finishSignIn = vi.hoisted(() => vi.fn())
vi.mock('@/mcp/auth.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  finishSignIn,
}))

/** What was announced to the tab that started the sign-in. */
const announced = []
vi.stubGlobal(
  'BroadcastChannel',
  class {
    postMessage(message) {
      announced.push(message)
    }
    close() {}
  }
)

describe('McpCallback', () => {
  beforeEach(() => {
    announced.length = 0
    finishSignIn.mockReset()
    vi.spyOn(window, 'close').mockImplementation(() => {})
    window.history.replaceState({}, '', '/connect/mcp?code=abc&state=xyz')
  })

  it('finishes the sign-in from what came back, tells the tab that asked, and closes', async () => {
    finishSignIn.mockResolvedValue({ url: 'https://mcp.linear.app/mcp' })

    const wrapper = mount(McpCallback)
    await flushPromises()

    expect(finishSignIn.mock.calls[0][0].get('code')).toBe('abc')
    expect(finishSignIn.mock.calls[0][0].get('state')).toBe('xyz')
    expect(wrapper.text()).toContain('Signed in')
    expect(announced).toEqual([{ url: 'https://mcp.linear.app/mcp' }])
    expect(window.close).toHaveBeenCalled()
  })

  it('says why it didn’t finish, and tells the tab that asked', async () => {
    const { SignInError } = await import('@/mcp/auth.js')
    finishSignIn.mockRejectedValue(
      new SignInError('Sign-in was cancelled.', 'https://mcp.linear.app/mcp')
    )

    const wrapper = mount(McpCallback)
    await flushPromises()

    expect(wrapper.text()).toContain('Sign-in was cancelled.')
    expect(announced).toEqual([
      { url: 'https://mcp.linear.app/mcp', error: 'Sign-in was cancelled.' },
    ])
  })
})
