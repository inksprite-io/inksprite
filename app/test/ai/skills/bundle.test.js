import { describe, it, expect } from 'vitest'
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import { findSkills, entriesFromZip, zipSkills, MAX_FILE_BYTES } from '@/ai/skills/bundle.js'
import { parseSkill } from '@/ai/skills/format.js'

/** A file handed over, as text. */
const entry = (path, text) => ({ path, bytes: strToU8(text) })

const skillFile = (name, extra = '') =>
  `---\nname: ${name}\ndescription: ${name}.\n${extra}---\n\nDo ${name}.\n`

describe('findSkills', () => {
  it('finds every SKILL.md in a skills folder, each with the files in its own folder', () => {
    const { skills, stray } = findSkills([
      entry('skills/tighten/SKILL.md', skillFile('tighten')),
      entry('skills/tighten/references/voice.md', 'Terse.'),
      entry('skills/critique/SKILL.md', skillFile('critique')),
      entry('skills/critique/examples/one.md', 'An example.'),
      entry('skills/README.md', '# My skills'),
    ])

    expect(skills.map(skill => [skill.path, skill.files.map(file => file.path)])).toEqual([
      ['skills/tighten/SKILL.md', ['references/voice.md']],
      ['skills/critique/SKILL.md', ['examples/one.md']],
    ])
    // A README with no frontmatter is in no skill's folder and is no skill.
    expect(stray).toEqual(['skills/README.md'])
  })

  it('gives a file to the deepest skill folder it is in', () => {
    const { skills } = findSkills([
      entry('a/SKILL.md', skillFile('a')),
      entry('a/b/SKILL.md', skillFile('b')),
      entry('a/b/notes.md', 'For b.'),
      entry('a/notes.md', 'For a.'),
    ])

    expect(
      Object.fromEntries(skills.map(skill => [skill.path, skill.files.map(f => f.path)]))
    ).toEqual({ 'a/SKILL.md': ['notes.md'], 'a/b/SKILL.md': ['notes.md'] })
  })

  it('reads a lone SKILL.md', () => {
    const { skills } = findSkills([entry('SKILL.md', skillFile('tighten'))])

    expect(skills).toHaveLength(1)
    expect(skills[0].text).toBe(skillFile('tighten'))
  })

  it('takes a Claude Code command, one file with no name, as a skill named for its file', () => {
    const { skills } = findSkills([
      entry('commands/fix-issue.md', '---\ndescription: Fix an issue.\n---\n\nFix $ARGUMENTS.\n'),
    ])

    const read = parseSkill(skills[0].text)
    expect('skill' in read && read.skill.name).toBe('fix-issue')
    expect('skill' in read && read.skill.body).toBe('Fix $ARGUMENTS.')
  })

  it('leaves scripts behind, and anything that is not text or is too big, and says so', () => {
    const { skills } = findSkills([
      entry('pdf/SKILL.md', skillFile('pdf')),
      entry('pdf/scripts/fill.py', 'print(1)'),
      { path: 'pdf/logo.png', bytes: new Uint8Array([0x89, 0x50, 0xff, 0xfe, 0x00]) },
      { path: 'pdf/huge.md', bytes: new Uint8Array(MAX_FILE_BYTES + 1).fill(97) },
      entry('pdf/forms.md', 'Forms.'),
    ])

    expect(skills[0].files.map(file => file.path)).toEqual(['forms.md'])
    expect(skills[0].dropped).toEqual([
      'scripts/fill.py: scripts can’t run here',
      'logo.png: not text',
      'huge.md: too big',
    ])
  })

  it('pays no attention to hidden files and what a Mac puts in a zip', () => {
    const { skills, stray } = findSkills([
      entry('tighten/SKILL.md', skillFile('tighten')),
      entry('tighten/.DS_Store', 'x'),
      entry('__MACOSX/tighten/._SKILL.md', 'x'),
      entry('.git/config', 'x'),
    ])

    expect(skills[0].files).toEqual([])
    expect(stray).toEqual([])
  })

  it('takes a path written the Windows way', () => {
    const { skills } = findSkills([
      entry('skills\\tighten\\SKILL.md', skillFile('tighten')),
      entry('skills\\tighten\\notes.md', 'Notes.'),
    ])

    expect(skills[0].files.map(file => file.path)).toEqual(['notes.md'])
  })
})

describe('zipSkills and entriesFromZip', () => {
  it('writes each skill in a folder of its name, and reads back what it wrote', () => {
    const zipped = zipSkills([
      {
        name: 'tighten',
        text: skillFile('tighten'),
        files: [{ path: 'references/voice.md', content: 'Terse.' }],
      },
      { name: 'critique', text: skillFile('critique') },
    ])

    expect(Object.keys(unzipSync(zipped)).sort()).toEqual([
      'critique/SKILL.md',
      'tighten/SKILL.md',
      'tighten/references/voice.md',
    ])

    const { skills } = findSkills(entriesFromZip(zipped))
    expect(skills.map(skill => [skill.text, skill.files])).toEqual([
      [skillFile('tighten'), [{ path: 'references/voice.md', content: 'Terse.' }]],
      [skillFile('critique'), []],
    ])
  })

  it('reads a zip made elsewhere, folders and all', () => {
    const zipped = zipSync({
      'my-skills/': new Uint8Array(),
      'my-skills/tighten/SKILL.md': strToU8(skillFile('tighten')),
    })

    const entries = entriesFromZip(zipped)
    expect(entries.map(one => one.path)).toEqual(['my-skills/tighten/SKILL.md'])
    expect(strFromU8(entries[0].bytes)).toBe(skillFile('tighten'))
  })
})
