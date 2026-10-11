import { describe, it, expect } from 'vitest'
import {
  BACKUP_FORMAT,
  buildBackup,
  redactApiKeys,
  redactServerKeys,
  redactWebKeys,
  validateBackup,
  upgradeTables,
  summarizeBackup,
  describeBackupContents,
  backupFilename,
  chatFilename,
  chatFromTables,
  projectFilename,
  projectFromTables,
  withFreshIds,
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

describe('redactServerKeys', () => {
  it('empties every header but keeps its name, and the rest of the server', () => {
    const out = redactServerKeys([
      {
        id: 'mcp_1',
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: 'Bearer secret', 'X-Team': 'blue' },
        profiles: ['p'],
      },
    ])
    expect(out[0]).toEqual({
      id: 'mcp_1',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: '', 'X-Team': '' },
      profiles: ['p'],
    })
  })

  it('leaves servers with no headers alone', () => {
    const server = { id: 'mcp_1', url: 'https://mcp.example.com/mcp' }
    expect(redactServerKeys([server])[0]).toBe(server)
  })
})

describe('redactWebKeys', () => {
  it('empties every key but keeps which services had one', () => {
    const out = redactWebKeys([
      { id: 'web', service: 'kagi', keys: { kagi: 'k', exa: 'e' }, profiles: ['p'] },
    ])
    expect(out[0]).toEqual({
      id: 'web',
      service: 'kagi',
      keys: { kagi: '', exa: '' },
      profiles: ['p'],
    })
  })

  it('leaves a setup with no keys alone', () => {
    const row = { id: 'web', service: 'exa', keys: {}, profiles: [] }
    expect(redactWebKeys([row])[0]).toBe(row)
  })
})

