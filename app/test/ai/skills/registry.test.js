import { describe, it, expect } from 'vitest'
import {
  BUILT_IN_SKILLS,
  getSkill,
  skillLabel,
  skillPrompt,
  COMPACT_PROMPT,
  toolDefinitionFor,
} from '@/ai/skills/index.js'
import { getBuiltInProfile, ROLEPLAY_PROFILE_ID, CHAT_PROFILE_ID } from '@/ai/profiles/index.js'
import { getToolDefinitions, getToolDefinitionsFor } from '@/ai/tools/index.js'
import { COMMANDS } from '@/ai/commands.js'

describe('the skills registry', () => {
  it('has the four that ship, each read from its own SKILL.md', () => {
    expect(BUILT_IN_SKILLS.map(skill => skill.name)).toEqual([
      'director',
      'interpret',
      'write',
      'compact',
    ])
    for (const skill of BUILT_IN_SKILLS) {
      expect(skill.body.trim(), skill.name).toBeTruthy()
      expect(skill.summary.trim(), skill.name).toBeTruthy()
      // All four run on their own, as an inference of their own.
      expect(skill.fork, skill.name).toBe(true)
    }
  })

  it('offers the model a tool for each skill it may call, and only those', () => {
    const registered = getToolDefinitions().map(d => d.function.name)

    for (const skill of BUILT_IN_SKILLS) {
      expect(registered.includes(skill.name), skill.name).toBe(skill.model)
    }
    expect(BUILT_IN_SKILLS.filter(skill => !skill.model).map(skill => skill.name)).toEqual([
      'write',
      'compact',
    ])
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

  it('leaves /director as the writer’s own direction, since the Director is the model’s', () => {
    // The skill is not the writer's to call; the command of the same name is
    // what they say in its place, and runs nothing.
    expect(getSkill('director').user).toBe(false)
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
