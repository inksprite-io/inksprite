import { describe, it, expect } from 'vitest'
import {
  getToolGroups,
  getToolDefinitions,
  getToolDefinitionsFor,
  replaysAcrossTurns,
  TOOL_GROUP_LABELS,
} from '@/ai/tools/index.js'
import { DIRECTOR_TOOLS, SKILL_MAX_DEPTH } from '@/ai/skills/index.js'

describe('tool groups', () => {
  it('assigns every registered tool to exactly one group', () => {
    const grouped = getToolGroups().flatMap(g => g.definitions.map(d => d.function.name))
    const all = getToolDefinitions().map(d => d.function.name)

    // A tool registered without a group would silently vanish from the
    // settings UI while still being sent to the model.
    expect([...grouped].sort()).toEqual([...all].sort())
    expect(new Set(grouped).size).toBe(grouped.length)
  })

  it('groups the tools as labelled', () => {
    const byId = Object.fromEntries(
      getToolGroups().map(g => [g.id, g.definitions.map(d => d.function.name)])
    )

    expect(byId.documents).toEqual([
      'read_document',
      'describe_document',
      'list_documents',
      'search_documents',
      'create_document',
      'create_folder',
      'update_document',
      'edit_document',
      'append_document',
    ])
    expect(byId.rpg).toEqual(['roll_dice', 'oracle', 'roll_table', 'generate_names'])
    expect(byId.skills).toEqual(['director', 'interpret'])
  })

  it('sends back only the dice and oracle calls of a past turn', () => {
    // Small answers the fiction turns on, and the calls worth showing the
    // model. A read is carried by the project block; a search is the payload
    // replay was costing.
    for (const name of ['roll_dice', 'oracle', 'roll_table', 'generate_names']) {
      expect(replaysAcrossTurns(name)).toBe(true)
    }
    for (const name of ['read_document', 'search_documents', 'director', 'interpret', 'nope']) {
      expect(replaysAcrossTurns(name)).toBe(false)
    }
  })

  it('exposes groups in declared order with their labels', () => {
    expect(getToolGroups().map(g => g.id)).toEqual(Object.keys(TOOL_GROUP_LABELS))
    expect(getToolGroups().map(g => g.label)).toEqual(Object.values(TOOL_GROUP_LABELS))
  })
})

describe("a skill's tools", () => {
  it('hands back the ones it named', () => {
    const names = getToolDefinitionsFor(DIRECTOR_TOOLS).map(d => d.function.name)

    expect(names).toEqual(DIRECTOR_TOOLS)
  })

  it('lets a skill reach a skill while there is depth left', () => {
    // The Director asks `interpret` for an idea the same way the Game Master
    // does. Its own tools resolve at depth 1, which is short of the limit.
    const names = getToolDefinitionsFor(['interpret', 'oracle'], 1).map(d => d.function.name)

    expect(names).toEqual(['interpret', 'oracle'])
  })

  it('withholds skills at the last permitted depth', () => {
    // Every skill runs inside the turn that called it, on its budget and its
    // clock. Without a floor, how deep that goes is the model's to choose.
    const names = getToolDefinitionsFor(['director', 'oracle'], SKILL_MAX_DEPTH).map(
      d => d.function.name
    )

    expect(names).toEqual(['oracle'])
  })

  it("resolves a skill's tools one deep unless told otherwise", () => {
    expect(getToolDefinitionsFor(['interpret']).map(d => d.function.name)).toEqual(['interpret'])
  })

  it('ignores what the chat switched off', () => {
    // A skill's tools belong to its role. The chat's switches say what the
    // assistant the writer is talking to may do, and a skill is not that
    // assistant — reading them here would mean switching off Dice & Oracle
    // quietly put the Director back to guessing.
    const names = getToolDefinitionsFor(['oracle', 'roll_dice']).map(d => d.function.name)

    expect(names).toEqual(['oracle', 'roll_dice'])
  })
})
