/**
 * @module utils/tabs
 * @description The editor's tabs: which documents are open, in strip order,
 * which is showing, and which is only being looked at. Kept on the story as
 * `openDocumentIds`, `lastDocumentId` and `previewDocumentId`, so a project
 * reopens with the documents it was left on. The rules are here, as pure
 * functions over the set; `tabsOf` reads it off a story and `tabsPatch`
 * writes it back.
 *
 * A document opened from the outline is a preview: it takes the preview tab,
 * if there is one, rather than adding another, so looking through the
 * outline leaves one tab behind rather than a strip of them. The tab stays
 * once the writer keeps it — types in it, or double-clicks it — and is then
 * like any other.
 */

/**
 * @typedef {Object} Tabs
 * @property {string[]} open - Document ids in strip order
 * @property {string|null} active - The one showing; null with nothing open
 * @property {string|null} preview - The one only being looked at, which the
 *   next preview replaces; null when every tab is kept
 */

/** @type {Tabs} */
export const NO_TABS = Object.freeze({ open: [], active: null, preview: null })

/**
 * Whether the active and preview tabs are among the open ones. The set is
 * inconsistent otherwise, and something showing that is not open is
 * repaired to the first tab, or to nothing; a preview that is not open is
 * no preview.
 *
 * @param {string[]} open
 * @param {string|null} active
 * @param {string|null} [preview]
 * @returns {Tabs}
 */
const settled = (open, active, preview = null) => ({
  open,
  active: active && open.includes(active) ? active : (open[0] ?? null),
  preview: preview && open.includes(preview) ? preview : null,
})

/**
 * The tabs a story record describes. A story from before tabs has no
 * `openDocumentIds`; it opens with one tab, its last document. A story with
 * the field but nothing in it was closed down to nothing on purpose. One
 * from before previews has every tab kept.
 *
 * @param {{ openDocumentIds?: string[], lastDocumentId?: string|null, previewDocumentId?: string|null }|null|undefined} story
 * @returns {Tabs}
 */
export function tabsOf(story) {
  const active = story?.lastDocumentId ?? null
  const open = Array.isArray(story?.openDocumentIds)
    ? story.openDocumentIds
    : active
      ? [active]
      : []
  return settled([...new Set(open)], active, story?.previewDocumentId ?? null)
}

/**
 * The story fields a set of tabs is written to.
 *
 * @param {Tabs} tabs
 * @returns {{ openDocumentIds: string[], lastDocumentId: string|null, previewDocumentId: string|null }}
 */
export function tabsPatch(tabs) {
  return {
    openDocumentIds: [...tabs.open],
    lastDocumentId: tabs.active,
    previewDocumentId: tabs.preview,
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
 * the strip — unless it is a preview and there is one already, in which case
 * it takes that tab's place.
 *
 * @param {Tabs} tabs
 * @param {string} id
 * @param {{ preview?: boolean }} [options]
 * @returns {Tabs}
 */
export function openTab(tabs, id, { preview = false } = {}) {
  if (tabs.open.includes(id)) return tabs.active === id ? tabs : { ...tabs, active: id }
  if (!preview) return { ...tabs, open: [...tabs.open, id], active: id }
  const open = tabs.preview
    ? tabs.open.map(other => (other === tabs.preview ? id : other))
    : [...tabs.open, id]
  return { open, active: id, preview: id }
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
 * The tabs with one closed. Closing the one showing brings its neighbour to
 * the front — the one to its right, else the one to its left — and closing
 * the last leaves nothing showing. Closing one that is not showing changes
 * nothing else.
 *
 * @param {Tabs} tabs
 * @param {string} id
 * @returns {Tabs}
 */
export function closeTab(tabs, id) {
  const at = tabs.open.indexOf(id)
  if (at === -1) return tabs
  const open = tabs.open.filter(other => other !== id)
  const preview = tabs.preview === id ? null : tabs.preview
  if (tabs.active !== id) return { open, active: tabs.active, preview }
  return { open, active: open[at] ?? open[at - 1] ?? null, preview }
}

/**
 * The tabs with several closed at once, for the documents a deletion took.
 * Each goes as a close does, so the tab left showing is the nearest survivor
 * to the right of the one that was, else to its left.
 *
 * @param {Tabs} tabs
 * @param {string[]} ids
 * @returns {Tabs}
 */
export function dropTabs(tabs, ids) {
  return ids.reduce(closeTab, tabs)
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
