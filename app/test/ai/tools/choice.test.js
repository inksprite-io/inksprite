import { describe, it, expect } from 'vitest'
import {
  copyChoice,
  groupOn,
  switchGroups,
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

  it('has a tool on when its group is and it is not off by name', () => {
    const choice = { disabledTools: ['oracle'], disabledToolGroups: ['web'] }

    expect(toolOn(choice, 'roll_dice', 'rpg')).toBe(true)
    expect(toolOn(choice, 'oracle', 'rpg')).toBe(false)
    expect(toolOn(choice, 'web_search', 'web')).toBe(false)
    expect(toolOn(choice, 'loose', undefined)).toBe(true)
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
