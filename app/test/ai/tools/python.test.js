/* global AbortController */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

const documents = vi.hoisted(() => ({ documentsForChat: vi.fn(), documentForChat: vi.fn() }))
vi.mock('@/ai/tools/documents.js', () => documents)
const storage = vi.hoisted(() => ({ filePath: vi.fn() }))
vi.mock('@/storage/index.js', () => ({ storage }))
const onDemand = vi.hoisted(() => ({ fileElsewhere: vi.fn(), fetchElsewhere: vi.fn() }))
vi.mock('@/cloud/onDemand.js', () => onDemand)
/** The chats there are, by id. */
const chats = vi.hoisted(() => ({}))
vi.mock('@/stores/chatsStore.js', () => ({
  useChatsStore: () => ({ getChatById: id => chats[id] }),
}))

import {
  executeRunPython,
  fetchForPython,
  pathNote,
  projectForPython,
  pythonCallTimeout,
  pythonForChat,
  pythonOffered,
  pythonProfiles,
  setPythonProfile,
} from '@/ai/tools/python.js'
import { toolRegistry } from '@/ai/tools/registry.js'
import { DEFAULT_PROFILE_ID } from '@/ai/profiles/index.js'
import { useApplicationState } from '@/composables/useApplicationState'

/** A document as the chat's view hands it out. */
const doc = (/** @type {object} */ over) => ({ storyId: 'story-1', content: '', ...over })

/** The project as the chat sees it: the project itself first. */
const seen = [
  { document: doc({ id: 'root', type: 'folder' }), path: '/', titles: [] },
  { document: doc({ id: 'f1', type: 'folder' }), path: 'Rules', titles: ['Rules'] },
  {
    document: doc({ id: 'd1', type: 'text', content: '# Combat' }),
    path: 'Rules/Combat',
    titles: ['Rules', 'Combat'],
  },
  {
    document: doc({ id: 'd2', type: 'file', mime: 'text/csv', content: 'a,b' }),
    path: 'Rules/odds.csv',
    titles: ['Rules', 'odds.csv'],
  },
  {
    document: doc({ id: 'd3', type: 'file', mime: 'text/x-python', content: 'print(1)' }),
    path: 'tool/main.py',
    titles: ['tool', 'main.py'],
  },
  {
    document: doc({ id: 'd4', type: 'file', mime: 'application/pdf', content: '[p.1] text' }),
    path: 'Rulebook.pdf',
    titles: ['Rulebook.pdf'],
  },
  {
    document: doc({ id: 'd5', type: 'text', content: 'halves' }),
    path: 'Notes/1/2',
    titles: ['Notes', '1/2'],
  },
  {
    document: doc({
      id: 'd6',
      type: 'file',
      mime: 'application/pdf',
      size: 2048,
      content: '[p.1] Big',
    }),
    path: 'Big.pdf',
    titles: ['Big.pdf'],
  },
  {
    document: doc({ id: 'd7', type: 'file', mime: 'text/csv', size: 3, content: 'x,y' }),
    path: 'far.csv',
    titles: ['far.csv'],
  },
  {
    document: doc({ id: 'd8', type: 'file', mime: 'application/pdf', content: 'Old map' }),
    path: 'map.pdf',
    titles: ['map.pdf'],
  },
  {
    document: doc({ id: 'd9', type: 'text', content: 'My own notes' }),
    path: 'map.pdf.txt',
    titles: ['map.pdf.txt'],
  },
  {
    document: doc({ id: 'd10', type: 'file', mime: 'image/png', size: 9 }),
    path: 'portrait.png',
    titles: ['portrait.png'],
  },
]

/** Where the library keeps each imported file whose bytes are on this disk. */
const onDisk = { d2: 'Thief/Rules/odds.csv', d8: 'Thief/map.pdf', d10: 'Thief/portrait.png' }

/** The files whose bytes are still only on the sync server. */
const onServer = new Set(['d6', 'd7'])

beforeAll(() => {
  // The document tools are how a chat sees the project; one stands for them.
  toolRegistry.register(
    'read_document',
    { type: 'function', function: { name: 'read_document', description: '', parameters: {} } },
    async () => ({}),
    'documents'
  )
})

/** What the desktop app's Python answers with, unless a test says otherwise. */
const ran = (/** @type {object} */ over = {}) => ({
  stdout: '',
  stderr: '',
  value: null,
  error: null,
  restarted: false,
  ...over,
})

/** The desktop app's bridge, with Python. */
let python

