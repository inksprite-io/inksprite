import { describe, it, expect } from 'vitest'
import { SHORTCUTS, isShortcutsKey, keyLabel, menuShortcuts } from '@/editor/shortcuts.js'
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
    // the project's search, focus mode, and this list itself.
    const elsewhere = [
      'Mod-k',
      'Mod-Shift-m',
      'Mod-f',
      'Mod-Shift-f',
      'Mod-Alt-f',
      'Mod-p',
      'Mod-/',
    ]
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
    expect(keyLabel('Ctrl-Shift-Tab', true)).toBe('⌃⇧⇥')
    expect(keyLabel('Ctrl-Tab', false)).toBe('Ctrl+Tab')
    expect(keyLabel('Mod-,', true)).toBe('⌘,')
  })

  it('lists the desktop menu’s keys, a new chat among them only with the AI on', () => {
    const actions = ai => menuShortcuts({ ai }).shortcuts.map(shortcut => shortcut.action)
    expect(actions(true)).toContain('New chat')
    expect(actions(false)).not.toContain('New chat')
    expect(actions(false)).toContain('Close tab')
  })

  it('lists the terminal’s keys only with the Terminal extension on, a Mac’s on a Mac', () => {
    const terminals = (terminal, mac) =>
      menuShortcuts({ ai: true, terminal, mac })
        .shortcuts.filter(({ action }) => action.includes('terminal'))
        .map(({ action, keys }) => [action, keyLabel(keys, mac)])
    expect(terminals(false, true)).toEqual([])
    expect(terminals(true, true)).toEqual([
      ['New terminal', '⌘L'],
      ['Show terminal', '⌃`'],
    ])
    expect(terminals(true, false)).toEqual([
      ['New terminal', 'Ctrl+Shift+L'],
      ['Show terminal', 'Ctrl+`'],
    ])
  })

  it('takes Mod-/ for the list, with Shift or without', () => {
    const mod = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }
    expect(isShortcutsKey({ key: '/', ...mod })).toBe(true)
    expect(isShortcutsKey({ key: '/', shiftKey: true, ...mod })).toBe(true)
    expect(isShortcutsKey({ key: '/' })).toBe(false)
  })
})
