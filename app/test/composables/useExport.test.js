/* global Blob */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { unzipSync } from 'fflate'
import {
  NO_LINKED_FOLDER,
  exportToLinkedFolder,
  fileOfExport,
  useExport,
} from '@/composables/useExport.js'
import { readStamp, stamped } from '@/files/exportStamp.js'

const documents = {
  root_story_1: { id: 'root_story_1', type: 'folder', title: 'My Project' },
  doc_1: { id: 'doc_1', type: 'text', title: 'Prologue' },
}
vi.mock('@/composables/useDocuments.js', () => ({
  useDocuments: () => ({
    get: (/** @type {string} */ id) =>
      documents[/** @type {keyof typeof documents} */ (id)] ?? null,
    childrenOf: () => [],
    currentContent: () => '',
    init: async () => {},
  }),
}))
vi.mock('@/stores/filesStore', () => ({ useFilesStore: () => ({ getFile: async () => null }) }))

const exportEntries = vi.fn()
vi.mock('@/files/exportDocument.js', () => ({
  exportEntries: (/** @type {any[]} */ ...args) => exportEntries(...args),
}))

const downloadBlob = vi.fn()
vi.mock('@/files/download.js', () => ({
  downloadBlob: (/** @type {any[]} */ ...args) => downloadBlob(...args),
}))

const toast = { warning: vi.fn(), error: vi.fn() }
vi.mock('@/composables/useToast.js', () => ({ useToast: () => toast }))

/** The desktop app's exports to a folder, there or not. */
const folders = vi.hoisted(() => ({
  can: false,
  choose: vi.fn(),
  write: vi.fn(),
  linked: vi.fn(),
  look: vi.fn(),
  apply: vi.fn(),
}))
vi.mock('@/platform/exportFolder.js', () => ({
  canExportToFolder: () => folders.can,
  chooseExportFolder: (/** @type {string} */ name) => folders.choose(name),
  writeExportFolder: (/** @type {any[]} */ ...args) => folders.write(...args),
  linkedExportFolder: (/** @type {string} */ storyId) => folders.linked(storyId),
  lookInLinkedFolder: (/** @type {any[]} */ ...args) => folders.look(...args),
  writeLinkedFolder: (/** @type {any[]} */ ...args) => folders.apply(...args),
}))
vi.mock('@/storage/index.js', () => ({
  storage: { filePath: async (/** @type {string} */ id) => `My Project/${id}.pdf` },
}))

/** A zip's files, each as its text. */
const unzipped = async (/** @type {Blob} */ blob) =>
  Object.fromEntries(
    Object.entries(unzipSync(new Uint8Array(await blob.arrayBuffer()))).map(([path, bytes]) => [
      path,
      new TextDecoder().decode(bytes),
    ])
  )

describe('fileOfExport', () => {
  it('hands out one text as its markdown file, or as typed under its own extension', async () => {
    const md = await fileOfExport(
      { name: 'Prologue.md', entries: [{ path: 'Prologue.md', text: 'The gate.' }], missing: 0 },
      false
    )
    expect(md.filename).toBe('Prologue.md')
    expect(md.blob.type).toBe('text/markdown')
    expect(await md.blob.text()).toBe('The gate.')

    const script = await fileOfExport(
      { name: 'analysis.py', entries: [{ path: 'analysis.py', text: 'print(1)' }], missing: 0 },
      false
    )
    expect(script.blob.type).toBe('text/plain')
  })

  it('hands out one file as itself', async () => {
    const pdf = new Blob(['%PDF'], { type: 'application/pdf' })
    const out = await fileOfExport(
      { name: 'Rules.pdf', entries: [{ path: 'Rules.pdf', blob: pdf }], missing: 0 },
      false
    )
    expect(out).toEqual({ blob: pdf, filename: 'Rules.pdf' })
  })

  it('zips more than one, named for the document or the folder', async () => {
    const document = await fileOfExport(
      {
        name: 'Prologue.md',
        entries: [
          { path: 'images/gate.png', blob: new Blob(['gate'], { type: 'image/png' }) },
          { path: 'Prologue.md', text: '![](images/gate.png)' },
        ],
        missing: 0,
      },
      false
    )
    expect(document.filename).toBe('Prologue.zip')
    expect(await unzipped(document.blob)).toEqual({
      'images/gate.png': 'gate',
      'Prologue.md': '![](images/gate.png)',
    })

    const folder = await fileOfExport(
      { name: 'Draft v1.2', entries: [{ path: 'Draft v1.2', folder: true }], missing: 0 },
      true
    )
    expect(folder.filename).toBe('Draft v1.2.zip')
    expect(await unzipped(folder.blob)).toEqual({ 'Draft v1.2/': '' })
  })
})

