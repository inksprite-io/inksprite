/* global structuredClone, AbortController */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  currentDigests,
  exploreAndWait,
  isRunning,
  planExploring,
  startExplore,
  startJob,
} from '@/jobs/index.js'
import { useDocumentsStore } from '@/stores/documentsStore.js'
import { useJobsStore } from '@/stores/jobsStore.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

const rows = new Map()
vi.mock('@/stores/db', () => ({
  default: {
    jobs: {
      put: vi.fn(async row => rows.set(row.id, structuredClone(row))),
      delete: vi.fn(async id => rows.delete(id)),
      bulkDelete: vi.fn(async ids => ids.forEach(id => rows.delete(id))),
      toArray: vi.fn(async () => [...rows.values()]),
    },
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
      bulkGet: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
    },
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const providers = {
  p1: { id: 'p1', name: 'Test', type: 'generic', endpoint: 'http://x' },
  p2: { id: 'p2', name: 'Home', type: 'generic', endpoint: 'http://home' },
}
// The preset in use, which every chat runs on and a new one starts on.
const active = vi.hoisted(() => ({ value: /** @type {any} */ (null) }))
vi.mock('@/composables/useAIConfig.js', () => ({
  useAIConfig: () => ({ activeAIPreset: active, getProvider: id => providers[id] || null }),
}))
// The workflows as a state saved while explore was one may still have them.
const workflows = vi.hoisted(() => ({ value: /** @type {any} */ ({}) }))
vi.mock('@/composables/useApplicationState.js', () => ({
  useApplicationState: () => ({ workflows }),
}))
// How long a context the model has: a small one, so a long document is read in parts.
const context = vi.hoisted(() => ({ value: /** @type {number|undefined} */ (undefined) }))
/** Each model asked how long its context is, by connection and model. */
const measured = []
vi.mock('@/ai/models.js', () => ({
  contextOf: async (provider, model) => {
    measured.push(`${provider.id} ${model}`)
    return context.value
  },
}))

/**
 * The model: it describes each heading it is asked for, and says what it
 * was sent, so a test can tell what reached it.
 */
const sent = []
/** Who each request went to, and how. */
const sentTo = []
let answering = (/** @type {string[]} */ headings) =>
  headings
    .map(heading => `## ${heading}\nAbout ${heading}.\n\nWhat ${heading} holds, in a paragraph.`)
    .join('\n\n')
vi.mock('@/ai/complete.js', () => ({
  complete: vi.fn(async ({ messages, provider, model, upstreams, overrides }) => {
    const user = messages[1].content
    sent.push(user)
    sentTo.push({
      to: `${provider.id} ${model}`,
      allowedProviders: upstreams?.allowedProviders,
      overrides,
    })
    const headings = user
      .slice(user.lastIndexOf('Describe'))
      .split('\n')
      .filter(line => line.startsWith('## '))
      .map(line => line.slice(3))
    return { content: answering(headings), finishReason: 'stop', usage: null }
  }),
}))

const STORY = 'story_1'
const ROOT = rootIdFor(STORY)
/** Made-up prose of so many words. @param {number} words @param {string} [word] */
const prose = (words, word = 'tide') => `${Array.from({ length: words }, () => word).join(' ')}.`

/** Wait for a job to stop running. @param {string} id */
const settled = async id => {
  for (let tries = 0; tries < 400 && isRunning(id); tries++) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  await new Promise(resolve => setTimeout(resolve, 5))
}

describe('exploring a project, as a job', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let documents

  /** @param {string} parentId @param {string} title @param {string} content */
  const text = (parentId, title, content) =>
    documents.createDocument({ storyId: STORY, parentId, type: 'text', title, content })
  /** @param {string} parentId @param {string} title */
  const folder = (parentId, title) =>
    documents.createDocument({ storyId: STORY, parentId, type: 'folder', title })

  /** @param {string} folderId */
  const explore = async folderId => {
    const planned = await planExploring(folderId)
    const job = await startExplore(STORY, folderId, planned)
    if (job) await settled(job.id)
    return { planned, job: job ? useJobsStore().getJob(job.id) : null }
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    rows.clear()
    sent.length = 0
    context.value = undefined
    active.value = { providerId: 'p1', model: 'small' }
    workflows.value = {}
    answering = headings =>
      headings
        .map(
          heading => `## ${heading}\nAbout ${heading}.\n\nWhat ${heading} holds, in a paragraph.`
        )
        .join('\n\n')
    documents = useDocumentsStore()
    await documents.loadStory(STORY)
    documents.ensureRoot(STORY, 'Thief')
  })

  it('gives each document worth a line, each folder and the project a digest, and edits nothing', async () => {
    const lore = folder(ROOT, 'Lore')
    const varrow = text(lore.id, 'Varrow', 'A port town on a cold coast.')
    const gull = text(lore.id, 'The Gull', prose(200, 'sail'))
    const updated = gull.updated
    const edited = documents.getDocument(ROOT)?.edited

    const { planned, job } = await explore(ROOT)

    expect(planned.documents).toBe(2)
    expect(job?.status).toBe('done')
    expect(job?.title).toBe('Explore Thief')
    // Everything fits in one request: the whole project read at once.
    expect(sent).toHaveLength(1)
    expect(documents.getDocument(gull.id)?.digest).toMatchObject({
      line: 'About Lore/The Gull.',
      text: 'What Lore/The Gull holds, in a paragraph.',
    })
    expect(documents.getDocument(lore.id)?.digest?.line).toBe('About Lore/.')
    expect(documents.getDocument(ROOT)?.digest?.line).toBe('About /.')
    // A short entry is described in its folder's.
    expect(documents.getDocument(varrow.id)?.digest).toBeUndefined()
    expect(documents.getDocument(gull.id)?.updated).toBe(updated)
    expect(documents.getDocument(ROOT)?.edited).toBe(edited)
  })

  it('reads a long document in parts on a small model, and the folders above from their digests', async () => {
    context.value = 4096
    const research = folder(ROOT, 'Research')
    const content = ['# Scoring', prose(1500, 'score'), '# Curves', prose(1500, 'curve')].join('\n')
    const book = text(research.id, 'Book', content)
    text(research.id, 'Reading list', 'Three papers to find.')

    const { job } = await explore(ROOT)

    expect(job?.status).toBe('done')
    const parts = job?.steps.filter(step => step.id.startsWith('part-')) || []
    expect(parts.length).toBeGreaterThan(1)
    expect(documents.getDocument(book.id)?.digest?.line).toBe('About Research/Book.')
    expect(documents.getDocument(research.id)?.digest).toBeDefined()
    // The book is put together from what its parts said, not read again.
    const whole = sent.find(said => said.startsWith('Research/Book was too long'))
    expect(whole).toContain('About Research/Book, part 1 of')
    expect(whole).not.toContain('score score')
  })

  it('explores again only what changed since, and the folders above it', async () => {
    const notes = folder(ROOT, 'Notes')
    const elara = text(notes.id, 'Elara', prose(200, 'elara'))
    text(notes.id, 'Bran', prose(200, 'bran'))
    text(ROOT, 'Outline', prose(200, 'outline'))
    await explore(ROOT)

    expect((await planExploring(ROOT)).steps).toEqual([])

    documents.updateDocument(elara.id, { content: prose(220, 'elara') })
    const again = await planExploring(ROOT)
    expect(again.steps).toHaveLength(1)
    expect(again.documents).toBe(3)
  })

  it('sends nothing the writer hid from the AI', async () => {
    const notes = folder(ROOT, 'Notes')
    text(notes.id, 'Elara', prose(200, 'elara'))
    const secret = text(notes.id, 'Secret', prose(200, 'hush'))
    documents.updateDocument(secret.id, { hidden: true })

    await explore(ROOT)

    expect(sent.join('\n')).not.toContain('hush')
    expect(sent.join('\n')).not.toContain('Secret')
  })

  it('reads a document as it stands, without what a suggestion would put in', async () => {
    const notes = folder(ROOT, 'Notes')
    const elara = text(
      notes.id,
      'Elara',
      'A knight of the {--north--}{>>sabcd1<<}{++salt marsh++}{>>sabcd1<<}, {==sworn==}{>>cabcd1<<} young.'
    )

    await explore(elara.id)

    expect(sent.join('\n')).toContain('A knight of the north, sworn young.')
    expect(sent.join('\n')).not.toContain('marsh')
  })

  it('fails the step when the model answers without the headings it was asked for', async () => {
    const notes = folder(ROOT, 'Notes')
    text(notes.id, 'Elara', prose(200, 'elara'))
    text(notes.id, 'Bran', prose(200, 'bran'))
    answering = () => 'These are notes about some people.'

    const { job } = await explore(ROOT)

    expect(job?.status).toBe('failed')
    expect(job?.error).toBe('The model answered without the headings it was asked for.')
  })

  it('starts nothing when everything is current', async () => {
    text(ROOT, 'Outline', prose(200))
    await explore(ROOT)
    const planned = await planExploring(ROOT)
    expect(await startExplore(STORY, ROOT, planned)).toBeNull()
  })

  it('explores one document, however short, and nothing around it', async () => {
    const notes = folder(ROOT, 'Notes')
    const elara = text(notes.id, 'Elara', 'A knight of the north.')
    text(notes.id, 'Bran', prose(200, 'bran'))

    const { planned, job } = await explore(elara.id)

    expect(planned.documents).toBe(1)
    expect(job?.status).toBe('done')
    expect(job?.title).toBe('Explore Elara')
    expect(sent.join('\n')).not.toContain('bran')
    expect(documents.getDocument(elara.id)?.digest?.line).toBe('About Notes/Elara.')
    expect(documents.getDocument(notes.id)?.digest).toBeUndefined()
    expect((await planExploring(elara.id)).steps).toEqual([])
  })

  it('gives a long section a line on its document’s digest, read whole or in parts', async () => {
    /** @param {string[]} titles @param {number} words */
    const chapters = (titles, words) =>
      titles.map(title => `# ${title}\n\n${prose(words, title.toLowerCase())}`).join('\n\n')
    const atlas = text(ROOT, 'Atlas', chapters(['Coasts', 'Tides'], 1100))

    await explore(atlas.id)
    expect(documents.getDocument(atlas.id)?.digest?.sections).toEqual([
      { link: 'coasts', line: 'About Atlas § Coasts.' },
      { link: 'tides', line: 'About Atlas § Tides.' },
    ])

    context.value = 4096
    const long = text(ROOT, 'Long atlas', chapters(['North', 'South', 'West'], 1300))
    const { job } = await explore(long.id)

    expect(job?.steps.filter(step => step.id.startsWith('part-')).length).toBeGreaterThan(1)
    expect(documents.getDocument(long.id)?.digest?.sections?.map(section => section.line)).toEqual([
      'About Long atlas § North.',
      'About Long atlas § South.',
      'About Long atlas § West.',
    ])
  })

  it('says which digests are current: none once what they were made from has changed', async () => {
    const notes = folder(ROOT, 'Notes')
    const elara = text(notes.id, 'Elara', prose(200, 'elara'))
    const bran = text(notes.id, 'Bran', prose(200, 'bran'))
    await explore(ROOT)

    const before = currentDigests(STORY)
    expect([elara.id, bran.id, notes.id, ROOT].map(before)).toEqual([true, true, true, true])

    documents.updateDocument(elara.id, { content: prose(210, 'elara') })
    const after = currentDigests(STORY)
    expect([elara.id, bran.id, notes.id, ROOT].map(after)).toEqual([false, true, false, false])
  })
})

describe('exploring while a chat waits', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let documents

  beforeEach(async () => {
    setActivePinia(createPinia())
    rows.clear()
    sent.length = 0
    context.value = undefined
    active.value = { providerId: 'p1', model: 'small' }
    workflows.value = {}
    documents = useDocumentsStore()
    await documents.loadStory(STORY)
    documents.ensureRoot(STORY, 'Thief')
  })

  it('runs the job, says how far it has got, and leaves no job behind', async () => {
    documents.createDocument({
      storyId: STORY,
      parentId: ROOT,
      type: 'text',
      title: 'Outline',
      content: prose(200),
    })
    const planned = await planExploring(ROOT)
    /** @type {string[]} */
    const said = []

    const outcome = await exploreAndWait(STORY, ROOT, planned, {
      progress: (done, of) => said.push(`${done} of ${of}`),
    })

    expect(outcome).toEqual({})
    expect(said[0]).toBe('0 of 1')
    expect(said.at(-1)).toBe('1 of 1')
    expect(documents.getDocument(ROOT)?.digest).toBeDefined()
    expect(useJobsStore().getJobs()).toEqual([])
  })

  it('stops with the chat, and keeps what its finished steps made', async () => {
    context.value = 4096
    const research = documents.createDocument({
      storyId: STORY,
      parentId: ROOT,
      type: 'folder',
      title: 'Research',
    })
    for (const title of ['One', 'Two', 'Three']) {
      documents.createDocument({
        storyId: STORY,
        parentId: research.id,
        type: 'text',
        title,
        // Each a request of its own on a small model, which describes it.
        content: prose(900, title.toLowerCase()),
      })
    }
    const planned = await planExploring(ROOT)
    const stop = new AbortController()

    const outcome = await exploreAndWait(STORY, ROOT, planned, {
      signal: stop.signal,
      progress: done => done === 1 && stop.abort(),
    })

    expect(outcome).toEqual({ error: 'Stopped.' })
    expect(useJobsStore().getJobs()).toEqual([])
    const left = await planExploring(ROOT)
    expect(left.steps.length).toBeGreaterThan(0)
    expect(left.steps.length).toBeLessThan(planned.steps.length)
  })

  it('starts nothing when it is stopped before it starts', async () => {
    documents.createDocument({
      storyId: STORY,
      parentId: ROOT,
      type: 'text',
      title: 'Outline',
      content: prose(200),
    })
    const stop = new AbortController()
    stop.abort()

    expect(
      await exploreAndWait(STORY, ROOT, await planExploring(ROOT), { signal: stop.signal })
    ).toEqual({ error: 'Stopped.' })
    expect(sent).toEqual([])
    expect(useJobsStore().getJobs()).toEqual([])
  })
})

