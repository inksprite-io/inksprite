import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import {
  BUILT_IN_SKILLS,
  DIRECTOR,
  allSkills,
  builtInSkills,
  getSkill,
  onSkillsChanged,
  setTrialSkills,
  skillLabel,
  skillPrompt,
  COMPACT_PROMPT,
  toolDefinitionFor,
} from '@/ai/skills/index.js'
import { getBuiltInProfile, ROLEPLAY_PROFILE_ID, CHAT_PROFILE_ID } from '@/ai/profiles/index.js'
import {
  SKILLS_GROUP,
  getEnabledToolDefinitions,
  getToolDefinitions,
  getToolDefinitionsFor,
  isSkill,
  toolGroupOf,
} from '@/ai/tools/index.js'
import { COMMANDS } from '@/ai/commands.js'
import { TRIAL_SKILLS } from '../../../harness/skills/trials.js'

describe('the skills registry', () => {
  it('has the one that ships, read from its own SKILL.md', () => {
    expect(BUILT_IN_SKILLS.map(skill => skill.name)).toEqual(['compact'])
    for (const skill of BUILT_IN_SKILLS) {
      expect(skill.body.trim(), skill.name).toBeTruthy()
      expect(skill.summary.trim(), skill.name).toBeTruthy()
      // It runs on its own, as an inference of its own.
      expect(skill.fork, skill.name).toBe(true)
    }
  })

  it('sets the Director aside: not offered, not listed, its file kept', () => {
    expect(getSkill('director')).toBeNull()
    expect(getToolDefinitions().map(d => d.function.name)).not.toContain('director')
    expect(DIRECTOR.body.trim()).toBeTruthy()
  })

  it('offers the model no tool for Compact, which is the writer’s', () => {
    expect(getToolDefinitions().map(d => d.function.name)).not.toContain('compact')
    expect(COMMANDS.compact).toMatchObject({ ownTurn: true, tag: 'summary' })
    expect(COMMANDS.compact.usage).toBe('/compact(<turns to keep>) [instructions]')
  })

  it('leaves /director as the writer’s own direction, which asks no model', () => {
    expect(DIRECTOR.user).toBe(false)
    expect(COMMANDS.director.consults).toBeUndefined()
  })

  it('does not answer to a name it does not have', () => {
    expect(getSkill('nothing')).toBeNull()
  })

  it('calls a skill by its name, as a word', () => {
    expect(skillLabel({ name: 'director' })).toBe('Director')
    expect(skillLabel({ name: 'house-style' })).toBe('House style')
  })
})

describe("the harness's skills", () => {
  beforeEach(() => {
    setTrialSkills(TRIAL_SKILLS)
  })

  afterEach(() => {
    setTrialSkills([])
  })

  it('are none in the app', async () => {
    vi.resetModules()
    const fresh = await import('@/ai/skills/index.js')

    expect(fresh.allSkills().map(skill => skill.name)).toEqual(['compact'])
    expect(fresh.getSkill('interpret')).toBeNull()
  })

  it('are there beside the built-ins once the harness sets them, and say so once', () => {
    setTrialSkills([])
    const told = vi.fn()
    const stop = onSkillsChanged(told)

    setTrialSkills(TRIAL_SKILLS)
    stop()

    expect(told).toHaveBeenCalledTimes(1)
    expect(builtInSkills().map(skill => skill.name)).toEqual(['compact', 'interpret', 'write'])
    expect(allSkills().map(skill => skill.name)).toEqual(['compact', 'interpret', 'write'])
    expect(getSkill('interpret')?.builtIn).toBe(true)
  })

  it('offer the model a tool for each, in the skills group, as its SKILL.md describes it', () => {
    for (const skill of TRIAL_SKILLS) {
      expect(toolGroupOf(skill.name), skill.name).toBe(SKILLS_GROUP)
      expect(isSkill(skill.name), skill.name).toBe(true)
      expect(getToolDefinitionsFor([skill.name], 0)).toEqual([toolDefinitionFor(skill)])
    }
  })

  it('give the writer a command for each, answered where each says', () => {
    for (const skill of TRIAL_SKILLS) {
      expect(COMMANDS[skill.name]?.consults, skill.name).toBe(true)
      expect(COMMANDS[skill.name].description).toBe(skill.summary)
    }
    expect(COMMANDS.interpret.ownTurn).toBeUndefined()
    expect(COMMANDS.write).toMatchObject({ ownTurn: true, tag: 'draft' })
  })

  it('go again, tools, commands and all, once the harness takes them away', () => {
    setTrialSkills([])

    const offered = getEnabledToolDefinitions({}).map(d => d.function.name)
    expect(offered).not.toContain('interpret')
    expect(offered).not.toContain('write')
    expect(getToolDefinitionsFor(['interpret', 'roll_dice'], 0).map(d => d.function.name)).toEqual([
      'roll_dice',
    ])
    expect(COMMANDS.interpret).toBeUndefined()
    expect(COMMANDS.write).toBeUndefined()
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
