import { describe, it, expect } from 'vitest'
import { FORMAT, TEXT_FORMAT, HELD_FORMAT, formatOf } from '@/cloud/format.js'
import { schema } from '@/editor/schema.js'

/**
 * What the editor could hold at each format: its nodes and marks, with their
 * attributes. An older app's editor drops what it doesn't know as it saves a
 * document, so the editor learning a node, a mark or an attribute is the
 * likeliest change to need a new format. When the first test fails, raise
 * `TEXT_FORMAT` and `FORMAT` with it (`cloud/format.js`) and add what the
 * editor holds now under the new number; change the entry in place only if
 * an older app would keep the text as it was.
 */
const AT = {
  1: {
    nodes: {
      doc: [],
      paragraph: [],
      text: [],
      heading: ['level'],
      blockquote: [],
      bullet_list: [],
      ordered_list: ['order'],
      list_item: [],
      code_block: ['params'],
      horizontal_rule: [],
      hard_break: [],
      image: ['alt', 'src', 'title'],
      table: [],
      table_row: [],
      table_cell: ['align', 'colspan', 'rowspan'],
    },
    marks: {
      comment: ['id'],
      insertion: ['id'],
      deletion: ['id'],
      link: ['href', 'title'],
      em: [],
      strong: [],
      code: [],
      strikethrough: [],
    },
  },
}

/** @param {Record<string, import('prosemirror-model').NodeType|import('prosemirror-model').MarkType>} types */
const withAttributes = types =>
  Object.fromEntries(
    Object.entries(types).map(([name, type]) => [name, Object.keys(type.spec.attrs ?? {}).sort()])
  )

describe('the format synced records carry', () => {
  it('names what the editor holds', () => {
    expect({ nodes: withAttributes(schema.nodes), marks: withAttributes(schema.marks) }).toEqual(
      /** @type {any} */ (AT)[TEXT_FORMAT]
    )
  })

  it('is the newest listed', () => {
    expect(Math.max(...Object.keys(AT).map(Number))).toBe(TEXT_FORMAT)
  })

  it('is the oldest that holds each record, and never newer than the app reads', () => {
    expect(formatOf('documents', { parentId: 'doc_ch1' }, 'text')).toBe(HELD_FORMAT)
    expect(formatOf('documents', { parentId: 'doc_pdf' }, 'file')).toBe(HELD_FORMAT)
    expect(formatOf('documents', { parentId: 'root_story_1' }, 'folder')).toBe(TEXT_FORMAT)
    expect(formatOf('documents', { parentId: 'story_1' })).toBe(TEXT_FORMAT)
    expect(formatOf('documents', null)).toBe(1)
    expect(formatOf('chats', { id: 'chat_1' })).toBe(1)
    expect(Math.max(TEXT_FORMAT, HELD_FORMAT)).toBe(FORMAT)
  })
})
