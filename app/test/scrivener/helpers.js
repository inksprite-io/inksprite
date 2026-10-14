/* global Blob */
/**
 * Made-up Scrivener projects, in the shape Scrivener 3 on a Mac writes them:
 * RTF from macOS's text system, a `.scrivx` binder, and each item's files
 * under `Files/Data/<id>/`.
 */

/**
 * RTF's `\\u`, for writing inside `String.raw`: the test build reads `\\u` and
 * four digits there as the character, raw or not.
 */
export const U = '\\u'

/** What macOS writes before a text's paragraphs. */
export const HEADER = String.raw`{\rtf1\ansi\ansicpg1252\cocoartf2761
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\froman\fcharset0 Palatino-Roman;\f1\froman\fcharset0 Palatino-Bold;\f2\froman\fcharset0 Palatino-Italic;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
`

/**
 * Two lists: the first bullets, with a second level of dashes; the second
 * numbered.
 */
export const LISTS = String.raw`{\*\listtable{\list\listtemplateid1\listhybrid{\listlevel\levelnfc23\levelnfcn23\leveljc0\leveljcn0\levelfollow0\levelstartat1\levelspace360\levelindent0{\*\levelmarker \{disc\}}{\leveltext\leveltemplateid1\'01\uc0${U}8226 ;}{\levelnumbers;}\fi-360\li720\lin720 }{\listlevel\levelnfc23\levelnfcn23\leveljc0\leveljcn0\levelfollow0\levelstartat1\levelspace360\levelindent0{\*\levelmarker \{hyphen\}}{\leveltext\leveltemplateid2\'01\uc0${U}8259 ;}{\levelnumbers;}\fi-360\li1440\lin1440 }{\listname ;}\listid1}
{\list\listtemplateid2\listhybrid{\listlevel\levelnfc0\levelnfcn0\leveljc0\leveljcn0\levelfollow0\levelstartat1\levelspace360\levelindent0{\*\levelmarker \{decimal\}.}{\leveltext\leveltemplateid101\'02\'00.;}{\levelnumbers\'01;}\fi-360\li720\lin720 }{\listname ;}\listid2}}
{\*\listoverridetable{\listoverride\listid1\listoverridecount0\ls1}{\listoverride\listid2\listoverridecount0\ls2}}
`

/** A paragraph's settings, as `\pard` opens them. */
export const PARAGRAPH = String.raw`\pard\tx560\tx1120\tx1680\tx2240\pardirnatural\partightenfactor0
`

/**
 * A list item's paragraph, its bullet as drawn and all.
 *
 * @param {number} list - Which `\ls`
 * @param {number} level
 * @param {string} text
 * @returns {string}
 */
export const item = (list, level, text) =>
  String.raw`\pard\tx220\tx720\pardeftab720\li720\fi-720\pardirnatural\partightenfactor0
\ls${list}\ilvl${level}\cf0 {\listtext\uc0${U}8226 \tab}${text}\
`

/**
 * A whole text.
 *
 * @param {string} body - Its paragraphs
 * @param {string} [head] - Tables before them, such as `LISTS`
 * @returns {string}
 */
export const rtf = (body, head = '') => `${HEADER}${head}${body}}`

/**
 * A text of plain paragraphs.
 *
 * @param {...string} paragraphs
 * @returns {string}
 */
export const plainRtf = (...paragraphs) =>
  rtf(`${PARAGRAPH}\n\\f0\\fs26 \\cf0 ${paragraphs.join('\\\n')}`)

/**
 * An item in a made-up binder, and its files.
 *
 * @typedef {Object} ItemSpec
 * @property {string} id
 * @property {string} type
 * @property {string} title
 * @property {string} [extension]
 * @property {Record<string, string|Uint8Array>} [files] - By name, in its folder
 * @property {ItemSpec[]} [children]
 */

/**
 * A binder's XML.
 *
 * @param {ItemSpec[]} items
 * @returns {string}
 */
export function scrivx(items) {
  const escape = (/** @type {string} */ text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  /** @param {ItemSpec} spec */
  const itemXml = spec => {
    const metadata = spec.extension
      ? `<MetaData><FileExtension>${spec.extension}</FileExtension></MetaData>`
      : '<MetaData><IncludeInCompile>Yes</IncludeInCompile></MetaData>'
    const children = spec.children?.length
      ? `<Children>${spec.children.map(itemXml).join('')}</Children>`
      : ''
    return (
      `<BinderItem UUID="${spec.id}" Type="${spec.type}" Created="2026-01-02 10:00:00 +0000">` +
      `<Title>${escape(spec.title)}</Title>${metadata}${children}</BinderItem>`
    )
  }
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<ScrivenerProject Identifier="00000000-0000-0000-0000-000000000000" Version="2.0" Creator="SCRMAC-3.3.6-16305">' +
    `<Binder>${items.map(itemXml).join('')}</Binder>` +
    '<LabelSettings><Title>Label</Title></LabelSettings>' +
    '</ScrivenerProject>'
  )
}

/**
 * A project's styles file, each style's look in a CDATA section as Scrivener
 * keeps it.
 *
 * @param {Record<string, string>} styles - Names by id
 * @returns {string}
 */
export const stylesXml = styles =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<Styles>' +
  Object.entries(styles)
    .map(
      ([id, name]) =>
        `<Style Name="${name}" ID="${id}" Type="Para+Char"><Format><![CDATA[${plainRtf('<$ScrKeepWithNext>Attributes')}]]></Format></Style>`
    )
    .join('') +
  '</Styles>'

/**
 * A project's files, by their path inside it, as a package carries them.
 *
 * @param {string} name
 * @param {ItemSpec[]} items
 * @param {Record<string, string>} [styles] - Names by id
 * @returns {import('@/scrivener/package.js').ScrivenerPackage}
 */
export function projectOf(name, items, styles) {
  /** @type {Map<string, Blob>} */
  const files = new Map()
  files.set(`${name}.scrivx`, new Blob([scrivx(items)]))
  files.set('Files/version.txt', new Blob(['23']))
  if (styles) files.set('Files/styles.xml', new Blob([stylesXml(styles)]))
  /** @param {ItemSpec[]} list */
  const add = list => {
    for (const spec of list) {
      for (const [file, content] of Object.entries(spec.files ?? {})) {
        files.set(`Files/Data/${spec.id}/${file}`, new Blob([content]))
      }
      add(spec.children ?? [])
    }
  }
  add(items)
  return { name, files }
}
