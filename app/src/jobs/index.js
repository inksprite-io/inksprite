/**
 * @module jobs
 * @description The long jobs a model does, and how to start one. A job
 * belongs to a project, its document's, but runs whichever project is open:
 * the jobs toast lists them all.
 *
 * - **runner** - Steps run in order, or side by side where they say what they
 *   wait on; stoppable and resumable
 * - **sections** - A document's section tree, decided before it is converted
 * - **convert** - A document's text turned into Markdown, a section at a time
 * - **explore** - A folder, a document or the whole project described for the
 *   model, a digest each: in the background, or while a chat waits, on the
 *   model the chat runs on
 *
 * A job is a row in the `jobs` table (`stores/jobsStore.js`) with a plan of
 * steps; the runner walks it, and a kind registered here says what a step
 * does and what happens at the end. A conversion runs on its workflow's model
 * (Settings › Workflows); an exploration on the model it keeps, the chat's.
 * `useJobs` is the composable the outline and the jobs toast use.
 */

import { watch } from 'vue'
import { useEditor } from '@/composables/useEditor.js'
import { contextOf } from '@/ai/models.js'
import { OPEN_MARKUP } from '@/editor/comments.js'
import { holdsSuggestions, textAsItStands } from '@/editor/suggestionText.js'
import { readPdfLayout } from '@/files/pdf.js'
import { isRepository } from '@/source/tree.js'
import { useDocumentsStore } from '@/stores/documentsStore.js'
import { useFilesStore } from '@/stores/filesStore.js'
import { useJobsStore } from '@/stores/jobsStore.js'
import { useVersionsStore } from '@/stores/versionsStore.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { documentPath, freeTitle } from '@/utils/documentPath.js'
import { chatVisibility } from '@/utils/visibility.js'
import { assemble, convertRequest } from './convert.js'
import {
  askedFor,
  basisOf,
  budgetFor,
  exploreMessages,
  headingPath,
  parseDigests,
  partAnswer,
  planExplore,
  sectionsAskedFor,
} from './explore.js'
import {
  cancelJob,
  chatModel,
  pauseJob,
  registerJobKind,
  resolveModel,
  startJob,
} from './runner.js'
import {
  linesOfText,
  parseStructure,
  planRequests,
  requestLabel,
  structureMessages,
  structureOfLayout,
  unitsOf,
  REQUEST_CHARS,
} from './sections.js'

export { startJob, pauseJob, cancelJob, resumeJob, isRunning, resolveWorkflow } from './runner.js'

/** The workflow whose model converts documents; see `useApplicationState().workflows`. */
export const CONVERT_WORKFLOW = 'convert'

/** The step that asks for a text's headings, when its PDF has no bookmarks. */
const STRUCTURE_STEP = 'structure'

/**
 * What a conversion planned from: the source as lines, its headings once
 * known, and the requests cut along them.
 *
 * @typedef {Object} ConversionPlan
 * @property {string} title - The source's title, for the model and for the copy's name
 * @property {import('./sections.js').SourceLine[]} lines
 * @property {import('./sections.js').PlannedHeading[]|null} headings - Null until the structure step has run
 * @property {import('./sections.js').Request[]} requests
 */

/**
 * The steps for a plan's requests.
 *
 * @param {ConversionPlan} plan
 * @returns {import('@/types/models.js').JobStep[]}
 */
const requestSteps = plan =>
  plan.requests.map(request => ({
    id: request.id,
    label: requestLabel(plan.lines, request, plan.headings || []),
    status: /** @type {const} */ ('pending'),
  }))

/**
 * The copy a conversion of a document wrote before, if it is still there.
 *
 * @param {string} storyId
 * @param {string} sourceId
 * @returns {import('@/types/models.js').Document|null}
 */
function copyOf(storyId, sourceId) {
  for (const document of useDocumentsStore().documents.values()) {
    if (document.storyId === storyId && document.convertedFrom === sourceId) return document
  }
  return null
}

