import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  setLibrarySkills,
  onSkillsChanged,
  allSkills,
  librarySkills,
  getSkill,
  skillPrompt,
} from '@/ai/skills/index.js'
import {
  getToolDefinitions,
  getEnabledToolDefinitions,
  executeTool,
  isSkill,
} from '@/ai/tools/index.js'
import {
  COMMANDS,
  listCommands,
  runCommand,
  parseCommand,
  inspectCommand,
  renderCommand,
  formatSegment,
  commandSpeaks,
  commandRepeatable,
  commandTakesTurn,
} from '@/ai/commands.js'

/** A library row: an id, and the SKILL.md. */
const stored = (id, front, body = 'Do it well.') => ({
  id,
  text: `---\n${front}\n---\n\n${body}\n`,
})

const critique = stored(
  'skill_critique',
  'name: critique\ndescription: Notes on a scene.\ncontext: fork\narguments: scene\nargument-hint: <scene>',
  'Give notes on $scene.'
)
const tighten = stored(
  'skill_tighten',
  'name: tighten\ndescription: Cut a passage by a third.\ndisable-model-invocation: true\nargument-hint: <passage>',
  'Tighten $ARGUMENTS by about a third.'
)
const style = stored(
  'skill_style',
  'name: house-style\ndescription: The house style.',
  'Past tense, close third.'
)

const tools = () => getToolDefinitions().map(d => d.function.name)

afterEach(() => {
  setLibrarySkills([])
})

describe('the writer’s own skills in the registry', () => {
  it('comes after the built-ins, and is found by name', () => {
    setLibrarySkills([critique])

    expect(allSkills().map(skill => skill.name)).toEqual([
      'interpret',
      'write',
      'compact',
      'critique',
    ])
    expect(getSkill('critique')).toMatchObject({ id: 'skill_critique', builtIn: false })
  })

  it('leaves out a skill whose file does not read, and one with a built-in’s name', () => {
    setLibrarySkills([
      { id: 'broken', text: 'no frontmatter' },
      stored('taken', 'name: interpret\ndescription: Mine.'),
      critique,
    ])

    expect(librarySkills().map(skill => skill.id)).toEqual(['skill_critique'])
  })

  it('keeps the first of two with the same name', () => {
    setLibrarySkills([critique, { ...critique, id: 'skill_other' }])

    expect(librarySkills().map(skill => skill.id)).toEqual(['skill_critique'])
  })

  it('tells whoever is listening when it changes', () => {
    const heard = vi.fn()
    const stop = onSkillsChanged(heard)
    setLibrarySkills([critique])
    stop()
    setLibrarySkills([])

    expect(heard).toHaveBeenCalledOnce()
  })

  it('runs a skill of the writer’s under a profile’s rewording of it', () => {
    setLibrarySkills([critique])

    expect(skillPrompt('critique', {})).toBe('Give notes on $scene.')
    expect(skillPrompt('critique', { skills: { critique: { prompt: 'Brief notes.' } } })).toBe(
      'Brief notes.'
    )
  })
})

describe('the model’s tools, as the library changes', () => {
  it('offers the model a skill of the writer’s that runs on its own, as a skill', () => {
    setLibrarySkills([critique])

    expect(tools()).toContain('critique')
    expect(isSkill('critique')).toBe(true)
  })

  it('takes the tool away again when the skill goes', () => {
    setLibrarySkills([critique])
    setLibrarySkills([])

    expect(tools()).not.toContain('critique')
  })

  it('offers nothing for a saved prompt, and a skill the model loads only through use_skill', () => {
    setLibrarySkills([tighten, style])

    expect(tools()).not.toContain('tighten')
    expect(tools()).not.toContain('house-style')
    expect(tools()).toContain('use_skill')
    const useSkill = getToolDefinitions().find(d => d.function.name === 'use_skill')
    expect(useSkill.function.parameters.properties.name.enum).toEqual(['house-style'])
    expect(useSkill.function.description).toContain('- house-style: The house style.')
  })

  it('offers no use_skill when there is nothing to load', () => {
    setLibrarySkills([tighten])
    expect(tools()).not.toContain('use_skill')

    setLibrarySkills([style])
    setLibrarySkills([])
    expect(tools()).not.toContain('use_skill')
  })

  it('takes a skill switched off in a chat out of use_skill’s list, and use_skill with the last', () => {
    const other = stored('skill_voice', 'name: notes-voice\ndescription: How notes sound.')
    setLibrarySkills([style, other])

    const offered = selection =>
      getEnabledToolDefinitions(selection).find(d => d.function.name === 'use_skill')

    expect(
      offered({ disabledTools: ['house-style'] }).function.parameters.properties.name.enum
    ).toEqual(['notes-voice'])
    expect(offered({ disabledTools: ['house-style', 'notes-voice'] })).toBeUndefined()
    expect(offered({ disabledGroups: ['skills'] })).toBeUndefined()
  })

  it('does not count use_skill as a skill that runs a model', () => {
    setLibrarySkills([style])
    expect(isSkill('use_skill')).toBe(false)
  })

  it('answers the model’s call with what the skill said', async () => {
    setLibrarySkills([critique])
    const consult = vi.fn().mockResolvedValue('Cut the first page.')
    const call = {
      id: 'c1',
      type: 'function',
      function: { name: 'critique', arguments: JSON.stringify({ scene: 'the chase' }) },
    }

    const result = await executeTool(call, { consult })

    expect(JSON.parse(result.content)).toEqual({ answer: 'Cut the first page.' })
    expect(consult.mock.calls[0][0]).toBe('Give notes on the chase.')
  })
})

