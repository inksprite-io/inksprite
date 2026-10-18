/**
 * Random edits to a Doc's document, seeded so a failure can be run again,
 * and the Doc with a little of everything they meet: for the writer's and
 * the sync's tests edited at random.
 */

import { bulleted, docOf, inline, item, para, run, styled, table } from './docsHelpers.js'

const QUOTE = {
  indentStart: { magnitude: 30, unit: 'PT' },
  indentFirstLine: { magnitude: 30, unit: 'PT' },
}

/** A seeded generator, so a failure can be run again. */
export const random = seed => {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}
export const WORDS = ['tide', 'rope', 'gull', 'harbour', 'late', 'grey', 'oar', 'salt', 'pier']

/** A Doc with a little of everything the writer meets. */
export const busy = () =>
  docOf(
    [
      styled('TITLE', 'Harbour Notes'),
      styled('HEADING_1', 'Monday'),
      para([
        run('Rain from the west, '),
        run('hard', { bold: true }),
        run(', then '),
        run('dry', { italic: true }),
        run('. Ask '),
        inline('person', { personProperties: { name: 'Ada Byrne', email: 'ada@example.com' } }),
        run(' about it.'),
      ]),
      para(''),
      para([
        run('The ferry was late again '),
        inline('inlineObjectElement', { inlineObjectId: 'kix.photo' }),
        run(' and nobody minded much.'),
      ]),
      para([inline('inlineObjectElement', { inlineObjectId: 'kix.pic' })]),
      para([run('Ended here.'), inline('pageBreak'), run('Began again on the far side.')]),
      para('Mind the gap.', { style: QUOTE }),
      item('Ropes', 'l'),
      item('Oars', 'l'),
      styled('HEADING_2', 'Tuesday'),
      table([
        ['Day', 'Miles', 'Wind'],
        ['Mon', '12', 'west'],
        ['Tue', '9', [para('north'), para('then calm')]],
      ]),
      para([
        run('A note'),
        inline('footnoteReference', { footnoteId: 'kix.n', footnoteNumber: '1' }),
        run(' on the weather, which turned.'),
      ]),
      para('Last words of the day.'),
    ],
    {
      footnotes: { 'kix.n': [para(' A footnote.')] },
      lists: { l: bulleted() },
      // A picture, and a drawing, which has none to fetch and is held.
      pictures: { 'kix.photo': { uri: 'https://pictures.example.com/photo' }, 'kix.pic': {} },
    }
  )

/** A Doc's markdown with its pictures the document's own, as the import leaves it. */
export const imported = (read, names) =>
  read.pictures.reduce(
    (markdown, picture) =>
      markdown.split(`](${picture.marker})`).join(`](.images/doc_t/${names.get(picture.object)})`),
    read.markdown
  )

/** How many of a Doc's elements show one inline object. */
export const objects = (document, id) =>
  JSON.stringify(document.tabs[0].documentTab.body).split(`"inlineObjectId":"${id}"`).length - 1

