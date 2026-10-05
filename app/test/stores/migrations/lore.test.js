import { describe, it, expect } from 'vitest'
import {
  loreToDocuments,
  plainTextToHtml,
  categoryFolderIdFor,
  archiveFolderIdFor,
} from '../../../src/stores/migrations/lore.js'
import { notesIdFor } from '../../../src/stores/migrations/projectTree.js'

const NOW = 1700000000000

const lorebook = (id, storyId) => ({ id, storyId })

const entry = (id, overrides = {}) => ({
  id,
  lorebookId: 'lorebook_1',
  name: id,
  category: '',
  description: '',
  content: '',
  enabled: true,
  includeInPrompt: true,
  version: 1,
  deleted: false,
  deletedAt: null,
  created: 1,
  updated: 2,
  ...overrides,
})

/** A story that has already been through the v4 restructure. */
const treeFor = storyId => [
  { id: `root_${storyId}`, storyId, parentId: storyId, type: 'folder' },
  { id: `manuscript_${storyId}`, storyId, parentId: `root_${storyId}`, type: 'folder' },
  { id: notesIdFor(storyId), storyId, parentId: `root_${storyId}`, type: 'folder' },
]

const run = (
  entries,
  { books = [lorebook('lorebook_1', 'story_1')], docs = treeFor('story_1') } = {}
) => loreToDocuments(books, entries, docs, NOW)

const byId = result => new Map(result.documents.map(d => [d.id, d]))

describe('loreToDocuments', () => {
  it('turns an entry into a text document under notes', () => {
    const result = run([
      entry('lore_1', { name: 'Elara', description: 'A knight', content: 'Tall.' }),
    ])

    expect(result.documents).toHaveLength(1)
    expect(result.documents[0]).toMatchObject({
      id: 'lore_1',
      storyId: 'story_1',
      parentId: notesIdFor('story_1'),
      type: 'text',
      title: 'Elara',
      // `description` was the one-line blurb under the name; that is a summary.
      summary: 'A knight',
      content: '<p>Tall.</p>',
      wordCount: 1,
    })
  })

  it('keeps entry ids, so replayed tool results still resolve', () => {
    const result = run([entry('lore_abc123')])
    expect(result.documents[0].id).toBe('lore_abc123')
  })

  it('makes a folder for each category in use', () => {
    const result = run([
      entry('lore_1', { category: 'Characters' }),
      entry('lore_2', { category: 'Characters' }),
      entry('lore_3', { category: 'Setting' }),
    ])

    const map = byId(result)
    const characters = categoryFolderIdFor('story_1', 'Characters')
    const setting = categoryFolderIdFor('story_1', 'Setting')

    expect(map.get(characters)).toMatchObject({
      type: 'folder',
      title: 'Characters',
      parentId: notesIdFor('story_1'),
      ordered: false,
    })
    expect(map.get('lore_1').parentId).toBe(characters)
    expect(map.get('lore_2').parentId).toBe(characters)
    expect(map.get('lore_3').parentId).toBe(setting)

    // Two entries in one category make one folder, not two.
    expect(result.documents.filter(d => d.type === 'folder')).toHaveLength(2)
  })

  it('does not invent folders for declared but unused categories', () => {
    // The lorebook declares five categories by default; the story uses one.
    const books = [{ ...lorebook('lorebook_1', 'story_1'), categories: ['A', 'B', 'C', 'D', 'E'] }]
    const result = run([entry('lore_1', { category: 'A' })], { books })

    expect(result.documents.filter(d => d.type === 'folder')).toHaveLength(1)
  })

  it('merges categories that differ only in case or punctuation', () => {
    const result = run([
      entry('lore_1', { category: 'Characters' }),
      entry('lore_2', { category: 'characters' }),
    ])

    const map = byId(result)
    expect(map.get('lore_1').parentId).toBe(map.get('lore_2').parentId)
    expect(result.documents.filter(d => d.type === 'folder')).toHaveLength(1)
  })

  it('leaves uncategorized entries directly in notes', () => {
    const result = run([entry('lore_1', { category: '   ' })])

    expect(result.documents).toHaveLength(1)
    expect(result.documents[0].parentId).toBe(notesIdFor('story_1'))
  })

  it('puts disabled entries in an archive folder rather than inline', () => {
    const result = run([
      entry('lore_1', { enabled: false, category: 'Characters' }),
      entry('lore_2', { enabled: true, category: 'Characters' }),
    ])

    const map = byId(result)
    const archive = archiveFolderIdFor('story_1')

    expect(map.get(archive)).toMatchObject({ type: 'folder', title: 'archive' })
    // Archive is flat: a switched-off entry does not also get its category.
    expect(map.get('lore_1').parentId).toBe(archive)
    expect(map.get('lore_2').parentId).toBe(categoryFolderIdFor('story_1', 'Characters'))
  })

  it('creates no archive folder when nothing is disabled', () => {
    const result = run([entry('lore_1'), entry('lore_2')])
    expect(byId(result).has(archiveFolderIdFor('story_1'))).toBe(false)
  })

  it('spreads entries across the stories that own them', () => {
    const books = [lorebook('lorebook_1', 'story_1'), lorebook('lorebook_2', 'story_2')]
    const docs = [...treeFor('story_1'), ...treeFor('story_2')]
    const result = run([entry('lore_1'), entry('lore_2', { lorebookId: 'lorebook_2' })], {
      books,
      docs,
    })

    const map = byId(result)
    expect(map.get('lore_1')).toMatchObject({ storyId: 'story_1', parentId: notesIdFor('story_1') })
    expect(map.get('lore_2')).toMatchObject({ storyId: 'story_2', parentId: notesIdFor('story_2') })
  })

  it('numbers siblings from zero within each folder', () => {
    const result = run([
      entry('lore_1', { category: 'Characters' }),
      entry('lore_2', { category: 'Characters' }),
      entry('lore_3'),
    ])

    const map = byId(result)
    expect(map.get('lore_1').order).toBe(0)
    expect(map.get('lore_2').order).toBe(1)
    expect(map.get('lore_3').order).toBe(0)
  })

  describe('skipping', () => {
    it('skips entries that are already documents, so a retry cannot double up', () => {
      const docs = [
        ...treeFor('story_1'),
        { id: 'lore_1', storyId: 'story_1', parentId: notesIdFor('story_1'), type: 'text' },
      ]
      const result = run([entry('lore_1'), entry('lore_2')], { docs })

      expect(result.documents.map(d => d.id)).toEqual(['lore_2'])
      expect(result.skipped).toContainEqual({ id: 'lore_1', reason: 'already migrated' })
    })

    it('reuses a category folder that a previous run already created', () => {
      const characters = categoryFolderIdFor('story_1', 'Characters')
      const docs = [
        ...treeFor('story_1'),
        { id: characters, storyId: 'story_1', parentId: notesIdFor('story_1'), type: 'folder' },
      ]
      const result = run([entry('lore_1', { category: 'Characters' })], { docs })

      expect(result.documents.filter(d => d.type === 'folder')).toHaveLength(0)
      expect(result.documents[0].parentId).toBe(characters)
    })

    it('reuses an archive folder that a previous run already created', () => {
      const archive = archiveFolderIdFor('story_1')
      const docs = [
        ...treeFor('story_1'),
        {
          id: archive,
          storyId: 'story_1',
          parentId: notesIdFor('story_1'),
          type: 'folder',
          title: 'archive',
        },
      ]
      const result = run([entry('lore_1', { enabled: false })], { docs })

      // Re-emitting it would overwrite a folder the writer may have renamed.
      expect(result.documents.filter(d => d.type === 'folder')).toHaveLength(0)
      expect(result.documents[0].parentId).toBe(archive)
    })

    it('skips deleted entries', () => {
      const result = run([entry('lore_1', { deleted: true })])

      expect(result.documents).toHaveLength(0)
      expect(result.skipped).toContainEqual({ id: 'lore_1', reason: 'entry is deleted' })
    })

    it('skips entries whose lorebook is missing', () => {
      const result = run([entry('lore_1', { lorebookId: 'lorebook_gone' })])

      expect(result.documents).toHaveLength(0)
      expect(result.skipped[0].reason).toContain('lorebook_gone')
    })

    it('skips entries whose story never got a tree', () => {
      const result = run([entry('lore_1')], { docs: [] })

      expect(result.documents).toHaveLength(0)
      expect(result.skipped[0].reason).toContain('no notes folder')
    })

    it('skips entries with no id', () => {
      const result = run([{ lorebookId: 'lorebook_1', name: 'nameless' }])
      expect(result.skipped[0].reason).toBe('entry has no id')
    })

    it('tolerates empty and missing input', () => {
      expect(loreToDocuments([], [], [], NOW)).toEqual({ documents: [], skipped: [] })
      expect(loreToDocuments(null, null, null, NOW)).toEqual({ documents: [], skipped: [] })
    })
  })
})

