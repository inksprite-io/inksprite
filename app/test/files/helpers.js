/* global TextEncoder */
import { strToU8, zipSync } from 'fflate'

/**
 * A PDF built by hand: one page per entry, one line of Helvetica per string.
 * Enough of the format for pdf.js to open it, with a correct cross-reference
 * table so nothing has to be reconstructed.
 *
 * @param {string[][]} pages
 * @returns {Uint8Array}
 */
export const minimalPdf = pages => {
  /** @type {string[]} */
  const objects = []
  const add = (/** @type {string} */ body) => objects.push(body)
  add('<< /Type /Catalog /Pages 2 0 R >>')
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  for (const lines of pages) {
    const n = objects.length + 1
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${n + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`
    )
    const stream =
      'BT /F1 12 Tf 72 712 Td 14 TL ' + lines.map(line => `(${line}) Tj T*`).join(' ') + ' ET'
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }
  let out = '%PDF-1.4\n'
  /** @type {number[]} */
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

/** The eight bytes every PNG opens with. */
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A PNG with nothing in it but its signature and an end chunk: a picture, not a card. */
export const barePng = () =>
  new Uint8Array([...PNG_SIGNATURE, 0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0])

/**
 * A table of contents entry for `minimalEpub`: the page it points to (an
 * index into the pages), an anchor in it, and the entries under it.
 *
 * @typedef {{title: string, page: number, anchor?: string, children?: TocSpec[]}} TocSpec
 */

/**
 * An epub built by hand: a container, a package, a table of contents, and one
 * XHTML page per entry in `pages`, zipped. EPUB 3 with a nav page by default,
 * or EPUB 2 with an NCX.
 *
 * @param {string[]} pages - Each page's XHTML body, in spine order
 * @param {Object} [options]
 * @param {TocSpec[]} [options.toc] - Entries; none by default
 * @param {'nav'|'ncx'} [options.format]
 * @param {string} [options.title] - The book's own title
 * @param {Record<string, string>} [options.extra] - More files, by path
 * @returns {Uint8Array}
 */
export const minimalEpub = (
  pages,
  { toc = [], format = 'nav', title = 'A Book', extra = {} } = {}
) => {
  const page = (/** @type {string} */ body) =>
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml">` +
    `<head><title>x</title><link rel="stylesheet" href="../style.css"/></head><body>${body}</body></html>`
  const href = (/** @type {TocSpec} */ entry) =>
    `Text/page%20${entry.page + 1}.xhtml${entry.anchor ? `#${entry.anchor}` : ''}`
  /** @type {Record<string, Uint8Array>} */
  const files = {}
  const put = (/** @type {string} */ path, /** @type {string} */ text) => {
    files[path] = strToU8(text)
  }
  put('mimetype', 'application/epub+zip')
  put(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
      `<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
  )
  const items = pages
    .map(
      (_, i) =>
        `<item id="p${i + 1}" href="Text/page%20${i + 1}.xhtml" media-type="application/xhtml+xml"/>`
    )
    .join('')
  const refs = pages.map((_, i) => `<itemref idref="p${i + 1}"/>`).join('')
  const tocItem =
    format === 'nav'
      ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
      : '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
  put(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">` +
      `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata>` +
      `<manifest>${tocItem}${items}</manifest><spine${format === 'ncx' ? ' toc="ncx"' : ''}>${refs}</spine></package>`
  )
  if (format === 'nav') {
    /** @param {TocSpec[]} entries @returns {string} */
    const list = entries =>
      `<ol>${entries
        .map(
          entry =>
            `<li><a href="${href(entry)}">${entry.title}</a>${entry.children ? list(entry.children) : ''}</li>`
        )
        .join('')}</ol>`
    put(
      'OEBPS/nav.xhtml',
      page(
        `<nav epub:type="landmarks"><ol><li><a href="Text/page%202.xhtml">Start</a></li></ol></nav>` +
          `<nav epub:type="toc" id="toc">${list(toc)}</nav>`
      )
    )
  } else {
    /** @param {TocSpec[]} entries @returns {string} */
    const points = entries =>
      entries
        .map(
          entry =>
            `<navPoint><navLabel><text>${entry.title}</text></navLabel><content src="${href(entry)}"/>` +
            `${entry.children ? points(entry.children) : ''}</navPoint>`
        )
        .join('')
    put(
      'OEBPS/toc.ncx',
      `<?xml version="1.0"?><ncx><docTitle><text>${title}</text></docTitle><navMap>${points(toc)}</navMap></ncx>`
    )
  }
  pages.forEach((body, i) => put(`OEBPS/Text/page ${i + 1}.xhtml`, page(body)))
  for (const [path, text] of Object.entries(extra)) put(path, text)
  return zipSync(files)
}

/** The namespaces a Word file's parts are written in. */
const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships'

/**
 * A Word file built by hand: the body given as WordprocessingML, with the
 * parts it can call on — numbering for a bulleted list (`numId` 1) and a
 * numbered one (`numId` 2), the links and pictures given by relationship id.
 * Headings are by style id (`Heading1`), as Word writes them.
 *
 * @param {string} body - What goes inside `<w:body>`
 * @param {Object} [options]
 * @param {Record<string, string>} [options.links] - Link targets, by relationship id
 * @param {Record<string, Uint8Array>} [options.images] - PNGs, by relationship id
 * @param {Record<string, string>} [options.footnotes] - Each footnote's text, by its id
 * @returns {Uint8Array}
 */
export const minimalDocx = (body, { links = {}, images = {}, footnotes = {} } = {}) => {
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  const rel = (
    /** @type {string} */ id,
    /** @type {string} */ type,
    /** @type {string} */ target,
    external = false
  ) =>
    `<Relationship Id="${id}" Type="${RELATIONSHIPS}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`
  const level = (/** @type {string} */ format) =>
    `<w:lvl w:ilvl="0"><w:numFmt w:val="${format}"/><w:lvlText w:val="${format === 'bullet' ? '•' : '%1.'}"/></w:lvl>`
  /** @type {Record<string, Uint8Array>} */
  const files = {
    '[Content_Types].xml': strToU8(
      `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `${xml}<Relationships xmlns="${PACKAGE}">${rel('rId1', 'officeDocument', 'word/document.xml')}</Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `${xml}<Relationships xmlns="${PACKAGE}">` +
        rel('rNumbering', 'numbering', 'numbering.xml') +
        rel('rFootnotes', 'footnotes', 'footnotes.xml') +
        Object.entries(links)
          .map(([id, url]) => rel(id, 'hyperlink', url, true))
          .join('') +
        Object.keys(images)
          .map(id => rel(id, 'image', `media/${id}.png`))
          .join('') +
        '</Relationships>'
    ),
    'word/numbering.xml': strToU8(
      `${xml}<w:numbering xmlns:w="${WORD}">` +
        `<w:abstractNum w:abstractNumId="0">${level('bullet')}</w:abstractNum>` +
        `<w:abstractNum w:abstractNumId="1">${level('decimal')}</w:abstractNum>` +
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
        '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
        '</w:numbering>'
    ),
    'word/document.xml': strToU8(
      `${xml}<w:document xmlns:w="${WORD}" xmlns:r="${RELATIONSHIPS}" ` +
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
        'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        `<w:body>${body}</w:body></w:document>`
    ),
  }
  files['word/footnotes.xml'] = strToU8(
    `${xml}<w:footnotes xmlns:w="${WORD}">` +
      Object.entries(footnotes)
        .map(
          ([id, text]) =>
            `<w:footnote w:id="${id}"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:footnote>`
        )
        .join('') +
      '</w:footnotes>'
  )
  for (const [id, bytes] of Object.entries(images)) files[`word/media/${id}.png`] = bytes
  return zipSync(files)
}
