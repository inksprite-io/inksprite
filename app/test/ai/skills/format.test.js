import { describe, it, expect } from 'vitest'
import {
  HANDS_OVER_REPLY,
  parseSkill,
  readBuiltInSkill,
  toolDefinitionFor,
} from '@/ai/skills/format.js'

/** A SKILL.md from frontmatter lines and a body. */
const file = (front, body = 'Do the thing well.') => `---\n${front}\n---\n\n${body}\n`

/** The skill a file reads as, or a failure naming its errors. */
const read = (front, body) => {
  const result = parseSkill(file(front, body))
  if ('errors' in result) throw new Error(result.errors.join(' | '))
  return result.skill
}

/** The errors a file is refused with. */
const refused = (front, body) => {
  const result = parseSkill(file(front, body))
  if (!('errors' in result)) throw new Error('It was read')
  return result.errors
}

describe('parseSkill', () => {
  it('reads a skill as claude.ai has one: a name and a description, and instructions', () => {
    const skill = read(
      'name: house-style\ndescription: The house style. Load it before writing prose.',
      'Past tense, close third.'
    )

    expect(skill).toMatchObject({
      name: 'house-style',
      description: 'The house style. Load it before writing prose.',
      body: 'Past tense, close third.',
      // Anyone may call it, and it joins its caller's conversation.
      model: true,
      user: true,
      fork: false,
      argument: null,
      tools: [],
      speakers: null,
    })
    // With no line of its own for the writer, the description is it.
    expect(skill.summary).toBe(skill.description)
  })

  it('reads a Claude Code command: the writer’s alone, with what they typed in its body', () => {
    const skill = read(
      'name: tighten\ndescription: Cut a passage by a third.\ndisable-model-invocation: true\nargument-hint: <the passage>',
      'Tighten $ARGUMENTS by about a third.'
    )

    expect(skill).toMatchObject({ model: false, user: true, argumentHint: '<the passage>' })
    expect(skill.body).toBe('Tighten $ARGUMENTS by about a third.')
  })

  it('reads a skill that runs on its own, with one argument and the tools it is given', () => {
    const skill = read(
      [
        'name: critique',
        'description: Notes on a scene.',
        'context: fork',
        'arguments: [scene]',
        'allowed-tools: read_document, search_documents',
        'metadata:',
        '  inksprite-output: reply',
        '  inksprite-summary: Get notes on a scene.',
        '  inksprite-argument: Which scene, by title.',
        '  inksprite-speakers: writer editor',
      ].join('\n')
    )

    expect(skill).toMatchObject({
      fork: true,
      argument: 'scene',
      tools: ['read_document', 'search_documents'],
      output: 'reply',
      summary: 'Get notes on a scene.',
      argumentDescription: 'Which scene, by title.',
      speakers: { user: 'writer', assistant: 'editor' },
    })
  })

  it('takes tools as a list too', () => {
    expect(read('name: a\ndescription: A.\nallowed-tools: [oracle, roll_dice]').tools).toEqual([
      'oracle',
      'roll_dice',
    ])
  })

  it('answers back to whoever called it, unless only the writer can', () => {
    // A skill nobody but the writer calls is one they wanted to read.
    expect(read('name: a\ndescription: A.').output).toBe('result')
    expect(read('name: a\ndescription: A.\ndisable-model-invocation: true').output).toBe('reply')
  })

  it('adds when_to_use to the description the model reads, as Claude Code does', () => {
    expect(read('name: a\ndescription: Does A.\nwhen_to_use: When B.').description).toBe(
      'Does A. When B.'
    )
  })

  it('names the fields it does not use, rather than refusing the file for them', () => {
    const result = parseSkill(
      file('name: a\ndescription: A.\nmodel: claude-opus-5-5\neffort: high\nhooks: {}')
    )

    expect('skill' in result && result.ignored).toEqual(['model', 'effort', 'hooks'])
  })

  it('keeps a license and what it needs, when the file says', () => {
    expect(read('name: a\ndescription: A.\nlicense: MIT\ncompatibility: Any.')).toMatchObject({
      license: 'MIT',
      compatibility: 'Any.',
    })
  })

  it('refuses a name the standard or the command line would not take', () => {
    for (const name of ['House-Style', '-a', 'a-', 'a--b', '1st', 'a b', 'x'.repeat(65)]) {
      expect(refused(`name: ${JSON.stringify(name)}\ndescription: A.`).join(' '), name).toMatch(
        /name/i
      )
    }
  })

  it('refuses a skill with no name, no description, or nothing to do', () => {
    expect(refused('description: A.')).toEqual(['It needs a name.'])
    expect(refused('name: a')).toEqual(['It needs a description.'])
    expect(refused('name: a\ndescription: A.', '')).toEqual(['It needs instructions.'])
  })

  it('says what is wrong in the order to put it right: the name, the description, the instructions', () => {
    expect(refused('context: inline', '')).toEqual([
      'It needs a name.',
      'It needs a description.',
      'It needs instructions.',
    ])
  })

  it('reads a name YAML took for a number as the name that was written', () => {
    expect(refused('name: 2024\ndescription: A.').join(' ')).toMatch(/"2024" cannot be a name/)
  })

  it('takes a description longer than the standard allows', () => {
    expect(read(`name: a\ndescription: ${'x'.repeat(1025)}`).description).toHaveLength(1025)
  })

  it('reads a skill nobody can call', () => {
    const skill = read(
      'name: a\ndescription: A.\ndisable-model-invocation: true\nuser-invocable: false'
    )
    expect([skill.model, skill.user]).toEqual([false, false])
  })

  /** What a file reads as, with what was passed over in it. */
  const passed = front => {
    const result = parseSkill(file(front))
    if ('errors' in result) throw new Error(result.errors.join(' | '))
    return result
  }

  it('passes over a field whose value it cannot use, as it does one it has no use for', () => {
    const several = passed('name: a\ndescription: A.\narguments: [one, two]')
    expect(several.skill.argument).toBeNull()
    expect(several.ignored).toEqual(['arguments'])
    expect(several.unusable.join(' ')).toMatch(/one argument/)

    const inline = passed('name: a\ndescription: A.\ncontext: inline')
    expect(inline.skill.fork).toBe(false)
    expect(inline.ignored).toEqual(['context'])

    const emailed = passed('name: a\ndescription: A.\nmetadata:\n  inksprite-output: email')
    expect(emailed.skill.output).toBe('result')
    expect(emailed.ignored).toEqual(['metadata.inksprite-output'])

    const maybe = passed('name: a\ndescription: A.\nuser-invocable: maybe\nmodel: opus')
    expect(maybe.skill.user).toBe(true)
    expect(maybe.ignored).toEqual(['model', 'user-invocable'])
    expect(maybe.unusable).toEqual(['`user-invocable` has to be true or false.'])
  })

  it('passes over a hint that YAML read as a list, which unquoted brackets are', () => {
    const listed = passed('name: a\ndescription: A.\nargument-hint: [instructions]')
    expect(listed.skill.argumentHint).toBe('')
    expect(listed.ignored).toEqual(['argument-hint'])
    expect(read("name: a\ndescription: A.\nargument-hint: '[instructions]'").argumentHint).toBe(
      '[instructions]'
    )
  })

  it('refuses a file with no frontmatter, or frontmatter that cannot be read, in a line', () => {
    expect(parseSkill('Just some instructions.')).toEqual({
      errors: ['A skill starts with its frontmatter, between two lines of three dashes.'],
    })
    const unclosed = parseSkill(file('name: a\ndescription: [unclosed')).errors
    expect(unclosed).toHaveLength(1)
    expect(unclosed[0]).toMatch(/^The frontmatter can’t be read: .+, on line \d+\.$/)
    expect(unclosed[0]).not.toMatch(/\n/)
    expect(parseSkill(file('- a list')).errors).toEqual([
      'The frontmatter can’t be read: it has to be a set of fields.',
    ])
  })

  it('keeps a rule in the body as part of the body', () => {
    expect(read('name: a\ndescription: A.', 'Before.\n\n---\n\nAfter.').body).toBe(
      'Before.\n\n---\n\nAfter.'
    )
  })
})

