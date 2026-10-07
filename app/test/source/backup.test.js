// @vitest-environment node
/* global File */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import db from '@/stores/db.js'
import { useBackup } from '@/composables/useBackup.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { isRepository, repositoryOf } from '@/source/tree.js'

// A repository belongs to its project, and goes wherever the project's
// documents go: into a whole backup and back, and into a project's own file
// and out again as a copy. Its files have no bytes beside their text, so
// nothing of it is in `files`.

const STORY = 'story_R4pQx8Lm2Wz6Tn0Vc3Ky9'
const ROOT = rootIdFor(STORY)
const REPOSITORY = 'doc_Gt5Hn1Kw7Pz3Xq9Lm2Vb8'
const SRC = 'doc_Jc8Rw2Nt6Yq0Lp4Xz7Mk1'
const INDEX = 'doc_Wb3Kq7Zp1Tn5Hx9Lc2Rv6'
const README = 'doc_Mz6Xp0Lt4Rq8Kw2Nc5Hj3'

const SOURCE = {
  from: 'github',
  name: 'acme/widgets',
  ref: 'main',
  commit: '3f9c2a17e0b4d58c6a1f27e93b0d4c8a51e6f702',
  imported: 4,
}
// Code is full of words with underscores in them, which is where an id is
// looked for when a project is copied.
const CODE = 'export const make_widget = (spec_id, doc_count) => ({ spec_id, doc_count })\n'

/** @param {string} id @param {string} parentId @param {object} rest */
const doc = (id, parentId, rest) => ({
  id,
  storyId: STORY,
  parentId,
  order: 0,
  summary: '',
  wordCount: 0,
  version: 1,
  created: 1,
  updated: 1,
  content: '',
  ...rest,
})

async function seed() {
  await db.stories.add({
    id: STORY,
    overview: '',
    wordCount: 0,
    lastDocumentId: null,
    options: {},
    version: 1,
    created: 1,
    updated: 1,
  })
  await db.documents.bulkAdd([
    doc(ROOT, STORY, { type: 'folder', title: 'Widgets design' }),
    doc(REPOSITORY, ROOT, { type: 'folder', title: 'widgets', kind: 'repository', source: SOURCE }),
    doc(SRC, REPOSITORY, { type: 'folder', title: 'src' }),
    doc(INDEX, SRC, { type: 'file', title: 'index.ts', mime: 'text/x-typescript', content: CODE }),
    doc(README, REPOSITORY, {
      type: 'file',
      title: 'README.md',
      mime: 'text/markdown',
      content: '# Widgets\n',
    }),
  ])
}

/** @param {import('@/utils/backup.js').Backup} backup */
const asFile = backup =>
  new File([JSON.stringify(backup)], 'project.json', { type: 'application/json' })

describe('a repository in backups', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await Promise.all(db.tables.map((/** @type {import('dexie').Table} */ table) => table.clear()))
    await seed()
  })

  it("goes into the project's own file, folder, files and all", async () => {
    const backup = await useBackup().createProjectBackup(STORY)

    const repository = backup.tables.documents.find(row => row.id === REPOSITORY)
    expect(repository).toMatchObject({ kind: 'repository', source: SOURCE })
    expect(backup.tables.documents.find(row => row.id === INDEX).content).toBe(CODE)
    expect(backup.tables.files).toEqual([])
  })

  it('comes out of that file as a copy of its own, its text untouched', async () => {
    const backup = useBackup()
    const story = await backup.importProject(
      await backup.readProjectFile(asFile(await backup.createProjectBackup(STORY)))
    )

    const documents = await db.documents.where('storyId').equals(story.id).toArray()
    const byId = new Map(documents.map(row => [row.id, row]))
    const repository = documents.find(isRepository)
    const index = documents.find(row => row.title === 'index.ts')

    expect(repository.id).not.toBe(REPOSITORY)
    expect(repository.source).toEqual(SOURCE)
    expect(index.id).not.toBe(INDEX)
    expect(index.content).toBe(CODE)
    expect(repositoryOf(id => byId.get(id), index)).toBe(repository)

    // The original is as it was.
    expect(await db.documents.get(REPOSITORY)).toMatchObject({ storyId: STORY, source: SOURCE })
  })

  it('goes into a whole backup and comes back as it was', async () => {
    const backup = useBackup()
    const saved = await backup.createBackup()
    await db.documents.clear()

    await backup.restoreBackup(saved)

    expect(await db.documents.get(REPOSITORY)).toMatchObject({
      kind: 'repository',
      source: SOURCE,
    })
    expect(await db.documents.get(INDEX)).toMatchObject({ parentId: SRC, content: CODE })
    expect(await db.files.count()).toBe(0)
  })
})