describe('the writer’s commands, as the library changes', () => {
  it('lists each skill the writer can call in the menu, with its summary', () => {
    setLibrarySkills([critique, tighten, style])

    const names = listCommands().map(entry => entry.name)
    expect(names).toEqual(expect.arrayContaining(['critique', 'tighten', 'house-style']))
    expect(listCommands().find(entry => entry.name === 'tighten')).toMatchObject({
      usage: '/tighten <passage>',
      description: 'Cut a passage by a third.',
      consults: false,
    })
  })

  it('takes a command away again when its skill goes', () => {
    setLibrarySkills([tighten])
    setLibrarySkills([])

    expect('tighten' in COMMANDS).toBe(false)
    expect(inspectCommand(parseCommand('/tighten the fight')).error).toMatch(/No command called/)
  })

  it('never lets a skill take a written command’s name', () => {
    setLibrarySkills([stored('mine', 'name: roll\ndescription: My roll.')])

    expect(COMMANDS.roll.consults).toBeUndefined()
    expect(COMMANDS.roll.description).toMatch(/Roll dice/)
  })

  it('asks one that runs on its own, and records its answer in the writer’s turn', async () => {
    setLibrarySkills([critique])
    const consult = vi.fn().mockResolvedValue('Cut the first page.')

    const ran = await runCommand(parseCommand('/critique the chase'), { consult })

    expect(ran).toMatchObject({ label: 'the chase', result: 'Cut the first page.' })
    expect(commandTakesTurn(ran)).toBe(false)
  })
})

describe('a saved prompt', () => {
  it('puts its instructions, filled in, into the turn, and keeps what was typed beside them', async () => {
    setLibrarySkills([tighten])

    const ran = await runCommand(parseCommand('/tighten the fight scene'))

    expect(ran).toMatchObject({
      name: 'tighten',
      detail: 'the fight scene',
      result: 'Tighten the fight scene by about a third.',
    })
    // What the model reads is the instructions, under the skill's name.
    expect(renderCommand(ran)).toBe(
      '<tighten>\nTighten the fight scene by about a third.\n</tighten>'
    )
  })

  it('takes a profile’s rewording of its skill', async () => {
    setLibrarySkills([tighten])

    const ran = await runCommand(parseCommand('/tighten the fight'), {
      promptFor: () => 'Halve $ARGUMENTS.',
    })

    expect(ran.result).toBe('Halve the fight.')
  })

  it('loads a skill the model could load too, for the chat to keep', async () => {
    setLibrarySkills([style])

    const ran = await runCommand(parseCommand('/house-style'))

    expect(ran.result).toBe('Past tense, close third.')
    expect(ran).toMatchObject({ prompt: true, load: true })
  })

  it('does not call a saved prompt only the writer can use a load', async () => {
    setLibrarySkills([tighten])

    const ran = await runCommand(parseCommand('/tighten the fight'))

    expect(ran).not.toHaveProperty('load')
  })

  it('asks for a reply, the way a character’s line does', async () => {
    setLibrarySkills([tighten])
    const ran = await runCommand(parseCommand('/tighten the fight'))

    expect(commandSpeaks(ran)).toBe(true)
    expect(commandSpeaks({ name: 'roll' })).toBe(false)
    expect(commandSpeaks({ name: 'cody', character: true })).toBe(true)
  })

  it('is not asked again, and is written for an edit without its old text', async () => {
    setLibrarySkills([tighten])
    const ran = await runCommand(parseCommand('/tighten the fight'))

    expect(commandRepeatable(ran)).toBe(false)
    expect(formatSegment({ type: 'command', command: ran })).toBe('/tighten the fight')
  })

  it('keeps what it said once its skill has gone', async () => {
    setLibrarySkills([tighten])
    const ran = await runCommand(parseCommand('/tighten the fight'))
    setLibrarySkills([])

    expect(renderCommand(ran)).toContain('Tighten the fight by about a third.')
    expect(formatSegment({ type: 'command', command: ran })).toContain(
      '> Tighten the fight by about a third.'
    )
  })
})
