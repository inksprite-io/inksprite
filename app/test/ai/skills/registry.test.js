import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import {
  BUILT_IN_SKILLS,
  DIRECTOR,
  availableSkills,
  getSkill,
  onSkillsChanged,
  setExperimentalSkills,
  skillIsOn,
  skillLabel,
  skillPrompt,
  ownPrompt,
  setSkillWordings,
  COMPACT_PROMPT,
  INTERPRET_PROMPT,
  toolDefinitionFor,
} from '@/ai/skills/index.js'
import { getBuiltInProfile, ROLEPLAY_PROFILE_ID, CHAT_PROFILE_ID } from '@/ai/profiles/index.js'
import {
  EXPERIMENTAL_GROUP,
  TOOL_GROUP_LABELS,
  getEnabledToolDefinitions,
  getToolDefinitions,
  getToolDefinitionsFor,
  getToolGroups,
  isSkill,
  toolGroupOf,
} from '@/ai/tools/index.js'
import { COMMANDS } from '@/ai/commands.js'

describe('the skills registry', () => {
  beforeEach(() => {
    setExperimentalSkills(['interpret', 'write'])
  })

  it('has the three that ship, each read from its own SKILL.md', () => {
    expect(BUILT_IN_SKILLS.map(skill => skill.name)).toEqual(['interpret', 'write', 'compact'])
    for (const skill of BUILT_IN_SKILLS) {
      expect(skill.body.trim(), skill.name).toBeTruthy()
      expect(skill.summary.trim(), skill.name).toBeTruthy()
      // All three run on their own, as an inference of their own.
      expect(skill.fork, skill.name).toBe(true)
    }
  })

  it('sets the Director aside: not offered, not listed, its file kept', () => {
    expect(getSkill('director')).toBeNull()
    expect(getToolDefinitions().map(d => d.function.name)).not.toContain('director')
    expect(DIRECTOR.body.trim()).toBeTruthy()
  })

  it('offers the model a tool for each skill it may call, and only those', () => {
    const registered = getToolDefinitions().map(d => d.function.name)

    for (const skill of BUILT_IN_SKILLS) {
      expect(registered.includes(skill.name), skill.name).toBe(skill.model)
    }
    expect(BUILT_IN_SKILLS.filter(skill => !skill.model).map(skill => skill.name)).toEqual([
      'compact',
    ])
  })

  it('offers Interpret and Write in the experimental group, as skills', () => {
    for (const name of ['interpret', 'write']) {
      expect(toolGroupOf(name), name).toBe(EXPERIMENTAL_GROUP)
      expect(isSkill(name), name).toBe(true)
    }
    expect(TOOL_GROUP_LABELS[EXPERIMENTAL_GROUP]).toBe('Experimental')
  })

  it('offers each tool as its SKILL.md describes it', () => {
    for (const skill of BUILT_IN_SKILLS.filter(one => one.model)) {
      expect(getToolDefinitionsFor([skill.name], 0)).toEqual([toolDefinitionFor(skill)])
    }
  })

  it('gives the writer a command for each skill they may call', () => {
    for (const skill of BUILT_IN_SKILLS.filter(one => one.user)) {
      expect(COMMANDS[skill.name]?.consults, skill.name).toBe(true)
      expect(COMMANDS[skill.name].description).toBe(skill.summary)
    }
  })

  it('leaves /director as the writer’s own direction, which asks no model', () => {
    expect(DIRECTOR.user).toBe(false)
    expect(COMMANDS.director.consults).toBeUndefined()
  })

  it('answers each command where its skill says: a record, the reply, or a summary', () => {
    expect(COMMANDS.interpret.ownTurn).toBeUndefined()
    expect(COMMANDS.write).toMatchObject({ ownTurn: true, tag: 'draft' })
    expect(COMMANDS.compact).toMatchObject({ ownTurn: true, tag: 'summary' })
    expect(COMMANDS.compact.usage).toBe('/compact(<turns to keep>) [instructions]')
  })

  it('does not answer to a name it does not have', () => {
    expect(getSkill('nothing')).toBeNull()
  })

  it('calls a skill by its name, as a word', () => {
    expect(skillLabel({ name: 'director' })).toBe('Director')
    expect(skillLabel({ name: 'house-style' })).toBe('House style')
  })
})

