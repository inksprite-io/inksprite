import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const { mockDb, mockProcessSync } = vi.hoisted(() => {
  const mockProcessSync = vi.fn().mockResolvedValue(undefined)
  return {
    mockDb: {
      verno: 2,
      tables: [],
      transaction: vi.fn(),
      chats: { get: vi.fn() },
      messages: { where: vi.fn() },
      aiPrompts: { get: vi.fn() },
      chatProfiles: { get: vi.fn() },
    },
    mockProcessSync,
  }
})

vi.mock('@/stores/db', () => ({ default: mockDb }))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ processSync: mockProcessSync }),
}))

const { useBackup } = await import('@/composables/useBackup.js')
const { ROLEPLAY_PROFILE_ID } = await import('@/ai/profiles/index.js')
const { DEFAULT_ROLEPLAY_NOTE } = await import('@/ai/prompts/index.js')

/**
 * Build a fake Dexie table that records what was written to it.
 * @param {string} name
 * @param {any[]} rows
 */
function fakeTable(name, rows = []) {
  return {
    name,
    toArray: vi.fn().mockResolvedValue(rows),
    clear: vi.fn().mockResolvedValue(undefined),
    bulkPut: vi.fn().mockResolvedValue(undefined),
  }
}

describe('useBackup', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockDb.verno = 2
    mockDb.tables = [
      fakeTable('stories', [{ id: 's1' }]),
      fakeTable('aiProviders', [{ id: 'p1', apiKey: 'sk-secret' }]),
      fakeTable('aiPrompts', []),
    ]
    // Run the transaction body directly.
    mockDb.transaction = vi.fn(async (_mode, _tables, fn) => fn())
  })

  describe('createBackup', () => {
    it('flushes pending edits before reading', async () => {
      const stories = mockDb.tables[0]
      await useBackup().createBackup()

      // A debounced edit not yet written would otherwise be missing from the file.
      expect(mockProcessSync).toHaveBeenCalled()
      expect(mockProcessSync.mock.invocationCallOrder[0]).toBeLessThan(
        stories.toArray.mock.invocationCallOrder[0]
      )
    })

    it('reads every table the database declares', async () => {
      const backup = await useBackup().createBackup()

      expect(Object.keys(backup.tables).sort()).toEqual(['aiPrompts', 'aiProviders', 'stories'])
      expect(backup.dbVersion).toBe(2)
    })

    it('redacts keys unless asked', async () => {
      const redacted = await useBackup().createBackup()
      expect(redacted.tables.aiProviders[0].apiKey).toBeUndefined()

      const kept = await useBackup().createBackup({ includeApiKeys: true })
      expect(kept.tables.aiProviders[0].apiKey).toBe('sk-secret')
    })
  })

  describe('readBackupFile', () => {
    /** @param {any} contents */
    const fileOf = contents => ({
      text: async () => (typeof contents === 'string' ? contents : JSON.stringify(contents)),
    })

    it('parses and summarizes without touching the database', async () => {
      const { backup, summary } = await useBackup().readBackupFile(
        fileOf({
          app: 'inksprite',
          format: 1,
          dbVersion: 2,
          tables: { stories: [{ id: 's1' }, { id: 's2' }], aiPrompts: [] },
        })
      )

      expect(backup.dbVersion).toBe(2)
      expect(summary).toEqual([{ table: 'stories', count: 2 }])
      expect(mockDb.transaction).not.toHaveBeenCalled()
      expect(mockDb.tables[0].clear).not.toHaveBeenCalled()
    })

    it('rejects a file that is not JSON', async () => {
      await expect(useBackup().readBackupFile(fileOf('not json at all'))).rejects.toThrow(
        'not valid JSON'
      )
    })

    it('rejects JSON from another app', async () => {
      await expect(useBackup().readBackupFile(fileOf({ hello: 'world' }))).rejects.toThrow(
        'not exported from InkSprite'
      )
    })

    it('sends a single-chat file to the chat list', async () => {
      await expect(
        useBackup().readBackupFile(
          fileOf({ app: 'inksprite', format: 1, dbVersion: 2, scope: 'chat', tables: {} })
        )
      ).rejects.toThrow('Import it from the chat list')
    })
  })

  describe('createChatBackup', () => {
    const chat = { id: 'chat_1', storyId: 's1', title: 'Plot holes' }
    const rowsFor = rows => ({ equals: () => ({ toArray: async () => rows }) })

    beforeEach(() => {
      mockDb.chats.get.mockResolvedValue(chat)
      mockDb.aiPrompts.get.mockResolvedValue(undefined)
      mockDb.messages.where.mockReturnValue(
        rowsFor([
          { id: 'm2', chatId: 'chat_1', created: 2 },
          { id: 'm1', chatId: 'chat_1', created: 1 },
        ])
      )
    })

    it('snapshots the chat with its messages in order, marked as one chat', async () => {
      const backup = await useBackup().createChatBackup('chat_1')

      expect(mockProcessSync).toHaveBeenCalled()
      expect(backup.scope).toBe('chat')
      expect(backup.dbVersion).toBe(2)
      expect(backup.tables.chats).toEqual([chat])
      expect(backup.tables.messages.map(m => m.id)).toEqual(['m1', 'm2'])
    })

    it('refuses a chat that is not there', async () => {
      mockDb.chats.get.mockResolvedValue(undefined)
      await expect(useBackup().createChatBackup('chat_x')).rejects.toThrow('not found')
    })

    it("carries the prompt of the profile the chat runs on, when it is the writer's own", async () => {
      mockDb.chats.get.mockResolvedValue({ ...chat, profileId: 'chatprofile_editor' })
      mockDb.chatProfiles.get.mockResolvedValue({
        id: 'chatprofile_editor',
        name: 'Editor',
        settings: { prompt: 'Be terse.' },
        version: 1,
        created: 1,
        updated: 2,
      })

      const backup = await useBackup().createChatBackup('chat_1')

      // A profile is more than its prompt, but the file format carries a
      // prompt and an older build knows how to read one.
      expect(mockDb.chatProfiles.get).toHaveBeenCalledWith('chatprofile_editor')
      expect(backup.tables.aiPrompts).toEqual([
        expect.objectContaining({ id: 'chatprofile_editor', name: 'Editor', content: 'Be terse.' }),
      ])
    })

    it('leaves the prompt out for a chat on a built-in', async () => {
      mockDb.chats.get.mockResolvedValue({ ...chat, profileId: 'builtin_profile_adventure' })

      const backup = await useBackup().createChatBackup('chat_1')

      expect(mockDb.chatProfiles.get).not.toHaveBeenCalled()
      expect(backup.tables).not.toHaveProperty('aiPrompts')
    })
  })

  describe('readChatFile', () => {
    /** @param {any} contents */
    const fileOf = contents => ({ text: async () => JSON.stringify(contents) })
    const chatFile = (dbVersion, overrides = {}) => ({
      app: 'inksprite',
      format: 1,
      dbVersion,
      scope: 'chat',
      tables: {
        chats: [{ id: 'chat_1', title: 'Plot holes' }],
        messages: [{ id: 'm1', chatId: 'chat_1', created: 1 }],
      },
      ...overrides,
    })

    it('hands back the chat and its messages without writing anything', async () => {
      const { chat, messages } = await useBackup().readChatFile(fileOf(chatFile(2)))

      expect(chat.title).toBe('Plot holes')
      expect(messages.map(m => m.id)).toEqual(['m1'])
      expect(mockDb.transaction).not.toHaveBeenCalled()
    })

    it('hands back the prompt the chat ran on, when the file carries it', async () => {
      const editor = { id: 'prompt_editor', name: 'Editor', content: 'Be terse.' }
      const file = chatFile(2, {
        tables: {
          chats: [{ id: 'chat_1', title: 'Plot holes', promptId: 'prompt_editor' }],
          messages: [],
          aiPrompts: [editor],
        },
      })

      const { prompt } = await useBackup().readChatFile(fileOf(file))

      expect(prompt).toEqual(editor)
    })

    it('reads a chat exported at an older schema', async () => {
      // v1 predates aiPrompts; the upgrade adds that table, which a chat has
      // no use for, and the chat comes through untouched.
      const { chat } = await useBackup().readChatFile(fileOf(chatFile(1)))
      expect(chat.id).toBe('chat_1')
    })

    it('refuses a chat exported at a newer schema', async () => {
      await expect(useBackup().readChatFile(fileOf(chatFile(3)))).rejects.toThrow(
        'Update the app first'
      )
    })

    it('sends a whole backup to the Data settings', async () => {
      await expect(
        useBackup().readChatFile(fileOf(chatFile(2, { scope: 'database' })))
      ).rejects.toThrow('Restore it from the Data settings')
    })

    describe('from SillyTavern', () => {
      /** @param {any[]} rows @param {string} [name] */
      const tavernFile = (rows, name = 'Elara - 2026-01-05@21h14m03s512ms.jsonl') => ({
        name,
        text: async () => rows.map(row => JSON.stringify(row)).join('\n'),
      })
      const header = (note = '') => ({
        chat_metadata: { note_prompt: note },
        user_name: 'unused',
        character_name: 'unused',
      })
      const said = (name, is_user, mes) => ({
        name,
        is_user,
        send_date: '2026-09-19T05:54:14.699Z',
        mes,
        extra: {},
      })
      const rows = [header(), said('Elara', false, 'Well?'), said('Sam', true, 'Hello.')]

      it('reads the chat, and says who it was with', async () => {
        const read = await useBackup().readChatFile(tavernFile(rows))

        expect(read.chat.title).toBe('Elara')
        expect(read.character).toBe('Elara')
        expect(read.messages.map(m => [m.role, m.content])).toEqual([
          ['assistant', 'Well?'],
          ['user', 'Hello.'],
        ])
        expect(mockDb.transaction).not.toHaveBeenCalled()
      })

      it('goes by what is in the file, not what it is called', async () => {
        const read = await useBackup().readChatFile(tavernFile(rows, 'chat.json'))

        expect(read.character).toBe('Elara')
      })

      it('puts it on the Roleplay profile, stamped as a new chat on it would be', async () => {
        const { chat } = await useBackup().readChatFile(tavernFile(rows))

        expect(chat.profileId).toBe(ROLEPLAY_PROFILE_ID)
        expect(chat.disabledToolGroups).toEqual(['documents', 'rpg', 'skills'])
        expect(chat.rules).toBe(DEFAULT_ROLEPLAY_NOTE)
        // A profile's prompt is read from the profile every turn, never copied.
        expect(chat).not.toHaveProperty('prompt')
      })

      it("keeps the Author's Note after the profile's rules", async () => {
        const noted = [header('[Slow burn.]'), ...rows.slice(1)]

        const read = await useBackup().readChatFile(tavernFile(noted))

        expect(read.note).toBe('[Slow burn.]')
        expect(read.chat.rules).toBe(`${DEFAULT_ROLEPLAY_NOTE}\n\n[Slow burn.]`)
      })

      it('dates the chat by its last message, so it sorts where it left off', async () => {
        const { chat } = await useBackup().readChatFile(tavernFile(rows))

        expect(chat.lastMessageAt).toBeGreaterThanOrEqual(Date.parse('2026-09-19T05:54:14.699Z'))
      })

      it('says so when nothing was said in it', async () => {
        await expect(useBackup().readChatFile(tavernFile([header()]))).rejects.toThrow(
          'no messages'
        )
      })
    })
  })

  describe('restoreBackup', () => {
    const backupAt = (dbVersion, tables) => ({
      app: 'inksprite',
      format: 1,
      dbVersion,
      tables,
    })

    it('clears each table before writing the backup into it', async () => {
      const stories = mockDb.tables[0]
      await useBackup().restoreBackup(backupAt(2, { stories: [{ id: 'restored' }] }))

      expect(stories.clear).toHaveBeenCalled()
      expect(stories.bulkPut).toHaveBeenCalledWith([{ id: 'restored' }])
      expect(stories.clear.mock.invocationCallOrder[0]).toBeLessThan(
        stories.bulkPut.mock.invocationCallOrder[0]
      )
    })

    it('empties tables the backup does not mention', async () => {
      const [stories, providers] = mockDb.tables
      await useBackup().restoreBackup(backupAt(2, { stories: [{ id: 'restored' }] }))

      // The backup is the whole truth, not a patch — leftover providers would
      // survive a restore that was meant to roll them back.
      expect(providers.clear).toHaveBeenCalled()
      expect(providers.bulkPut).not.toHaveBeenCalled()
      expect(stories.bulkPut).toHaveBeenCalled()
    })

    it('ignores rows for tables this build no longer has', async () => {
      const result = await useBackup().restoreBackup(
        backupAt(2, { stories: [{ id: 's1' }], removedLongAgo: [{ id: 'x' }] })
      )

      expect(result.restored).toBe(1)
    })

    it('moves an older backup forward before writing it', async () => {
      const prompts = mockDb.tables[2]
      // v1 predates aiPrompts, so the file has no such table at all.
      await useBackup().restoreBackup(backupAt(1, { stories: [{ id: 's1' }] }))

      expect(prompts.clear).toHaveBeenCalled()
      expect(prompts.bulkPut).not.toHaveBeenCalled()
    })

    it('refuses a backup newer than the database', async () => {
      await expect(useBackup().restoreBackup(backupAt(5, {}))).rejects.toThrow('Cannot downgrade')
    })

    it('runs every write in one transaction', async () => {
      await useBackup().restoreBackup(backupAt(2, { stories: [{ id: 's1' }] }))
      expect(mockDb.transaction).toHaveBeenCalledTimes(1)
      expect(mockDb.transaction).toHaveBeenCalledWith('rw', mockDb.tables, expect.any(Function))
    })
  })

  describe('downloadChat', () => {
    it('names the file after the chat', async () => {
      mockDb.chats.get.mockResolvedValue({ id: 'chat_1', title: 'Plot holes' })
      mockDb.messages.where.mockReturnValue({ equals: () => ({ toArray: async () => [] }) })
      const click = vi.fn()
      vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() })
      vi.spyOn(document, 'createElement').mockReturnValue(
        /** @type {any} */ ({ click, set href(_v) {}, set download(_v) {} })
      )

      const { filename } = await useBackup().downloadChat('chat_1')

      expect(filename).toBe('inksprite-chat-plot-holes.json')
      expect(click).toHaveBeenCalled()

      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('hands over the chat with its words taken out when asked', async () => {
      mockDb.chats.get.mockResolvedValue({ id: 'chat_1', title: 'Plot holes' })
      mockDb.messages.where.mockReturnValue({
        equals: () => ({
          toArray: async () => [
            {
              id: 'm1',
              chatId: 'chat_1',
              role: 'user',
              content: 'Is the door locked?',
              created: 1,
            },
            {
              id: 'm2',
              chatId: 'chat_1',
              role: 'user',
              content: 'stale',
              segments: [
                {
                  type: 'command',
                  command: {
                    name: 'oracle',
                    param: 'likely',
                    input: 'Is it?',
                    label: 'Is it?',
                    result: 'yes',
                  },
                },
              ],
              created: 2,
            },
          ],
        }),
      })
      let written = ''
      vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() })
      vi.stubGlobal(
        'Blob',
        class {
          constructor(parts) {
            written = parts.join('')
          }
        }
      )
      vi.spyOn(document, 'createElement').mockReturnValue(
        /** @type {any} */ ({ click: vi.fn(), set href(_v) {}, set download(_v) {} })
      )

      const { filename } = await useBackup().downloadChat('chat_1', { obfuscated: true })

      expect(filename).toBe('inksprite-chat-plot-holes.obfuscated.json')
      const file = JSON.parse(written)
      const [chat] = file.tables.chats
      const [m1, m2] = file.tables.messages
      expect(chat.id).toBe('chat_1')
      expect(chat.title).not.toBe('Plot holes')
      expect(chat.title).toHaveLength('Plot holes'.length)
      expect(m1.content).not.toBe('Is the door locked?')
      expect(m1.content).toHaveLength('Is the door locked?'.length)
      // The app's own way of putting a turn together, and its own knowledge
      // of which commands answer by rule.
      expect(m2.segments[0].command).toMatchObject({
        name: 'oracle',
        param: 'likely',
        result: 'yes',
      })
      expect(m2.segments[0].command.label).not.toBe('Is it?')
      expect(m2.content).toMatch(
        /^<oracle likelihood="likely">\n[a-z]{2} [a-z]{2}\?\nyes\n<\/oracle>$/i
      )

      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })
  })

  describe('downloadBackup', () => {
    it('hands the user a dated json file and releases the blob url', async () => {
      const click = vi.fn()
      const createObjectURL = vi.fn().mockReturnValue('blob:fake')
      const revokeObjectURL = vi.fn()
      vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
      vi.spyOn(document, 'createElement').mockReturnValue(
        /** @type {any} */ ({ click, set href(_v) {}, set download(_v) {} })
      )
      vi.useFakeTimers()

      const { filename, bytes } = await useBackup().downloadBackup()

      expect(filename).toMatch(/^inksprite-backup-\d{4}-\d{2}-\d{2}\.json$/)
      expect(bytes).toBeGreaterThan(0)
      expect(click).toHaveBeenCalled()

      vi.runAllTimers()
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')

      vi.useRealTimers()
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })
  })
})
