/**
 * @module jobs
 * @description The long jobs a model does, and how to start one. A job
 * belongs to a project, its document's, but runs whichever project is open:
 * the jobs toast lists them all.
 *
 * - **runner** - Steps run one after another, stoppable and resumable
 * - **sections** - A document's section tree, decided before it is converted
 * - **convert** - A document's text turned into Markdown, a section at a time
 *
 * A job is a row in the `jobs` table (`stores/jobsStore.js`) with a plan of
 * steps; the runner walks it, and a kind registered here says what a step
 * does and what happens at the end. `useJobs` is the composable the outline
 * and the jobs toast use.
 */

import { useEditor } from '@/composables/useEditor.js'
import { readPdfLayout } from '@/files/pdf.js'
import { useDocumentsStore } from '@/stores/documentsStore.js'
import { useFilesStore } from '@/stores/filesStore.js'
import { useJobsStore } from '@/stores/jobsStore.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { freeTitle } from '@/utils/documentPath.js'
import { assemble, convertRequest } from './convert.js'
import { pauseJob, registerJobKind, startJob } from './runner.js'
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
      const editor = useEditor()
      if (editor.holds(existing.id)) editor.replaceContent(existing.id, content)
      else documents.updateDocument(existing.id, { content, plain: false })
      return
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
