import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LAYOUT,
  NO_PROJECT_LAYOUT,
  PANELS,
  SIDEBAR_TABS,
  CONTENT_SIZES,
  ROW_SIZES,
  canHide,
  normalizeLayout,
  selectSidebarTab,
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

  it('keeps any of the four lists, and falls back to the outline otherwise', () => {
    expect(normalizeLayout({ sidebarTab: 'chats' }).sidebarTab).toBe(SIDEBAR_TABS.CHATS)
    expect(normalizeLayout({ sidebarTab: 'narration' }).sidebarTab).toBe(SIDEBAR_TABS.NARRATION)
    expect(normalizeLayout({ sidebarTab: 'projects' }).sidebarTab).toBe(SIDEBAR_TABS.PROJECTS)
    expect(normalizeLayout({ sidebarTab: 'lore' }).sidebarTab).toBe(SIDEBAR_TABS.OUTLINE)
  })
})

describe('selectSidebarTab', () => {
  it('shows the sidebar on the list picked', () => {
    const hidden = { ...DEFAULT_LAYOUT, sidebar: false }
    expect(selectSidebarTab(hidden, SIDEBAR_TABS.PROJECTS)).toEqual({
      ...DEFAULT_LAYOUT,
      sidebar: true,
      sidebarTab: SIDEBAR_TABS.PROJECTS,
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
    const onProjects = { ...DEFAULT_LAYOUT, sidebarTab: SIDEBAR_TABS.PROJECTS }
    expect(togglePanel(onProjects, PANELS.EDITOR).sidebarTab).toBe(SIDEBAR_TABS.PROJECTS)
    expect(togglePanel(onProjects, PANELS.CHAT).sidebarTab).toBe(SIDEBAR_TABS.PROJECTS)

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
  it('shows the project list and nothing to chat in', () => {
    expect(NO_PROJECT_LAYOUT.sidebarTab).toBe(SIDEBAR_TABS.PROJECTS)
    expect(NO_PROJECT_LAYOUT.sidebar).toBe(true)
    expect(NO_PROJECT_LAYOUT.chat).toBe(false)
  })
})

describe('the splitters', () => {
  it('sizes the sidebar and the content to fill the row, and the editor and the chat the content', () => {
    expect(ROW_SIZES.sidebar + ROW_SIZES.content).toBe(100)
    expect(CONTENT_SIZES.editor + CONTENT_SIZES.chat).toBe(100)
  })
})
