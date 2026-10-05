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
    expect(refused('description: A.').join(' ')).toMatch(/needs a `name`/)
    expect(refused('name: a').join(' ')).toMatch(/needs a `description`/)
    expect(refused('name: a\ndescription: A.', '').join(' ')).toMatch(/needs instructions/)
  })

  it('refuses a description longer than the standard allows', () => {
    expect(refused(`name: a\ndescription: ${'x'.repeat(1025)}`).join(' ')).toMatch(/longer/)
  })

  it('refuses a skill nobody can call', () => {
    expect(
      refused('name: a\ndescription: A.\ndisable-model-invocation: true\nuser-invocable: false')
    ).toEqual(['Nobody can call it: the model is kept from it, and so are you.'])
  })

  it('refuses more than one argument: a command is everything after its name', () => {
    expect(refused('name: a\ndescription: A.\narguments: [one, two]').join(' ')).toMatch(
      /one argument/
    )
  })

  it('refuses a context it cannot run, and an output it has not heard of', () => {
    expect(refused('name: a\ndescription: A.\ncontext: inline').join(' ')).toMatch(/fork/)
    expect(
      refused('name: a\ndescription: A.\nmetadata:\n  inksprite-output: email').join(' ')
    ).toMatch(/inksprite-output/)
  })

  it('refuses a hint that YAML read as a list, which unquoted brackets are', () => {
    expect(refused('name: a\ndescription: A.\nargument-hint: [instructions]').join(' ')).toMatch(
      /argument-hint/
    )
    expect(read("name: a\ndescription: A.\nargument-hint: '[instructions]'").argumentHint).toBe(
      '[instructions]'
    )
  })

  it('says everything that is wrong at once, so a file is fixed once', () => {
    expect(refused('context: inline\nuser-invocable: maybe')).toHaveLength(4)
  })

  it('refuses a file with no frontmatter, or frontmatter that is not YAML', () => {
    expect(parseSkill('Just some instructions.')).toEqual({
      errors: ['A skill starts with its frontmatter, between two lines of three dashes.'],
    })
    expect(parseSkill(file('name: [unclosed')).errors[0]).toMatch(/not YAML/)
    expect(parseSkill(file('- a list')).errors).toEqual([
      'Its frontmatter has to be a set of fields.',
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
