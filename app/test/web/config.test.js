import { describe, it, expect, afterEach } from 'vitest'
import {
  serviceInUse,
  setWebSearch,
  webForChat,
  webSearchSetup,
  onWebSearchChanged,
} from '@/web/config.js'

/** A setup with this service, keys and profiles. */
const setup = (service, keys = {}, profiles = ['p_default']) => ({
  id: /** @type {const} */ ('web'),
  service,
  keys,
  profiles,
})

describe('serviceInUse', () => {
  afterEach(() => setWebSearch(null))

  it('is none until a service is chosen', () => {
    expect(serviceInUse(null)).toBeNull()
    expect(serviceInUse(setup(undefined))).toBeNull()
  })

  it('takes Exa with no key, which answers without one', () => {
    expect(serviceInUse(setup('exa'))).toMatchObject({ service: { id: 'exa' }, key: '' })
  })

  it('takes Kagi only with a key', () => {
    expect(serviceInUse(setup('kagi'))).toBeNull()
    expect(serviceInUse(setup('kagi', { kagi: '' }))).toBeNull()
    expect(serviceInUse(setup('kagi', { kagi: 'k' }))).toMatchObject({ key: 'k' })
  })

  it('takes Brave only in the desktop app, and only with a key', () => {
    expect(serviceInUse(setup('brave', { brave: 'b' }))).toBeNull()

    globalThis.__INKSPRITE_DESKTOP__ = {}
    try {
      expect(serviceInUse(setup('brave'))).toBeNull()
      expect(serviceInUse(setup('brave', { brave: 'b' }))).toMatchObject({ key: 'b' })
    } finally {
      delete globalThis.__INKSPRITE_DESKTOP__
    }
  })

  it('reads the setup as it stands when given none', () => {
    setWebSearch(setup('exa', { exa: 'k' }))

    expect(serviceInUse()).toMatchObject({ service: { id: 'exa' }, key: 'k' })
    expect(webSearchSetup()?.service).toBe('exa')
  })

  it('tells whoever listens when the setup changes', () => {
    let told = 0
    const stop = onWebSearchChanged(() => told++)

    setWebSearch(setup('exa'))
    stop()
    setWebSearch(setup('kagi'))

    expect(told).toBe(1)
  })
})

describe('webForChat', () => {
  it('searches in chats on a listed profile, until the chat says otherwise', () => {
    const from = setup('exa')

    expect(webForChat({}, 'p_default', from)).toBe(true)
    expect(webForChat({}, 'p_roleplay', from)).toBe(false)
    expect(webForChat({ web: false }, 'p_default', from)).toBe(false)
    expect(webForChat({ web: true }, 'p_roleplay', from)).toBe(true)
  })

  it('never searches while no service can, whatever the chat said', () => {
    expect(webForChat({ web: true }, 'p_default', setup(undefined))).toBe(false)
    expect(webForChat({ web: true }, 'p_default', setup('kagi'))).toBe(false)
  })
})