registerJobKind('convert', {
  async runStep(job, step, { ask, note }) {
    /** @type {ConversionPlan} */
    const plan = job.plan
    if (step.id === STRUCTURE_STEP) {
      const answer = await ask(structureMessages({ title: plan.title, lines: plan.lines }))
      /** @type {import('./sections.js').PlannedHeading[]} */
      let headings = []
      try {
        headings = parseStructure(answer.content, plan.lines)
      } catch {
        // A text with no headings at all converts as one run of text.
      }
      const planned = {
        ...plan,
        headings,
        requests: planRequests(plan.lines, unitsOf(plan.lines, headings)),
      }
      const structure = job.steps.filter(one => one.id === STRUCTURE_STEP)
      await useJobsStore().updateJob(job.id, {
        plan: planned,
        steps: [...structure, ...requestSteps(planned)],
      })
      return { output: `${headings.length} headings`, usage: answer.usage }
    }

    const request = plan.requests.find(one => one.id === step.id)
    if (!request) throw new Error(`No request for step ${step.id}`)
    const { markdown, usage } = await convertRequest({
      title: plan.title,
      lines: plan.lines,
      headings: plan.headings || [],
      request,
      ask,
      note,
    })
    return { output: markdown, usage }
  },

  async finish(job) {
    /** @type {ConversionPlan} */
    const plan = job.plan
    const content = assemble(
      job.steps.filter(step => step.id !== STRUCTURE_STEP).map(step => step.output || '')
    )
    // The copy goes beside the source, and is replaced by a later
    // conversion of the same source; the source is left as it is. It is an
    // ordinary document, shown and edited like any other: the editor holds
    // everything a conversion writes but tables, whose rows it keeps as
    // lines of text. Stored as written; the editor settles it when it is
    // first edited, not here, which for a book is seconds of work.
    const documents = useDocumentsStore()
    await documents.loadStory(job.storyId)
    const existing = copyOf(job.storyId, job.documentId || '')
    if (existing) {
      // What was written in the copy since is kept as a version first, as
      // before any of the model's changes.
      const editor = useEditor()
      editor.flush(existing.id)
      useVersionsStore().around(documents.getDocument(existing.id), 'model', () => {
        if (editor.holds(existing.id)) editor.replaceContent(existing.id, content)
        else documents.updateDocument(existing.id, { content, plain: false })
      })
      return existing.id
    }
    const source = documents.getDocument(job.documentId || '')
    const parentId = source?.parentId || rootIdFor(job.storyId)
    const made = documents.createDocument({
      storyId: job.storyId,
      parentId,
      type: 'text',
      title: freeTitle(documents.getChildrenOrdered(parentId), `${plan.title} (Markdown)`),
      content,
    })
    documents.updateDocument(made.id, { convertedFrom: job.documentId })
    return made.id
  },
})

/**
 * The lines a document is converted from, and its headings where the file
 * decides them: a PDF's layout, read again from the file — its running
 * headers taken out, its bookmarks placed, and the headings its type makes
 * below them — and the stored text otherwise.
 *
 * @param {import('@/types/models.js').Document} document
 * @returns {Promise<{lines: import('./sections.js').SourceLine[], placed: import('./sections.js').PlannedHeading[]|null}>}
 */
async function sourceOf(document) {
  if (document.type === 'file' && document.mime === 'application/pdf') {
    const blob = await useFilesStore().getFile(document.id)
    if (blob) {
      const layout = await readPdfLayout(await blob.arrayBuffer())
      const { lines, headings } = structureOfLayout(layout)
      // Its height placed the bookmarks; without it a line is lighter to keep in the job's row.
      for (const line of lines) delete line.y
      return { lines, placed: headings }
    }
  }
  return { lines: linesOfText(document.content || ''), placed: null }
}

/**
 * About how many requests a conversion of a text makes, for asking first.
 *
 * @param {string} text
 * @returns {number}
 */
export const requestsFor = text => Math.max(1, Math.ceil(text.length / REQUEST_CHARS))

/**
 * Plan a document's conversion and start it. The section tree comes from
 * the PDF's bookmarks when it has them; otherwise the first step asks a
 * model for it, and the requests are planned when it answers.
 *
 * @param {string} storyId
 * @param {string} documentId
 * @returns {Promise<import('@/types/models.js').Job>}
 * @throws {Error} When the document has no text to convert
 */
export async function startConversion(storyId, documentId) {
  const document = useDocumentsStore().getDocument(documentId)
  if (!document) throw new Error('No such document')
  const { lines, placed } = await sourceOf(document)
  if (!lines.some(line => line.text)) throw new Error('There is no text to convert.')

  const title = document.title || 'Untitled'
  /** @type {ConversionPlan} */
  const plan = placed
    ? { title, lines, headings: placed, requests: planRequests(lines, unitsOf(lines, placed)) }
    : { title, lines, headings: null, requests: [] }
  const steps = placed
    ? requestSteps(plan)
    : [
        {
          id: STRUCTURE_STEP,
          label: 'Finding the sections',
          status: /** @type {const} */ ('pending'),
        },
      ]

  const job = await useJobsStore().createJob({
    storyId,
    kind: 'convert',
    workflow: CONVERT_WORKFLOW,
    documentId,
    title: `Convert ${title} to Markdown`,
    steps,
    plan,
  })
  startJob(job.id).catch(error => console.error('Conversion failed to start:', error))
  return job
}

