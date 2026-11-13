import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  drawsByChance,
  getToolGroups,
  getToolDefinitions,
  getToolDefinitionsFor,
  getEnabledToolDefinitions,
  keptInConversation,
  offersDocuments,
  TOOL_GROUP_LABELS,
} from '@/ai/tools/index.js'
import { DIRECTOR_TOOLS, SKILL_MAX_DEPTH, setTrialSkills } from '@/ai/skills/index.js'
import { setWebSearch } from '@/web/config.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { TRIAL_SKILLS } from '../../../harness/skills/trials.js'

// Every tool there is, Interpret and Write among them as in the harness, with
// a service to search the web and Python on, as in the desktop app.
beforeAll(() => {
  setTrialSkills(TRIAL_SKILLS)
  setWebSearch({ id: 'web', service: 'exa', keys: {} })
  globalThis.__INKSPRITE_DESKTOP__ = { python: { run: () => {}, stop: () => {} } }
  useApplicationState().setAiEnabled(true)
  useApplicationState().setExtension('python', true)
})

afterAll(() => {
  setTrialSkills([])
  setWebSearch(null)
  delete globalThis.__INKSPRITE_DESKTOP__
  useApplicationState().setExtension('python', false)
})

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
      'move_document',
      'delete_document',
      'append_document',
      'list_comments',
      'add_comment',
      'reply_comment',
      'resolve_comment',
      'explore_documents',
    ])
    expect(byId.rpg).toEqual(['roll_dice', 'oracle', 'roll_table', 'draw_tarot', 'generate_names'])
    // The skills group holds the writer's own, and they have none here: these
    // are the harness's.
    expect(byId.skills).toEqual(['interpret', 'write'])
    expect(byId.web).toEqual(['web_search', 'read_web_page', 'save_web_page'])
    expect(byId.python).toEqual(['run_python'])
  })

  it('offers the web to a chat that has not switched it off, while a service can search', () => {
    const offered = choice =>
      getEnabledToolDefinitions(choice)
        .map(definition => definition.function.name)
        .filter(name => name === 'web_search' || name === 'read_web_page')

    expect(offered({})).toEqual(['web_search', 'read_web_page'])
    expect(offered({ disabledTools: ['read_web_page'] })).toEqual(['web_search'])
    expect(offered({ disabledToolGroups: ['web'] })).toEqual([])
    // Not in a profile that offers only some, unless it is among them.
    expect(offered({ onlyToolGroups: ['documents'] })).toEqual([])

    setWebSearch(null)
    try {
      expect(offered({})).toEqual([])
      expect(getToolGroups().map(group => group.id)).not.toContain('web')
    } finally {
      setWebSearch({ id: 'web', service: 'exa', keys: {} })
    }
  })

  it('offers Python to a chat that has not switched it off, while its extension is on', () => {
    const offered = choice =>
      getEnabledToolDefinitions(choice)
        .map(definition => definition.function.name)
        .filter(name => name === 'run_python')

    expect(offered({})).toEqual(['run_python'])
    expect(offered({ disabledToolGroups: ['python'] })).toEqual([])
    expect(offered({ disabledTools: ['run_python'] })).toEqual([])

    useApplicationState().setExtension('python', false)
    try {
      expect(offered({})).toEqual([])
    } finally {
      useApplicationState().setExtension('python', true)
    }
  })

  it('keeps the document calls of a turn from when only they went back', () => {
    for (const name of ['read_document', 'search_documents', 'edit_document']) {
      expect(keptInConversation(name)).toBe(true)
    }
    for (const name of ['roll_dice', 'oracle', 'director', 'nope']) {
      expect(keptInConversation(name)).toBe(false)
    }
  })

  it('says whether a chat is offered any of the document tools', () => {
    const documents = getToolGroups()
      .find(group => group.id === 'documents')
      .definitions.map(definition => definition.function.name)

    expect(offersDocuments({})).toBe(true)
    expect(offersDocuments({ disabledToolGroups: ['rpg', 'web'] })).toBe(true)
    expect(offersDocuments({ disabledTools: documents.slice(1) })).toBe(true)
    expect(offersDocuments({ disabledToolGroups: ['documents'] })).toBe(false)
    expect(offersDocuments({ onlyToolGroups: [] })).toBe(false)
    expect(offersDocuments({ disabledTools: documents })).toBe(false)
  })

  it('says which tools draw by chance', () => {
    for (const name of ['roll_dice', 'oracle', 'roll_table', 'draw_tarot', 'generate_names']) {
      expect(drawsByChance(name), name).toBe(true)
    }
    expect(drawsByChance('read_document')).toBe(false)
    expect(drawsByChance('interpret')).toBe(false)
  })

  it('lists the groups by where each comes from, in declared order with their labels', () => {
    const declared = Object.entries(TOOL_GROUP_LABELS)

    expect(getToolGroups().map(g => g.id)).toEqual(['documents', 'web', 'python', 'skills', 'rpg'])
    expect(getToolGroups().map(g => g.id)).toEqual(declared.map(([id]) => id))
    expect(getToolGroups().map(g => g.label)).toEqual(declared.map(([, label]) => label))
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
    const names = getToolDefinitionsFor(['interpret', 'oracle'], SKILL_MAX_DEPTH).map(
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
