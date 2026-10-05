import { describe, it, expect, afterEach } from 'vitest'
import { setLibrarySkills } from '@/ai/skills/index.js'
import { executeUseSkill, useSkillDefinition, loadableSkills } from '@/ai/tools/useSkill.js'

const stored = (id, front, body, files = []) => ({
  id,
  text: `---\n${front}\n---\n\n${body}\n`,
  files,
})

const style = stored(
  'skill_style',
  'name: house-style\ndescription: The house style.',
  'Past tense, close third. See references/voice.md.',
  [{ path: 'references/voice.md', content: 'Short sentences.' }]
)
const critique = stored(
  'skill_critique',
  'name: critique\ndescription: Notes on a scene.\ncontext: fork',
  'Give notes.'
)
const tighten = stored(
  'skill_tighten',
  'name: tighten\ndescription: Cut it.\ndisable-model-invocation: true',
  'Tighten $ARGUMENTS.'
)

afterEach(() => setLibrarySkills([]))

describe('use_skill', () => {
  it('offers only the skills the model loads', () => {
    setLibrarySkills([style, critique, tighten])

    expect(loadableSkills().map(skill => skill.name)).toEqual(['house-style'])
  })

  it('lists each skill it offers a line each, and takes only those names', () => {
    setLibrarySkills([style])
    const definition = useSkillDefinition(loadableSkills())

    expect(definition.function.name).toBe('use_skill')
    expect(definition.function.description).toMatch(/- house-style: The house style\.$/)
    expect(definition.function.parameters.required).toEqual(['name'])
    expect(definition.function.parameters.properties.name.enum).toEqual(['house-style'])
  })

  it('answers with the instructions, and the files that came with them', async () => {
    setLibrarySkills([style])

    expect(await executeUseSkill({ name: 'house-style' })).toEqual({
      name: 'house-style',
      instructions: 'Past tense, close third. See references/voice.md.',
      files: ['references/voice.md'],
      // Or the model goes looking for them among the project's documents.
      reading: expect.stringContaining('use_skill(name: "house-style", file: "<path>")'),
    })
  })

  it('answers under the chat’s wording of the skill, when it has one', async () => {
    setLibrarySkills([style])

    const answer = await executeUseSkill(
      { name: 'house-style' },
      { promptFor: () => 'Present tense.' }
    )

    expect(answer.instructions).toBe('Present tense.')
  })

  it('says a skill is already loaded rather than sending it again', async () => {
    setLibrarySkills([style])

    const answer = await executeUseSkill(
      { name: 'house-style' },
      { loadedSkills: () => ['house-style'] }
    )

    expect(answer).not.toHaveProperty('instructions')
    expect(answer.loaded).toMatch(/already loaded/i)
  })

  it('reads one of the skill’s files, however its path is written', async () => {
    setLibrarySkills([style])

    for (const file of ['references/voice.md', './references/voice.md']) {
      expect(await executeUseSkill({ name: 'house-style', file })).toEqual({
        name: 'house-style',
        file: 'references/voice.md',
        content: 'Short sentences.',
      })
    }
  })

  it('says which files there are when asked for one that is not', async () => {
    setLibrarySkills([style])

    const answer = await executeUseSkill({ name: 'house-style', file: 'voice.md' })

    expect(answer.error).toContain('references/voice.md')
  })

  it('loads nothing that is not a skill the model loads', async () => {
    setLibrarySkills([style, critique, tighten])

    for (const name of ['critique', 'tighten', 'nothing', '']) {
      expect(await executeUseSkill({ name })).toHaveProperty('error')
    }
  })
})