beforeEach(() => {
  vi.clearAllMocks()
  documents.documentsForChat.mockResolvedValue(seen)
  documents.documentForChat.mockResolvedValue(null)
  storage.filePath.mockImplementation(async id => onDisk[id] ?? null)
  onDemand.fileElsewhere.mockImplementation(async id => onServer.has(id))
  onDemand.fetchElsewhere.mockResolvedValue(null)
  for (const id of Object.keys(chats)) delete chats[id]
  python = { run: vi.fn().mockResolvedValue(ran()), stop: vi.fn() }
  globalThis.__INKSPRITE_DESKTOP__ = { python }
  vi.stubEnv('VITE_PREVIEW', 'python')
  const state = useApplicationState()
  state.setAiEnabled(true)
  state.setExtension('python', true)
  state.state.value.system.pythonProfiles = null
  state.setPythonTimeLimit(600)
})

afterEach(() => {
  delete globalThis.__INKSPRITE_DESKTOP__
  vi.unstubAllEnvs()
})

describe('pythonOffered', () => {
  it('offers Python in the desktop app, with its extension and the AI on', () => {
    expect(pythonOffered()).toBe(true)
  })

  it('offers none in a browser, or a desktop app without it', () => {
    delete globalThis.__INKSPRITE_DESKTOP__
    expect(pythonOffered()).toBe(false)
    globalThis.__INKSPRITE_DESKTOP__ = {}
    expect(pythonOffered()).toBe(false)
  })

  it('offers none with the extension off, or the AI', () => {
    useApplicationState().setExtension('python', false)
    expect(pythonOffered()).toBe(false)
    useApplicationState().setExtension('python', true)
    useApplicationState().setAiEnabled(false)
    expect(pythonOffered()).toBe(false)
  })

  it('offers none outside its preview', () => {
    vi.stubEnv('VITE_PREVIEW', '')
    expect(pythonOffered()).toBe(false)
  })
})

describe('pythonForChat', () => {
  it('runs Python on Default until the writer chooses the profiles', () => {
    expect(pythonProfiles()).toEqual([DEFAULT_PROFILE_ID])
    expect(pythonForChat(null, DEFAULT_PROFILE_ID)).toBe(true)
    expect(pythonForChat(null, 'builtin_profile_roleplay')).toBe(false)
  })

  it('runs it on the profiles the writer lists', () => {
    setPythonProfile('chatprofile_mine', true)
    setPythonProfile(DEFAULT_PROFILE_ID, false)
    expect(pythonProfiles()).toEqual(['chatprofile_mine'])
    expect(pythonForChat(null, 'chatprofile_mine')).toBe(true)
    expect(pythonForChat(null, DEFAULT_PROFILE_ID)).toBe(false)
  })

  it('takes the chat’s own choice over its profile’s', () => {
    expect(pythonForChat({ python: false }, DEFAULT_PROFILE_ID)).toBe(false)
    expect(pythonForChat({ python: true }, 'builtin_profile_roleplay')).toBe(true)
  })

  it('runs none where Python isn’t offered, whatever the chat chose', () => {
    useApplicationState().setExtension('python', false)
    expect(pythonForChat({ python: true }, DEFAULT_PROFILE_ID)).toBe(false)
  })
})