describe('the model an exploration runs on', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let documents

  /** The chat's preset: another connection and model than the one in use. */
  const chatPreset = {
    id: 'preset_chat',
    name: 'Chat',
    providerId: 'p2',
    model: 'big',
    allowedProviders: ['fast'],
    generationOverrides: { reasoningEffort: 'low', temperature: 0.4 },
    isDefault: false,
    version: 1,
    created: 1,
    updated: 1,
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    rows.clear()
    sent.length = 0
    sentTo.length = 0
    measured.length = 0
    context.value = undefined
    active.value = { providerId: 'p1', model: 'small' }
    workflows.value = {}
    documents = useDocumentsStore()
    await documents.loadStory(STORY)
    documents.ensureRoot(STORY, 'Thief')
    documents.createDocument({
      storyId: STORY,
      parentId: ROOT,
      type: 'text',
      title: 'Outline',
      content: prose(200),
    })
  })

  it('is the chat’s: planned on its context, kept on the job, and asked with its settings', async () => {
    const planned = await planExploring(ROOT, chatPreset)

    expect(measured).toEqual(['p2 big'])
    expect(planned.runsOn).toEqual({
      providerId: 'p2',
      model: 'big',
      allowedProviders: ['fast'],
      overrides: { reasoningEffort: 'low', temperature: 0.4 },
    })

    // The preset in use changes while it runs; the job goes on as planned.
    active.value = { providerId: 'p1', model: 'small' }
    const job = await startExplore(STORY, ROOT, planned)
    if (job) await settled(job.id)

    expect(useJobsStore().getJob(job?.id || '')).toMatchObject({
      status: 'done',
      runsOn: planned.runsOn,
    })
    expect(useJobsStore().getJob(job?.id || '')).not.toHaveProperty('workflow')
    expect(sentTo).toEqual([
      {
        to: 'p2 big',
        allowedProviders: ['fast'],
        overrides: { reasoningEffort: 'low', temperature: 0.4 },
      },
    ])
  })

  it('is the one a new chat runs on when no chat asks: the preset in use', async () => {
    const planned = await planExploring(ROOT)

    expect(planned.runsOn).toEqual({ providerId: 'p1', model: 'small' })
    expect(measured).toEqual(['p1 small'])
  })

  it('says what a chat would say when there is none to run on', async () => {
    active.value = null
    await expect(planExploring(ROOT)).rejects.toThrow('No AI provider is connected.')
    await expect(planExploring(ROOT, { ...chatPreset, model: '' })).rejects.toThrow(
      'Pick a model in Settings › AI.'
    )
    expect(sent).toEqual([])
  })

  it('fails a job whose connection has gone since, saying so', async () => {
    const planned = await planExploring(ROOT, chatPreset)
    const job = await useJobsStore().createJob({
      storyId: STORY,
      kind: 'explore',
      runsOn: { ...planned.runsOn, providerId: 'p_gone' },
      documentId: ROOT,
      title: 'Explore Thief',
      steps: planned.steps,
      plan: planned.plan,
    })

    await startJob(job.id)

    expect(useJobsStore().getJob(job.id)).toMatchObject({
      status: 'failed',
      error: 'The connection this job runs on is gone.',
    })
    expect(sent).toEqual([])
  })

  it('runs one made while explore was a workflow, on that workflow’s model or the preset in use', async () => {
    const planned = await planExploring(ROOT)
    const { runsOn, ...before } = planned
    const old = () =>
      useJobsStore().createJob({
        storyId: STORY,
        kind: 'explore',
        workflow: 'explore',
        documentId: ROOT,
        title: 'Explore Thief',
        steps: before.steps,
        plan: before.plan,
      })

    const first = await old()
    await startJob(first.id)
    expect(useJobsStore().getJob(first.id)?.status).toBe('done')
    expect(sentTo.at(-1)?.to).toBe(`${runsOn.providerId} ${runsOn.model}`)

    workflows.value = { explore: { providerId: 'p2', model: 'cheap' } }
    const second = await old()
    await startJob(second.id)
    expect(useJobsStore().getJob(second.id)?.status).toBe('done')
    expect(sentTo.at(-1)?.to).toBe('p2 cheap')
  })
})