/** One edit to a list of blocks: only to paragraphs and headings of the body. */
export const edits = [
  // A word in.
  (blocks, pick, next) => {
    const i = pick(blocks)
    if (i < 0) return
    const words = blocks[i].split(' ')
    words.splice(
      Math.floor(next() * (words.length + 1)),
      0,
      WORDS[Math.floor(next() * WORDS.length)]
    )
    blocks[i] = words.join(' ').replace(/^(#+) (#+ )?/, '$1 ')
  },
  // A word out.
  (blocks, pick, next) => {
    const i = pick(blocks)
    if (i < 0) return
    const words = blocks[i].split(' ')
    const at = Math.floor(next() * words.length)
    if (words.length > 2 && !/[*[\]\\`]/.test(words[at]) && !words[at].startsWith('#')) {
      words.splice(at, 1)
      blocks[i] = words.join(' ')
    }
  },
  // A plain word made bold.
  (blocks, pick, next) => {
    const i = pick(blocks)
    if (i < 0) return
    const words = blocks[i].split(' ')
    const at = Math.floor(next() * words.length)
    if (/^[a-z]+$/i.test(words[at])) {
      words[at] = `**${words[at]}**`
      blocks[i] = words.join(' ')
    }
  },
  // A paragraph parted in two at a space.
  (blocks, pick, next) => {
    const i = pick(blocks)
    if (i < 0 || blocks[i].startsWith('#')) return
    const words = blocks[i].split(' ')
    if (words.length < 4) return
    const at = 1 + Math.floor(next() * (words.length - 2))
    if (
      /[*[\]\\`]/.test(
        words
          .slice(0, at)
          .join(' ')
          .replace(/\*\*[a-z, ]+\*\*|\*[a-z]+\*/gi, '')
      )
    )
      return
    blocks.splice(i, 1, words.slice(0, at).join(' '), words.slice(at).join(' '))
  },
  // Two paragraphs joined.
  (blocks, pick) => {
    const i = pick(blocks)
    if (i < 0 || i + 1 >= blocks.length || !plain(blocks[i + 1]) || blocks[i].startsWith('#'))
      return
    blocks.splice(i, 2, `${blocks[i]} ${blocks[i + 1]}`)
  },
  // A paragraph out, or one in.
  (blocks, pick, next) => {
    const i = pick(blocks)
    if (i < 0) return
    if (next() < 0.5) blocks.splice(i, 1)
    else blocks.splice(i + 1, 0, `A ${WORDS[Math.floor(next() * WORDS.length)]} came in.`)
  },
  // A heading's level, or a paragraph made one.
  (blocks, pick, next) => {
    const i = pick(blocks)
    if (i < 0) return
    const text = blocks[i].replace(/^#+ /, '')
    blocks[i] = next() < 0.3 ? text : `${'#'.repeat(1 + Math.floor(next() * 3))} ${text}`
  },
  // A word in a list item, a quote or the footnote, after its marker.
  (blocks, _pick, next) => {
    const choices = blocks
      .map((block, i) => (/^(- |> |\\\[\^)/.test(block) ? i : -1))
      .filter(i => i >= 0)
    if (!choices.length) return
    const i = choices[Math.floor(next() * choices.length)]
    const lines = blocks[i].split('\n')
    const line = Math.floor(next() * lines.length)
    const words = lines[line].split(' ')
    words.splice(1 + Math.floor(next() * words.length), 0, WORDS[Math.floor(next() * WORDS.length)])
    lines[line] = words.join(' ')
    blocks[i] = lines.join('\n')
  },
  // A list item in, or one out.
  (blocks, _pick, next) => {
    const i = blocks.findIndex(block => block.startsWith('- '))
    if (i < 0) return
    const lines = blocks[i].split('\n')
    const at = Math.floor(next() * lines.length)
    if (next() < 0.5 && lines.length > 1) lines.splice(at, 1)
    else lines.splice(at + 1, 0, `- ${WORDS[Math.floor(next() * WORDS.length)]}`)
    blocks[i] = lines.join('\n')
  },
]
/** A table's rows, from its markdown, the line under its header left out. */
const rowsOf = block =>
  block
    .split('\n')
    .filter((_, i) => i !== 1)
    .map(line =>
      line
        .slice(2, -2)
        .split(' | ')
        .map(cell => cell.trim())
    )

/** A table as markdown, by its rows. */
const tableOf = rows =>
  [rows[0], rows[0].map(() => '---'), ...rows.slice(1)]
    .map(row => `| ${row.join(' | ')} |`)
    .join('\n')

/** A word, at random. */
const word = next => WORDS[Math.floor(next() * WORDS.length)]

/** Edits to the tables of a list of blocks. */
export const tableEdits = [
  // A word in a cell, or a cell's words changed.
  (blocks, next) => {
    const i = blocks.findIndex(block => block.startsWith('| '))
    if (i < 0) return
    const rows = rowsOf(blocks[i])
    const row = rows[Math.floor(next() * rows.length)]
    const at = Math.floor(next() * row.length)
    row[at] = next() < 0.5 ? `${row[at]} ${word(next)}`.trim() : word(next)
    blocks[i] = tableOf(rows)
  },
  // A row in, or one out.
  (blocks, next) => {
    const i = blocks.findIndex(block => block.startsWith('| '))
    if (i < 0) return
    const rows = rowsOf(blocks[i])
    if (next() < 0.5 && rows.length > 1) rows.splice(1 + Math.floor(next() * (rows.length - 1)), 1)
    else
      rows.splice(
        1 + Math.floor(next() * rows.length),
        0,
        rows[0].map(() => word(next))
      )
    blocks[i] = tableOf(rows)
  },
  // A column in, or one out.
  (blocks, next) => {
    const i = blocks.findIndex(block => block.startsWith('| '))
    if (i < 0) return
    const rows = rowsOf(blocks[i])
    const width = rows[0].length
    if (next() < 0.5 && width > 1) {
      const at = Math.floor(next() * width)
      for (const row of rows) row.splice(at, 1)
    } else {
      const at = Math.floor(next() * (width + 1))
      for (const row of rows) row.splice(at, 0, next() < 0.3 ? '' : word(next))
    }
    blocks[i] = tableOf(rows)
  },
  // A table in, or one out.
  (blocks, next) => {
    const i = blocks.findIndex(block => block.startsWith('| '))
    if (i >= 0 && next() < 0.4) {
      blocks.splice(i, 1)
      return
    }
    const at = 2 + Math.floor(next() * (blocks.length - 2))
    blocks.splice(
      at,
      0,
      tableOf([
        [word(next), word(next)],
        [word(next), ''],
      ])
    )
  },
]

/** A block an edit may touch: a paragraph or a heading, not a note, a list, a quote or the picture's place. */
export const plain = block => /^(#+ )?[A-Za-z*]/.test(block) && !block.startsWith('\\[^')

/**
 * One edit to a list of blocks, at random: to a table, now and then.
 *
 * @param {string[]} blocks
 * @param {(blocks: string[]) => number} pick
 * @param {() => number} next
 */
export const anyEdit = (blocks, pick, next) => {
  if (next() < 0.3) tableEdits[Math.floor(next() * tableEdits.length)](blocks, next)
  else edits[Math.floor(next() * edits.length)](blocks, pick, next)
}
