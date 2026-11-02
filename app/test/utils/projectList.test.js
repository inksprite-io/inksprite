import { describe, it, expect } from 'vitest'
import { projectsNamed, recentProjects, sortProjects } from '@/utils/projectList.js'

const row = (name, edited, created) => ({ id: `story_${name}`, name, edited, created })
const names = rows => rows.map(project => project.name)

describe('sortProjects', () => {
  const rows = [row('Draft 10', 3, 1), row('apple', 1, 3), row('Draft 2', 2, 2)]

  it('sorts by name with numbers as numbers, and back', () => {
    expect(names(sortProjects(rows, { by: 'name', descending: false }))).toEqual([
      'apple',
      'Draft 2',
      'Draft 10',
    ])
    expect(names(sortProjects(rows, { by: 'name', descending: true }))).toEqual([
      'Draft 10',
      'Draft 2',
      'apple',
    ])
  })

  it('sorts by a time, either way', () => {
    expect(names(sortProjects(rows, { by: 'edited', descending: true }))).toEqual([
      'Draft 10',
      'Draft 2',
      'apple',
    ])
    expect(names(sortProjects(rows, { by: 'created', descending: false }))).toEqual([
      'Draft 10',
      'Draft 2',
      'apple',
    ])
  })

  it('keeps projects of one time by name, whichever way the times run', () => {
    const same = [row('b', 5), row('a', 5), row('c', 9)]
    expect(names(sortProjects(same, { by: 'edited', descending: true }))).toEqual(['c', 'a', 'b'])
    expect(names(sortProjects(same, { by: 'edited', descending: false }))).toEqual(['a', 'b', 'c'])
  })

  it('puts a project with no time yet at the end of the latest first', () => {
    const rowsWithUnknown = [row('unknown'), row('known', 5)]
    expect(names(sortProjects(rowsWithUnknown, { by: 'edited', descending: true }))).toEqual([
      'known',
      'unknown',
    ])
  })

  it('leaves what it was given as it was', () => {
    const given = [row('b', 1), row('a', 2)]
    sortProjects(given, { by: 'name', descending: false })
    expect(names(given)).toEqual(['b', 'a'])
  })
})

describe('recentProjects', () => {
  it('gives the latest edited first, up to the limit', () => {
    const rows = [row('a', 1), row('b', 3), row('c', 2)]
    expect(names(recentProjects(rows, 2))).toEqual(['b', 'c'])
  })
})

describe('projectsNamed', () => {
  const rows = [row('The Long Road'), row('Road Notes'), row('Éire')]

  it('gives them all for no query', () => {
    expect(projectsNamed(rows, '')).toEqual(rows)
    expect(projectsNamed(rows, '   ')).toEqual(rows)
  })

  it('finds a part of a name, without case', () => {
    expect(names(projectsNamed(rows, 'ROAD'))).toEqual(['The Long Road', 'Road Notes'])
  })

  it('wants every word, in any order', () => {
    expect(names(projectsNamed(rows, 'road long'))).toEqual(['The Long Road'])
  })

  it('finds a name without its accents, and with them', () => {
    expect(names(projectsNamed(rows, 'eire'))).toEqual(['Éire'])
    expect(names(projectsNamed(rows, 'éire'))).toEqual(['Éire'])
  })

  it('finds nothing where no name has it', () => {
    expect(projectsNamed(rows, 'nowhere')).toEqual([])
  })
})
