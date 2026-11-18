// @vitest-environment node
/* global Response */
import { describe, it, expect, vi } from 'vitest'
import {
  LOCAL_REFUSED,
  fetchFromWeb,
  isPrivateNumber,
  leadsHome,
} from '../../electron/src/addresses.js'

describe('isPrivateNumber', () => {
  it('takes this computer and the private ranges as private, and the rest as the web', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd12::1',
      'fe80::1',
      '::ffff:192.168.1.1',
    ]) {
      expect(isPrivateNumber(address), address).toBe(true)
    }
    for (const address of ['203.0.113.7', '172.32.0.1', '2001:db8::1', '::ffff:203.0.113.7']) {
      expect(isPrivateNumber(address), address).toBe(false)
    }
  })
})

describe('leadsHome', () => {
  const resolving = found => async () => found.map(address => ({ address }))

  it('goes by where a name resolves, not by what it is called', async () => {
    expect(await leadsHome('https://tides.example/a', resolving(['203.0.113.7']))).toBe(false)
    expect(await leadsHome('https://tides.example/a', resolving(['192.168.1.1']))).toBe(true)
    // Any of its numbers is enough.
    expect(await leadsHome('https://tides.example/a', resolving(['203.0.113.7', '::1']))).toBe(true)
  })

  it('needs no lookup for a number, or for localhost', async () => {
    const never = vi.fn()
    expect(await leadsHome('http://10.0.0.5/admin', never)).toBe(true)
    expect(await leadsHome('http://[::1]:3000/', never)).toBe(true)
    expect(await leadsHome('http://203.0.113.7/', never)).toBe(false)
    expect(await leadsHome('http://app.localhost/', never)).toBe(true)
    expect(never).not.toHaveBeenCalled()
  })

  it('leaves a name that can’t be looked up to the fetch', async () => {
    const failing = async () => {
      throw new Error('ENOTFOUND')
    }
    expect(await leadsHome('https://nowhere.example/', failing)).toBe(false)
  })
})

describe('fetchFromWeb', () => {
  const home = async url => new URL(url).hostname === 'router.example'
  const redirect = to => new Response(null, { status: 302, headers: { location: to } })

  it('fetches an address on the web, without leaving redirects to the fetch', async () => {
    const fetch = vi.fn(async () => new Response('page'))
    const response = await fetchFromWeb(fetch, 'https://tides.example/a', { method: 'GET' }, home)
    expect(await response.text()).toBe('page')
    expect(fetch).toHaveBeenCalledWith('https://tides.example/a', {
      method: 'GET',
      redirect: 'manual',
    })
  })

  it('refuses an address that leads home before asking it anything', async () => {
    const fetch = vi.fn()
    await expect(fetchFromWeb(fetch, 'https://router.example/reboot', {}, home)).rejects.toThrow(
      LOCAL_REFUSED
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('follows a redirect on the web, and refuses one that leads home', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(redirect('/b'))
      .mockResolvedValueOnce(new Response('moved'))
    const response = await fetchFromWeb(fetch, 'https://tides.example/a', {}, home)
    expect(await response.text()).toBe('moved')
    expect(fetch.mock.calls[1][0]).toBe('https://tides.example/b')

    const homeward = vi.fn().mockResolvedValueOnce(redirect('http://router.example/reboot'))
    await expect(fetchFromWeb(homeward, 'https://tides.example/a', {}, home)).rejects.toThrow(
      LOCAL_REFUSED
    )
    expect(homeward).toHaveBeenCalledTimes(1)

    const toFile = vi.fn().mockResolvedValueOnce(redirect('file:///etc/passwd'))
    await expect(fetchFromWeb(toFile, 'https://tides.example/a', {}, home)).rejects.toThrow(
      LOCAL_REFUSED
    )
  })

  it('gives up on an address that only ever redirects', async () => {
    const fetch = vi.fn(async () => redirect('/again'))
    await expect(fetchFromWeb(fetch, 'https://tides.example/a', {}, home)).rejects.toThrow(
      'too many times'
    )
  })
})
