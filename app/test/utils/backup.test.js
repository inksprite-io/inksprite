import { describe, it, expect } from 'vitest'
import {
  BACKUP_FORMAT,
  buildBackup,
  redactApiKeys,
  validateBackup,
  upgradeTables,
  summarizeBackup,
  backupFilename,
  chatFilename,
  chatFromTables,
} from '@/utils/backup.js'

const validBackup = (overrides = {}) => ({
  app: 'inksprite',
  format: BACKUP_FORMAT,
  dbVersion: 2,
  exported: 1000,
  includesApiKeys: false,
  tables: { stories: [], aiPrompts: [] },
  ...overrides,
})

describe('redactApiKeys', () => {
  it('removes the key but keeps everything else', () => {
    const out = redactApiKeys([
      { id: 'p1', name: 'OpenRouter', apiKey: 'sk-secret', rememberKey: true },
    ])
    expect(out[0]).toEqual({ id: 'p1', name: 'OpenRouter', rememberKey: true })
    expect('apiKey' in out[0]).toBe(false)
  })

  it('leaves providers that never stored one alone', () => {
    const provider = { id: 'p1', name: 'Local', rememberKey: false }
    expect(redactApiKeys([provider])[0]).toBe(provider)
  })
})

describe('buildBackup', () => {
  const tables = {
    stories: [{ id: 's1' }],
    aiProviders: [{ id: 'p1', apiKey: 'sk-secret' }],
  }

  it('redacts provider keys by default', () => {
    const backup = buildBackup(tables, { dbVersion: 2, exported: 42 })

    expect(backup.includesApiKeys).toBe(false)
    expect(backup.tables.aiProviders[0].apiKey).toBeUndefined()
    // Untouched tables pass through.
    expect(backup.tables.stories).toEqual([{ id: 's1' }])
  })

  it('keeps keys when asked, and says so in the envelope', () => {
    const backup = buildBackup(tables, { dbVersion: 2, includeApiKeys: true, exported: 42 })

    expect(backup.includesApiKeys).toBe(true)
    expect(backup.tables.aiProviders[0].apiKey).toBe('sk-secret')
  })

  it('stamps the envelope so an import knows what it is reading', () => {
    const backup = buildBackup(tables, { dbVersion: 3, exported: 42 })

    expect(backup.app).toBe('inksprite')
    expect(backup.format).toBe(BACKUP_FORMAT)
    expect(backup.dbVersion).toBe(3)
    expect(backup.exported).toBe(42)
  })

  it('does not mutate the tables it was given', () => {
    const original = { aiProviders: [{ id: 'p1', apiKey: 'sk-secret' }] }
    buildBackup(original, { dbVersion: 2 })
    expect(original.aiProviders[0].apiKey).toBe('sk-secret')
  })

  it('says what the file holds', () => {
    expect(buildBackup(tables, { dbVersion: 2 }).scope).toBe('database')
    expect(buildBackup({ chats: [] }, { dbVersion: 2, scope: 'chat' }).scope).toBe('chat')
  })
})

describe('validateBackup', () => {
  it('accepts a backup taken at the running version', () => {
    expect(validateBackup(validBackup(), 2)).toEqual({ ok: true, errors: [] })
  })

  it('reads a file from before there were scopes as a whole backup', () => {
    const { scope: _scope, ...unscoped } = validBackup({ scope: 'database' })
    expect(validateBackup(unscoped, 2).ok).toBe(true)
    expect(validateBackup(unscoped, 2, 'chat').ok).toBe(false)
  })

  it('sends a chat file to the chat list', () => {
    const { ok, errors } = validateBackup(validBackup({ scope: 'chat' }), 2)
    expect(ok).toBe(false)
    expect(errors.join(' ')).toContain('Import it from the chat list')
  })

  it('sends a whole backup to the Data settings', () => {
    const { ok, errors } = validateBackup(validBackup(), 2, 'chat')
    expect(ok).toBe(false)
    expect(errors.join(' ')).toContain('Restore it from the Data settings')
  })

  it('refuses a scope it has never heard of', () => {
    const { ok, errors } = validateBackup(validBackup({ scope: 'library' }), 2)
    expect(ok).toBe(false)
    expect(errors.join(' ')).toContain('Update the app first')
  })

  it('accepts an older backup when an upgrade path exists', () => {
    const result = validateBackup(validBackup({ dbVersion: 1 }), 2)
    expect(result.ok).toBe(true)
  })

  it('rejects an older backup with no upgrade path', () => {
    // Nothing is registered for a version this far ahead.
    const result = validateBackup(validBackup({ dbVersion: 1 }), 999)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('No upgrade path')
  })

  it('rejects a backup from a newer app', () => {
    const result = validateBackup(validBackup({ dbVersion: 5 }), 2)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('Update the app first')
  })

  it('rejects a newer envelope format', () => {
    const result = validateBackup(validBackup({ format: BACKUP_FORMAT + 1 }), 2)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('newer than this version')
  })

  it('rejects JSON that came from somewhere else', () => {
    const result = validateBackup({ some: 'other file' }, 2)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('not exported from InkSprite')
  })

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['an array', []],
  ])('rejects %s', (_label, value) => {
    expect(validateBackup(value, 2).ok).toBe(false)
  })

  it('rejects a table that is not a list of rows', () => {
    const result = validateBackup(validBackup({ tables: { stories: { id: 's1' } } }), 2)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain("Table 'stories'")
  })
})

