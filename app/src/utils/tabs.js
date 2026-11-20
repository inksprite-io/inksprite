/**
 * @module utils/tabs
 * @description A panel's tabs: which documents are open in the editor, or
 * which chats in the chat panel, in strip order, which is showing, which is
 * only being looked at, and the order they were shown in. Kept in the
 * project's view, the editor's as `openDocumentIds`, `lastDocumentId`,
 * `previewDocumentId`, `shownDocumentIds` and `closedDocumentIds` and the
 * chat panel's under the same names for chats, so a project reopens with
 * what it was left on. The
 * rules are here, as pure functions over the set, the same for both panels;
 * `tabsOf` reads it off a view and `tabsPatch` writes it back.
 *
 * A document opened from the outline is a preview: it takes the preview tab,
 * if there is one, rather than adding another, so looking through the
 * outline leaves one tab behind rather than a strip of them. The tab stays
 * once the writer keeps it — types in it, or double-clicks it — and is then
 * like any other.
 *
 * Closing the tab showing goes back to the one shown before it, and closing
 * that to the one before, down the whole history: a document opened to look
 * something up and closed again leaves the writer where they were. Only past
 * the history, as for tabs from before it was kept, does a neighbour come
 * forward.
 *
 * A tab the writer closes is remembered, the last few of them, so that the
 * one closed last can be brought back, and the one before it after that. One
 * opened again by any other way is no longer among them, and one that went
 * because its document was deleted never was.
 */

/**
 * @typedef {Object} Tabs
 * @property {string[]} open - Document ids in strip order
 * @property {string|null} active - The one showing; null with nothing open
 * @property {string|null} preview - The one only being looked at, which the
 *   next preview replaces; null when every tab is kept
 * @property {string[]} shown - Open ids, the one showing first and then the
 *   others as they were shown before it, most recent first: where closing
 *   goes back to. A tab not shown since the history was kept is not in it.
 * @property {string[]} closed - Ids the writer closed and has not opened
 *   since, the one closed last first: what reopening brings back
 */

/** @type {Tabs} */
export const NO_TABS = Object.freeze({
  open: [],
  active: null,
  preview: null,
  shown: [],
  closed: [],
})

/** How many closed tabs are remembered. */
const CLOSED_KEPT = 20

/**
 * The fields of a project's view a panel's tabs are kept in.
 *
 * @typedef {Object} TabFields
 * @property {string} open
 * @property {string} active
 * @property {string} preview
 * @property {string} shown
 * @property {string} closed
 */

/** The editor's. @type {TabFields} */
export const DOCUMENT_TABS = Object.freeze({
  open: 'openDocumentIds',
  active: 'lastDocumentId',
  preview: 'previewDocumentId',
  shown: 'shownDocumentIds',
  closed: 'closedDocumentIds',
})

/** The chat panel's. @type {TabFields} */
export const CHAT_TABS = Object.freeze({
  open: 'openChatIds',
  active: 'lastChatId',
  preview: 'previewChatId',
  shown: 'shownChatIds',
  closed: 'closedChatIds',
})

/**
 * The history with a tab put at its head, as the one showing now.
 *
 * @param {string[]} shown
 * @param {string} id
 * @returns {string[]}
 */
const showing = (shown, id) => [id, ...shown.filter(other => other !== id)]

/**
 * Whether the active and preview tabs are among the open ones, and the
 * history only open tabs, headed by the one showing. The set is inconsistent
 * otherwise, and something showing that is not open is repaired to the first
 * tab, or to nothing; a preview that is not open is no preview; and a tab
 * that is open is not a closed one.
 *
 * @param {string[]} open
 * @param {string|null} active
 * @param {string|null} [preview]
 * @param {string[]} [shown]
 * @param {string[]} [closed]
 * @returns {Tabs}
 */
const settled = (open, active, preview = null, shown = [], closed = []) => {
  const showingNow = active && open.includes(active) ? active : (open[0] ?? null)
  const history = [...new Set(shown)].filter(id => open.includes(id))
  return {
    open,
    active: showingNow,
    preview: preview && open.includes(preview) ? preview : null,
    shown: showingNow ? showing(history, showingNow) : [],
    closed: [...new Set(closed)].filter(id => !open.includes(id)).slice(0, CLOSED_KEPT),
  }
}

