/* global Blob */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { unzipSync } from 'fflate'
import { fileOfExport, useExport } from '@/composables/useExport.js'

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
}))
vi.mock('@/platform/exportFolder.js', () => ({
  canExportToFolder: () => folders.can,
  chooseExportFolder: (/** @type {string} */ name) => folders.choose(name),
  writeExportFolder: (/** @type {any[]} */ ...args) => folders.write(...args),
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