describe('upgradeTables', () => {
  it('passes data through when the versions match', () => {
    const tables = { stories: [{ id: 's1' }] }
    expect(upgradeTables(tables, 2, 2)).toBe(tables)
  })

  it('adds the table a later schema version introduced', () => {
    const out = upgradeTables({ stories: [{ id: 's1' }] }, 1, 2)

    expect(out.aiPrompts).toEqual([])
    expect(out.stories).toEqual([{ id: 's1' }])
  })

  it('keeps rows a backup already had for a table the upgrade introduces', () => {
    const out = upgradeTables({ aiPrompts: [{ id: 'prompt_1' }] }, 1, 2)
    expect(out.aiPrompts).toEqual([{ id: 'prompt_1' }])
  })

  it('rebuilds documents from a backup taken before the tree migration', () => {
    const out = upgradeTables(
      {
        parts: [{ id: 'part_1', storyId: 'story_1', order: 0, title: 'Act 1' }],
        scenes: [{ id: 'scene_1', partId: 'part_1', order: 0, title: 'Ch 1', content: '<p>x</p>' }],
      },
      2,
      3
    )

    expect(out.documents.map(d => [d.id, d.type, d.parentId])).toEqual([
      ['part_1', 'folder', 'story_1'],
      ['scene_1', 'text', 'part_1'],
    ])
    // The old tables ride along untouched — they are the way back.
    expect(out.parts).toHaveLength(1)
    expect(out.scenes).toHaveLength(1)
  })

  it('folds lore into documents for a backup taken before v5', () => {
    const out = upgradeTables(
      {
        stories: [{ id: 'story_1', title: 'A Novel' }],
        parts: [],
        scenes: [],
        lorebooks: [{ id: 'lorebook_1', storyId: 'story_1' }],
        loreEntries: [
          {
            id: 'lore_1',
            lorebookId: 'lorebook_1',
            name: 'Elara',
            category: 'Characters',
            content: 'A knight.',
            enabled: true,
          },
        ],
      },
      2,
      5
    )

    const elara = out.documents.find(d => d.id === 'lore_1')
    expect(elara).toMatchObject({ type: 'text', title: 'Elara', content: '<p>A knight.</p>' })
    // v4 gave the story its notes folder; v5 hangs the category off it.
    expect(out.documents.find(d => d.id === elara.parentId)).toMatchObject({
      type: 'folder',
      title: 'Characters',
      parentId: 'notes_story_1',
    })
    // The old tables ride along untouched.
    expect(out.loreEntries).toHaveLength(1)
    expect(out.lorebooks).toHaveLength(1)
  })

  it('does not duplicate lore when restoring a backup taken after v5', () => {
    const tables = {
      stories: [{ id: 'story_1' }],
      lorebooks: [{ id: 'lorebook_1', storyId: 'story_1' }],
      loreEntries: [{ id: 'lore_1', lorebookId: 'lorebook_1', name: 'Elara', enabled: true }],
      documents: [
        { id: 'root_story_1', storyId: 'story_1', parentId: 'story_1', type: 'folder' },
        { id: 'notes_story_1', storyId: 'story_1', parentId: 'root_story_1', type: 'folder' },
        { id: 'lore_1', storyId: 'story_1', parentId: 'notes_story_1', type: 'text' },
      ],
    }

    const out = upgradeTables(tables, 4, 5)
    expect(out.documents.filter(d => d.id === 'lore_1')).toHaveLength(1)
  })

  it('rewrites stored slash commands on the way to v8', () => {
    const tables = {
      messages: [
        {
          id: 'm1',
          metadata: {
            command: { name: 'oracle', args: ['Is it locked?', 'likely'], result: 'no' },
          },
        },
      ],
    }

    const out = upgradeTables(tables, 7, 8)
    expect(out.messages[0].metadata.command).toMatchObject({
      input: 'Is it locked?',
      param: 'likely',
      result: 'no',
    })
  })

  it('moves a consultation into the assistant voice on the way to v9', () => {
    const tables = {
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: '<interpret>\nWhat is he afraid of?\nHe is waiting.\n</interpret>',
          metadata: {
            command: {
              name: 'interpret',
              input: 'What is he afraid of?',
              result: 'He is waiting.',
            },
          },
        },
      ],
    }

    const out = upgradeTables(tables, 8, 9)
    expect(out.messages[0]).toMatchObject({ role: 'assistant', content: 'He is waiting.' })
  })

  it('marks the people among the stored commands on the way to v10', () => {
    const tables = {
      messages: [
        { id: 'm1', metadata: { command: { name: 'cody', result: 'I hide.' } } },
        { id: 'm2', metadata: { command: { name: 'oracle', result: 'no' } } },
      ],
    }

    const out = upgradeTables(tables, 9, 10)
    expect(out.messages[0].metadata.command.character).toBe(true)
    expect(out.messages[1].metadata.command.character).toBeUndefined()
  })

  it("folds a run of the writer's messages on the way to v12", () => {
    const piece = content => ({ type: 'text', content })
    const tables = {
      messages: [
        {
          id: 'm1',
          chatId: 'c',
          role: 'user',
          content: 'I try the door.',
          segments: [piece('I try the door.')],
          created: 1,
        },
        {
          id: 'm2',
          chatId: 'c',
          role: 'user',
          content: 'It sticks.',
          segments: [piece('It sticks.')],
          created: 2,
        },
      ],
    }

    const out = upgradeTables(tables, 11, 12)
    expect(out.messages).toHaveLength(1)
    expect(out.messages[0].content).toBe('I try the door.\n\nIt sticks.')
  })

  it('turns documents into markdown on the way to v13', () => {
    const out = upgradeTables(
      {
        documents: [
          { id: 'doc_1', type: 'text', content: '<p>Snow <em>fell</em>.</p><p>Then more.</p>' },
          { id: 'folder_1', type: 'folder', content: '' },
        ],
        stories: [{ id: 'story_1' }],
      },
      12,
      13
    )

    expect(out.documents.map(d => d.content)).toEqual(['Snow *fell*.\n\nThen more.', ''])
    expect(out.stories).toEqual([{ id: 'story_1' }])
  })

  it('moves summaries to where they are read on the way to v15', () => {
    const said = (id, created) => ({ id, chatId: 'chat_1', role: 'user', content: id, created })
    const out = upgradeTables(
      {
        messages: [
          said('a', 10),
          said('b', 20),
          said('c', 30),
          {
            ...said('s', 40),
            role: 'assistant',
            metadata: { command: { name: 'compact', input: '', keep: 1, result: 'They crossed.' } },
          },
        ],
        chats: [{ id: 'chat_1' }],
      },
      14,
      15
    )

    // A backup taken before the move restores into the order the app reads.
    const order = [...out.messages].sort((x, y) => x.created - y.created).map(m => m.id)
    expect(order).toEqual(['a', 'b', 's', 'c'])
    expect(out.messages).toHaveLength(4)
    expect(out.chats).toEqual([{ id: 'chat_1' }])
  })

  it('empties the trash on the way to v17', () => {
    const out = upgradeTables(
      {
        messages: [
          { id: 'm1', chatId: 'c1' },
          { id: 'gone', chatId: 'c1', deleted: true, deletedAt: 5 },
        ],
        documents: [
          { id: 'doc_live', type: 'file' },
          { id: 'doc_gone', type: 'file', deleted: true },
        ],
        files: [{ id: 'doc_live' }, { id: 'doc_gone' }],
        chats: [{ id: 'c1', deleted: false }],
      },
      16,
      17
    )

    expect(out.messages).toEqual([{ id: 'm1', chatId: 'c1' }])
    expect(out.documents.map(d => d.id)).toEqual(['doc_live'])
    // The bytes go with their document.
    expect(out.files.map(f => f.id)).toEqual(['doc_live'])
    expect(out.chats).toEqual([{ id: 'c1', deleted: false }])
  })

  it('throws rather than guessing when a version has no transform', () => {
    expect(() => upgradeTables({}, 1, 999)).toThrow(/No backup upgrade path to schema version \d+/)
  })

  it('refuses to downgrade', () => {
    expect(() => upgradeTables({}, 3, 2)).toThrow('Cannot downgrade')
  })
})

