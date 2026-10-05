import { describe, it, expect } from 'vitest'
import { exposedNames, serverGroup, serverOfGroup, serverPrefix } from '@/mcp/names.js'

describe('serverPrefix', () => {
  it('makes a prefix of the name a function name can hold', () => {
    expect(serverPrefix('Hugging Face')).toBe('hugging_face')
    expect(serverPrefix('Café Notes!')).toBe('cafe_notes')
    expect(serverPrefix('***')).toBe('server')
  })

  it('keeps it short, and unlike any other server’s', () => {
    expect(serverPrefix('A server with a very long name indeed').length).toBeLessThanOrEqual(24)
    expect(serverPrefix('Linear', ['linear'])).toBe('linear_2')
    expect(serverPrefix('Linear', ['linear', 'linear_2'])).toBe('linear_3')
  })
})

describe('exposedNames', () => {
  it('names each tool under the server’s prefix', () => {
    expect(exposedNames('deepwiki', ['ask_question', 'read.wiki'])).toEqual([
      'deepwiki__ask_question',
      'deepwiki__read_wiki',
    ])
  })

  it('cuts a name to 64 characters, and numbers one that would come out the same', () => {
    const long = 'a'.repeat(80)
    const names = exposedNames('server', [long, `${long}b`])

    expect(names.every(name => name.length <= 64)).toBe(true)
    expect(names[0]).not.toBe(names[1])
    expect(names[1].endsWith('_2')).toBe(true)
  })

  it('leaves the names already taken to the tools that have them', () => {
    expect(exposedNames('s', ['search'], ['s__search'])).toEqual(['s__search_2'])
  })
})

describe('server groups', () => {
  it('tells a server’s group from the app’s own', () => {
    expect(serverOfGroup(serverGroup('mcp_1'))).toBe('mcp_1')
    expect(serverOfGroup('documents')).toBeNull()
    expect(serverOfGroup(undefined)).toBeNull()
  })
})
