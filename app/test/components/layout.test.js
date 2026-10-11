import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LAYOUT,
  NO_PROJECT_LAYOUT,
  PANELS,
  SIDEBAR_TABS,
  CONTENT_SIZES,
  ROW_SIZES,
  canHide,
  keptSizes,
  normalizeLayout,
  selectSidebarTab,
  shownLayout,
  togglePanel,
} from '@/components/writer/layout/layout.js'

describe('normalizeLayout', () => {
  it('gives the default arrangement to a story that has none', () => {
    expect(normalizeLayout(undefined)).toEqual(DEFAULT_LAYOUT)
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT)
  })

  it('fills in what a partial record leaves out', () => {
    expect(normalizeLayout({ chat: false })).toEqual({ ...DEFAULT_LAYOUT, chat: false })
  })

  it('never opens onto an empty screen', () => {
    const layout = normalizeLayout({ editor: false, chat: false })
    expect(layout.editor).toBe(true)
    expect(layout.chat).toBe(false)
  })

  it('keeps any of the three lists, and falls back to the outline otherwise', () => {
    expect(normalizeLayout({ sidebarTab: 'chats' }).sidebarTab).toBe(SIDEBAR_TABS.CHATS)
    expect(normalizeLayout({ sidebarTab: 'narration' }).sidebarTab).toBe(SIDEBAR_TABS.NARRATION)
    expect(normalizeLayout({ sidebarTab: 'lore' }).sidebarTab).toBe(SIDEBAR_TABS.OUTLINE)
  })

  it('brings a project left on the old project list back on the outline', () => {
    expect(normalizeLayout({ sidebarTab: 'projects' }).sidebarTab).toBe(SIDEBAR_TABS.OUTLINE)
  })
})

describe('selectSidebarTab', () => {
  it('shows the sidebar on the list picked', () => {
    const hidden = { ...DEFAULT_LAYOUT, sidebar: false }
    expect(selectSidebarTab(hidden, SIDEBAR_TABS.NARRATION)).toEqual({
      ...DEFAULT_LAYOUT,
      sidebar: true,
      sidebarTab: SIDEBAR_TABS.NARRATION,
    })
  })

  it('switches lists while the sidebar is showing', () => {
    expect(selectSidebarTab(DEFAULT_LAYOUT, SIDEBAR_TABS.CHATS)).toEqual({
      ...DEFAULT_LAYOUT,
      sidebarTab: SIDEBAR_TABS.CHATS,
    })
  })

  it('hides the sidebar when the list showing is picked again', () => {
    const hidden = selectSidebarTab(DEFAULT_LAYOUT, DEFAULT_LAYOUT.sidebarTab)
    expect(hidden.sidebar).toBe(false)
    expect(hidden.sidebarTab).toBe(DEFAULT_LAYOUT.sidebarTab)
  })

  it('brings the sidebar back on the same list', () => {
    const hidden = selectSidebarTab(DEFAULT_LAYOUT, DEFAULT_LAYOUT.sidebarTab)
    expect(selectSidebarTab(hidden, DEFAULT_LAYOUT.sidebarTab)).toEqual(DEFAULT_LAYOUT)
  })
})

