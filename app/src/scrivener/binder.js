/* global DOMParser */
/**
 * @module scrivener/binder
 * @description A Scrivener project's binder, and the names of its styles.
 *
 * The binder is the `.scrivx` file at the top of the project: XML, each item
 * a `BinderItem` with its id, its type, its title and the items under it. An
 * item's own files are kept under `Files/Data/<id>/`, which is how the rest of
 * the import finds its text. The Trash is left out here, so nothing after this
 * sees it.
 *
 * The styles are `Files/styles.xml`, each with an id and a name. A text lists
 * the ids of the styles it uses, and its markers number them in that order.
 */

/**
 * An item in the binder.
 *
 * @typedef {Object} BinderItem
 * @property {string} id - Its UUID, which names the folder its files are in
 * @property {string} type - Scrivener's own: `DraftFolder`, `ResearchFolder`,
 *   `Folder`, `Text`, `PDF`, `Image`, …
 * @property {string} title - As written; empty for an untitled item
 * @property {string} [extension] - A file's, from the item's metadata
 * @property {BinderItem[]} children
 */

/** The binder's items that are folders whatever is in them. */
export const FOLDER_TYPES = new Set(['DraftFolder', 'ResearchFolder', 'Folder'])

/**
 * Read XML, saying plainly when it cannot be.
 *
 * @param {string} xml
 * @param {string} what - What it is, for the error
 * @returns {Document}
 */
function parse(xml, what) {
  // A style keeps its look as RTF in a CDATA section. The same text escaped
  // reads the same, and happy-dom, which the tests and the harness run in,
  // cannot read CDATA.
  const escaped = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, text) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  )
  const document = new DOMParser().parseFromString(escaped, 'application/xml')
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`The project's ${what} could not be read.`)
  }
  return document
}

/**
 * An element's children with a name, in order.
 *
 * @param {Element} element
 * @param {string} name
 * @returns {Element[]}
 */
const childrenNamed = (element, name) =>
  Array.from(element.children).filter(child => child.localName === name)

/**
 * @param {Element} element
 * @param {string} name
 * @returns {string|undefined}
 */
const childText = (element, name) => childrenNamed(element, name)[0]?.textContent ?? undefined

/**
 * @param {Element} element - A `BinderItem`
 * @returns {BinderItem}
 */
function itemOf(element) {
  const metadata = childrenNamed(element, 'MetaData')[0]
  const extension = metadata ? childText(metadata, 'FileExtension')?.trim() : undefined
  const children = childrenNamed(element, 'Children')[0]
  return {
    id: element.getAttribute('UUID') || '',
    type: element.getAttribute('Type') || '',
    title: childText(element, 'Title') ?? '',
    ...(extension ? { extension } : {}),
    children: children ? itemsOf(children) : [],
  }
}

/**
 * @param {Element} element - The binder, or an item's `Children`
 * @returns {BinderItem[]}
 */
const itemsOf = element =>
  childrenNamed(element, 'BinderItem')
    .filter(child => child.getAttribute('Type') !== 'TrashFolder')
    .map(itemOf)

/**
 * The binder, from the project's `.scrivx`, without the Trash.
 *
 * @param {string} xml
 * @returns {BinderItem[]}
 * @throws {Error} When it is not XML, or has no binder
 */
export function readBinder(xml) {
  const binder = parse(xml, 'binder').getElementsByTagName('Binder')[0]
  if (!binder) throw new Error("The project's binder could not be read.")
  return itemsOf(binder)
}

/**
 * The project's styles' names by their ids, from `Files/styles.xml`.
 *
 * @param {string} xml
 * @returns {Map<string, string>}
 */
export function readStyles(xml) {
  /** @type {Map<string, string>} */
  const names = new Map()
  for (const style of Array.from(parse(xml, 'styles').getElementsByTagName('Style'))) {
    const id = style.getAttribute('ID')
    const name = style.getAttribute('Name')
    if (id && name) names.set(id, name)
  }
  return names
}