/**
 * The tabs a project's view describes. One from before tabs has no list of
 * what is open; it opens with one tab, the last one shown. One with the list
 * but nothing in it was closed down to nothing on purpose. One from before
 * previews has every tab kept, one from before the history was kept knows
 * only the tab showing, and one from before closed tabs were remembered has
 * none to bring back.
 *
 * @param {Record<string, any>|null|undefined} view
 * @param {TabFields} [fields] - Which panel's: the editor's unless given
 * @returns {Tabs}
 */
export function tabsOf(view, fields = DOCUMENT_TABS) {
  const active = view?.[fields.active] ?? null
  const open = Array.isArray(view?.[fields.open]) ? view[fields.open] : active ? [active] : []
  const shown = Array.isArray(view?.[fields.shown]) ? view[fields.shown] : []
  const closed = Array.isArray(view?.[fields.closed]) ? view[fields.closed] : []
  return settled([...new Set(open)], active, view?.[fields.preview] ?? null, shown, closed)
}

/**
 * The view's fields a set of tabs is written to.
 *
 * @param {Tabs} tabs
 * @param {TabFields} [fields] - Which panel's: the editor's unless given
 * @returns {Record<string, string[]|string|null>}
 */
export function tabsPatch(tabs, fields = DOCUMENT_TABS) {
  return {
    [fields.open]: [...tabs.open],
    [fields.active]: tabs.active,
    [fields.preview]: tabs.preview,
    [fields.shown]: [...tabs.shown],
    [fields.closed]: [...tabs.closed],
  }
}

/**
 * The tabs with any that can no longer be shown dropped: a document deleted
 * since, or one that was never a text document. What is left keeps its
 * order; a dropped active tab gives way as a close does.
 *
 * @param {Tabs} tabs
 * @param {(id: string) => boolean} canShow - Whether a document is there to open
 * @returns {Tabs}
 */
export function normalizeTabs(tabs, canShow) {
  return dropTabs(
    tabs,
    tabs.open.filter(id => !canShow(id))
  )
}

/**
 * The tabs with a document open and showing. One already open is brought to
 * the front where it is, kept or not as it was. A new one goes at the end of
 * the strip, or beside the tab showing when asked — unless it is a preview
 * and there is one already, in which case it takes that tab's place, and the
 * place in the history of the document it replaces, which is no longer open.
 * The document a preview replaces was only being looked at, and is not
 * remembered as closed.
 *
 * @param {Tabs} tabs
 * @param {string} id
 * @param {{ preview?: boolean, beside?: boolean }} [options] - `beside` for a
 *   tab opened from the one showing, such as a fork, which sits next to it
 * @returns {Tabs}
 */
export function openTab(tabs, id, { preview = false, beside = false } = {}) {
  if (tabs.open.includes(id)) {
    return tabs.active === id ? tabs : { ...tabs, active: id, shown: showing(tabs.shown, id) }
  }
  const closed = tabs.closed.filter(other => other !== id)
  if (!preview) {
    const at = beside && tabs.active ? tabs.open.indexOf(tabs.active) + 1 : tabs.open.length
    const open = [...tabs.open.slice(0, at), id, ...tabs.open.slice(at)]
    return { ...tabs, open, active: id, shown: showing(tabs.shown, id), closed }
  }
  const replaced = tabs.preview
  const open = replaced
    ? tabs.open.map(other => (other === replaced ? id : other))
    : [...tabs.open, id]
  const shown = showing(
    tabs.shown.filter(other => other !== replaced),
    id
  )
  return { open, active: id, preview: id, shown, closed }
}

/**
 * The tabs with one kept: no longer a preview, so the next preview goes
 * elsewhere. Any other tab is kept already.
 *
 * @param {Tabs} tabs
 * @param {string} id
 * @returns {Tabs}
 */
export function keepTab(tabs, id) {
  return tabs.preview === id ? { ...tabs, preview: null } : tabs
}

/**
 * The tabs with one gone from the strip. The one showing gives way to the
 * one shown before it; past the history, to its neighbour, the one to its
 * right, else the one to its left; and the last going leaves nothing
 * showing. One that is not showing changes nothing else, but that it is gone
 * from the history.
 *
 * @param {Tabs} tabs
 * @param {string} id
 * @param {boolean} remember - Whether it is the tab closed last, for
 *   reopening: one the writer closed, rather than one whose document went
 * @returns {Tabs}
 */
