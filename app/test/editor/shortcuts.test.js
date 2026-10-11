import { describe, it, expect } from 'vitest'
import { SHORTCUTS, isShortcutsKey, keyLabel } from '@/editor/shortcuts.js'
import { keys } from '@/editor/state.js'

/** A binding's parts, in an order that does not matter: `Shift-Mod-z` is `Mod-Shift-z`. */
const parts = binding =>
  binding
    .split(/-(?!$)/)
    .sort()
    .join('-')

describe('editor/shortcuts', () => {
  it('lists only keys the editor has', () => {
    // Bound elsewhere than the state's keymap: links, comments, the find,
    // and this list itself.
    const elsewhere = ['Mod-k', 'Mod-Shift-m', 'Mod-f', 'Mod-/']
    const bound = new Set([...Object.keys(keys), ...elsewhere].map(parts))

    for (const group of SHORTCUTS) {
      for (const shortcut of group.shortcuts) {
        if (shortcut.keys) expect(bound.has(parts(shortcut.keys)), shortcut.keys).toBe(true)
        else expect(shortcut.typed).toBeTruthy()
      }
    }
  })

  it('spells a binding for a Mac, and for anything else', () => {
    expect(keyLabel('Mod-Shift-b', true)).toBe('⌘⇧B')
    expect(keyLabel('Mod-Shift-b', false)).toBe('Ctrl+Shift+B')
    expect(keyLabel('Mod-/', false)).toBe('Ctrl+/')
    expect(keyLabel('Shift-Enter', true)).toBe('⇧↵')
  })

  it('takes Mod-/ for the list, with Shift or without', () => {
    const mod = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }
    expect(isShortcutsKey({ key: '/', ...mod })).toBe(true)
    expect(isShortcutsKey({ key: '/', shiftKey: true, ...mod })).toBe(true)
    expect(isShortcutsKey({ key: '/' })).toBe(false)
  })
})
