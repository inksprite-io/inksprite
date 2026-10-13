import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** What saving goes through on the way to the database, in order. */
const saved = vi.hoisted(() => /** @type {string[]} */ ([]))
vi.mock('@/composables/useEditor.js', () => ({
  useEditor: () => ({ flush: () => saved.push('editor') }),
}))
vi.mock('@/stores/syncStore.js', () => ({
  useSyncStore: () => ({
    processSync: async () => {
      await Promise.resolve()
      saved.push('store')
    },
  }),
}))

import { useSaveBeforeClosing } from '@/composables/useSaveBeforeClosing.js'

describe('useSaveBeforeClosing', () => {
  beforeEach(() => {
    saved.length = 0
  })

  afterEach(() => {
    delete globalThis.__INKSPRITE_DESKTOP__
  })

  it('gives the window a save of the open document and then the store', async () => {
    const beforeClosing = vi.fn()
    globalThis.__INKSPRITE_DESKTOP__ = { beforeClosing }
    useSaveBeforeClosing()

    expect(beforeClosing).toHaveBeenCalledTimes(1)
    const save = beforeClosing.mock.calls[0][0]
    expect(saved).toEqual([])
    await save()
    expect(saved).toEqual(['editor', 'store'])
  })

  it('does nothing in a browser', () => {
    expect(() => useSaveBeforeClosing()).not.toThrow()
  })

  it('does nothing in a window that cannot wait', () => {
    globalThis.__INKSPRITE_DESKTOP__ = {}
    expect(() => useSaveBeforeClosing()).not.toThrow()
  })
})