describe('the experimental switches', () => {
  beforeEach(() => {
    setExperimentalSkills([])
  })

  it('start off', async () => {
    vi.resetModules()
    const fresh = await import('@/ai/skills/index.js')

    expect(fresh.skillIsOn('interpret')).toBe(false)
    expect(fresh.skillIsOn('write')).toBe(false)
    expect(fresh.skillIsOn('compact')).toBe(true)
  })

  it('leave Interpret and Write out of what can be used while they are off', () => {
    expect(availableSkills().map(skill => skill.name)).toEqual(['compact'])
    // Still found by name, for the records they left in chats.
    expect(getSkill('interpret')?.builtIn).toBe(true)
    expect(getSkill('write')?.builtIn).toBe(true)
  })

  it('take their tools away while they are off, wherever a tool is asked for', () => {
    const offered = getEnabledToolDefinitions({}).map(d => d.function.name)

    expect(offered).not.toContain('interpret')
    expect(offered).not.toContain('write')
    expect(getToolDefinitions().map(d => d.function.name)).not.toContain('write')
    expect(getToolDefinitionsFor(['interpret', 'roll_dice'], 0).map(d => d.function.name)).toEqual([
      'roll_dice',
    ])
    expect(getToolGroups().map(group => group.id)).not.toContain(EXPERIMENTAL_GROUP)
  })

  it('bring back only the one switched on, and say so once', () => {
    const told = vi.fn()
    const stop = onSkillsChanged(told)

    setExperimentalSkills(['interpret'])
    setExperimentalSkills(['interpret'])
    stop()

    expect(told).toHaveBeenCalledTimes(1)
    expect(skillIsOn('interpret')).toBe(true)
    expect(skillIsOn('write')).toBe(false)
    expect(availableSkills().map(skill => skill.name)).toEqual(['interpret', 'compact'])
    expect(toolGroupOf('interpret')).toBe(EXPERIMENTAL_GROUP)
    const offered = getEnabledToolDefinitions({}).map(d => d.function.name)
    expect(offered).toContain('interpret')
    expect(offered).not.toContain('write')
  })
})

describe('skillPrompt', () => {
  it("takes the skill's own wording when the profile has not said", () => {
    // Which is how a profile nobody has edited keeps getting the app's
    // improvements to it.
    expect(skillPrompt('compact', {})).toBe(COMPACT_PROMPT)
    expect(skillPrompt('compact', undefined)).toBe(COMPACT_PROMPT)
    expect(skillPrompt('compact', { skills: {} })).toBe(COMPACT_PROMPT)
  })

  it("takes the profile's wording when it has one", () => {
    const settings = { skills: { compact: { prompt: 'Keep the dialogue.' } } }

    expect(skillPrompt('compact', settings)).toBe('Keep the dialogue.')
  })

  it('treats an empty override as no override', () => {
    const settings = { skills: { compact: { prompt: '   ' } } }

    expect(skillPrompt('compact', settings)).toBe(COMPACT_PROMPT)
  })

  it('is nothing for a skill that does not exist', () => {
    expect(skillPrompt('nothing', {})).toBe('')
  })
})

describe("the writer's wording of a built-in", () => {
  afterEach(() => setSkillWordings([]))

  it('is what a profile with none of its own runs the skill under', () => {
    setSkillWordings([{ name: 'interpret', prompt: 'Read the card darkly.\n' }])

    expect(ownPrompt('interpret')).toBe('Read the card darkly.')
    expect(skillPrompt('interpret', {})).toBe('Read the card darkly.')
  })

  it("gives way to a profile's own", () => {
    setSkillWordings([{ name: 'compact', prompt: 'Keep everything.' }])
    const settings = { skills: { compact: { prompt: 'Keep the dialogue.' } } }

    expect(skillPrompt('compact', settings)).toBe('Keep the dialogue.')
  })

  it('leaves the others on their own files', () => {
    setSkillWordings([{ name: 'compact', prompt: 'Keep everything.' }])

    expect(skillPrompt('interpret', {})).toBe(INTERPRET_PROMPT)
  })

  it('is no wording when it is nothing but space', () => {
    setSkillWordings([{ name: 'interpret', prompt: '  \n' }])

    expect(skillPrompt('interpret', {})).toBe(INTERPRET_PROMPT)
  })

  it("is only a built-in's: a skill of the writer's is reworded in its file", () => {
    setSkillWordings([{ name: 'tighten', prompt: 'Cut more.' }])

    expect(skillPrompt('tighten', {})).toBe('')
  })
})

describe('what the built-in profiles say', () => {
  it('gives Roleplay a compaction of its own', () => {
    // The default asks what was decided and what is left to do, which throws
    // away exactly what a played-out scene is made of.
    const roleplay = getBuiltInProfile(ROLEPLAY_PROFILE_ID)
    const prompt = skillPrompt('compact', roleplay.settings)

    expect(prompt).not.toBe(COMPACT_PROMPT)
    expect(prompt).toMatch(/verbatim/i)
  })

  it('leaves the others on the wording that ships with the app', () => {
    const chat = getBuiltInProfile(CHAT_PROFILE_ID)

    for (const skill of BUILT_IN_SKILLS) {
      expect(skillPrompt(skill.name, chat.settings)).toBe(skill.body)
    }
  })
})
