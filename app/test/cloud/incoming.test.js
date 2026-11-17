import { describe, it, expect } from 'vitest'
import { belongs, isStoryId, refusal } from '@/cloud/incoming.js'
import { SETUP } from '@/cloud/setup.js'

const mine = { storyId: 'story_a', shared: false, role: 'owner' }
const shared = { storyId: 'story_a', shared: true, role: 'member' }
const setup = { storyId: SETUP }

/** @param {object} row @param {string} [table] */
const record = (row, table = 'documents') => ({ table, id: row.id, schema: 32, row })

describe('a project’s id', () => {
  it('is never the setup’s, nor anything but letters, digits, dashes and underscores', () => {
    expect(isStoryId('story_V1StGXR8_Z5jdHi6B-myT')).toBe(true)
    expect(isStoryId(SETUP)).toBe(false)
    expect(isStoryId('')).toBe(false)
    expect(isStoryId('story:a')).toBe(false)
    expect(isStoryId('../story')).toBe(false)
    expect(isStoryId(undefined)).toBe(false)
    expect(isStoryId({ id: 'story_a' })).toBe(false)
  })
})

describe('a record of a project', () => {
  it('is taken as a row of the project, under its own id', () => {
    expect(refusal(mine, record({ id: 'doc_1', storyId: 'story_a' }))).toBeNull()
    expect(refusal(mine, record({ id: 'story_a' }, 'stories'))).toBeNull()
    expect(refusal(mine, record({ id: 'ver_1', storyId: 'story_a' }, 'versions'))).toBeNull()
    expect(refusal(mine, record({ id: 'doc_1/a.png', storyId: 'story_a' }, 'files'))).toBeNull()
    expect(refusal(mine, record({ id: 'msg_1', chatId: 'chat_1' }, 'messages'))).toBeNull()
    expect(refusal(mine, { table: 'documents', id: 'doc_1', schema: 32, deleted: true })).toBeNull()
  })

  it('is not taken as a row of the setup, or of a table there isn’t', () => {
    for (const table of ['aiProviders', 'mcpServers', 'skills', 'cloudState', 'settings', 'x']) {
      expect(refusal(mine, record({ id: 'one', storyId: 'story_a' }, table))).toBe('table')
    }
  })

  it('is not taken as another project’s row', () => {
    expect(refusal(mine, record({ id: 'doc_1', storyId: 'story_b' }))).toBe('project')
    expect(refusal(mine, record({ id: 'doc_1' }))).toBe('project')
    expect(refusal(mine, record({ id: 'chat_1', storyId: 'story_b' }, 'chats'))).toBe('project')
    expect(refusal(mine, record({ id: 'story_b' }, 'stories'))).toBe('project')
    expect(refusal(mine, { table: 'stories', id: 'story_b', schema: 32, deleted: true })).toBe(
      'project'
    )
  })

  it('is not taken as another project’s root, even to remove it', () => {
    expect(refusal(mine, record({ id: 'root_story_a', storyId: 'story_a' }))).toBeNull()
    expect(refusal(mine, record({ id: 'root_story_b', storyId: 'story_a' }))).toBe('project')
    expect(
      refusal(mine, { table: 'documents', id: 'root_story_b', schema: 32, deleted: true })
    ).toBe('project')
  })

  it('is not taken under an id its row doesn’t have', () => {
    expect(
      refusal(mine, { table: 'documents', id: 'doc_1', row: { id: 'doc_2', storyId: 'story_a' } })
    ).toBe('id')
  })

  it('is not taken without a row, a table or an id', () => {
    expect(refusal(mine, null)).toBe('shape')
    expect(refusal(mine, { table: 'documents', id: 'doc_1' })).toBe('shape')
    expect(refusal(mine, { table: 'documents', id: 'doc_1', row: [] })).toBe('shape')
    expect(refusal(mine, { table: 'documents', id: '', row: { id: '' } })).toBe('shape')
    expect(refusal(mine, { id: 'doc_1', row: { id: 'doc_1' } })).toBe('shape')
    expect(refusal(mine, record({ id: 'msg_1' }, 'messages'))).toBe('shape')
  })
})

describe('a chat in a project others are in', () => {
  const chat = record({ id: 'chat_1', storyId: 'story_a' }, 'chats')
  const message = record({ id: 'msg_1', chatId: 'chat_1' }, 'messages')

  it('is taken only as this account’s own', () => {
    expect(refusal(shared, chat, { own: true })).toBeNull()
    expect(refusal(shared, message, { own: true })).toBeNull()
    expect(refusal(shared, chat)).toBe('own')
    expect(refusal(shared, message)).toBe('own')
    expect(refusal({ ...mine, shared: true }, chat)).toBe('own')
  })

  it('is taken as it is where nobody else is', () => {
    expect(refusal(mine, chat)).toBeNull()
    expect(refusal(mine, message)).toBeNull()
  })

  it('leaves a document everyone’s', () => {
    expect(refusal(shared, record({ id: 'doc_1', storyId: 'story_a' }))).toBeNull()
  })
})

describe('a record of the setup', () => {
  it('is taken as a row of the setup’s tables, under its own id', () => {
    expect(refusal(setup, record({ id: 'conn_1' }, 'aiProviders'))).toBeNull()
    expect(refusal(setup, record({ id: 'general' }, 'settings'))).toBeNull()
    expect(refusal(setup, { table: 'skills', id: 'skill_1', schema: 32, deleted: true })).toBeNull()
  })

  it('is not taken as a project’s row, or under another id', () => {
    expect(refusal(setup, record({ id: 'doc_1', storyId: 'story_a' }))).toBe('table')
    expect(refusal(setup, record({ id: 'story_a' }, 'stories'))).toBe('table')
    expect(refusal(setup, { table: 'aiProviders', id: 'conn_1', row: { id: 'conn_2' } })).toBe('id')
  })
})

describe('a row about to be written', () => {
  it('is its project’s, of a project’s table', () => {
    const row = { id: 'doc_1', storyId: 'story_a' }
    expect(belongs('story_a', { table: 'documents', id: 'doc_1', row })).toBe(true)
    expect(belongs('story_a', { table: 'documents', id: 'doc_1', row: null })).toBe(true)
    expect(belongs('story_a', { table: 'stories', id: 'story_a', row: { id: 'story_a' } })).toBe(
      true
    )
    expect(belongs('story_b', { table: 'documents', id: 'doc_1', row })).toBe(false)
    expect(belongs('story_a', { table: 'stories', id: 'story_b', row: null })).toBe(false)
    expect(belongs('story_a', { table: 'mcpServers', id: 'mcp_1', row: { id: 'mcp_1' } })).toBe(
      false
    )
    expect(belongs('story_a', { table: 'cloudState', id: 'account', row: {} })).toBe(false)
  })

  it('is the setup’s, of the setup’s tables', () => {
    expect(belongs(SETUP, { table: 'aiProviders', id: 'conn_1', row: { id: 'conn_1' } })).toBe(true)
    expect(belongs(SETUP, { table: 'settings', id: 'general', row: { id: 'general' } })).toBe(true)
    expect(belongs(SETUP, { table: 'documents', id: 'doc_1', row: null })).toBe(false)
    expect(belongs(SETUP, { table: 'cloudState', id: 'account', row: {} })).toBe(false)
  })
})
