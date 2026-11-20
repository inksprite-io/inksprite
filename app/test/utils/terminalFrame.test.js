import { describe, it, expect } from 'vitest'
import { appShortcutFrom } from '@/utils/terminalFrame.js'

describe('appShortcutFrom', () => {
  it('is the shortcut a frame said was pressed, with Command held', () => {
    expect(
      appShortcutFrom({ type: 'key', key: 'f', code: 'KeyF', metaKey: true, shiftKey: true })
    ).toEqual({
      key: 'f',
      code: 'KeyF',
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
    })
  })

  it('is nothing without Command: the rest of what is typed is the shell’s', () => {
    expect(appShortcutFrom({ key: 'f', code: 'KeyF', ctrlKey: true })).toBeNull()
    expect(appShortcutFrom({ key: 'f', code: 'KeyF', metaKey: 'yes' })).toBeNull()
  })

  it('is nothing for what isn’t a key', () => {
    for (const said of [
      null,
      'f',
      { metaKey: true },
      { metaKey: true, key: 1, code: 'KeyF' },
      { metaKey: true, key: 'f' },
      { metaKey: true, key: 'f'.repeat(50), code: 'KeyF' },
    ]) {
      expect(appShortcutFrom(said)).toBeNull()
    }
  })
})
