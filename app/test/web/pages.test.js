import { describe, it, expect, beforeEach, vi } from 'vitest'

const serviceInUse = vi.hoisted(() => vi.fn())
vi.mock('@/web/config.js', () => ({ serviceInUse }))

const { forgetPages, readPage, wholePage } = await import('@/web/pages.js')

/** A service whose reads are counted. */
const service = () => ({
  id: 'exa',
  read: vi.fn(async url => ({ title: url, text: `Text of ${url}.` })),
})

describe('readPage', () => {
  beforeEach(() => forgetPages())

  it('asks the service once for a page read again', async () => {
    const exa = service()

    await readPage(/** @type {any} */ (exa), 'https://example.org/a', {})
    const again = await readPage(/** @type {any} */ (exa), 'https://example.org/a', {})

    expect(exa.read).toHaveBeenCalledTimes(1)
    expect(again.text).toBe('Text of https://example.org/a.')
  })

  it('keeps the last few pages, and asks again for one let go', async () => {
    const exa = service()
    for (let i = 0; i < 9; i++)
      await readPage(/** @type {any} */ (exa), `https://example.org/${i}`, {})

    await readPage(/** @type {any} */ (exa), 'https://example.org/8', {})
    expect(exa.read).toHaveBeenCalledTimes(9)
    await readPage(/** @type {any} */ (exa), 'https://example.org/0', {})
    expect(exa.read).toHaveBeenCalledTimes(10)
  })

  it('does not keep a read that failed', async () => {
    const exa = service()
    exa.read.mockRejectedValueOnce(new Error('down'))

    await expect(readPage(/** @type {any} */ (exa), 'https://example.org/a', {})).rejects.toThrow(
      'down'
    )
    await readPage(/** @type {any} */ (exa), 'https://example.org/a', {})

    expect(exa.read).toHaveBeenCalledTimes(2)
  })
})

describe('wholePage', () => {
  beforeEach(() => forgetPages())

  it('gives the copy kept, whichever service read it, without asking again', async () => {
    const kagi = { ...service(), id: 'kagi' }
    await readPage(/** @type {any} */ (kagi), 'https://example.org/a', {})
    serviceInUse.mockReturnValue({ service: service(), key: '' })

    expect((await wholePage('https://example.org/a'))?.text).toBe('Text of https://example.org/a.')
    expect(kagi.read).toHaveBeenCalledTimes(1)
  })

  it('reads a page no longer kept with the service in use, and its key', async () => {
    const exa = service()
    serviceInUse.mockReturnValue({ service: exa, key: 'k1' })

    expect((await wholePage('https://example.org/b', { timeout: 5 }))?.text).toBe(
      'Text of https://example.org/b.'
    )
    expect(exa.read).toHaveBeenCalledWith('https://example.org/b', { timeout: 5, key: 'k1' })
  })

  it('has nothing when no copy is kept and no service is set up', async () => {
    serviceInUse.mockReturnValue(null)

    expect(await wholePage('https://example.org/c')).toBeNull()
  })
})
