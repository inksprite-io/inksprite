/* global Response */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const fetch = vi.hoisted(() => vi.fn())
vi.mock('@/platform/fetch.js', () => ({ fetch }))

const { askProps, forgetProps } = await import('@/ai/llamacpp.js')

/** @param {string} endpoint */
const server = endpoint => /** @type {any} */ ({ id: 'l', type: 'llamacpp', endpoint })

describe('askProps', () => {
  beforeEach(() => {
    forgetProps()
    fetch.mockReset()
  })

  it('reads the slots and how long a context each holds, asked once beside the API', async () => {
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ total_slots: 2, default_generation_settings: { n_ctx: 16384 } })
      )
    )

    expect(await askProps(server('http://localhost:8080/v1/'))).toEqual({
      slots: 2,
      context: 16384,
    })
    expect(await askProps(server('http://localhost:8080/v1/'))).toEqual({
      slots: 2,
      context: 16384,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:8080/props')
  })

  it('says nothing of what the server leaves out, or when it cannot be asked', async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ total_slots: 'many' })))
    expect(await askProps(server('http://a:8080'))).toEqual({})

    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await askProps(server('http://b:8080'))).toEqual({})

    expect(await askProps(server('not an address'))).toEqual({})
  })
})