describe('executeRunPython', () => {
  it('runs the code in the chat’s session', async () => {
    python.run.mockResolvedValue(ran({ stdout: 'out', value: '42' }))

    expect(await executeRunPython({ code: 'print("out")\n42' }, { chatId: 'chat-1' })).toEqual({
      stdout: 'out',
      value: '42',
    })
    expect(python.run).toHaveBeenCalledWith(
      'chat-1',
      'print("out")\n42',
      { timeoutMs: 600000, project: null, filename: null },
      fetchForPython
    )
  })

  it('gives the run the writer’s time limit, or none', async () => {
    useApplicationState().setPythonTimeLimit(0)
    await executeRunPython({ code: '1' }, { chatId: 'chat-1' })
    expect(python.run).toHaveBeenLastCalledWith(
      'chat-1',
      '1',
      expect.objectContaining({ timeoutMs: null }),
      fetchForPython
    )
  })

  it('hands the run the project the chat sees', async () => {
    await executeRunPython({ code: '1' }, { chatId: 'chat-1', storyId: 'story-1' })
    expect(documents.documentsForChat).toHaveBeenCalledWith('story-1', 'chat-1')
    expect(python.run.mock.calls[0][2].project).toHaveLength(12)
  })

  it('runs a script of the project’s by its path, as it is now', async () => {
    documents.documentForChat.mockResolvedValue({
      document: doc({ id: 'd6', type: 'text', plain: true, content: 'print("d20")' }),
      path: 'Sims/d20.py',
    })
    python.run.mockResolvedValue(ran({ stdout: 'd20' }))

    for (const file of ['Sims/d20.py', '/project/Sims/d20.py']) {
      expect(await executeRunPython({ file }, { chatId: 'chat-1', storyId: 'story-1' })).toEqual({
        stdout: 'd20',
      })
    }
    expect(documents.documentForChat).toHaveBeenLastCalledWith('story-1', 'chat-1', 'Sims/d20.py')
    expect(python.run).toHaveBeenLastCalledWith(
      'chat-1',
      'print("d20")',
      { timeoutMs: 600000, project: expect.any(Array), filename: '/project/Sims/d20.py' },
      fetchForPython
    )
  })

  it('runs a file of text, and refuses a folder, a PDF, or nothing there', async () => {
    const context = { chatId: 'chat-1', storyId: 'story-1' }
    documents.documentForChat.mockResolvedValueOnce(seen[4])
    await executeRunPython({ file: 'tool/main.py' }, context)
    expect(python.run).toHaveBeenLastCalledWith(
      'chat-1',
      'print(1)',
      expect.anything(),
      fetchForPython
    )

    documents.documentForChat.mockResolvedValueOnce(seen[1])
    expect(await executeRunPython({ file: 'Rules' }, context)).toEqual({
      error: 'There is no script at Rules.',
    })
    documents.documentForChat.mockResolvedValueOnce(seen[5])
    expect(await executeRunPython({ file: 'Rulebook.pdf' }, context)).toEqual({
      error: 'Rulebook.pdf isn’t text.',
    })
    expect(await executeRunPython({ file: 'Sims/none.py' }, context)).toEqual({
      error: 'There is no script at Sims/none.py.',
    })
    expect(python.run).toHaveBeenCalledTimes(1)
  })

  it('runs code or a file, not both, and no file where the chat sees no project', async () => {
    const context = { chatId: 'chat-1', storyId: 'story-1' }
    expect(await executeRunPython({ code: '1', file: 'a.py' }, context)).toEqual({
      error: 'Give code or a file to run, not both.',
    })
    chats['chat-1'] = { disabledToolGroups: ['documents'] }
    expect(await executeRunPython({ file: 'a.py' }, context)).toEqual({
      error: 'This chat doesn’t see the project.',
    })
    expect(python.run).not.toHaveBeenCalled()
  })

  it('answers with only the parts there are, and something when there are none', async () => {
    python.run.mockResolvedValue(ran({ stderr: 'warning', error: 'Traceback…' }))
    expect(await executeRunPython({ code: '1/0' }, { chatId: 'chat-1' })).toEqual({
      stderr: 'warning',
      error: 'Traceback…',
    })

    python.run.mockResolvedValue(ran())
    expect(await executeRunPython({ code: 'x = 1' }, { chatId: 'chat-1' })).toEqual({
      stdout: '',
    })
  })

  it('says when what earlier runs defined is gone', async () => {
    python.run.mockResolvedValue(ran({ error: 'Stopped after 30 seconds.', restarted: true }))
    const result = await executeRunPython({ code: 'while True: pass' }, { chatId: 'chat-1' })
    expect(result.error).toBe('Stopped after 30 seconds.')
    expect(result.restarted).toMatch(/nothing the earlier runs defined/)
  })

  it('stops the run when the call is stopped', async () => {
    const controller = new AbortController()
    python.run.mockImplementation(() => {
      controller.abort()
      return Promise.resolve(ran({ error: 'Python stopped unexpectedly.', restarted: true }))
    })
    await executeRunPython(
      { code: 'while True: pass' },
      { chatId: 'chat-1', signal: controller.signal }
    )
    expect(python.stop).toHaveBeenCalledWith('chat-1')
  })

  it('runs nothing without code, and nothing in a browser', async () => {
    expect(await executeRunPython({ code: '  ' }, { chatId: 'chat-1' })).toEqual({
      error: 'There is no code to run.',
    })
    delete globalThis.__INKSPRITE_DESKTOP__
    expect(await executeRunPython({ code: '1' }, { chatId: 'chat-1' })).toEqual({
      error: 'Python runs only in the desktop app.',
    })
  })

  it('says so when the desktop app can’t be reached', async () => {
    python.run.mockRejectedValue(new Error('Only the app’s page may ask that.'))
    expect(await executeRunPython({ code: '1' }, { chatId: 'chat-1' })).toEqual({
      error: "Python couldn't be reached. Only the app’s page may ask that.",
    })
  })
})

