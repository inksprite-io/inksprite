/* global TextEncoder, btoa, File, Blob */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCardImport } from '@/composables/useCardImport'
import { useApplicationState } from '@/composables/useApplicationState'

const startConversion = vi.fn(async () => ({ id: 'job_1' }))
vi.mock('@/jobs/index.js', () => ({ startConversion: (...args) => startConversion(...args) }))
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { SHELF_KINDS } from '@/cards/write.js'
import { LAYOUT_LIMIT } from '@/editor/size.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

vi.mock('@/stores/db', () => ({
  default: {
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
      filter: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
      bulkDelete: vi.fn(),
      bulkGet: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
    },
    files: { put: vi.fn(async () => undefined), get: vi.fn(async () => undefined) },
    stories: { toArray: vi.fn(async () => []) },
  },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))
import db from '@/stores/db'
import { minimalPdf } from '../files/helpers.js'

const STORY = 'story_1'
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A PNG with a card in its `chara` chunk. */
const cardPng = card => {
  const bytes = new TextEncoder().encode(JSON.stringify(card))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const value = `chara\0${btoa(binary)}`

  const body = Uint8Array.from(value, c => c.charCodeAt(0))
  const head = new Uint8Array(8)
  new DataView(head.buffer).setUint32(0, body.length)
  head.set(
    Uint8Array.from('tEXt', c => c.charCodeAt(0)),
    4
  )
  const end = new Uint8Array(12)
  end.set(
    Uint8Array.from('IEND', c => c.charCodeAt(0)),
    4
  )

  const parts = [Uint8Array.from(SIGNATURE), head, body, new Uint8Array(4), end]
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const file = (name, data) =>
  new File([typeof data === 'string' ? data : data], name, {
    type: name.endsWith('.png') ? 'image/png' : 'application/json',
  })

describe('useCardImport', () => {
  /** @type {ReturnType<typeof useCardImport>} */
  let cards

  beforeEach(() => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    cards = useCardImport(STORY)
  })

  const CARD = {
    spec: 'chara_card_v2',
    data: {
      name: 'Elara',
      description: 'A knight.',
      first_mes: 'Well?',
      alternate_greetings: ['Or this.'],
      character_book: { entries: [{ comment: 'Crowns', content: 'The coin.' }] },
    },
  }

  describe('inspect', () => {
    it('says what a card holds without writing any of it', async () => {
      const found = await cards.inspect(file('elara.png', cardPng(CARD)))

      expect(found).toMatchObject({
        shape: 'card',
        title: 'Elara',
        description: true,
        personality: false,
        greetings: 2,
        lore: 1,
      })
      expect(useDocumentsStore().documents.size).toBe(0)
    })

    it('counts what it is about to write, sidecar and all', async () => {
      const found = await cards.inspect(file('elara.png', cardPng(CARD)))

      // Folder, description, two greetings, the Lore folder, one entry,
      // sidecar — and the PNG itself, kept as the portrait.
      expect(found.documents).toBe(8)
      expect(found.portrait).toBeInstanceOf(File)
    })

    it('has no portrait for a card that came as JSON', async () => {
      const found = await cards.inspect(file('elara.json', JSON.stringify(CARD)))

      expect(found.documents).toBe(7)
      expect(found.portrait).toBeNull()
    })

    it('reads a card that came as JSON rather than in an image', async () => {
      const found = await cards.inspect(file('elara.json', JSON.stringify(CARD)))

      expect(found.shape).toBe('card')
      expect(found.title).toBe('Elara')
    })

    it('knows a lorebook from a card by what is in it', async () => {
      const book = { name: 'A World', entries: { 0: { comment: 'Crowns', content: 'The coin.' } } }
      const found = await cards.inspect(file('world.json', JSON.stringify(book)))

      expect(found).toMatchObject({ shape: 'lorebook', title: 'A World', lore: 1, documents: 3 })
    })

    it('names a lorebook after its file when the book did not name itself', async () => {
      const found = await cards.inspect(
        file('my world.json', JSON.stringify({ entries: [{ content: 'x' }] }))
      )

      expect(found.title).toBe('my world')
    })

    it('keeps an image with no card in it as a picture', async () => {
      const bare = new Uint8Array([...SIGNATURE, 0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0])

      const found = await cards.inspect(file('holiday.png', bare))

      expect(found).toMatchObject({
        shape: 'file',
        title: 'holiday',
        mime: 'image/png',
        text: false,
        documents: 1,
        asks: false,
      })
    })

    it('keeps JSON that is neither a card nor a book as a text file', async () => {
      const found = await cards.inspect(file('notes.json', '{"hello":"world"}'))

      expect(found).toMatchObject({ shape: 'file', mime: 'application/json', text: true })
    })

    it('keeps a file that will not parse as what it is', async () => {
      const found = await cards.inspect(file('notes.json', 'not json'))

      expect(found.shape).toBe('file')
      expect(found.value.text).toBe('not json')
    })

    it('keeps a file called .png that is no such thing', async () => {
      const found = await cards.inspect(file('fake.png', 'plain text'))

      expect(found.shape).toBe('file')
    })

    it('reads a PDF out page by page', async () => {
      const found = await cards.inspect(
        new File([minimalPdf([['Abstract'], ['Method']])], 'paper.pdf', {
          type: 'application/pdf',
        })
      )

      expect(found).toMatchObject({
        shape: 'file',
        title: 'paper',
        mime: 'application/pdf',
        pages: 2,
        text: true,
      })
      expect(found.value.text).toBe('[p.1]\nAbstract\n\n[p.2]\nMethod')
    })

    it('refuses a lorebook with nothing left in it', async () => {
      // Every entry a separator, which is a book of headings and no lore.
      const book = { name: 'Empty', entries: [{ comment: '═══', content: '' }] }

      await expect(cards.inspect(file('empty.json', JSON.stringify(book)))).rejects.toThrow(
        /nothing in it/
      )
    })
  })

  describe('markdown', () => {
    it('is a document and asks nothing', async () => {
      const found = await cards.inspect(file('Chapter 1.md', '# The Road North\n\nSnow fell.'))

      expect(found).toMatchObject({ shape: 'markdown', title: 'Chapter 1', documents: 1 })
      // Nothing to decide, so nothing to ask: no `{{user}}`, no prompt override.
      expect(found.asks).toBe(false)
    })

    it('writes one document, titled after the file', async () => {
      const store = useDocumentsStore()
      const found = await cards.inspect(file('Chapter 1.md', '# The Road North\n\nSnow fell.'))

      const written = await cards.write(found)

      // The heading inside is the writer's text. Eating it to make a name is a
      // decision an importer has no business taking.
      const document = store.getDocument(written.folderId)
      expect(document.title).toBe('Chapter 1')
      expect(document.type).toBe('text')
      expect(document.content).toContain('# The Road North')
    })

    it('takes plain text as readily as markdown', async () => {
      const found = await cards.inspect(file('notes.txt', 'Some notes.'))

      expect(found.shape).toBe('markdown')
    })

    it('writes one too long to lay out as plain text, as it came', async () => {
      const store = useDocumentsStore()
      const row = '| *one* | two |'
      const table = ['| a | b |', '| --- | --- |', ...Array(LAYOUT_LIMIT / 2).fill(row)].join('\n')
      const found = await cards.inspect(file('Tables.md', table))

      const written = await cards.write(found)

      const document = store.getDocument(written.folderId)
      expect(document.plain).toBe(true)
      expect(document.content).toBe(table)
    })

    it('lays out one that is long in words alone', async () => {
      const store = useDocumentsStore()
      const prose = Array(3000).fill('A paragraph of the *road* north.').join('\n\n')
      const found = await cards.inspect(file('Novel.md', prose))

      const written = await cards.write(found)

      expect(store.getDocument(written.folderId).plain).toBeUndefined()
    })

    it('does not make two documents of one name', async () => {
      const store = useDocumentsStore()
      const found = await cards.inspect(file('Chapter 1.md', 'Snow fell.'))

      await cards.write(found)
      const second = await cards.write(found)

      expect(store.getDocument(second.folderId).title).toBe('Chapter 1 (2)')
    })
  })

  describe('write', () => {
    it('starts a conversion for a file with text when the Convert role says so on import', async () => {
      startConversion.mockClear()
      const pdf = file('paper.pdf', minimalPdf([['Hello there']]))
      const found = await cards.inspect(pdf)

      const quiet = await cards.write(found, {})
      expect(startConversion).not.toHaveBeenCalled()

      useApplicationState().setWorkflow('convert', { onImport: true })
      const written = await cards.write(found, {})
      expect(startConversion).toHaveBeenCalledWith(STORY, written.folderId)
      expect(written.folderId).not.toBe(quiet.folderId)
      useApplicationState().setWorkflow('convert', { onImport: false })
    })

    it('writes what was found, where it was asked to', async () => {
      const store = useDocumentsStore()
      const found = await cards.inspect(file('elara.png', cardPng(CARD)))

      const written = await cards.write(found, { userName: 'Riley' })

      expect(written.documents).toBe(found.documents)
      expect(store.getDocument(written.folderId).title).toBe('Elara')
    })

    it('keeps the PNG a card came in as its portrait', async () => {
      const store = useDocumentsStore()
      const png = file('elara.png', cardPng(CARD))
      const found = await cards.inspect(png)

      const written = await cards.write(found, { userName: 'Riley' })

      const portrait = store
        .getChildren(written.folderId)
        .find(document => document.kind === 'portrait')
      expect(portrait).toMatchObject({
        type: 'file',
        title: 'Portrait',
        mime: 'image/png',
        size: png.size,
        content: '',
      })
      expect(portrait.hidden).toBeUndefined()
      expect(db.files.put).toHaveBeenCalledWith({ id: portrait.id, storyId: STORY, blob: png })
    })

    it('writes a file as one document with its bytes beside it', async () => {
      const store = useDocumentsStore()
      const found = await cards.inspect(
        new File([minimalPdf([['Abstract']])], 'paper.pdf', { type: 'application/pdf' })
      )

      const written = await cards.write(found)

      const document = store.getDocument(written.folderId)
      expect(document).toMatchObject({
        type: 'file',
        title: 'paper',
        mime: 'application/pdf',
        pages: 1,
        content: '[p.1]\nAbstract',
      })
      expect(written.note).toBe('1 page of text.')
      expect(db.files.put).toHaveBeenCalledWith(
        expect.objectContaining({ id: document.id, storyId: STORY })
      )
    })

    it('writes a lorebook under the name the dialog showed', async () => {
      const store = useDocumentsStore()
      const found = await cards.inspect(
        file('my world.json', JSON.stringify({ entries: [{ content: 'x' }] }))
      )

      const written = await cards.write(found)

      // The dialog said "my world", so that is what lands — not `Lore`, which
      // is what a nameless book would otherwise become.
      expect(store.getDocument(written.folderId).title).toBe('my world')
    })
  })

  describe('shelves', () => {
    const pathOf = id => {
      const store = useDocumentsStore()
      const titles = []
      for (
        let at = store.getDocument(id);
        at?.parentId !== STORY;
        at = store.getDocument(at.parentId)
      ) {
        titles.unshift(at.title)
      }
      return titles.join('/')
    }
    const book = () => file('my world.json', JSON.stringify({ entries: [{ content: 'x' }] }))

    it('shelves a card asked for on the project under Cards/Characters', async () => {
      const found = await cards.inspect(file('elara.png', cardPng(CARD)))

      const written = await cards.write(found, { parentId: rootIdFor(STORY) })

      expect(pathOf(written.folderId)).toBe('Cards/Characters/Elara')
    })

    it('shelves a lorebook under Cards/Lorebooks, beside the characters', async () => {
      const card = await cards.write(await cards.inspect(file('elara.png', cardPng(CARD))))
      const lore = await cards.write(await cards.inspect(book()))

      expect(pathOf(lore.folderId)).toBe('Cards/Lorebooks/my world')
      // One Cards folder, not one per import.
      const store = useDocumentsStore()
      const shelf = id => store.getDocument(store.getDocument(id).parentId)
      expect(shelf(card.folderId).parentId).toBe(shelf(lore.folderId).parentId)
    })

    it('finds a shelf by what it is, wherever the writer moved it', async () => {
      const store = useDocumentsStore()
      const first = await cards.write(await cards.inspect(file('elara.png', cardPng(CARD))))
      const characters = store.getDocument(first.folderId).parentId
      store.updateDocument(characters, { title: 'Cast' })

      const second = await cards.write(await cards.inspect(file('elara.png', cardPng(CARD))))

      expect(store.getDocument(second.folderId).parentId).toBe(characters)
      expect(store.getDocument(characters).kind).toBe(SHELF_KINDS.characters)
    })

    it('puts one asked for on a folder in that folder', async () => {
      const store = useDocumentsStore()
      await cards.inspect(file('elara.png', cardPng(CARD)))
      const folder = store.createDocument({
        storyId: STORY,
        parentId: rootIdFor(STORY),
        type: 'folder',
        title: 'Mine',
      })

      const written = await cards.write(await cards.inspect(file('elara.png', cardPng(CARD))), {
        parentId: folder.id,
      })

      expect(pathOf(written.folderId)).toBe('Mine/Elara')
    })

    it('leaves a markdown file where it was asked for', async () => {
      const written = await cards.write(await cards.inspect(file('notes.md', '# Hi')))

      expect(pathOf(written.folderId)).toBe('notes')
    })

    it('leaves a file where it was asked for, and on no shelf', async () => {
      const store = useDocumentsStore()
      const folder = store.createDocument({
        storyId: STORY,
        parentId: rootIdFor(STORY),
        type: 'folder',
        title: 'Papers',
      })
      const png = () =>
        file('holiday.png', new Uint8Array([...SIGNATURE, 0, 0, 0, 0, 73, 69, 78, 68]))

      const top = await cards.write(await cards.inspect(png()))
      const inside = await cards.write(await cards.inspect(png()), { parentId: folder.id })

      expect(pathOf(top.folderId)).toBe('holiday')
      expect(pathOf(inside.folderId)).toBe('Papers/holiday')
    })
  })

  describe('inspectCard', () => {
    it('reads the card back out of its folder, portrait and all', async () => {
      const store = useDocumentsStore()
      const written = await cards.write(await cards.inspect(file('elara.png', cardPng(CARD))), {
        userName: 'Riley',
      })
      const portrait = store
        .getChildren(written.folderId)
        .find(document => document.kind === 'portrait')
      db.files.get.mockImplementation(async id =>
        id === portrait.id
          ? { id, storyId: STORY, blob: new Blob(['png'], { type: 'image/png' }) }
          : undefined
      )

      const found = await cards.inspectCard(written.folderId)

      expect(found).toMatchObject({
        shape: 'card',
        title: 'Elara',
        greetings: 2,
        lore: 1,
        documents: 8,
        replaces: written.folderId,
      })
      expect(found.portrait).toBeInstanceOf(File)
    })

    it('writes it back over the folder with the new answers', async () => {
      const store = useDocumentsStore()
      const written = await cards.write(
        await cards.inspect(file('elara.json', JSON.stringify(CARD))),
        { userName: 'Riley' }
      )
      const found = await cards.inspectCard(written.folderId)

      const again = await cards.write(found, { userName: 'Sam' })

      expect(again.folderId).toBe(written.folderId)
      const greeting = store
        .getChildren(written.folderId)
        .find(document => document.kind === 'greeting')
      expect(greeting.content).toBe('Well?')
      expect(
        store.getChildren(written.folderId).some(document => document.kind === 'sidecar')
      ).toBe(true)
    })

    it('has nothing to import again from a folder without a sidecar', async () => {
      const folder = useDocumentsStore().createDocument({
        storyId: STORY,
        parentId: rootIdFor(STORY),
        type: 'folder',
        title: 'Elara',
        kind: 'card',
      })
      await expect(cards.inspectCard(folder.id)).rejects.toThrow('no card in it')
    })
  })
})