describe('summarizeBackup', () => {
  it('orders by size and drops empty tables', () => {
    const summary = summarizeBackup({
      tables: { stories: [1, 2], messages: [1, 2, 3, 4], sceneBeats: [] },
    })

    expect(summary).toEqual([
      { table: 'messages', count: 4 },
      { table: 'stories', count: 2 },
    ])
  })

  it('handles a backup with no tables', () => {
    expect(summarizeBackup({ tables: {} })).toEqual([])
  })
})

describe('backupFilename', () => {
  it('pads month and day so filenames sort chronologically', () => {
    expect(backupFilename(new Date(2026, 7, 3))).toBe('inksprite-backup-2026-08-03.json')
  })
})

describe('chatFilename', () => {
  it('names the file after the chat', () => {
    expect(chatFilename('Plot holes in Act Two')).toBe('inksprite-chat-plot-holes-in-act-two.json')
  })

  it('keeps letters from any alphabet and drops the rest', () => {
    expect(chatFilename('  Café / 第二幕?  ')).toBe('inksprite-chat-café-第二幕.json')
  })

  it('has a name for a chat without one', () => {
    expect(chatFilename('')).toBe('inksprite-chat-untitled.json')
    expect(chatFilename('!!!')).toBe('inksprite-chat-untitled.json')
  })

  it('does not run on', () => {
    const name = chatFilename('word '.repeat(40))
    expect(name.length).toBeLessThanOrEqual('inksprite-chat-'.length + 60 + '.json'.length)
    expect(name).not.toMatch(/-\.json$/)
  })
})

