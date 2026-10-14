import { describe, it, expect } from 'vitest'
import { readRtf } from '@/scrivener/rtf.js'
import { LISTS, PARAGRAPH, U, item, plainRtf, rtf } from './helpers.js'

/**
 * Each block's text, or the table's rows.
 * @param {import('@/scrivener/rtf.js').RtfBlock[]} blocks
 */
const texts = blocks =>
  blocks.map(block =>
    block.type === 'paragraph' ? block.runs.map(run => run.text).join('') : block.rows
  )

describe('readRtf', () => {
  it('reads a paragraph to each backslash that ends a line, and the last without one', () => {
    const blocks = readRtf(plainRtf('The tide came in.', '', 'It went out again'))

    expect(texts(blocks)).toEqual(['The tide came in.', '', 'It went out again'])
    expect(blocks[0]).toMatchObject({ type: 'paragraph', style: null, list: null })
  })

  it('keeps bold, italic and strikethrough, and reads past fonts and sizes', () => {
    const [paragraph] = readRtf(
      rtf(String.raw`${PARAGRAPH}
\f1\b\fs26 \cf0 The\f0\b0  keeper \f2\i slept\f0\i0  \strike \strikec0 late\strike0 \striked0  again.`)
    )

    expect(paragraph.type === 'paragraph' && paragraph.runs).toEqual([
      { text: 'The', bold: true, italic: false, strike: false },
      { text: ' keeper ', bold: false, italic: false, strike: false },
      { text: 'slept', bold: false, italic: true, strike: false },
      { text: ' ', bold: false, italic: false, strike: false },
      { text: 'late', bold: false, italic: false, strike: true },
      { text: ' again.', bold: false, italic: false, strike: false },
    ])
  })

  it('reads characters by code page and by number, and passes over their stand-ins', () => {
    const blocks = readRtf(
      plainRtf(
        String.raw`The keeper\'92s lamp \uc0${U}8212  lit`,
        String.raw`{\uc1${U}8220 "Ahoy${U}8221 "} \{braces\} and a \~space`
      )
    )

    expect(texts(blocks)).toEqual([
      'The keeper\u2019s lamp \u2014 lit',
      '\u201cAhoy\u201d {braces} and a \u00a0space',
    ])
  })

  it('takes a line break inside a paragraph as a newline', () => {
    const blocks = readRtf(plainRtf(String.raw`Harbour Road\line North Point\uc0${U}8232 Coast`))

    expect(texts(blocks)).toEqual(['Harbour Road\nNorth Point\nCoast'])
  })

  it('takes out the style markers and gives each paragraph the style it is in', () => {
    const blocks = readRtf(
      rtf(String.raw`${PARAGRAPH}
\f0\fs24 \cf0 <$ScrKeepWithNext><$Scr_Ps::0>
\f1\fs56 Harbour\
<$ScrKeepWithNext><$Scr_H::1><!$Scr_Ps::0><$Scr_Ps::1>
\f1\b\fs36 Before dawn\
<!$Scr_H::1><!$Scr_Ps::1>
\f0\b0\fs26 Gulls on the wall.`),
      ['Title', 'Heading 1']
    )

    expect(texts(blocks)).toEqual(['Harbour', 'Before dawn', 'Gulls on the wall.'])
    expect(blocks.map(block => block.type === 'paragraph' && block.style)).toEqual([
      'Title',
      'Heading 1',
      null,
    ])
  })

  it('keeps a style over every paragraph until it is closed', () => {
    const blocks = readRtf(
      plainRtf('<$Scr_Ps::0>First line', 'Second line', '<!$Scr_Ps::0>After'),
      ['Block Quote']
    )

    expect(blocks.map(block => block.type === 'paragraph' && block.style)).toEqual([
      'Block Quote',
      'Block Quote',
      null,
    ])
  })

  it('names no style for a marker the text does not list', () => {
    const [paragraph] = readRtf(plainRtf('<$Scr_Ps::3>Unlisted'), ['Title'])

    expect(paragraph).toMatchObject({ style: null })
  })

  it('reads which list a paragraph is in, how deep, and whether it is numbered', () => {
    const blocks = readRtf(
      rtf(
        item(1, 0, 'Salt') +
          item(1, 1, 'Kelp') +
          item(2, 0, 'First') +
          `${PARAGRAPH}\\cf0 After the list.`,
        LISTS
      )
    )

    expect(texts(blocks)).toEqual(['Salt', 'Kelp', 'First', 'After the list.'])
    expect(blocks.map(block => block.type === 'paragraph' && block.list)).toEqual([
      { level: 0, ordered: false },
      { level: 1, ordered: false },
      { level: 0, ordered: true },
      null,
    ])
  })

  it('reads a table as its cells, a cell of two paragraphs as two lines', () => {
    const row = String.raw`\itap1\trowd \taflags1 \trgaph108\trleft-108 \trbrdrt\brdrnil \trbrdrl\brdrnil \trbrdrt\brdrnil \trbrdrr\brdrnil
\clvertalt \clshdrawnil \clbrdrt\brdrnil \clbrdrl\brdrnil \clbrdrb\brdrnil \clbrdrr\brdrnil \clpadl100 \clpadr100 \gaph\cellx4320
\clvertalt \clshdrawnil \clbrdrt\brdrnil \clbrdrl\brdrnil \clbrdrb\brdrnil \clbrdrr\brdrnil \clpadl100 \clpadr100 \gaph\cellx8640
`
    const cell = String.raw`\pard\intbl\itap1\tx560\tx1120\pardirnatural\partightenfactor0
`
    const blocks = readRtf(
      rtf(String.raw`${row}${cell}
\f0\fs26 \cf0 Name\cell
${cell}\cf0 Light\cell \row

${row}${cell}\cf0 North\
Point\cell
${cell}\cf0 Red\cell \lastrow\row
${PARAGRAPH}\cf0 After the table.`)
    )

    expect(texts(blocks)).toEqual([
      [
        ['Name', 'Light'],
        ['North\nPoint', 'Red'],
      ],
      'After the table.',
    ])
  })

  it('drops what holds no text, and reads a field as the text it shows', () => {
    const blocks = readRtf(
      plainRtf(
        String.raw`See {\field{\*\fldinst{HYPERLINK "https://example.com/tides"}}{\fldrslt the chart}} here.`,
        String.raw`{\*\shppict{\pict\pngblip 89504e470d0a1a0a}}{\pict\pngblip 89504e470d0a1a0a}Under the picture.`
      )
    )

    expect(texts(blocks)).toEqual(['See the chart here.', 'Under the picture.'])
  })

  it('reads what it can of RTF that is broken, rather than throwing', () => {
    expect(texts(readRtf('{\\rtf1 Broken {\\b bold'))).toEqual(['Broken bold'])
    expect(readRtf('')).toEqual([])
    expect(texts(readRtf('Not RTF at all'))).toEqual(['Not RTF at all'])
  })
})
