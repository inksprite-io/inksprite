import { describe, it, expect } from 'vitest'
import {
  DOCUMENT_ROWS,
  copyChoice,
  groupOn,
  rowOn,
  switchGroups,
  switchRow,
  switchTool,
  toolOn,
  toolsSwitchedOff,
} from '@/ai/tools/choice.js'

describe('a choice of tools', () => {
  it('has every group on that nothing switched off, one added later among them', () => {
    expect(groupOn({}, 'documents')).toBe(true)
    expect(groupOn(undefined, 'mcp:mcp_new')).toBe(true)
    expect(groupOn({ disabledToolGroups: ['rpg'] }, 'rpg')).toBe(false)
    expect(groupOn({ disabledToolGroups: ['rpg'] }, 'web')).toBe(true)
  })

  it('offers only the groups it names, where it names some, and none added later', () => {
    const roleplay = { onlyToolGroups: ['documents'], disabledToolGroups: ['rpg'] }

    expect(groupOn(roleplay, 'documents')).toBe(true)
    expect(groupOn(roleplay, 'web')).toBe(false)
    expect(groupOn(roleplay, 'mcp:mcp_new')).toBe(false)
    expect(groupOn({ onlyToolGroups: [] }, 'documents')).toBe(false)
  })

  it('has a tool on wherever its group is, whatever a choice names off', () => {
    // But a document's and a skill's, a tool is switched for the whole app.
    const choice = { disabledTools: ['oracle'], disabledToolGroups: ['web'] }

    expect(toolOn(choice, 'roll_dice', 'rpg')).toBe(true)
    expect(toolOn(choice, 'oracle', 'rpg')).toBe(true)
    expect(toolOn(choice, 'web_search', 'web')).toBe(false)
    expect(toolOn(choice, 'loose', undefined)).toBe(true)
  })

  it('has a skill on unless it is off by name', () => {
    const choice = { disabledTools: ['proofread'] }

    expect(toolOn(choice, 'proofread', 'skills')).toBe(false)
    expect(toolOn(choice, 'outline', 'skills')).toBe(true)
  })

  describe('the documents, by what the model does with them', () => {
    const [read, edit, comment] = DOCUMENT_ROWS

    it('puts every document tool in one row', async () => {
      const { getToolGroups } = await import('@/ai/tools/index.js')
      const registered = getToolGroups()
        .find(group => group.id === 'documents')
        .definitions.map(definition => definition.function.name)
      const rowed = DOCUMENT_ROWS.flatMap(row => row.tools)

      expect([...rowed].sort()).toEqual([...registered].sort())
      expect(new Set(rowed).size).toBe(rowed.length)
    })

    it('has a row on unless every tool in it is off, one from before among them', () => {
      expect(rowOn({}, 'edit')).toBe(true)
      expect(rowOn({ disabledTools: ['delete_document'] }, 'edit')).toBe(true)
      expect(toolOn({ disabledTools: ['delete_document'] }, 'delete_document', 'documents')).toBe(
        true
      )
      expect(rowOn({ disabledTools: [...edit.tools] }, 'edit')).toBe(false)
      expect(toolOn({ disabledTools: [...edit.tools] }, 'edit_document', 'documents')).toBe(false)
      expect(toolOn({ disabledTools: [...edit.tools] }, 'read_document', 'documents')).toBe(true)
    })

    it('switches reading on with editing or commenting, and those off with reading', () => {
      const none = switchRow({}, 'read', false)
      expect(none.disabledTools.sort()).toEqual(
        [...read.tools, ...edit.tools, ...comment.tools].sort()
      )
      expect(['read', 'edit', 'comment'].map(id => rowOn(none, id))).toEqual([false, false, false])

      const commenting = switchRow(none, 'comment', true)
      expect(['read', 'edit', 'comment'].map(id => rowOn(commenting, id))).toEqual([
        true,
        false,
        true,
      ])

      const reading = switchRow(commenting, 'comment', false)
      expect(['read', 'edit', 'comment'].map(id => rowOn(reading, id))).toEqual([
        true,
        false,
        false,
      ])
    })

    it('has nothing edited or commented on where nothing is read, whatever was named', () => {
      const unread = { disabledTools: [...read.tools] }
      expect(rowOn(unread, 'edit')).toBe(false)
      expect(toolOn(unread, 'add_comment', 'documents')).toBe(false)
    })

    it('leaves a skill’s switch as it was', () => {
      expect(switchRow({ disabledTools: ['proofread'] }, 'edit', false).disabledTools).toContain(
        'proofread'
      )
    })
  })

  it('has every tool off while tools are off, each group keeping its own switch', () => {
    const choice = { toolsOff: true, disabledToolGroups: ['rpg'] }

    expect(toolsSwitchedOff(choice)).toBe(true)
    expect(toolOn(choice, 'read_document', 'documents')).toBe(false)
    expect(toolOn(choice, 'loose', undefined)).toBe(false)
    expect(groupOn(choice, 'documents')).toBe(true)
    expect(groupOn(choice, 'rpg')).toBe(false)
    expect(toolsSwitchedOff({})).toBe(false)
  })

  it('switches groups, leaving their tools’ own switches as they were', () => {
    const choice = { disabledTools: ['oracle'], disabledToolGroups: ['web'] }

    expect(switchGroups(choice, ['rpg', 'documents'], false)).toEqual({
      disabledToolGroups: ['web', 'rpg', 'documents'],
    })
    expect(switchGroups(choice, ['web'], true)).toEqual({ disabledToolGroups: [] })
  })

  it('switches a group into, and out of, the ones offered where it names some', () => {
    const roleplay = { onlyToolGroups: ['documents'], disabledToolGroups: ['rpg'] }

    const on = switchGroups(roleplay, ['rpg'], true)
    expect(on).toEqual({ onlyToolGroups: ['documents', 'rpg'], disabledToolGroups: [] })
    expect(groupOn({ ...roleplay, ...on }, 'rpg')).toBe(true)

    const off = switchGroups(roleplay, ['documents'], false)
    expect(groupOn({ ...roleplay, ...off }, 'documents')).toBe(false)
  })

  it('switches a tool by its name', () => {
    expect(switchTool({}, 'oracle', false)).toEqual({ disabledTools: ['oracle'] })
    expect(switchTool({ disabledTools: ['oracle', 'tarot'] }, 'oracle', true)).toEqual({
      disabledTools: ['tarot'],
    })
  })

  it('copies what it holds, and no list it does not', () => {
    const roleplay = { onlyToolGroups: ['documents'], disabledToolGroups: ['rpg'], prompt: 'x' }

    const copy = copyChoice(roleplay)
    expect(copy).toEqual({
      disabledTools: [],
      disabledToolGroups: ['rpg'],
      onlyToolGroups: ['documents'],
    })
    expect(copy.onlyToolGroups).not.toBe(roleplay.onlyToolGroups)
    expect(copyChoice({})).not.toHaveProperty('onlyToolGroups')
    expect(copyChoice({})).not.toHaveProperty('toolsOff')
    expect(copyChoice({ toolsOff: true })).toMatchObject({ toolsOff: true })
  })
})