describe('buildBackup', () => {
  const tables = {
    stories: [{ id: 's1' }],
    aiProviders: [{ id: 'p1', apiKey: 'sk-secret' }],
    mcpServers: [{ id: 'mcp_1', headers: { Authorization: 'Bearer secret' } }],
    webSearch: [{ id: 'web', service: 'kagi', keys: { kagi: 'k' }, profiles: [] }],
  }

  it('redacts provider and server keys by default', () => {
    const backup = buildBackup(tables, { dbVersion: 2, exported: 42 })

    expect(backup.includesApiKeys).toBe(false)
    expect(backup.tables.aiProviders[0].apiKey).toBeUndefined()
    expect(backup.tables.mcpServers[0].headers).toEqual({ Authorization: '' })
    expect(backup.tables.webSearch[0].keys).toEqual({ kagi: '' })
    // Untouched tables pass through.
    expect(backup.tables.stories).toEqual([{ id: 's1' }])
  })

  it('keeps keys when asked, and says so in the envelope', () => {
    const backup = buildBackup(tables, { dbVersion: 2, includeApiKeys: true, exported: 42 })

    expect(backup.includesApiKeys).toBe(true)
    expect(backup.tables.aiProviders[0].apiKey).toBe('sk-secret')
    expect(backup.tables.mcpServers[0].headers).toEqual({ Authorization: 'Bearer secret' })
    expect(backup.tables.webSearch[0].keys).toEqual({ kagi: 'k' })
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

  it('sends a project file to the projects menu', () => {
    const { ok, errors } = validateBackup(validBackup({ scope: 'project' }), 2, 'chat')
    expect(ok).toBe(false)
    expect(errors.join(' ')).toContain('Import it from the Projects menu atop the outline')
  })

  it('takes a project file where a project is expected', () => {
    expect(validateBackup(validBackup({ scope: 'project' }), 2, 'project').ok).toBe(true)
    expect(validateBackup(validBackup(), 2, 'project').errors.join(' ')).toContain(
      'holds a whole backup, not one project'
    )
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
    expect(result.errors.join(' ')).toContain('not exported from inksprite')
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

  it('adds an empty web search setup to a backup from before it', () => {
    expect(upgradeTables({ stories: [] }, 25, 26).webSearch).toEqual([])
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

describe('describeBackupContents', () => {
  it('counts what the writer made, and says it has settings without counting them', () => {
    const backup = {
      tables: {
        stories: [{ id: 's1' }, { id: 's2' }],
        documents: [
          { id: 'root_s1', storyId: 's1' },
          { id: 'root_s2', storyId: 's2' },
          { id: 'd1', storyId: 's1' },
          { id: 'd2', storyId: 's1' },
          { id: 'd3', storyId: 's2' },
        ],
        chats: [{ id: 'c1' }],
        messages: [{ id: 'm1' }, { id: 'm2' }],
        files: [{ id: 'f1' }],
        aiProviders: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
        aiProfiles: [{ id: 'pr1' }],
        skills: [],
      },
    }

    expect(describeBackupContents(backup)).toBe(
      'It holds 2 projects, 3 documents, 1 chat and your settings.'
    )
  })

  it('says only what there is', () => {
    expect(describeBackupContents({ tables: { stories: [{ id: 's1' }] } })).toBe(
      'It holds 1 project.'
    )
    expect(describeBackupContents({ tables: { aiProviders: [{ id: 'p1' }] } })).toBe(
      'It holds your settings.'
    )
    expect(describeBackupContents({ tables: { stories: [], messages: [] } })).toBe(
      'It holds nothing.'
    )
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

describe('projectFilename', () => {
  it('names the file after the project', () => {
    expect(projectFilename('The Salt Road')).toBe('inksprite-project-the-salt-road.json')
  })

  it('has a name for a project without one', () => {
    expect(projectFilename('')).toBe('inksprite-project-untitled.json')
  })
})

describe('projectFromTables', () => {
  const tables = () => ({
    stories: [{ id: 'story_a' }],
    documents: [
      { id: 'root_story_a', storyId: 'story_a' },
      { id: 'doc_stray', storyId: 'story_b' },
    ],
    files: [{ id: 'doc_pdf', storyId: 'story_a', mime: 'application/pdf', data: 'JVBE' }],
    chats: [
      { id: 'chat_1', storyId: 'story_a' },
      { id: 'chat_stray', storyId: 'story_b' },
    ],
    messages: [
      { id: 'message_1', chatId: 'chat_1' },
      { id: 'message_stray', chatId: 'chat_stray' },
      { id: 'message_orphan', chatId: 'chat_gone' },
    ],
    chatProfiles: [{ id: 'chatprofile_1', name: 'Terse', settings: { prompt: 'Be terse.' } }],
  })

  it('picks the project and only what is its own', () => {
    const project = projectFromTables(tables())

    expect(project.story.id).toBe('story_a')
    expect(project.documents.map(row => row.id)).toEqual(['root_story_a'])
    expect(project.files.map(row => row.id)).toEqual(['doc_pdf'])
    expect(project.chats.map(row => row.id)).toEqual(['chat_1'])
    expect(project.messages.map(row => row.id)).toEqual(['message_1'])
    expect(project.profiles.map(row => row.id)).toEqual(['chatprofile_1'])
  })

  it('reads a file with only the story in it', () => {
    const project = projectFromTables({ stories: [{ id: 'story_a' }] })
    expect(project).toMatchObject({
      documents: [],
      files: [],
      chats: [],
      messages: [],
      profiles: [],
    })
  })

  it('refuses a file with no project in it', () => {
    expect(() => projectFromTables({ stories: [] })).toThrow('no project')
    expect(() => projectFromTables({})).toThrow('no project')
  })
})

describe('withFreshIds', () => {
  // Long and random-looking, as real ids are: the rewrite is by id, and short
  // ones would be found inside other words.
  const STORY = 'story_V1StGXR8Z5jdHi6BmyT'
  const DOC = 'doc_q8L2nPw0xYtR3sVbKe7Zc'
  const PDF = 'doc_Hn4Jw9pQz2LsXcV7bTm1R'
  const CHAT = 'chat_Ua8sK1dFq3ZmW0pVyN6xT'
  const MESSAGE = 'message_Rt5Yh2Lp9GcX4bNw8QeJm'
  const ROOT = `root_${STORY}`

  /** @returns {import('@/utils/backup.js').ProjectRows} */
  const project = () =>
    /** @type {any} */ ({
      story: { id: STORY, lastDocumentId: DOC, openDocumentIds: [DOC], options: {} },
      documents: [
        { id: ROOT, storyId: STORY, parentId: STORY, type: 'folder', title: 'The Salt Road' },
        { id: DOC, storyId: STORY, parentId: ROOT, type: 'text', content: 'Chapter one.' },
        { id: PDF, storyId: STORY, parentId: ROOT, type: 'file', content: '' },
      ],
      files: [{ id: PDF, storyId: STORY, mime: 'application/pdf', data: 'JVBERi0x' }],
      chats: [{ id: CHAT, storyId: STORY, pinnedIds: [DOC], profileId: 'chatprofile_mine' }],
      messages: [
        {
          id: MESSAGE,
          chatId: CHAT,
          content: 'Done.',
          metadata: {
            documentEdits: [{ id: 'edit_1', documentId: DOC, path: '/Chapter' }],
            apiTrajectory: [
              {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'read_document', arguments: JSON.stringify({ id: DOC }) },
                  },
                ],
              },
              { role: 'tool', tool_call_id: 'call_1', content: 'Chapter one.', _document: DOC },
            ],
          },
        },
      ],
      profiles: [{ id: 'chatprofile_mine', name: 'Mine', settings: { prompt: 'Hello.' } }],
    })

  let minted = 0
  const mint = (/** @type {string} */ prefix) => `${prefix}_new${++minted}`

  it('gives every row a new id', () => {
    minted = 0
    const fresh = withFreshIds(project(), mint)

    expect(fresh.story.id).toBe('story_new1')
    expect(fresh.documents.map(row => row.id)).toEqual(['root_story_new1', 'doc_new2', 'doc_new3'])
    expect(fresh.chats[0].id).toBe('chat_new4')
    expect(fresh.messages[0].id).toBe('message_new5')
  })

  it('gives the root the id the app finds it by', () => {
    const fresh = withFreshIds(project())
    expect(fresh.documents[0].id).toBe(`root_${fresh.story.id}`)
    expect(fresh.documents[0].parentId).toBe(fresh.story.id)
  })

  it('carries every reference across', () => {
    const fresh = withFreshIds(project())
    const [root, doc] = fresh.documents
    const [message] = fresh.messages

    expect(fresh.story.lastDocumentId).toBe(doc.id)
    expect(fresh.story.openDocumentIds).toEqual([doc.id])
    expect(doc.parentId).toBe(root.id)
    expect(fresh.chats[0].storyId).toBe(fresh.story.id)
    expect(fresh.chats[0].pinnedIds).toEqual([doc.id])
    expect(message.chatId).toBe(fresh.chats[0].id)
    expect(message.metadata.documentEdits[0].documentId).toBe(doc.id)
    expect(message.metadata.apiTrajectory[1]._document).toBe(doc.id)
    // Inside a string that is itself JSON, which no list of fields would reach.
    expect(JSON.parse(message.metadata.apiTrajectory[0].tool_calls[0].function.arguments)).toEqual({
      id: doc.id,
    })
  })

  it('finds an id behind an escape in JSON held as a string', () => {
    const rows = project()
    rows.messages[0].content = JSON.stringify({ text: `see\n${DOC}` })
    const fresh = withFreshIds(rows)
    expect(fresh.messages[0].content).toContain(`\\n${fresh.documents[1].id}`)
  })

  it('rewrites keys as well as values', () => {
    const rows = project()
    rows.story.layout = /** @type {any} */ ({ [DOC]: true })
    const fresh = withFreshIds(rows)
    expect(Object.keys(fresh.story.layout)).toEqual([fresh.documents[1].id])
  })

  it('moves a file to its document, leaving its bytes alone', () => {
    const fresh = withFreshIds(project())
    expect(fresh.files).toEqual([
      {
        id: fresh.documents[2].id,
        storyId: fresh.story.id,
        mime: 'application/pdf',
        data: 'JVBERi0x',
      },
    ])
  })

  it("keeps the writer's profiles, and what runs on them, as they are", () => {
    const fresh = withFreshIds(project())
    expect(fresh.profiles).toEqual(project().profiles)
    expect(fresh.chats[0].profileId).toBe('chatprofile_mine')
  })

  it('leaves the rows it was given untouched', () => {
    const rows = project()
    withFreshIds(rows)
    expect(rows).toEqual(project())
  })

  it('leaves text that only looks like an id', () => {
    const rows = project()
    rows.documents[1].content = 'snake_case and doc_q8L2 are not ids.'
    const fresh = withFreshIds(rows)
    expect(fresh.documents[1].content).toBe('snake_case and doc_q8L2 are not ids.')
  })
})
