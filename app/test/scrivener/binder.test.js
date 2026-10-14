import { describe, it, expect } from 'vitest'
import { readBinder, readStyles } from '@/scrivener/binder.js'
import { scrivx, stylesXml } from './helpers.js'

describe('readBinder', () => {
  it('reads the items in order, with the items under them, and leaves out the Trash', () => {
    const binder = readBinder(
      scrivx([
        {
          id: 'D',
          type: 'DraftFolder',
          title: 'Manuscript',
          children: [
            { id: 'C1', type: 'Folder', title: 'Chapter One', children: [] },
            { id: 'S1', type: 'Text', title: '' },
          ],
        },
        {
          id: 'R',
          type: 'ResearchFolder',
          title: 'Research',
          children: [{ id: 'P', type: 'PDF', title: 'Tides & Currents', extension: 'pdf' }],
        },
        {
          id: 'T',
          type: 'TrashFolder',
          title: 'Trash',
          children: [{ id: 'X', type: 'Text', title: 'Cut' }],
        },
      ])
    )

    expect(binder).toEqual([
      {
        id: 'D',
        type: 'DraftFolder',
        title: 'Manuscript',
        children: [
          { id: 'C1', type: 'Folder', title: 'Chapter One', children: [] },
          { id: 'S1', type: 'Text', title: '', children: [] },
        ],
      },
      {
        id: 'R',
        type: 'ResearchFolder',
        title: 'Research',
        children: [
          { id: 'P', type: 'PDF', title: 'Tides & Currents', extension: 'pdf', children: [] },
        ],
      },
    ])
  })

  it('says plainly when the binder cannot be read', () => {
    expect(() => readBinder('not xml <')).toThrow("The project's binder could not be read.")
    expect(() => readBinder('<ScrivenerProject/>')).toThrow(
      "The project's binder could not be read."
    )
  })
})

describe('readStyles', () => {
  it('reads each style’s name by its id, past the RTF each keeps its look in', () => {
    const styles = readStyles(stylesXml({ 'ID-T': 'Title', 'ID-H': 'Heading 1' }))

    expect([...styles]).toEqual([
      ['ID-T', 'Title'],
      ['ID-H', 'Heading 1'],
    ])
  })
})
