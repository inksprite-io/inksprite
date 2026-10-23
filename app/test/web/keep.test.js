/* global File */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const fetchDirect = vi.hoisted(() => vi.fn())
vi.mock('@/web/direct.js', () => ({ fetchDirect, readDirect: vi.fn() }))

const { fetchToKeep } = await import('@/web/keep.js')
const { readPage, forgetPages } = await import('@/web/pages.js')
const { setWebSearch } = await import('@/web/config.js')
const { ServiceError } = await import('@/web/answers.js')

/** A service that reads every page as this text. */
const service = (/** @type {string} */ text) => ({
  id: 'stub',
  name: 'Stub',
  read: vi.fn(async () => ({ title: 'As read', text })),
})

const pdf = () => new File(['%PDF'], 'standards.pdf', { type: 'application/pdf' })

describe('fetchToKeep', () => {
  beforeEach(() => {
    forgetPages()
    fetchDirect.mockReset()
  })

  afterEach(() => setWebSearch(null))

  it('keeps the file a read fetched from its site, without fetching it again', async () => {
    const file = pdf()
    const read = { id: 'brave', name: 'Brave', read: vi.fn(async () => ({ text: 'x', file })) }
    await readPage(/** @type {any} */ (read), 'https://example.org/standards.pdf', {})

    expect(await fetchToKeep('https://example.org/standards.pdf')).toEqual({ file })
    expect(fetchDirect).not.toHaveBeenCalled()
  })

  it('keeps the file the site has, over the text a service read of it', async () => {
    await readPage(/** @type {any} */ (service('Its text')), 'https://example.org/a.pdf', {})
    const file = pdf()
    fetchDirect.mockResolvedValue({ file })

    expect(await fetchToKeep('https://example.org/a.pdf')).toEqual({ file })
  })

  it('keeps a page as the model read it, rather than as the site serves it', async () => {
    await readPage(/** @type {any} */ (service('What the model read')), 'https://example.org/p', {})
    fetchDirect.mockResolvedValue({ page: { title: 'Raw', text: 'The whole site' } })

    expect(await fetchToKeep('https://example.org/p')).toEqual({
      page: { title: 'As read', text: 'What the model read' },
      read: false,
    })
  })

  it('keeps the page a service reads when the site refuses', async () => {
    setWebSearch({ id: 'web', service: 'exa', keys: {}, profiles: [] })
    await readPage(/** @type {any} */ (service('Read by the service')), 'https://example.org/p', {})
    fetchDirect.mockRejectedValue(new ServiceError('https://example.org/p couldn’t be reached.'))

    expect(await fetchToKeep('https://example.org/p')).toEqual({
      page: { title: 'As read', text: 'Read by the service' },
      read: true,
    })
  })

  it('says why, in the site’s words, when nothing can be had', async () => {
    fetchDirect.mockRejectedValue(new ServiceError('https://example.org/p couldn’t be reached.'))

    await expect(fetchToKeep('https://example.org/p')).rejects.toThrow(
      'https://example.org/p couldn’t be reached.'
    )
  })
})
