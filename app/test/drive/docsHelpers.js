/**
 * Google Docs in the shape `documents.get` returns them, made up for tests,
 * their indices counted as the Docs API counts them: a section break at 0,
 * a paragraph's newline at its end, and one index each for a table's start,
 * each row's and each cell's start, and the table's end. A footnote is
 * counted from 0 on its own. An index of 0 is left out, as the API leaves
 * out every zero.
 */

/**
 * A run of text in a paragraph.
 *
 * @param {string} content
 * @param {object} [textStyle]
 * @param {object} [extra] - Suggestion ids and the like
 */
export const run = (content, textStyle = {}, extra = {}) => ({
  textRun: { content, textStyle, ...extra },
})

/**
 * Anything else in a paragraph: a chip, a picture, a break. One index wide.
 *
 * @param {string} kind - `person`, `inlineObjectElement`, `pageBreak`, …
 * @param {object} [props]
 */
export const inline = (kind, props = {}) => ({ [kind]: { textStyle: {}, ...props } })

/**
 * A paragraph, from its text or its elements. Its newline is added to its
 * last run, or as a run of its own after anything else.
 *
 * @param {string|object[]} elements
 * @param {{style?: object, bullet?: object, positionedObjectIds?: string[]}} [options]
 */
export const para = (elements, { style = {}, ...rest } = {}) => ({
  paragraph: {
    elements: typeof elements === 'string' ? [run(elements)] : elements,
    paragraphStyle: { namedStyleType: 'NORMAL_TEXT', ...style },
    ...rest,
  },
})

/**
 * @param {string} named - `HEADING_1`, `TITLE`, …
 * @param {string|object[]} elements
 */
export const styled = (named, elements) => para(elements, { style: { namedStyleType: named } })

/**
 * A list's paragraph.
 *
 * @param {string|object[]} elements
 * @param {string} listId
 * @param {number} [nestingLevel]
 */
export const item = (elements, listId, nestingLevel = 0) =>
  para(elements, { bullet: { listId, ...(nestingLevel && { nestingLevel }) } })

/**
 * A table, by its rows of cells, each cell its paragraphs or its text.
 *
 * @param {Array<Array<string|object[]>>} rows
 */
export const table = rows => ({
  table: {
    rows: rows.length,
    columns: Math.max(...rows.map(row => row.length)),
    tableRows: rows.map(row => ({
      tableCells: row.map(cell => ({
        content: typeof cell === 'string' ? [para(cell)] : cell,
      })),
    })),
  },
})

/** A list whose levels are numbered, the first from `startNumber`. */
export const numbered = (startNumber = 1) => ({
  listProperties: {
    nestingLevels: [
      { glyphType: 'DECIMAL', startNumber },
      { glyphType: 'ALPHA', startNumber: 1 },
      { glyphType: 'ROMAN', startNumber: 1 },
    ],
  },
})

/** A list whose levels are bulleted. */
export const bulleted = () => ({
  listProperties: {
    nestingLevels: [{ glyphSymbol: '●' }, { glyphSymbol: '○' }, { glyphSymbol: '■' }],
  },
})

/**
 * Index the elements of a body or a footnote from `start`.
 *
 * @param {object[]} blocks
 * @param {number} start
 * @returns {{content: object[], end: number}}
 */
function indexBlocks(blocks, start) {
  let at = start
  const at0 = (/** @type {number} */ index) => (index === 0 ? {} : { startIndex: index })
  const content = blocks.map(block => {
    if (block.paragraph) {
      const from = at
      const elements = block.paragraph.elements.map(element => ({ ...element }))
      const last = elements.at(-1)
      if (last?.textRun) last.textRun = { ...last.textRun, content: `${last.textRun.content}\n` }
      else elements.push(run('\n'))
      const indexed = elements.map(element => {
        const size = element.textRun ? element.textRun.content.length : 1
        const out = { ...at0(at), endIndex: at + size, ...element }
        at += size
        return out
      })
      return { ...at0(from), endIndex: at, paragraph: { ...block.paragraph, elements: indexed } }
    }
    if (block.table) {
      const from = at
      at++
      const tableRows = block.table.tableRows.map(row => {
        const rowFrom = at
        at++
        const tableCells = row.tableCells.map(cell => {
          const cellFrom = at
          at++
          const inner = indexBlocks(cell.content, at)
          at = inner.end
          return { startIndex: cellFrom, endIndex: at, content: inner.content }
        })
        return { startIndex: rowFrom, endIndex: at, tableCells }
      })
      at++
      return { startIndex: from, endIndex: at, table: { ...block.table, tableRows } }
    }
    // A section break, a table of contents: one index, or as many as given.
    const size = block.size ?? 1
    const { size: _size, ...rest } = block
    const out = { ...at0(at), endIndex: at + size, ...rest }
    at += size
    return out
  })
  return { content, end: at }
}

