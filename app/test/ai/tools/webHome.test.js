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

    const read = await executeReadWebPage({ url }, { approve, mayLeadHome: () => false })

    expect(approve).toHaveBeenCalledWith(`${url} is on this computer or its network. Read it?`)
    expect(readPage.mock.calls.map(([, , options]) => options.home)).toEqual([false, true])
    expect(read.content).toBe('At home.')
    expect(allowSite).not.toHaveBeenCalled()
  })

  it('always allows its site when told, and reads nothing when told no', async () => {
    readPage.mockRejectedValueOnce(leadsHome()).mockResolvedValueOnce(page)
    await executeReadWebPage({ url }, { approve: async () => 'always', mayLeadHome: () => false })
    expect(allowSite).toHaveBeenCalledWith('chat.home.example')

    readPage.mockReset()
    readPage.mockRejectedValueOnce(leadsHome())
    const refused = await executeReadWebPage(
      { url },
      { approve: async () => 'deny', mayLeadHome: () => false }
    )
    expect(refused.error).toContain('leads to this computer or its network')
    expect(readPage).toHaveBeenCalledTimes(1)
  })

  it('asks nothing of an address the writer typed, which is read wherever it leads', async () => {
    readPage.mockResolvedValueOnce(page)
    const approve = vi.fn()
    await executeReadWebPage({ url }, { approve, mayLeadHome: () => true })
    expect(readPage.mock.calls[0][2].home).toBe(true)
    expect(approve).not.toHaveBeenCalled()
  })

  it('asks nothing for any other failure', async () => {
    readPage.mockRejectedValueOnce(new Error('It couldn’t be reached.'))
    const approve = vi.fn()
    const failed = await executeReadWebPage({ url }, { approve, mayLeadHome: () => false })
    expect(failed).toHaveProperty('error')
    expect(approve).not.toHaveBeenCalled()
  })
})