describe('useExport', () => {
  beforeEach(() => {
    exportEntries.mockReset()
    downloadBlob.mockReset()
    toast.warning.mockReset()
    toast.error.mockReset()
  })

  it('hands the export out, and says when files were left out of it', async () => {
    exportEntries.mockResolvedValue({
      name: 'Prologue.md',
      entries: [{ path: 'Prologue.md', text: 'The gate.' }],
      missing: 2,
    })
    expect(await useExport('story_1').exportDocument('doc_1')).toBe(true)
    expect(exportEntries).toHaveBeenCalledWith(expect.anything(), 'doc_1')
    expect(downloadBlob.mock.calls[0][1]).toBe('Prologue.md')
    expect(toast.warning).toHaveBeenCalledWith(
      "2 files couldn't be downloaded from the sync server, so the export leaves them out."
    )
  })

  it('says what couldn’t be exported, and why', async () => {
    exportEntries.mockRejectedValue(new Error('Quota exceeded'))
    expect(await useExport('story_1').exportDocument('root_story_1')).toBe(false)
    expect(downloadBlob).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith("The project couldn't be exported. Quota exceeded")
  })

  it('hands out nothing for a file alone whose bytes couldn’t be had', async () => {
    exportEntries.mockResolvedValue({ name: 'Prologue.md', entries: [], missing: 1 })
    expect(await useExport('story_1').exportDocument('doc_1')).toBe(false)
    expect(downloadBlob).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      "The document couldn't be exported. Its file couldn't be downloaded from the sync server."
    )
  })

  it('does nothing for a document that isn’t there', async () => {
    expect(await useExport('story_1').exportDocument('doc_gone')).toBe(false)
    expect(exportEntries).not.toHaveBeenCalled()
  })

  describe('in the desktop app', () => {
    beforeEach(() => {
      folders.can = true
      folders.choose.mockReset()
      folders.write.mockReset()
    })

    it('writes a project or a folder where the writer says, its files copied from the library', async () => {
      folders.choose.mockResolvedValue('/docs/My Project')
      const made = {
        name: 'My Project',
        entries: [{ path: 'My Project', folder: true }],
        missing: 0,
      }
      exportEntries.mockResolvedValue(made)

      expect(await useExport('story_1').exportDocument('root_story_1')).toBe(true)
      expect(folders.choose).toHaveBeenCalledWith('My Project')
      expect(folders.write).toHaveBeenCalledWith('/docs/My Project', made.entries)
      expect(downloadBlob).not.toHaveBeenCalled()
      const [source] = exportEntries.mock.calls[0]
      expect(await source.located('doc_pdf')).toBe('My Project/doc_pdf.pdf')
    })

    it('does nothing more once the writer cancels', async () => {
      folders.choose.mockResolvedValue(null)
      expect(await useExport('story_1').exportDocument('root_story_1')).toBe(false)
      expect(exportEntries).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('hands out a document as it would anywhere', async () => {
      exportEntries.mockResolvedValue({
        name: 'Prologue.md',
        entries: [{ path: 'Prologue.md', text: 'The gate.' }],
        missing: 0,
      })
      expect(await useExport('story_1').exportDocument('doc_1')).toBe(true)
      expect(folders.choose).not.toHaveBeenCalled()
      expect(downloadBlob.mock.calls[0][1]).toBe('Prologue.md')
      expect(exportEntries.mock.calls[0][0].located).toBeUndefined()
    })
  })
})

describe('an export to the project’s linked folder', () => {
  const report = (/** @type {object} */ patch = {}) => ({
    folder: '/repo/docs',
    written: ['Prologue.md'],
    edited: [],
    removed: [],
    unchanged: 0,
    ...patch,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    folders.linked.mockResolvedValue('/repo/docs')
    folders.look.mockResolvedValue({})
    folders.apply.mockResolvedValue(report())
    exportEntries.mockResolvedValue({
      name: 'My Project',
      entries: [
        { path: 'My Project', folder: true },
        { path: 'My Project/Prologue.md', text: 'stamped: The gate.' },
      ],
      missing: 0,
    })
  })

  it('is refused for a project with no folder, before anything is read', async () => {
    folders.linked.mockResolvedValue(null)

    await expect(exportToLinkedFolder('story_1')).rejects.toThrow(NO_LINKED_FOLDER)
    expect(exportEntries).not.toHaveBeenCalled()
  })

  it('exports the whole project, stamping each text with the document it came from', async () => {
    const done = await exportToLinkedFolder('story_1')

    expect(done).toEqual({ ...report(), missing: 0 })
    const [source, top] = exportEntries.mock.calls[0]
    expect(top).toBe('root_story_1')
    expect(await source.located('doc_9')).toBe('My Project/doc_9.pdf')

    const text = await source.stamp(documents.doc_1, 'The gate.')
    expect(readStamp(text)).toMatchObject({
      stamp: { project: 'My Project', document: 'Prologue', id: 'doc_1' },
      // Ending in a newline, as a file in a repository does.
      body: 'The gate.\n',
    })
    expect(readStamp(await source.stamp(documents.doc_1, 'The gate.\n')).body).toBe('The gate.\n')
    expect(folders.apply).toHaveBeenCalledWith('story_1', [
      { path: 'My Project', folder: true },
      { path: 'My Project/Prologue.md', text: 'stamped: The gate.' },
    ])
  })

  it('looks at the texts that are there, and says which are older exports of its own', async () => {
    const from = { project: 'My Project', document: 'Prologue', id: 'doc_1' }
    const now = await stamped(from, 'The gate, rewritten.')
    const older = await stamped(from, 'The gate.')
    const entry = { path: 'My Project/Prologue.md', text: now }
    exportEntries.mockResolvedValue({ name: 'My Project', entries: [entry], missing: 0 })

    // An older export, as it was left: the export's own.
    folders.look.mockResolvedValue({ 'My Project/Prologue.md': older })
    await exportToLinkedFolder('story_1')
    expect(folders.look).toHaveBeenCalledWith('story_1', ['My Project/Prologue.md'])
    expect(folders.apply).toHaveBeenLastCalledWith('story_1', [{ ...entry, own: true }])

    // Changed outside since: not said to be.
    folders.look.mockResolvedValue({ 'My Project/Prologue.md': `${older}\nAdded in the repo.` })
    await exportToLinkedFolder('story_1')
    expect(folders.apply).toHaveBeenLastCalledWith('story_1', [entry])

    // Nothing there, or the same already: nothing to say.
    for (const there of [null, now]) {
      folders.look.mockResolvedValue({ 'My Project/Prologue.md': there })
      await exportToLinkedFolder('story_1')
      expect(folders.apply).toHaveBeenLastCalledWith('story_1', [entry])
    }
  })

  it('says nothing when it goes as it should', async () => {
    expect(await useExport('story_1').exportToLinked()).toBe(true)
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('tells of copies changed outside that it replaced, and of files left out', async () => {
    folders.apply.mockResolvedValue(report({ edited: ['Prologue.md'] }))
    await useExport('story_1').exportToLinked()
    expect(toast.warning).toHaveBeenCalledWith(
      "A file had been changed outside inksprite, and was replaced. The copy that was there is in the system's trash."
    )

    toast.warning.mockClear()
    folders.apply.mockResolvedValue(report({ edited: ['a.md', 'b.md'] }))
    exportEntries.mockResolvedValue({ name: 'My Project', entries: [], missing: 1 })
    await useExport('story_1').exportToLinked()
    expect(toast.warning).toHaveBeenCalledTimes(2)
    expect(toast.warning.mock.calls[1][0]).toContain('2 files had been changed outside inksprite')
  })

  it('says what went wrong, and that it wasn’t exported', async () => {
    folders.apply.mockRejectedValue(new Error('Plan.md is there, and isn’t a file.'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await useExport('story_1').exportToLinked()).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(
      "The project couldn't be exported. Plan.md is there, and isn’t a file."
    )
    error.mockRestore()
  })
})
