// @vitest-environment node
/* global Response */
import { describe, it, expect } from 'vitest'
import { createApi } from '@/cloud/api.js'

/**
 * A fetch that answers every call with an empty object, noting where each
 * was sent.
 */
function fakeFetch() {
  /** @type {string[]} */
  const asked = []
  /** @type {typeof fetch} */
  const fetch = async input => {
    asked.push(String(input))
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { fetch, asked }
}

describe('createApi', () => {
  it('assumes https when the address has no scheme', () => {
    expect(createApi('sync.example.com').server).toBe('https://sync.example.com')
    expect(createApi(' sync.example.com:8787/ ').server).toBe('https://sync.example.com:8787')
    expect(createApi('//sync.example.com').server).toBe('https://sync.example.com')
  })

  it('keeps the scheme given, without a slash at the end', () => {
    expect(createApi('http://localhost:8787/').server).toBe('http://localhost:8787')
    expect(createApi('https://sync.example.com').server).toBe('https://sync.example.com')
  })

  it('asks the server at the assumed address', async () => {
    const { fetch, asked } = fakeFetch()
    await createApi('sync.example.com', null, { fetch }).prelogin('writer')
    expect(asked).toEqual(['https://sync.example.com/v1/prelogin'])
  })
})
