import { describe, it, expect } from 'vitest'
import { formFromText, nameFromTitle, textFromForm, withName } from '@/ai/skills/form.js'
import { parseSkill, splitSkill } from '@/ai/skills/format.js'

const critique = `---
# Kept for the workshop.
name: critique
description: Notes on a scene.
license: MIT
context: fork
arguments: scene
allowed-tools: read_document Read
metadata:
  author: someone
  inksprite-summary: Get notes.
---

Give notes on $scene.
`

/** The fields a file reads as. */
const formOf = text => {
  const read = formFromText(text)
  if ('error' in read) throw new Error(read.error)
  return read.form
}

/** The frontmatter a file has. */
const frontOf = text => {
  const split = splitSkill(text)
  if ('error' in split) throw new Error(split.error)
  return split.front
}

describe('formFromText', () => {
  it('reads the three fields out of the file', () => {
    expect(formOf(critique)).toEqual({
      name: 'critique',
      description: 'Notes on a scene.',
      body: 'Give notes on $scene.',
    })
  })

  it('has no fields for a file whose frontmatter cannot be read, and says why', () => {
    expect(formFromText('Just instructions.')).toEqual({
      error: 'A skill starts with its frontmatter, between two lines of three dashes.',
    })
  })

  it('shows a name YAML took for a number, and nothing for a field that is not text', () => {
    expect(formOf('---\nname: 2024\ndescription: [a, b]\n---\n\nDo it.\n')).toEqual({
      name: '2024',
      description: '',
      body: 'Do it.',
    })
  })
})

describe('textFromForm', () => {
  it('leaves the frontmatter as it was written when only the instructions change', () => {
    const text = textFromForm({ ...formOf(critique), body: 'Give notes.\n\nBe kind.' }, critique)

    expect(text).toBe(critique.replace('Give notes on $scene.', 'Give notes.\n\nBe kind.'))
    expect(text).toContain('# Kept for the workshop.')
  })

  it('writes a new name or description into the frontmatter, and keeps every other field', () => {
    const text = textFromForm(
      { name: 'notes', description: 'Notes on a chapter.', body: 'Give notes on $scene.' },
      critique
    )

    expect(frontOf(text)).toEqual({
      name: 'notes',
      description: 'Notes on a chapter.',
      license: 'MIT',
      context: 'fork',
      arguments: 'scene',
      'allowed-tools': 'read_document Read',
      metadata: { author: 'someone', 'inksprite-summary': 'Get notes.' },
    })
    expect(Object.keys(frontOf(text)).slice(0, 3)).toEqual(['name', 'description', 'license'])
    expect(formOf(text).body).toBe('Give notes on $scene.')
  })

  it('gives back the file it read, for fields nobody changed', () => {
    expect(textFromForm(formOf(critique), critique)).toBe(critique)
  })

  it('writes a file from nothing', () => {
    const text = textFromForm({ name: 'tighten', description: 'Cuts a passage.', body: 'Cut it.' })

    const read = parseSkill(text)
    expect('skill' in read && read.skill).toMatchObject({
      name: 'tighten',
      description: 'Cuts a passage.',
      body: 'Cut it.',
      model: true,
      user: true,
      fork: false,
    })
  })
})

describe('nameFromTitle', () => {
  it('makes the name a skill is called by from what was written for one', () => {
    expect(nameFromTitle('Short Story Editor')).toBe('short-story-editor')
    expect(nameFromTitle('  Plot & Pacing  ')).toBe('plot-pacing')
    expect(nameFromTitle('scene_critique!')).toBe('scene-critique')
    expect(nameFromTitle('The Writer’s Room')).toBe('the-writers-room')
    expect(nameFromTitle('Éditeur de scène')).toBe('editeur-de-scene')
    expect(nameFromTitle('2nd draft')).toBe('nd-draft')
    expect(nameFromTitle('x'.repeat(80))).toHaveLength(64)
  })

  it('leaves a name written as one alone', () => {
    expect(nameFromTitle('my-skill')).toBe('my-skill')
  })

  it('finds no name where there is nothing to make one of', () => {
    expect(nameFromTitle('')).toBe('')
    expect(nameFromTitle('  ')).toBe('')
    expect(nameFromTitle('?!')).toBe('')
  })
})

describe('a name written as a title', () => {
  const written = { name: 'Short Story Editor', description: 'Notes.', body: 'Give notes.' }

  it('is kept beside the name made from it, and read back as it was written', () => {
    const text = textFromForm(written)

    expect(frontOf(text)).toEqual({
      name: 'short-story-editor',
      description: 'Notes.',
      metadata: { 'inksprite-title': 'Short Story Editor' },
    })
    expect(formOf(text)).toEqual(written)
    const read = parseSkill(text)
    expect('skill' in read && read.skill).toMatchObject({
      name: 'short-story-editor',
      title: 'Short Story Editor',
    })
  })

  it('is not kept where the name already says it', () => {
    const text = textFromForm({ ...written, name: 'my-skill' }, textFromForm(written))

    expect(frontOf(text)).toEqual({ name: 'my-skill', description: 'Notes.' })
  })

  it('goes in beside what the file already keeps under metadata', () => {
    const text = textFromForm({ ...formOf(critique), name: 'Scene Critique' }, critique)

    expect(frontOf(text).name).toBe('scene-critique')
    expect(frontOf(text).metadata).toEqual({
      author: 'someone',
      'inksprite-summary': 'Get notes.',
      'inksprite-title': 'Scene Critique',
    })
  })

  it('leaves the frontmatter as it was written when only the instructions change', () => {
    const text = textFromForm(written)

    expect(textFromForm({ ...written, body: 'Be kind.' }, text)).toBe(
      text.replace('Give notes.', 'Be kind.')
    )
  })

  it('keeps a file with no name, for a name that was cleared', () => {
    const text = textFromForm({ ...written, name: '' }, textFromForm(written))

    expect(formOf(text).name).toBe('')
    expect(parseSkill(text)).toEqual({ errors: ['It needs a name.'] })
  })
})

describe('withName', () => {
  it('renames a skill and leaves the rest of it', () => {
    const text = withName(critique, 'notes')

    expect(frontOf(text)).toMatchObject({ name: 'notes', license: 'MIT', context: 'fork' })
    expect(formOf(text).body).toBe('Give notes on $scene.')
  })

  it('leaves a file it cannot read as it is', () => {
    expect(withName('Just instructions.', 'notes')).toBe('Just instructions.')
  })
})