describe('projectForPython', () => {
  it('lists the project as the chat sees it, by the paths the tools give', async () => {
    expect(await projectForPython({ chatId: 'chat-1', storyId: 'story-1' })).toEqual([
      { path: 'Rules', folder: true },
      { path: 'Rules/Combat', id: 'd1', text: '# Combat' },
      { path: 'Rules/odds.csv', id: 'd2', file: 'Thief/Rules/odds.csv' },
      { path: 'tool/main.py', id: 'd3', text: 'print(1)' },
      { path: 'Rulebook.pdf.txt', id: 'd4.txt', text: '[p.1] text' },
      { path: 'Notes/1_2', id: 'd5', text: 'halves' },
      { path: 'Big.pdf', id: 'd6', size: 2048, onServer: true },
      { path: 'Big.pdf.txt', id: 'd6.txt', text: '[p.1] Big' },
      { path: 'far.csv', id: 'd7', text: 'x,y' },
      { path: 'map.pdf', id: 'd8', file: 'Thief/map.pdf' },
      { path: 'map.pdf.txt', id: 'd9', text: 'My own notes' },
      { path: 'portrait.png', id: 'd10', file: 'Thief/portrait.png' },
    ])
  })

  it('makes a document that holds others a directory, the document in it under its name', async () => {
    documents.documentsForChat.mockResolvedValue([
      { document: doc({ id: 'root', type: 'folder' }), path: '/', titles: [] },
      {
        document: doc({ id: 'ch', parentId: 'root', type: 'text', content: 'A chapter.' }),
        path: 'Chapter 1',
        titles: ['Chapter 1'],
      },
      {
        document: doc({ id: 'sc', parentId: 'ch', type: 'text', content: 'A scene.' }),
        path: 'Chapter 1/Arrival',
        titles: ['Chapter 1', 'Arrival'],
      },
      {
        document: doc({
          id: 'd8',
          parentId: 'root',
          type: 'file',
          mime: 'application/pdf',
          content: 'Old map',
        }),
        path: 'map.pdf',
        titles: ['map.pdf'],
      },
      {
        document: doc({ id: 'md', parentId: 'd8', type: 'text', content: '# Map' }),
        path: 'map.pdf/map (Markdown)',
        titles: ['map.pdf', 'map (Markdown)'],
      },
    ])
    const listed = await projectForPython({ chatId: 'chat-1', storyId: 'story-1' })
    expect(listed).toEqual([
      { path: 'Chapter 1/Chapter 1', id: 'ch', text: 'A chapter.' },
      { path: 'Chapter 1/Arrival', id: 'sc', text: 'A scene.' },
      { path: 'map.pdf/map.pdf', id: 'd8', file: 'Thief/map.pdf' },
      { path: 'map.pdf/map.pdf.txt', id: 'd8.txt', text: 'Old map' },
      { path: 'map.pdf/map (Markdown)', id: 'md', text: '# Map' },
    ])
  })

  it('fetches a file still on the sync server into the library, and says where it is', async () => {
    expect(await fetchForPython('d2')).toBe('Thief/Rules/odds.csv')
    expect(onDemand.fetchElsewhere).toHaveBeenCalledWith('d2')

    onDemand.fetchElsewhere.mockRejectedValue(new Error('The server couldn’t be reached.'))
    expect(await fetchForPython('d2')).toBeNull()
  })

  it('lists none without a project, or in a chat that doesn’t see it', async () => {
    expect(await projectForPython({ chatId: 'chat-1' })).toBeNull()
    chats['chat-1'] = { disabledToolGroups: ['documents'] }
    expect(await projectForPython({ chatId: 'chat-1', storyId: 'story-1' })).toBeNull()
    chats['chat-1'] = { disabledTools: ['read_document'] }
    expect(await projectForPython({ chatId: 'chat-1', storyId: 'story-1' })).toBeNull()
    expect(documents.documentsForChat).not.toHaveBeenCalled()
  })
})