describe('togglePanel', () => {
  it('moves the sidebar off the outline when the editor goes', () => {
    const next = togglePanel(DEFAULT_LAYOUT, PANELS.EDITOR)
    expect(next.editor).toBe(false)
    expect(next.sidebarTab).toBe(SIDEBAR_TABS.CHATS)
  })

  it('moves the sidebar off the chats when the chat goes', () => {
    const start = { ...DEFAULT_LAYOUT, sidebarTab: SIDEBAR_TABS.CHATS }
    const next = togglePanel(start, PANELS.CHAT)
    expect(next.chat).toBe(false)
    expect(next.sidebarTab).toBe(SIDEBAR_TABS.OUTLINE)
  })

  it('leaves the sidebar on any other list', () => {
    const onNarration = { ...DEFAULT_LAYOUT, sidebarTab: SIDEBAR_TABS.NARRATION }
    expect(togglePanel(onNarration, PANELS.EDITOR).sidebarTab).toBe(SIDEBAR_TABS.NARRATION)
    expect(togglePanel(onNarration, PANELS.CHAT).sidebarTab).toBe(SIDEBAR_TABS.NARRATION)

    const onChats = { ...DEFAULT_LAYOUT, sidebarTab: SIDEBAR_TABS.CHATS }
    expect(togglePanel(onChats, PANELS.EDITOR).sidebarTab).toBe(SIDEBAR_TABS.CHATS)
  })

  it('leaves the tab alone when a panel comes back', () => {
    const chatOnly = { ...DEFAULT_LAYOUT, editor: false, sidebarTab: SIDEBAR_TABS.CHATS }
    const next = togglePanel(chatOnly, PANELS.EDITOR)
    expect(next.editor).toBe(true)
    expect(next.sidebarTab).toBe(SIDEBAR_TABS.CHATS)
  })

  it('refuses to hide the last content panel', () => {
    const editorOnly = { ...DEFAULT_LAYOUT, chat: false }
    expect(togglePanel(editorOnly, PANELS.EDITOR)).toBe(editorOnly)
    expect(canHide(editorOnly, PANELS.EDITOR)).toBe(false)
    expect(canHide(editorOnly, PANELS.CHAT)).toBe(true)
  })

  it('toggles the sidebar without touching its tab', () => {
    const start = { ...DEFAULT_LAYOUT, sidebarTab: SIDEBAR_TABS.CHATS }
    const hidden = togglePanel(start, PANELS.SIDEBAR)
    expect(hidden.sidebar).toBe(false)
    expect(hidden.sidebarTab).toBe(SIDEBAR_TABS.CHATS)
    expect(canHide(start, PANELS.SIDEBAR)).toBe(true)
  })

  it('does not change the layout it was given', () => {
    const start = { ...DEFAULT_LAYOUT }
    togglePanel(start, PANELS.EDITOR)
    expect(start).toEqual(DEFAULT_LAYOUT)
  })
})

describe('with no project open', () => {
  it('shows no list and nothing to chat in', () => {
    expect(NO_PROJECT_LAYOUT.sidebar).toBe(false)
    expect(NO_PROJECT_LAYOUT.chat).toBe(false)
  })
})

describe('the splitters', () => {
  it('sizes the sidebar and the content to fill the row, and the editor and the chat the content', () => {
    expect(ROW_SIZES.sidebar + ROW_SIZES.content).toBe(100)
    expect(CONTENT_SIZES.editor + CONTENT_SIZES.chat).toBe(100)
  })
})

describe('in a narrow window', () => {
  it('folds the chat away while the sidebar is open beside the editor', () => {
    expect(shownLayout(DEFAULT_LAYOUT, true)).toEqual({ ...DEFAULT_LAYOUT, chat: false })
    expect(shownLayout({ ...DEFAULT_LAYOUT, sidebar: false }, true).chat).toBe(true)
  })

  it('leaves two panels as they are', () => {
    const noEditor = { ...DEFAULT_LAYOUT, editor: false }
    const noChat = { ...DEFAULT_LAYOUT, chat: false }
    expect(shownLayout(noEditor, true)).toBe(noEditor)
    expect(shownLayout(noChat, true)).toBe(noChat)
  })

  it('shows all three in a wide one', () => {
    expect(shownLayout(DEFAULT_LAYOUT, false)).toBe(DEFAULT_LAYOUT)
  })
})

describe('keptSizes', () => {
  it('gives back the widths kept, one for each panel', () => {
    expect(keptSizes([25, 75], [20, 80])).toEqual([25, 75])
  })

  it('starts from the starting widths when what is kept is not that', () => {
    expect(keptSizes(null, [20, 80])).toEqual([20, 80])
    expect(keptSizes([25], [20, 80])).toEqual([20, 80])
    expect(keptSizes([25, 'wide'], [20, 80])).toEqual([20, 80])
    expect(keptSizes([25, Number.NaN], [20, 80])).toEqual([20, 80])
    expect(keptSizes({ 0: 25, 1: 75 }, [20, 80])).toEqual([20, 80])
  })
})
