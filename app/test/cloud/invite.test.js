import { describe, it, expect, beforeEach } from 'vitest'
import { takeInvite, takeInviteFromAddress } from '@/cloud/invite.js'

/**
 * A page at an address, and what its history was told.
 * @param {string} address
 */
function pageAt(address) {
  const url = new URL(address)
  /** @type {string[]} */
  const replaced = []
  const location = /** @type {Location} */ (
    /** @type {unknown} */ ({ search: url.search, pathname: url.pathname, hash: url.hash })
  )
  const history = /** @type {History} */ (
    /** @type {unknown} */ ({
      state: null,
      replaceState: (_state, _title, at) => replaced.push(at),
    })
  )
  return { location, history, replaced }
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  takeInvite()
})

describe('an invitation opened as a link', () => {
  it('takes the server and the code off the address, and is handed to the settings once', () => {
    const page = pageAt(
      'https://app.inksprite.io/project/story_1?server=sync.inksprite.io&invite=7K3M-Q9TX-2HDP#x'
    )
    expect(takeInviteFromAddress(page)).toBe(true)
    expect(page.replaced).toEqual(['/project/story_1#x'])
    expect(window.sessionStorage.getItem('expandable-section-ui.settings.sync')).toBe('true')
    expect(takeInvite()).toEqual({ server: 'sync.inksprite.io', code: '7K3M-Q9TX-2HDP' })
    expect(takeInvite()).toBeNull()
  })

  it('leaves an address without one as it is', () => {
    const page = pageAt('https://app.inksprite.io/?other=1')
    expect(takeInviteFromAddress(page)).toBe(false)
    expect(page.replaced).toEqual([])
    expect(takeInvite()).toBeNull()
  })
})