describe('pathNote', () => {
  /** A project with a chapter and a PDF that hold others, beside a folder. */
  const project = [
    { path: 'Manuscript', folder: true },
    { path: 'Manuscript/Chapter 1/Chapter 1', id: 'ch', text: 'A chapter.' },
    { path: 'Manuscript/Chapter 1/Arrival', id: 'sc', text: 'A scene.' },
    { path: 'Rules/Map.pdf/Map.pdf', id: 'map', file: 'Thief/Rules/Map.pdf' },
    { path: 'Rules/Map.pdf/Map.pdf.txt', id: 'map.txt', text: '[p.1] Old map' },
    { path: 'Rules/Map.pdf/Notes', id: 'notes', text: '# Notes' },
    { path: 'Notes', folder: true },
    { path: 'Notes/Notes', id: 'n', text: 'Mine.' },
  ]
  const refused = (/** @type {string} */ line) =>
    `Traceback (most recent call last):\n  File "<code>", line 1, in <module>\n${line}\n`

  it('says where the document that holds others is, taken by the path the tools give', () => {
    expect(
      pathNote(
        refused("IsADirectoryError: [Errno 31] Is a directory: '/project/Manuscript/Chapter 1'"),
        project
      )
    ).toBe(
      '/project/Manuscript/Chapter 1 is a directory, since that document holds others: the document itself is /project/Manuscript/Chapter 1/Chapter 1.'
    )
  })

  it('says where the text beside it is', () => {
    expect(
      pathNote(
        refused(
          "FileNotFoundError: [Errno 44] No such file or directory: '/project/Rules/Map.pdf.txt'"
        ),
        project
      )
    ).toBe(
      'That text is /project/Rules/Map.pdf/Map.pdf.txt: the file holds others, so it and its text are in a directory of its name.'
    )
  })

  it('says a text has no extension, one that holds others among them', () => {
    expect(
      pathNote(
        refused(
          "FileNotFoundError: [Errno 2] No such file or directory: '/project/Rules/Map.pdf/Notes.md'"
        ),
        project
      )
    ).toBe('A text has no extension here: it is /project/Rules/Map.pdf/Notes.')
    expect(
      pathNote(
        refused(
          "FileNotFoundError: [Errno 44] No such file or directory: '/project/Manuscript/Chapter 1.md'"
        ),
        project
      )
    ).toBe(
      '/project/Manuscript/Chapter 1 is a directory, since that document holds others: the document itself is /project/Manuscript/Chapter 1/Chapter 1.'
    )
  })

  it('says nothing of a folder, a path that is nowhere, or another error', () => {
    expect(
      pathNote(refused("IsADirectoryError: [Errno 31] Is a directory: '/project/Notes'"), project)
    ).toBeNull()
    expect(
      pathNote(
        refused("FileNotFoundError: [Errno 44] No such file or directory: '/project/Lost'"),
        project
      )
    ).toBeNull()
    expect(pathNote(refused('ZeroDivisionError: division by zero'), project)).toBeNull()
  })

  it('comes back with the run that was refused the path, or printed it refused', async () => {
    documents.documentsForChat.mockResolvedValue([
      { document: doc({ id: 'root', type: 'folder' }), path: '/', titles: [] },
      {
        document: doc({ id: 'ch', parentId: 'root', type: 'text', content: 'A chapter.' }),
        path: 'Chapter 1',
        titles: ['Chapter 1'],
      },
      {
        document: doc({ id: 'sc', parentId: 'ch', type: 'text', content: 'A scene.' }),
        path: 'Chapter 1/Arrival',
        titles: ['Chapter 1', 'Arrival'],
      },
    ])
    const error = refused("IsADirectoryError: [Errno 31] Is a directory: '/project/Chapter 1'")
    python.run.mockResolvedValue(ran({ error }))
    expect(
      await executeRunPython(
        { code: "open('/project/Chapter 1').read()" },
        { chatId: 'chat-1', storyId: 'story-1' }
      )
    ).toEqual({
      error,
      note: '/project/Chapter 1 is a directory, since that document holds others: the document itself is /project/Chapter 1/Chapter 1.',
    })

    const printed = "Error: [Errno 31] Is a directory: '/project/Chapter 1'"
    python.run.mockResolvedValue(ran({ stdout: printed }))
    expect(
      await executeRunPython({ code: 'count()' }, { chatId: 'chat-1', storyId: 'story-1' })
    ).toMatchObject({
      stdout: printed,
      note: expect.stringContaining('/project/Chapter 1/Chapter 1'),
    })
  })
})

describe('pythonCallTimeout', () => {
  it('gives the call the run’s limit and a minute for Python to start', () => {
    expect(pythonCallTimeout()).toBe(660000)
    useApplicationState().setPythonTimeLimit(3600)
    expect(pythonCallTimeout()).toBe(3660000)
  })

  it('gives none when the run has none', () => {
    useApplicationState().setPythonTimeLimit(0)
    expect(pythonCallTimeout()).toBe(Infinity)
  })
})
