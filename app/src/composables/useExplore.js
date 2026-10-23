/**
 * @module composables/useExplore
 * @description Exploring a folder, a document, or the whole project. From a
 * folder's menu, in the background, on the model a new chat would run on.
 * From a chat, by the model's `explore_documents` or the writer's `/explore`,
 * while the chat waits, on the chat's model. Either way the writer is asked
 * first only when it reads a lot, until they say to always allow it
 * (Settings › System › Chats). See `jobs/explore.js` for what is made.
 */

import ConfirmationEventBus from 'primevue/confirmationeventbus'
import { exploreAndWait, exploreNode, planExploring, startExplore } from '@/jobs/index.js'
import { useApplicationState } from '@/composables/useApplicationState.js'
import { useJobsToast } from '@/composables/useJobsToast.js'

/** @typedef {import('@/jobs/explore.js').PlannedExplore} PlannedExplore */
/** @typedef {import('@/jobs/index.js').PlannedExploring} PlannedExploring */

/**
 * The writer's answer to a question about exploring: `always` is yes, and
 * stop asking.
 *
 * @typedef {'allow'|'always'|'deny'} ExploreDecision
 */

/**
 * A count of tokens as the question gives it, rounded as an estimate should
 * be: `800`, `12k`, `1.5M`.
 *
 * @param {number} tokens
 * @returns {string}
 */
export function tokenCount(tokens) {
  if (tokens >= 999_500) return `${(tokens / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (tokens >= 950) return `${Math.round(tokens / 1000)}k`
  return String(Math.max(100, Math.round(tokens / 100) * 100))
}

/**
 * About how many tokens a plan sends: a token is about four characters of
 * English.
 *
 * @param {PlannedExplore} planned
 * @returns {number}
 */
const tokensOf = planned => planned.chars / 4

/**
 * What something explored is called in a question or a heading: a folder by
 * its path and a slash, a document by its path, and the root as the project.
 *
 * @param {import('@/jobs/explore.js').ExploreNode} node
 * @returns {string}
 */
export function exploredName(node) {
  if (node.path === '/') return 'the project'
  return node.type === 'folder' ? `${node.path}/` : node.path
}

/**
 * The question asked before exploring: what, and what it costs, which is
 * the part the writer weighs. `Explore Notes/ (~60k tokens)?`
 *
 * @param {import('@/jobs/explore.js').ExploreNode|null} node
 * @param {PlannedExplore} planned
 * @returns {string}
 */
export function exploreQuestion(node, planned) {
  return `Explore ${node ? exploredName(node) : 'it'} (~${tokenCount(tokensOf(planned))} tokens)?`
}

/**
 * Show the app's confirm dialog from anywhere, as the confirm service does.
 * @param {import('primevue/confirmationoptions').ConfirmationOptions} options
 */
const confirmAnywhere = options => ConfirmationEventBus.emit('confirm', options)

/**
 * Ask a question about exploring in a dialog, the question its heading.
 *
 * @param {string} question
 * @param {(options: import('primevue/confirmationoptions').ConfirmationOptions) => void} [require] -
 *   A component's `useConfirm().require`, or the dialog from anywhere
 * @returns {Promise<boolean>}
 */
function askInDialog(question, require = confirmAnywhere) {
  return new Promise(resolve =>
    require({
      header: question,
      rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
      acceptProps: { label: 'Explore' },
      accept: () => resolve(true),
      reject: () => resolve(false),
      onHide: () => resolve(false),
    })
  )
}

/**
 * Ask about exploring in the app's dialog, from anywhere: for the writer's
 * `/explore`, which has no call to ask beside.
 *
 * @param {string} question - `exploreQuestion`'s
 * @returns {Promise<ExploreDecision>}
 */
export async function confirmExploring(question) {
  return (await askInDialog(question)) ? 'allow' : 'deny'
}

/**
 * More than this many tokens is asked about before it is explored: more
 * than a few requests, or a bill worth knowing about before it is run up. A
 * lorebook's folder is well under it, and a shelf of books well over.
 */
export const ASK_FROM_TOKENS = 50_000

/**
 * What came of asking to explore. Nothing is to do when everything in it is
 * explored already, or there is nothing in it to read.
 *
 * @typedef {{job: import('@/types/models.js').Job, planned: PlannedExploring}
 *   | {declined: true}
 *   | {nothing: true}} ExploreOutcome
 */

/**
 * Explore a folder in the background, from its menu, asking the writer
 * first, with what it costs, when it reads a lot and they have Ask before
 * exploring large folders on. Outside a chat, it runs on the model a new
 * chat would.
 *
 * @param {string} storyId
 * @param {string} folderId - The folder, or the project's root
 * @param {{require?: (options: import('primevue/confirmationoptions').ConfirmationOptions) => void}} [options]
 *   - How to ask: a component's `useConfirm().require`, or the dialog from anywhere
 * @returns {Promise<ExploreOutcome>}
 * @throws {Error} When the folder is gone or hidden, or no chat could run
 */
export async function askToExplore(storyId, folderId, { require = confirmAnywhere } = {}) {
  const planned = await planExploring(folderId)
  if (planned.steps.length === 0) return { nothing: true }
  const { askBeforeExploring } = useApplicationState()
  if (tokensOf(planned) > ASK_FROM_TOKENS && askBeforeExploring.value) {
    const question = exploreQuestion(exploreNode(folderId), planned)
    if (!(await askInDialog(question, require))) return { declined: true }
  }
  const job = await startExplore(storyId, folderId, planned)
  if (!job) return { nothing: true }
  useJobsToast().show()
  return { job, planned }
}

/**
 * What came of exploring from a chat.
 *
 * @typedef {{done: true}|{declined: true}|{error: string}} ExploredOutcome
 */

/**
 * Explore a folder, a document, or the whole project, and wait until it is
 * done: for a chat, whose model or writer asked, on the model the chat runs
 * on. What is current is not read again, so asking twice costs nothing the
 * second time. One that reads a lot is asked about first, while the writer
 * has Ask before exploring large folders on; an answer of always turns it
 * off.
 *
 * @param {string} storyId
 * @param {string} id
 * @param {{signal?: AbortSignal, progress?: (said: string) => void, approve?: (question: string) => Promise<ExploreDecision>, preset?: import('@/types/models.js').AIPreset|null}} [options] -
 *   The chat's signal; where to say how far it has got; how to ask first,
 *   without which a big one does not start; and the preset the chat runs on,
 *   the active one when it is not said
 * @returns {Promise<ExploredOutcome>}
 * @throws {Error} When it is gone or hidden, or the chat's model can't be asked
 */
export async function exploreNow(storyId, id, { signal, progress, approve, preset } = {}) {
  const planned = await planExploring(id, preset)
  if (planned.steps.length === 0) return { done: true }
  const { askBeforeExploring, setAskBeforeExploring } = useApplicationState()
  if (tokensOf(planned) > ASK_FROM_TOKENS && askBeforeExploring.value) {
    const decision = approve ? await approve(exploreQuestion(exploreNode(id), planned)) : 'deny'
    if (decision === 'deny') return { declined: true }
    if (decision === 'always') setAskBeforeExploring(false)
  }
  const outcome = await exploreAndWait(storyId, id, planned, {
    signal,
    progress: (done, of) => progress?.(`${done} of ${of} ${of === 1 ? 'request' : 'requests'}`),
  })
  return outcome.error ? { error: outcome.error } : { done: true }
}