function without(tabs, id, remember) {
  const at = tabs.open.indexOf(id)
  if (at === -1) return tabs
  const open = tabs.open.filter(other => other !== id)
  const preview = tabs.preview === id ? null : tabs.preview
  const shown = tabs.shown.filter(other => other !== id)
  const closed = remember
    ? [id, ...tabs.closed.filter(other => other !== id)].slice(0, CLOSED_KEPT)
    : tabs.closed
  if (tabs.active !== id) return { open, active: tabs.active, preview, shown, closed }
  const active = shown[0] ?? open[at] ?? open[at - 1] ?? null
  return { open, active, preview, shown: active ? showing(shown, active) : [], closed }
}

/**
 * The tabs with one closed by the writer. Closing the one showing brings
 * back the one shown before it; past the history, its neighbour, the one to
 * its right, else the one to its left; and closing the last leaves nothing
 * showing. Closing one that is not showing changes nothing else, but that it
 * is gone from the history. Either way it is the tab closed last, for
 * reopening.
 *
 * @param {Tabs} tabs
 * @param {string} id
 * @returns {Tabs}
 */
export function closeTab(tabs, id) {
  return without(tabs, id, true)
}

/**
 * The tabs with several closed by the writer at once, as Close others does,
 * each remembered as a close is.
 *
 * @param {Tabs} tabs
 * @param {string[]} ids
 * @returns {Tabs}
 */
export function closeTabs(tabs, ids) {
  return ids.reduce(closeTab, tabs)
}

/**
 * The tabs with several dropped at once, for the documents a deletion took.
 * Each goes as a close does, so the tab left showing is the latest shown of
 * those that survive, else the nearest survivor to the right of the one that
 * was, else to its left. None is remembered as closed: there is nothing of
 * it to open again.
 *
 * @param {Tabs} tabs
 * @param {string[]} ids
 * @returns {Tabs}
 */
export function dropTabs(tabs, ids) {
  return ids.reduce((left, id) => without(left, id, false), tabs)
}

/**
 * The tab closed last that can still be shown: what reopening brings back.
 * One whose document has been deleted since is passed over for the one
 * closed before it.
 *
 * @param {Tabs} tabs
 * @param {(id: string) => boolean} canShow - Whether a document is there to open
 * @returns {string|null} Null with none to bring back
 */
export function lastClosed(tabs, canShow) {
  return tabs.closed.find(canShow) ?? null
}

/**
 * The tab a step along the strip from the one showing, round its ends: the
 * next one, or the one before.
 *
 * @param {Tabs} tabs
 * @param {1|-1} step
 * @returns {string|null} Null with no other tab to go to
 */
export function tabBeside(tabs, step) {
  const count = tabs.open.length
  const at = tabs.active ? tabs.open.indexOf(tabs.active) : -1
  if (at === -1 || count < 2) return null
  return tabs.open[(at + step + count) % count]
}

/**
 * The tab at a place in the strip, counted from 1 as its keys are; 9 is the
 * last tab however many there are, as it is in a browser.
 *
 * @param {Tabs} tabs
 * @param {number} place - 1 to 9
 * @returns {string|null} Null with no tab there
 */
export function tabAt(tabs, place) {
  if (place === 9) return tabs.open.at(-1) ?? null
  return tabs.open[place - 1] ?? null
}

/**
 * What to call each tab: its title, and as much of the path above it as
 * tells it apart from another open tab of the same title — `bar/a` and
 * `baz/a`, or `foo/bar/a` and `qux/bar/a` — and none where the title alone
 * does. Two documents of the same title in the same folder cannot be told
 * apart by path, and show all of it.
 *
 * @param {string[][]} paths - Each tab's titles from the top down, its own last
 * @returns {{ prefix: string, title: string }[]} The path shown above each
 *   title, ending in `/`, or '' for none
 */
export function tabNames(paths) {
  /**
   * The last `n` titles of a path, as one key.
   * @param {string[]} path
   * @param {number} n
   */
  const tail = (path, n) => path.slice(-n).join('\u0000')

  return paths.map((path, at) => {
    const rivals = paths.filter((other, i) => i !== at && tail(other, 1) === tail(path, 1))
    let n = 1
    while (n < path.length && rivals.some(other => tail(other, n) === tail(path, n))) n++
    const shown = path.slice(-n, -1)
    return {
      prefix: shown.length > 0 ? `${shown.join('/')}/` : '',
      title: path[path.length - 1] ?? '',
    }
  })
}
