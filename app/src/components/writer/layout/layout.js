/**
 * @module components/writer/layout/layout
 * @description The writer's panel arrangement: which of the sidebar, the editor
 * and the chat are showing, and which list the sidebar is on — the outline,
 * the chats, or the narration of the open document. It is kept on the story
 * rather than app-wide, so each project reopens the way it was left:
 * an adventure chat-only, a novel with the editor beside its chat.
 *
 * The rail picks the sidebar's list, and picking the list showing hides the
 * sidebar; the editor and the chat each hide the other from a toggle at the
 * edge of their header. The sidebar's width is its own, and the editor and
 * the chat divide the rest. The rules for all of it are here, as pure
 * functions over the layout.
 */

/** @typedef {import('@/types/models.js').StoryLayout} StoryLayout */
/** @typedef {'sidebar'|'editor'|'chat'} Panel */

export const PANELS = Object.freeze({
  SIDEBAR: /** @type {Panel} */ ('sidebar'),
  EDITOR: /** @type {Panel} */ ('editor'),
  CHAT: /** @type {Panel} */ ('chat'),
})

export const SIDEBAR_TABS = Object.freeze({
  OUTLINE: /** @type {'outline'} */ ('outline'),
  CHATS: /** @type {'chats'} */ ('chats'),
  NARRATION: /** @type {'narration'} */ ('narration'),
})

/** @typedef {typeof SIDEBAR_TABS[keyof typeof SIDEBAR_TABS]} SidebarTab */

/** @type {StoryLayout} */
export const DEFAULT_LAYOUT = Object.freeze({
  sidebar: true,
  editor: true,
  chat: true,
  sidebarTab: SIDEBAR_TABS.OUTLINE,
})

/**
 * The arrangement with no project open: no sidebar, since every list in it is
 * a project's, and room to say so. Nothing here is the writer's to change
 * until a project is.
 * @type {StoryLayout}
 */
export const NO_PROJECT_LAYOUT = Object.freeze({
  sidebar: false,
  editor: true,
  chat: false,
  sidebarTab: SIDEBAR_TABS.OUTLINE,
})

/** The panels whose content the writer is working in, as opposed to picking from. */
const CONTENT_PANELS = [PANELS.EDITOR, PANELS.CHAT]

/**
 * A stored layout, or anything else, made whole. Missing fields take the
 * default, and a record that shows neither content panel gets the editor back,
 * so nothing that was saved can open onto an empty screen.
 *
 * @param {Partial<StoryLayout>|null|undefined} stored
 * @returns {StoryLayout}
 */
export function normalizeLayout(stored) {
  const layout = {
    sidebar: typeof stored?.sidebar === 'boolean' ? stored.sidebar : DEFAULT_LAYOUT.sidebar,
    editor: typeof stored?.editor === 'boolean' ? stored.editor : DEFAULT_LAYOUT.editor,
    chat: typeof stored?.chat === 'boolean' ? stored.chat : DEFAULT_LAYOUT.chat,
    sidebarTab: isSidebarTab(stored?.sidebarTab) ? stored.sidebarTab : SIDEBAR_TABS.OUTLINE,
  }
  if (!layout.editor && !layout.chat) layout.editor = true
  return layout
}

/**
 * @param {unknown} value
 * @returns {value is SidebarTab}
 */
function isSidebarTab(value) {
  return Object.values(SIDEBAR_TABS).includes(/** @type {SidebarTab} */ (value))
}

/**
 * The layout after a list is picked on the rail. Picking a list is asking to
 * see it, so the sidebar shows on it — unless it is the list already showing,
 * in which case the writer is asking for it to go: the sidebar hides, on that
 * list, so the next pick brings it straight back.
 *
 * @param {StoryLayout} layout
 * @param {SidebarTab} tab
 * @returns {StoryLayout}
 */
export function selectSidebarTab(layout, tab) {
  if (layout.sidebar && layout.sidebarTab === tab) return { ...layout, sidebar: false }
  return { ...layout, sidebarTab: tab, sidebar: true }
}

/**
 * Whether the panel can be hidden right now. The editor and the chat are never
 * both hidden: the last one showing stays.
 *
 * @param {StoryLayout} layout
 * @param {Panel} panel
 * @returns {boolean}
 */
export function canHide(layout, panel) {
  if (!CONTENT_PANELS.includes(panel)) return true
  return CONTENT_PANELS.some(other => other !== panel && layout[other])
}

/**
 * The layout with one panel shown or hidden.
 *
 * Hiding a content panel while the sidebar is on its list moves the sidebar to
 * the other's — the chats when the editor goes, the outline when the chat
 * does — since that is what the writer is about to look for. Any other list,
 * and showing a panel, leave the tab where it is. A toggle that would hide the
 * last content panel changes nothing.
 *
 * @param {StoryLayout} layout
 * @param {Panel} panel
 * @returns {StoryLayout}
 */
export function togglePanel(layout, panel) {
  const showing = layout[panel]
  if (showing && !canHide(layout, panel)) return layout

  const next = { ...layout, [panel]: !showing }
  if (showing && panel === PANELS.EDITOR && layout.sidebarTab === SIDEBAR_TABS.OUTLINE) {
    next.sidebarTab = SIDEBAR_TABS.CHATS
  }
  if (showing && panel === PANELS.CHAT && layout.sidebarTab === SIDEBAR_TABS.CHATS) {
    next.sidebarTab = SIDEBAR_TABS.OUTLINE
  }
  return next
}

/**
 * Starting widths, as percentages, for the sidebar against the content and,
 * within the content, for the editor against the chat. A panel hidden leaves
 * the whole of its splitter to the other and comes back to the split as it
 * was; the splitter remembers what the writer drags it to, so these matter
 * only the first time.
 */
export const ROW_SIZES = Object.freeze({ sidebar: 20, content: 80 })
export const CONTENT_SIZES = Object.freeze({ editor: 62, chat: 38 })
