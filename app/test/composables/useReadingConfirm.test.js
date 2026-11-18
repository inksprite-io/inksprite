import { describe, it, expect, vi, beforeEach } from 'vitest'

const require = vi.hoisted(() => vi.fn())
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require }) }))

const { READING_GUIDE, useReadingConfirm } = await import('@/composables/useReadingConfirm.js')

describe('confirming that reading stops asking', () => {
  beforeEach(() => require.mockReset())

  it('asks about the web or the writer’s network, with the guide’s section after', () => {
    const { confirmUnasked } = useReadingConfirm()
    confirmUnasked('web')
    confirmUnasked('local')

    expect(require.mock.calls.map(([asked]) => asked.message)).toEqual([
      'Allowing access to any web page is a potential privacy risk.',
      'Allowing access to your local network is a potential privacy risk.',
    ])
    expect(require.mock.calls[0][0].guide).toBe(READING_GUIDE)
    expect(READING_GUIDE).toBe('https://docs.inksprite.io/web-search/#reading-without-asking')
  })

  it('is yes only when the writer accepts', async () => {
    const { confirmUnasked } = useReadingConfirm()
    const yes = confirmUnasked('web')
    require.mock.calls[0][0].accept()
    expect(await yes).toBe(true)

    const no = confirmUnasked('local')
    require.mock.calls[1][0].reject()
    expect(await no).toBe(false)

    const shut = confirmUnasked('local')
    require.mock.calls[2][0].onHide()
    expect(await shut).toBe(false)
  })
})