/**
 * A document or folder as explore reads it, as it is now: only what every
 * chat may see, a text without its comments' markup, and a repository and a
 * file with no text named and not read. Null for one gone or hidden.
 *
 * @param {string} id
 * @returns {import('./explore.js').ExploreNode|null}
 */
export function exploreNode(id) {
  const store = useDocumentsStore()
  /** @param {string} at */
  const get = at => store.getDocument(at)
  const { sees } = chatVisibility(null, get)

  /**
   * @param {import('@/types/models.js').Document} document
   * @returns {import('./explore.js').ExploreNode}
   */
  const nodeOf = document => {
    const folder = document.type === 'folder'
    const repository = isRepository(document)
    const content = document.content || ''
    // A text document as it stands: its comments' markup off, and the
    // suggestions waiting on the writer left out.
    const marked =
      document.type === 'text' &&
      (content.includes(OPEN_MARKUP) || (!document.plain && holdsSuggestions(content)))
    const text = folder ? '' : marked ? textAsItStands(content) : content
    return {
      id: document.id,
      path: documentPath(get, document),
      title: document.title || 'Untitled',
      type: document.type,
      text,
      words: document.wordCount || 0,
      ...(repository
        ? { leftOut: 'a codebase' }
        : document.type === 'file' && !text.trim()
          ? { leftOut: 'a file with no text' }
          : {}),
      children:
        folder && !repository
          ? store
              .getChildrenOrdered(document.id)
              .filter(child => sees(child))
              .map(nodeOf)
          : [],
      ...(document.digest ? { digest: document.digest } : {}),
    }
  }

  const document = get(id)
  return document && sees(document) ? nodeOf(document) : null
}

registerJobKind('explore', {
  async runStep(job, step, { ask }) {
    /** @type {import('./explore.js').ExplorePlan} */
    const plan = job.plan
    const work = plan.work[step.id]
    if (!work) throw new Error(`No work for step ${step.id}`)
    const documents = useDocumentsStore()
    await documents.loadStory(job.storyId)

    /** @type {import('./explore.js').ExploreReader} */
    const read = {
      node: exploreNode,
      output: id => job.steps.find(one => one.id === id)?.output || '',
    }
    const messages = exploreMessages(work, read)
    if (!messages) return { output: '' }
    const answer = await ask(messages)

    const asked = askedFor(work, read)
    if (asked.length === 0) {
      // A part, or a gather in parts: what it said goes into what is put
      // together from it, its sections' lines with it, and nowhere else.
      const of = work.of ? exploreNode(work.of) : null
      return { output: partAnswer(answer.content, of ? headingPath(of) : ''), usage: answer.usage }
    }
    const sectionAsks = sectionsAskedFor(work.sections, read)
    const found = parseDigests(answer.content, [...asked, ...sectionAsks])
    if (!asked.some(one => found.has(one.id))) {
      throw new Error('The model answered without the headings it was asked for.')
    }

    // Each long section's line, by its document: from this answer, or from
    // the parts of a document read in parts.
    /** @type {Map<string, Map<string, string>>} */
    const lines = new Map()
    /**
     * @param {import('./explore.js').SectionAsk[]} asks
     * @param {Map<string, {line: string}>} said
     */
    const keep = (asks, said) => {
      for (const one of asks) {
        const line = said.get(one.id)?.line
        if (!line) continue
        if (!lines.has(one.of)) lines.set(one.of, new Map())
        lines.get(one.of)?.set(one.link, line)
      }
    }
    keep(sectionAsks, found)
    for (const partId of work.sectionsFrom || []) {
      const asks = sectionsAskedFor(plan.work[partId]?.sections, read)
      keep(asks, parseDigests(read.output(partId), asks, { alone: false }))
    }

    const made = Date.now()
    for (const one of asked) {
      const digest = found.get(one.id)
      if (!digest) continue
      const sections = [...(lines.get(one.id) || [])].map(([link, line]) => ({ link, line }))
      documents.setDigest(one.id, {
        ...digest,
        of: work.answers[one.id],
        made,
        ...(sections.length > 0 ? { sections } : {}),
      })
    }
    for (const id of work.drop || []) documents.setDigest(id, null)
    return { output: answer.content, usage: answer.usage }
  },

  // Each digest is kept as its step lands, for the listing to show at once.
  async finish() {},
})

/**
 * An exploration as planned, and the model it is planned for: how much a
 * request carries is that model's context.
 *
 * @typedef {import('./explore.js').PlannedExplore & {runsOn: import('@/types/models.js').JobModel}} PlannedExploring
 */

