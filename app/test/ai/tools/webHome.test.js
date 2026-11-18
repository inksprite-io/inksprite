import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const readPage = vi.hoisted(() => vi.fn())
vi.mock('@/web/pages.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  readPage,
}))
const allowSite = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useWebSearch.js', () => ({ useWebSearch: () => ({ allowSite }) }))

const { executeReadWebPage } = await import('@/ai/tools/web.js')
const { setWebSearch } = await import('@/web/config.js')
const { ServiceError } = await import('@/web/answers.js')

/** What the site request says of an address that turned out to lead home. */
const leadsHome = () =>
  Object.assign(
    new ServiceError(
      'https://chat.home.example/ leads to this computer or its network, and wasn’t read.'
    ),
    {
      home: true,
    }
  )

const url = 'https://chat.home.example/'
const page = { title: 'Notes', text: 'At home.' }

describe('reading an address that turns out to be on the writer’s own network', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setWebSearch({ id: 'web', service: 'exa', keys: {} })
  })

  afterEach(() => setWebSearch(null))

  it('asks the writer, and reads it wherever it leads once they allow it', async () => {
    readPage.mockRejectedValueOnce(leadsHome()).mockResolvedValueOnce(page)
    const approve = vi.fn(async () => 'allow')

    const read = await executeReadWebPage({ url }, { approve, mayLeadHome: () => [] })

    expect(approve).toHaveBeenCalledWith(
      `${url} is on this computer or its network. Read it?`,
      'chat.home.example'
    )
    expect(readPage.mock.calls.map(([, , options]) => options.home)).toEqual([
      [],
      ['chat.home.example'],
    ])
    expect(read.content).toBe('At home.')
    expect(allowSite).not.toHaveBeenCalled()
  })

  it('always allows its site when told, and reads nothing when told no', async () => {
    readPage.mockRejectedValueOnce(leadsHome()).mockResolvedValueOnce(page)
    await executeReadWebPage({ url }, { approve: async () => 'always', mayLeadHome: () => [] })
    expect(allowSite).toHaveBeenCalledWith('chat.home.example')

    readPage.mockReset()
    readPage.mockRejectedValueOnce(leadsHome())
    const refused = await executeReadWebPage(
      { url },
      { approve: async () => 'deny', mayLeadHome: () => [] }
    )
    expect(refused.error).toContain('leads to this computer or its network')
    expect(readPage).toHaveBeenCalledTimes(1)
  })

  it('asks about the step a redirect leads to, and allows that and no more', async () => {
    readPage
      .mockRejectedValueOnce(Object.assign(leadsHome(), { site: 'router.home.example' }))
      .mockResolvedValueOnce(page)
    const approve = vi.fn(async () => 'always')

    await executeReadWebPage({ url }, { approve, mayLeadHome: () => ['tides.example'] })

    expect(approve).toHaveBeenCalledWith(
      `${url} leads to router.home.example, on this computer or its network. Read it?`,
      'router.home.example'
    )
    expect(readPage.mock.calls[1][2].home).toEqual(['tides.example', 'router.home.example'])
    expect(allowSite).toHaveBeenCalledWith('router.home.example')
  })

  it('asks about each place at home a read is led through, in the one call', async () => {
    readPage
      .mockRejectedValueOnce(Object.assign(leadsHome(), { site: 'shelf.home.example' }))
      .mockRejectedValueOnce(Object.assign(leadsHome(), { site: 'shelf.home.example:5001' }))
      .mockResolvedValueOnce(page)
    const approve = vi.fn(async () => 'allow')

    const read = await executeReadWebPage({ url }, { approve, mayLeadHome: () => [] })

    expect(approve).toHaveBeenCalledTimes(2)
    expect(readPage.mock.calls[2][2].home).toEqual([
      'shelf.home.example',
      'shelf.home.example:5001',
    ])
    expect(read.content).toBe('At home.')
  })

  it('asks nothing once reading on the writer’s network never asks', async () => {
    readPage.mockResolvedValueOnce(page)
    const approve = vi.fn()
    await executeReadWebPage({ url }, { approve, mayLeadHome: () => true })
    expect(readPage.mock.calls[0][2].home).toBe(true)
    expect(approve).not.toHaveBeenCalled()
  })

  it('reads nothing there, and asks nothing, while reading on the network is off', async () => {
    setWebSearch({ id: 'web', service: 'exa', keys: {}, readLocalOff: true })
    const approve = vi.fn()

    const local = await executeReadWebPage({ url: 'http://localhost:3000/' }, { approve })
    expect(local.error).toContain('switched off')
    expect(readPage).not.toHaveBeenCalled()

    // Nor where an address only turns out to lead there.
    readPage.mockRejectedValueOnce(leadsHome())
    const led = await executeReadWebPage({ url }, { approve, mayLeadHome: () => [] })
    expect(led.error).toContain('leads to this computer or its network')
    expect(approve).not.toHaveBeenCalled()
  })

  it('asks nothing for any other failure', async () => {
    readPage.mockRejectedValueOnce(new Error('It couldn’t be reached.'))
    const approve = vi.fn()
    const failed = await executeReadWebPage({ url }, { approve, mayLeadHome: () => [] })
    expect(failed).toHaveProperty('error')
    expect(approve).not.toHaveBeenCalled()
  })
})