/**
 * A Doc of one tab, read with its tabs.
 *
 * @param {object[]} blocks - The body, after its opening section break
 * @param {Object} [options]
 * @param {Record<string, object[]>} [options.footnotes] - Each footnote's paragraphs, by id
 * @param {Record<string, object>} [options.lists]
 * @param {object[]} [options.namedStyles]
 * @param {Record<string, {uri?: string, alt?: string}>} [options.pictures] - The
 *   inline objects, by id: a picture with the address it is fetched from, or
 *   with none a drawing
 * @returns {import('@/drive/docsTypes.js').Document}
 */
export function docOf(blocks, { footnotes = {}, lists = {}, namedStyles, pictures = {} } = {}) {
  const body = indexBlocks([{ sectionBreak: { sectionStyle: {} } }, ...blocks], 0)
  return {
    documentId: 'doc-1',
    title: 'A Doc',
    revisionId: 'rev-1',
    tabs: [
      {
        tabProperties: { tabId: 't.0', title: 'Tab 1' },
        documentTab: {
          body: { content: body.content },
          footnotes: Object.fromEntries(
            Object.entries(footnotes).map(([id, paragraphs]) => [
              id,
              { footnoteId: id, content: indexBlocks(paragraphs, 0).content },
            ])
          ),
          lists,
          inlineObjects: Object.fromEntries(
            Object.entries(pictures).map(([id, { uri, alt }]) => [
              id,
              {
                objectId: id,
                inlineObjectProperties: {
                  embeddedObject: uri
                    ? { imageProperties: { contentUri: uri }, ...(alt && { description: alt }) }
                    : { embeddedDrawingProperties: {} },
                },
              },
            ])
          ),
          namedStyles: {
            styles: namedStyles ?? [
              {
                namedStyleType: 'NORMAL_TEXT',
                textStyle: { weightedFontFamily: { fontFamily: 'Arial' } },
              },
              { namedStyleType: 'HEADING_1', textStyle: {} },
              { namedStyleType: 'TITLE', textStyle: {} },
            ],
          },
        },
      },
    ],
  }
}

/**
 * What is at each index of a Doc's body and footnotes: a character of text,
 * `inline` for anything else in a paragraph, `structure` for a table's,
 * a row's and a cell's starts and a table's end, `block` for a section break
 * or a table of contents.
 *
 * @param {import('@/drive/docsTypes.js').Document} document
 * @returns {Map<string, Map<number, string>>} By segment: '' for the body,
 *   a footnote's id for its own
 */
export function indicesOf(document) {
  const tab = document.tabs?.[0]?.documentTab ?? {}
  /** @type {Map<string, Map<number, string>>} */
  const out = new Map()
  const walk = (/** @type {any[]} */ content, /** @type {Map<number, string>} */ into) => {
    for (const element of content) {
      if (element.paragraph) {
        for (const part of element.paragraph.elements) {
          const start = part.startIndex ?? 0
          if (part.textRun) {
            // By UTF-16 unit, as the Doc counts: an emoji is two.
            const { content: text } = part.textRun
            for (let i = 0; i < text.length; i++) into.set(start + i, text[i])
          } else {
            into.set(start, 'inline')
          }
        }
      } else if (element.table) {
        into.set(element.startIndex, 'structure')
        for (const row of element.table.tableRows) {
          into.set(row.startIndex, 'structure')
          for (const cell of row.tableCells) {
            into.set(cell.startIndex, 'structure')
            walk(cell.content, into)
          }
        }
        into.set(element.endIndex - 1, 'structure')
      } else {
        for (let i = element.startIndex ?? 0; i < element.endIndex; i++) into.set(i, 'block')
      }
    }
  }
  const body = new Map()
  walk(tab.body?.content ?? [], body)
  out.set('', body)
  for (const [id, footnote] of Object.entries(tab.footnotes ?? {})) {
    const own = new Map()
    walk(footnote.content ?? [], own)
    out.set(id, own)
  }
  return out
}