/**
 * What exploring a folder, a document, or the whole project from its root,
 * would do: the plan, how many documents it reads, and about how much it
 * sends. For asking first, and for starting it. Planned on the model a chat
 * on the preset runs on: the chat's that asks, or, asked from outside a
 * chat, the active preset's, which a new chat runs on.
 *
 * @param {string} id
 * @param {import('@/types/models.js').AIPreset|null} [preset] - The chat's
 * @returns {Promise<PlannedExploring>}
 * @throws {Error} When it is gone or hidden, or a chat on the preset could not run
 */
export async function planExploring(id, preset) {
  const tree = exploreNode(id)
  if (!tree) throw new Error('There is no such document or folder to explore.')
  const runsOn = chatModel(preset)
  const { provider, model } = resolveModel(runsOn)
  return { ...planExplore(tree, budgetFor(await contextOf(provider, model))), runsOn }
}

/**
 * The job that explores something as planned, made and not started: on the
 * model it was planned for, kept on the job.
 *
 * @param {string} storyId
 * @param {string} id - A folder, a document, or the project's root
 * @param {PlannedExploring} planned
 * @returns {Promise<import('@/types/models.js').Job>}
 */
function exploreJob(storyId, id, planned) {
  const explored = useDocumentsStore().getDocument(id)
  return useJobsStore().createJob({
    storyId,
    kind: 'explore',
    runsOn: planned.runsOn,
    documentId: id,
    title: `Explore ${explored?.title || 'Untitled'}`,
    steps: planned.steps,
    plan: planned.plan,
  })
}

/**
 * Explore a folder, a document, or the whole project from its root, as
 * planned, in the background: the jobs toast shows it.
 *
 * @param {string} storyId
 * @param {string} id
 * @param {PlannedExploring} planned - From `planExploring`
 * @returns {Promise<import('@/types/models.js').Job|null>} Null when everything is current
 */
export async function startExplore(storyId, id, planned) {
  if (planned.steps.length === 0) return null
  const job = await exploreJob(storyId, id, planned)
  startJob(job.id).catch(error => console.error('Explore failed to start:', error))
  return job
}

/**
 * Explore as planned while a chat waits. The job runs as any other does, and
 * goes once it stops: the chat says what came of it. Stopped, it is
 * cancelled, and the digests its finished steps made are kept, so exploring
 * again goes on from there.
 *
 * @param {string} storyId
 * @param {string} id
 * @param {PlannedExploring} planned - From `planExploring`
 * @param {{signal?: AbortSignal, progress?: (done: number, of: number) => void}} [options] -
 *   The chat's signal, and where to say how many requests are done
 * @returns {Promise<{error?: string}>} Why it ended early, when it did
 */
export async function exploreAndWait(storyId, id, planned, { signal, progress } = {}) {
  if (planned.steps.length === 0) return {}
  const store = useJobsStore()
  const job = await exploreJob(storyId, id, planned)
  const stopWatching = watch(
    () => store.getJob(job.id)?.steps.filter(step => step.status === 'done').length ?? 0,
    done => progress?.(done, planned.steps.length),
    { immediate: true }
  )
  const stop = () => cancelJob(job.id)
  signal?.addEventListener('abort', stop)
  try {
    if (!signal?.aborted) await startJob(job.id)
    const ended = store.getJob(job.id)
    if (signal?.aborted || ended?.status === 'cancelled') return { error: 'Stopped.' }
    if (ended?.status !== 'done') return { error: ended?.error || 'It stopped before the end.' }
    return {}
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  } finally {
    stopWatching()
    signal?.removeEventListener('abort', stop)
    await store.deleteJob(job.id)
  }
}

/**
 * Which of a project's digests are current: made from what their document
 * or folder holds now. The model is shown no other, so nothing it reads of
 * a document is older than the document. Worked out from the tree as it
 * stands when this is called, and asked of as often as needed after.
 *
 * @param {string} storyId
 * @returns {(id: string) => boolean}
 */
export function currentDigests(storyId) {
  /** @type {Map<string, import('./explore.js').ExploreNode>} */
  const nodes = new Map()
  /** @param {import('./explore.js').ExploreNode} node */
  const index = node => {
    nodes.set(node.id, node)
    node.children.forEach(index)
  }
  const root = exploreNode(rootIdFor(storyId))
  if (root) index(root)
  /** @type {Map<string, string>} */
  const known = new Map()
  return id => {
    const node = nodes.get(id)
    return Boolean(node?.digest) && node?.digest?.of === basisOf(node, known)
  }
}

/**
 * Stop and forget a project's jobs: the project is being deleted. A job
 * running has its request in flight aborted first, so nothing more is
 * spent on a document that is going.
 *
 * @param {string} storyId
 * @returns {Promise<void>}
 */
export async function dropJobsForStory(storyId) {
  const store = useJobsStore()
  for (const job of store.getJobs()) if (job.storyId === storyId) pauseJob(job.id)
  await store.deleteJobsForStory(storyId)
}
