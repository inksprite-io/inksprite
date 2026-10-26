import { describe, it, expect } from 'vitest'
import { readDoc } from '@/drive/convert.js'
import { applyRequests } from '@/drive/apply.js'
import { bulleted, docOf, inline, item, para, run, styled, table } from './docsHelpers.js'

const read = document => readDoc(document).markdown

describe('the Docs stand-in', () => {
  const doc = () =>
    docOf([
      styled('HEADING_1', 'The Crossing'),
      para([run('The ferry left '), run('late', { bold: true }), run('.')]),
      para('It rained.'),
    ])

  it('gives back the same Doc for no requests, indexed as the API indexes', () => {
    const document = doc()
    expect(applyRequests(document, [])).toEqual({ ...document, revisionId: 'rev-1+' })
  })

  it('inserts text in the style before it, and a newline as a paragraph like its own', () => {
    // "The ferry left late." starts at 14: the heading is 1–13.
    const after = applyRequests(doc(), [
      { insertText: { text: ' again', location: { index: 33 } } },
      { insertText: { text: 'At dawn.\n', location: { index: 14 } } },
    ])
    expect(read(after)).toBe(
      '# The Crossing\n\nAt dawn.\n\nThe ferry left **late again**.\n\nIt rained.'
    )
  })

  it('joins two paragraphs a deletion runs across, keeping the second’s style', () => {
    const after = applyRequests(doc(), [
      { deleteContentRange: { range: { startIndex: 12, endIndex: 14 } } },
    ])
    expect(read(after)).toBe('The CrossinThe ferry left **late**.\n\nIt rained.')
  })

  it('refuses what Docs refuses', () => {
    const document = docOf([para('Before.'), table([['a']]), para('After.')])
    const bad = request => () => applyRequests(document, [request])
    // "Before." is 1–8, the table 9–14 (its cell's text at 12), "After." 15–21.
    expect(bad({ deleteContentRange: { range: { startIndex: 8, endIndex: 9 } } })).toThrow(
      /before a table/
    )
    expect(bad({ insertText: { text: 'x', location: { index: 9 } } })).toThrow(/inside a paragraph/)
    expect(bad({ deleteContentRange: { range: { startIndex: 21, endIndex: 22 } } })).toThrow(
      /last newline/
    )
    expect(bad({ deleteContentRange: { range: { startIndex: 9, endIndex: 11 } } })).toThrow(/table/)
  })

  it('sets the style fields given and resets those named but left out', () => {
    const after = applyRequests(doc(), [
      {
        updateTextStyle: {
          range: { startIndex: 14, endIndex: 17 },
          textStyle: { italic: true },
          fields: 'italic',
        },
      },
      {
        updateTextStyle: { range: { startIndex: 29, endIndex: 33 }, textStyle: {}, fields: 'bold' },
      },
      {
        updateParagraphStyle: {
          range: { startIndex: 1, endIndex: 2 },
          paragraphStyle: {},
          fields: 'namedStyleType',
        },
      },
    ])
    expect(read(after)).toBe('The Crossing\n\n*The* ferry left late.\n\nIt rained.')
  })

  it('makes bullets, nested by leading tabs, and joins a list made the same way', () => {
    const document = docOf([para('One'), para('\tTwo'), para('Three')])
    const after = applyRequests(document, [
      {
        createParagraphBullets: {
          range: { startIndex: 1, endIndex: 10 },
          bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN',
        },
      },
      {
        createParagraphBullets: {
          range: { startIndex: 9, endIndex: 10 },
          bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN',
        },
      },
    ])
    expect(read(after)).toBe('1. One\n   1. Two\n2. Three')
  })

  it('gives a list made after one it doesn’t join an id of its own', () => {
    const document = docOf([item('Rope', 'list.1'), para('Salt')], {
      lists: { 'list.1': bulleted() },
    })
    const after = applyRequests(document, [
      {
        createParagraphBullets: {
          range: { startIndex: 6, endIndex: 7 },
          bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN',
        },
      },
    ])
    expect(read(after)).toBe('- Rope\n\n1. Salt')
  })

  describe('tables', () => {
    // "Before." is 1–8, the table 9–33, "After." 34–40.
    const tabled = () =>
      docOf([
        para('Before.'),
        table([
          ['Day', 'Miles'],
          ['Mon', '12'],
        ]),
        para('After.'),
      ])
    const at = (rowIndex, columnIndex = 0) => ({
      tableStartLocation: { index: 9 },
      rowIndex,
      columnIndex,
    })

    it('puts a table in a paragraph, after a newline of its own, its cells empty', () => {
      // At "Before."'s newline: what followed it, the newline, follows the table.
      const document = docOf([para('Before.'), para('After.')])
      const made = applyRequests(document, [
        { insertTable: { rows: 2, columns: 2, location: { index: 8 } } },
      ])
      // The table is 9–20, its cells' paragraphs at 12, 14, 17 and 19, the
      // newline left 21, "After." 22.
      const [, , made1, made2] = made.tabs[0].documentTab.body.content
      expect(made1.table.tableRows[1].tableCells.map(cell => cell.content[0].startIndex)).toEqual([
        17, 19,
      ])
      expect(made2).toMatchObject({ startIndex: 21, endIndex: 22 })
      const after = applyRequests(made, [
        { deleteContentRange: { range: { startIndex: 21, endIndex: 22 } } },
        { insertText: { text: 'd', location: { index: 19 } } },
        { insertText: { text: 'c', location: { index: 17 } } },
        { insertText: { text: 'b', location: { index: 14 } } },
        { insertText: { text: 'a', location: { index: 12 } } },
      ])
      expect(read(after)).toBe('Before.\n\n| a | b |\n| --- | --- |\n| c | d |\n\nAfter.')
    })

    it('refuses a table anywhere but inside a paragraph', () => {
      const bad = location => () =>
        applyRequests(tabled(), [{ insertTable: { rows: 1, columns: 1, location } }])
      expect(bad({ index: 9 })).toThrow(/inside a paragraph/)
      expect(bad({ index: 1, segmentId: 'f' })).toThrow(/footnote/)
    })

    it('puts in rows and columns of empty cells, either side of the one given', () => {
      const after = applyRequests(tabled(), [
        { insertTableColumn: { tableCellLocation: at(0, 1), insertRight: true } },
        { insertTableRow: { tableCellLocation: at(0), insertBelow: false } },
        { insertTableRow: { tableCellLocation: at(2), insertBelow: true } },
      ])
      expect(read(after)).toBe(
        'Before.\n\n|  |  |  |\n| --- | --- | --- |\n| Day | Miles |  |\n| Mon | 12 |  |\n|  |  |  |\n\nAfter.'
      )
      expect(after.tabs[0].documentTab.body.content[2].table).toMatchObject({ rows: 4, columns: 3 })
    })

    it('takes rows and columns out, and the table with its last', () => {
      const after = applyRequests(tabled(), [
        { deleteTableRow: { tableCellLocation: at(1) } },
        { deleteTableColumn: { tableCellLocation: at(0, 0) } },
      ])
      expect(read(after)).toBe('Before.\n\n| Miles |\n| --- |\n\nAfter.')
      const gone = applyRequests(after, [{ deleteTableRow: { tableCellLocation: at(0) } }])
      expect(read(gone)).toBe('Before.\n\nAfter.')
    })

    it('deletes a table whole by its range, and no part of one', () => {
      const after = applyRequests(tabled(), [
        { deleteContentRange: { range: { startIndex: 9, endIndex: 34 } } },
      ])
      expect(read(after)).toBe('Before.\n\nAfter.')
      expect(() =>
        applyRequests(tabled(), [
          { deleteContentRange: { range: { startIndex: 9, endIndex: 33 } } },
        ])
      ).toThrow(/table/)
      // With the newline before it, which may go once the table does.
      const joined = applyRequests(tabled(), [
        { deleteContentRange: { range: { startIndex: 8, endIndex: 34 } } },
      ])
      expect(read(joined)).toBe('Before.After.')
    })
  })

  it('reaches a footnote by its segment, and keeps an element’s place', () => {
    const document = docOf(
      [
        para([
          run('A'),
          inline('footnoteReference', { footnoteId: 'f', footnoteNumber: '1' }),
          run('.'),
        ]),
      ],
      { footnotes: { f: [para(' The note.')] } }
    )
    const after = applyRequests(document, [
      { insertText: { text: ' old', location: { index: 9, segmentId: 'f' } } },
    ])
    expect(read(after)).toBe('A\\[^1\\].\n\n\\[^1\\]: The note old.')
  })
})
