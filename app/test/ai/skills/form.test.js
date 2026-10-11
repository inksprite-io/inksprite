import { describe, it, expect } from 'vitest'
import { formFromText, textFromForm, newSkillText } from '@/ai/skills/form.js'
import { parseSkill } from '@/ai/skills/format.js'

const critique = `---
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

/** The form a file reads as. */
const formOf = text => {
  const read = formFromText(text)
  if ('error' in read) throw new Error(read.error)
  return read
}

describe('formFromText', () => {
  it('reads the fields the form edits out of the frontmatter', () => {
    expect(formOf(critique).form).toEqual({
      name: 'critique',
      description: 'Notes on a scene.',
      summary: 'Get notes.',
      model: true,
      user: true,
      fork: true,
      output: 'result',
      argument: 'scene',
      argumentHint: '',
      tools: ['read_document', 'Read'],
      body: 'Give notes on $scene.',
    })
  })

  it('has no form for a file whose frontmatter cannot be read', () => {
    expect(formFromText('no frontmatter')).toEqual({
      error: 'A skill starts with its frontmatter, between two lines of three dashes.',
    })
  })
})

describe('textFromForm', () => {
  it('writes back what it read, and keeps every field the form does not reach', () => {
    const { form, front } = formOf(critique)
    const again = parseSkill(textFromForm(form, front))

    expect('skill' in again && again.skill).toMatchObject({
      name: 'critique',
      license: 'MIT',
      tools: ['read_document', 'Read'],
      summary: 'Get notes.',
    })
    expect(textFromForm(form, front)).toContain('author: someone')
  })

  it('keeps the fields in the order they were in', () => {
    const { form, front } = formOf(critique)
    const keys = textFromForm({ ...form, summary: '' }, front)
      .split('\n')
      .filter(line => /^[a-z-]+:/.test(line))
      .map(line => line.split(':')[0])

    expect(keys).toEqual([
      'name',
      'description',
      'license',
      'context',
      'arguments',
      'allowed-tools',
      'metadata',
    ])
  })

  it('takes settings at their default out rather than writing them', () => {
    const { form, front } = formOf(critique)
    const text = textFromForm(
      { ...form, fork: false, argument: '', tools: ['oracle'], summary: '' },
      front
    )

    expect(text).not.toMatch(/context:|arguments:|allowed-tools:|inksprite-summary|user-invocable/)
    // Metadata that still has something in it stays.
    expect(text).toContain('author: someone')
  })

  it('writes where the answer goes only when it runs on its own and it is not the default', () => {
    const { form, front } = formOf(critique)

    expect(textFromForm({ ...form, output: 'reply' }, front)).toContain('inksprite-output: reply')
    expect(textFromForm({ ...form, output: 'result' }, front)).not.toContain('inksprite-output')
    expect(textFromForm({ ...form, fork: false, output: 'reply' }, front)).not.toContain(
      'inksprite-output'
    )
  })

  it('writes who may call it', () => {
    const { form, front } = formOf(critique)
    const text = textFromForm({ ...form, model: false, user: true }, front)

    expect(text).toContain('disable-model-invocation: true')
    expect(textFromForm({ ...form, model: true, user: false }, front)).toContain(
      'user-invocable: false'
    )
  })

  it('writes a hint YAML would read as a list as text', () => {
    const { form, front } = formOf(critique)
    const again = parseSkill(textFromForm({ ...form, argumentHint: '[instructions]' }, front))

    expect('skill' in again && again.skill.argumentHint).toBe('[instructions]')
  })
})

describe('newSkillText', () => {
  it('starts a new skill as a saved prompt, with nothing written for it', () => {
    const read = formFromText(newSkillText('new-skill'))

    expect('form' in read && read.form).toMatchObject({
      name: 'new-skill',
      description: '',
      body: '',
      model: false,
      user: true,
      fork: false,
    })
  })

  it('reads as a skill once its description and instructions are written', () => {
    const read = formFromText(newSkillText('new-skill'))
    if (!('form' in read)) throw new Error('no form')
    const written = textFromForm({ ...read.form, description: 'Tightens.', body: 'Cut it.' })

    expect('skill' in parseSkill(written)).toBe(true)
  })
})