describe('readBuiltInSkill', () => {
  it('throws for a skill the app ships that does not read, which is a bug', () => {
    expect(() => readBuiltInSkill('no frontmatter')).toThrow(/built-in skill does not read/)
  })

  it('holds one to the fields a file from elsewhere is let off', () => {
    expect(() => readBuiltInSkill(file('name: a\ndescription: A.\ncontext: inline'))).toThrow(
      /context/
    )
  })
})

describe('toolDefinitionFor', () => {
  it('makes a tool with no parameters of a skill with no argument', () => {
    const skill = read('name: director\ndescription: Ask it.')

    expect(toolDefinitionFor(skill)).toEqual({
      type: 'function',
      function: {
        name: 'director',
        description: 'Ask it.',
        parameters: { type: 'object', properties: {} },
      },
    })
  })

  it('makes its one argument a required parameter, described as the file describes it', () => {
    const skill = read(
      'name: interpret\ndescription: Ask it.\narguments: question\nmetadata:\n  inksprite-argument: One question.'
    )

    expect(toolDefinitionFor(skill).function.parameters).toEqual({
      type: 'object',
      properties: { question: { type: 'string', description: 'One question.' } },
      required: ['question'],
    })
  })

  it('describes the argument by its hint when the file says nothing else about it', () => {
    const skill = read('name: a\ndescription: A.\narguments: topic\nargument-hint: <topic>')

    expect(toolDefinitionFor(skill).function.parameters.properties.topic.description).toBe(
      '<topic>'
    )
  })

  it('tells the model that a skill answering as the reply ends its turn', () => {
    const skill = read(
      'name: scene\ndescription: Writes the scene.\ncontext: fork\nmetadata:\n  inksprite-output: reply'
    )

    expect(toolDefinitionFor(skill).function.description).toBe(
      `Writes the scene. ${HANDS_OVER_REPLY}`
    )
  })
})