describe('plainTextToHtml', () => {
  it('makes a paragraph of a single block', () => {
    expect(plainTextToHtml('Hello there.')).toBe('<p>Hello there.</p>')
  })

  it('splits blank-line-separated blocks into paragraphs', () => {
    expect(plainTextToHtml('One.\n\nTwo.')).toBe('<p>One.</p><p>Two.</p>')
  })

  it('keeps single newlines as hard breaks', () => {
    // A character sheet is mostly single newlines; dropping them would run it
    // into one block of prose.
    expect(plainTextToHtml('Age: 30\nEyes: green')).toBe('<p>Age: 30<br>Eyes: green</p>')
  })

  it('escapes markup so lore text cannot inject nodes', () => {
    expect(plainTextToHtml('a < b & <script>x</script>')).toBe(
      '<p>a &lt; b &amp; &lt;script&gt;x&lt;/script&gt;</p>'
    )
  })

  it('leaves non-ASCII alone', () => {
    expect(plainTextToHtml('Café — naïve')).toBe('<p>Café — naïve</p>')
  })

  it('returns empty for blank input', () => {
    expect(plainTextToHtml('')).toBe('')
    expect(plainTextToHtml('   \n\n  ')).toBe('')
    expect(plainTextToHtml(undefined)).toBe('')
  })

  it('normalizes CRLF', () => {
    expect(plainTextToHtml('One.\r\n\r\nTwo.')).toBe('<p>One.</p><p>Two.</p>')
  })
})