describe('chatFromTables', () => {
  it('picks the chat and its messages, oldest first', () => {
    const { chat, messages } = chatFromTables({
      chats: [{ id: 'c1', title: 'Plot' }],
      messages: [
        { id: 'm2', chatId: 'c1', created: 2 },
        { id: 'm1', chatId: 'c1', created: 1 },
        { id: 'other', chatId: 'c9', created: 0 },
      ],
    })

    expect(chat.id).toBe('c1')
    expect(messages.map(m => m.id)).toEqual(['m1', 'm2'])
  })

  it('leaves the trash behind when a chat file from before v17 is brought in', () => {
    // The import upgrades the file before reading it, and v17 is where the
    // marked rows go — so what a writer deleted before the export stays gone.
    const { chat, messages } = chatFromTables(
      upgradeTables(
        {
          chats: [
            { id: 'old', deleted: true },
            { id: 'live', title: 'Plot' },
          ],
          messages: [
            { id: 'm1', chatId: 'live', created: 1 },
            { id: 'gone', chatId: 'live', created: 2, deleted: true },
          ],
        },
        16,
        17
      )
    )
    expect(chat.id).toBe('live')
    expect(messages.map(m => m.id)).toEqual(['m1'])
  })

  it('refuses a file with no chat in it', () => {
    expect(() => chatFromTables({ chats: [], messages: [] })).toThrow('no chat')
    expect(() => chatFromTables({})).toThrow('no chat')
  })

  it('brings the prompt the chat ran on, when the file carries it', () => {
    const { prompt } = chatFromTables({
      chats: [{ id: 'c1', promptId: 'prompt_editor' }],
      aiPrompts: [
        { id: 'prompt_other', name: 'Other' },
        { id: 'prompt_editor', name: 'Editor', content: 'Be terse.' },
      ],
    })

    expect(prompt).toEqual({ id: 'prompt_editor', name: 'Editor', content: 'Be terse.' })
  })

  it('leaves the prompt out when the file has none for the chat', () => {
    // A built-in is wherever the file is opened, and is not carried.
    expect(chatFromTables({ chats: [{ id: 'c1', promptId: 'builtin_chat' }] })).not.toHaveProperty(
      'prompt'
    )
    expect(
      chatFromTables({
        chats: [{ id: 'c1', promptId: 'prompt_editor' }],
        aiPrompts: [{ id: 'prompt_other' }],
      })
    ).not.toHaveProperty('prompt')
  })
})
