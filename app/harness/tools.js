/**
 * @module harness/tools
 * @description How the document tools were used across a batch, turn by
 * turn, and whether each turn did what the scenario expected of it.
 *
 * `surface.js` counts what is in the prose. This counts what the model did
 * with the project: which documents it read, whether it read one it was
 * already holding, whether a write landed or came back with an error, how
 * often it listed the project, which reads came back unchanged, and what each
 * turn cost in prompt tokens. Where
 * the scenario's messages carry expectations — a number the reply should
 * mention, a document the turn should have read, a passage the document
 * should hold afterwards — each is checked and reported.
 *
 * A batch's `state-N.json` is what makes the document checks possible: the
 * runner snapshots every document after every turn. What the writer attached
 * is read off the chat itself, where each message holds what it attached.
 *
 * @example
 * npm run tools -- harness/runs/2026-09-26T10-00-00-findable-design
 */

import { readFile, readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { withoutComments as stripComments } from '../src/editor/comments.js'
import { attachmentsOf } from '../src/ai/context/attachments.js'
import { isCompaction } from '../src/ai/compaction.js'

/** @param {string} path */
const norm = path => (path || '').trim().toLowerCase().replace(/^\/+/, '')

/**
 * @typedef {Object} Expectation
 * @property {string} text
 * @property {string[]} [mentions] - Regex sources the reply should match
 * @property {string[]} [reads] - Paths the turn should have to hand: read now, read
 *   earlier in the conversation or attached by the writer, and not edited by
 *   the writer since
 * @property {string[]} [readsAgain] - Paths the turn should read now, whatever came
 *   before: a document the writer changed since the model read it
 * @property {string[]} [notRead] - Paths the turn should not read: attached, or
 *   still in the conversation as they were
 * @property {boolean} [noRereads] - The turn should read nothing it already has to
 *   hand
 * @property {string[]} [calls] - Tools the turn should call at least once
 * @property {string[]} [notCalls] - Tools the turn should not call at all
 * @property {string[]} [finds] - Paths the turn should have found: read, or in a
 *   search result
 * @property {string[]} [findsAny] - Of which at least one should have been found
 * @property {boolean} [noWrites] - The turn should have changed nothing
 * @property {{path: string, contains: string[]}} [document] - Passages the document should hold
 * @property {{path: string, patterns: string[]}} [notContains] - Passages it should not
 * @property {string[]} [gone] - Paths that should hold nothing after the turn: what a
 *   move or rename took away, or a delete
 * @property {string[]} [kept] - Paths that should still hold a document after the turn
 * @property {string[]} [trashed] - Paths that should be in the project's trash after
 *   the turn, a folder's by the folder
 * @property {boolean} [accept] - The writer accepted what the turn proposed; checked
 *   as every proposal accepted without a refusal
 * @property {{path: string, contains: string[]}} [summary] - What its summary should say
 * @property {CommentCheck|CommentCheck[]} [comments] - What should have become of a
 *   document's comments
 */

/**
 * What a turn should have done to one document's comments, by the ids the
 * scenario gave the writer's.
 *
 * @typedef {Object} CommentCheck
 * @property {string} path
 * @property {string[]} [resolved] - Comments resolved once the turn is done
 * @property {string[]} [open] - Comments still open, on their passages
 * @property {string[]} [untouched] - Comments the turn left as they were: the same
 *   standing, and nothing said on them
 * @property {string[]} [replied] - Comments the model said something on this turn
 * @property {number} [added] - At least this many comments of the model's own, new this turn
 * @property {string[]} [addedOn] - Regex sources, each matching the passage of a new one
 * @property {boolean} [textUnchanged] - The words, without comments, as they were
 * @property {boolean} [noneOpenByModel] - No comment the model began is open afterwards
 */

/** The tools that read, make, answer and resolve comments. */
const COMMENT_TOOLS = new Map([
  ['list_comments', 'list'],
  ['add_comment', 'add'],
  ['reply_comment', 'reply'],
  ['resolve_comment', 'resolve'],
])

/**
 * Where one document's comments fall short of the check.
 *
 * @param {CommentCheck} check
 * @param {any} state - The snapshot after the turn, with `before` as it began
 * @returns {string[]}
 */
function commentFailures(check, state) {
  const find = (/** @type {Record<string, any>|undefined} */ byPath) =>
    Object.entries(byPath || {}).find(([key]) => norm(key) === norm(check.path))?.[1]
  const after = find(state?.comments) || {}
  const before = find(state?.before?.comments) || {}
  const modelPosts = (/** @type {any} */ thread) =>
    (thread?.posts || []).filter((/** @type {any} */ post) => post.author === 'model').length
  /** @type {string[]} */
  const failures = []
  for (const id of check.resolved || []) {
    if (after[id]?.status !== 'resolved')
      failures.push(`${id} ${after[id]?.status || 'gone'}, not resolved`)
  }
  for (const id of check.open || []) {
    if (after[id]?.status !== 'open')
      failures.push(`${id} ${after[id]?.status || 'gone'}, not open`)
  }
  for (const id of check.untouched || []) {
    const same =
      after[id] &&
      after[id].status === before[id]?.status &&
      JSON.stringify(after[id].posts) === JSON.stringify(before[id]?.posts)
    if (!same) failures.push(`${id} touched`)
  }
  for (const id of check.replied || []) {
    if (modelPosts(after[id]) <= modelPosts(before[id])) failures.push(`${id} not replied`)
  }
  const added = Object.entries(after)
    .filter(([id, thread]) => !before[id] && thread.posts[0]?.author === 'model')
    .map(([, thread]) => thread)
  if (check.added !== undefined && added.length < check.added) {
    failures.push(`added ${added.length} < ${check.added}`)
  }
  for (const source of check.addedOn || []) {
    const pattern = new RegExp(source, 'i')
    if (!added.some(thread => pattern.test(thread.quote))) failures.push(`none added on ${source}`)
  }
  if (check.textUnchanged) {
    const words = (/** @type {Record<string, string>|undefined} */ byPath) =>
      Object.entries(byPath || {}).find(([key]) => norm(key) === norm(check.path))?.[1]
    const was = words(state?.before?.words)
    const now = state?.documents
      ? Object.entries(state.documents).find(([key]) => norm(key) === norm(check.path))?.[1]
      : undefined
    if (was !== undefined && now && was !== stripComments(now.content))
      failures.push('text changed')
  }
  if (check.noneOpenByModel) {
    const open = Object.entries(after).filter(
      ([, thread]) => thread.status === 'open' && thread.posts[0]?.author === 'model'
    )
    if (open.length) failures.push(`model's ${open.map(([id]) => id).join(', ')} open`)
  }
  return failures.map(failure => `${check.path}: ${failure}`)
}

/**
 * @typedef {Object} Call
 * @property {string} name
 * @property {any} args
 * @property {any} result - Parsed tool result, or null
 * @property {string} [error]
 */

/**
 * The calls one assistant turn made, each with what came back.
 *
 * @param {any} turn - A stored assistant message
 * @returns {Call[]}
 */
function callsOf(turn) {
  /** @type {Map<string, Call>} */
  const byId = new Map()
  /** @type {Call[]} */
  const calls = []
  for (const step of turn.metadata?.apiTrajectory || []) {
    for (const call of step.tool_calls || []) {
      let args = {}
      try {
        args = JSON.parse(call.function?.arguments || '{}')
      } catch {
        args = { _unparsed: call.function?.arguments }
      }
      const entry = { name: call.function?.name || '?', args, result: null }
      byId.set(call.id, entry)
      calls.push(entry)
    }
    if (step.role === 'tool' && byId.has(step.tool_call_id)) {
      const entry = byId.get(step.tool_call_id)
      try {
        entry.result = JSON.parse(step.content)
      } catch {
        entry.result = { raw: step.content }
      }
      if (entry.result?.error) entry.error = String(entry.result.error)
    }
  }
  return calls
}

/**
 * @param {string[]|undefined} patterns
 * @param {string} text
 * @returns {string[]} The patterns that did not match
 */
const missing = (patterns, text) =>
  (patterns || []).filter(source => !new RegExp(source, 'i').test(text))

/**
 * One turn, measured.
 *
 * @param {Object} args
 * @param {any} turn - The assistant message
 * @param {Expectation} expect
 * @param {Set<string>} holding - Paths the turn began with: read earlier in the
 *   conversation or attached by the writer, and not changed since
 * @param {Set<string>} attached - Those of them the writer attached
 * @param {any} state - The snapshot after the turn: {documents: {path: {content, summary}}}
 */
function measure({ turn, expect, holding, attached, state }) {
  const calls = callsOf(turn)
  const content = turn.content || ''
  const reads = calls.filter(call => call.name === 'read_document')
  // A read that came back unchanged sent nothing: its text was above already.
  const readPaths = reads
    .filter(call => !call.error && !call.result?.unchanged)
    .map(call => norm(call.args.path))
  // A path the model named that is not there: a guess, without the tree.
  const misses = reads.filter(call => /^No document at/.test(call.error || ''))
  const searches = calls.filter(call => call.name === 'search_documents')
  const found = new Set(readPaths)
  for (const search of searches) {
    for (const hit of search.result?.results || []) found.add(norm(hit.path))
  }
  const writes = calls.filter(call =>
    [
      'create_document',
      'create_folder',
      'edit_document',
      'append_document',
      'update_document',
      'move_document',
      'delete_document',
    ].includes(call.name)
  )
  // A read answered as unchanged cost nothing: its text was above already.
  const unchanged = reads.filter(call => call.result?.unchanged)
  const lists = calls.filter(call => call.name === 'list_documents')
  const errors = calls.filter(call => call.error)
  // A read of something attached buys nothing: its text came with the
  // writer's message, whole.
  const ofAttached = readPaths.filter(path => attached.has(path))
  // A read of something still in the conversation as it was read: another
  // part of a long document, or a model that lost track of what it has.
  const again = readPaths.filter(path => holding.has(path) && !attached.has(path))
  const documents = state?.documents || {}
  const docAt = (/** @type {string} */ path) =>
    Object.entries(documents).find(([key]) => norm(key) === norm(path))?.[1]

  /** @type {string[]} */
  const failures = []
  for (const pattern of missing(expect.mentions, content)) failures.push(`mentions ${pattern}`)
  // What the turn had to hand: read this turn, still in the conversation, or
  // attached by the writer.
  for (const path of expect.reads || []) {
    if (!holding.has(norm(path)) && !readPaths.includes(norm(path))) failures.push(`reads ${path}`)
  }
  for (const path of expect.readsAgain || []) {
    if (!readPaths.includes(norm(path))) failures.push(`reads again ${path}`)
  }
  for (const path of expect.notRead || []) {
    if (readPaths.includes(norm(path))) failures.push(`read ${path}`)
  }
  const had = [...ofAttached, ...again]
  if (expect.noRereads && had.length) failures.push(`read again ${had.join(', ')}`)
  for (const name of expect.calls || []) {
    if (!calls.some(call => call.name === name)) failures.push(`calls ${name}`)
  }
  for (const name of expect.notCalls || []) {
    if (calls.some(call => call.name === name)) failures.push(`called ${name}`)
  }
  for (const path of expect.finds || []) {
    if (!found.has(norm(path)) && !holding.has(norm(path))) failures.push(`finds ${path}`)
  }
  if (expect.findsAny?.length) {
    const any = expect.findsAny.some(path => found.has(norm(path)) || holding.has(norm(path)))
    if (!any) failures.push(`finds any of ${expect.findsAny.join(' | ')}`)
  }
  if (expect.noWrites && writes.some(call => !call.error)) {
    failures.push(`wrote ${writes.map(call => call.name).join(', ')}`)
  }
  if (expect.document) {
    const doc = docAt(expect.document.path)
    if (!doc) failures.push(`document ${expect.document.path} missing`)
    else
      for (const pattern of missing(expect.document.contains, doc.content))
        failures.push(`document lacks ${pattern}`)
  }
  if (expect.notContains) {
    const doc = docAt(expect.notContains.path)
    for (const pattern of expect.notContains.patterns) {
      if (doc && new RegExp(pattern, 'i').test(doc.content))
        failures.push(`document still has ${pattern}`)
    }
  }
  // A move leaves nothing behind: a copy at the new path is not one.
  for (const path of expect.gone || []) {
    if (docAt(path)) failures.push(`${path} still there`)
  }
  for (const path of expect.kept || []) {
    if (!docAt(path)) failures.push(`${path} gone`)
  }
  const trash = new Set((state?.trash || []).map((/** @type {any} */ item) => norm(item.path)))
  for (const path of expect.trashed || []) {
    if (!trash.has(norm(path))) failures.push(`${path} not in the trash`)
  }
  for (const refusal of (expect.accept && state?.refused) || []) {
    failures.push(`accept refused ${refusal}`)
  }
  if (expect.summary) {
    const doc = docAt(expect.summary.path)
    for (const pattern of missing(expect.summary.contains, doc?.summary || ''))
      failures.push(`summary lacks ${pattern}`)
  }
  for (const check of [expect.comments || []].flat()) {
    failures.push(...commentFailures(check, state))
  }
  const notes = calls.filter(call => COMMENT_TOOLS.has(call.name))

  const usage = turn.metadata?.usage || {}
  return {
    calls,
    reads: readPaths,
    searches: searches.length,
    writes: writes.map(call => `${call.name.replace('_document', '')}${call.error ? '!' : ''}`),
    notes: notes.map(call => `${COMMENT_TOOLS.get(call.name)}${call.error ? '!' : ''}`),
    written: writes.filter(call => !call.error).map(call => norm(call.args.path)),
    misses: misses.length,
    unchanged: unchanged.length,
    lists: lists.length,
    errors: errors.map(call => `${call.name}: ${call.error}`),
    ofAttached,
    again,
    promptTokens: usage.promptTokens || 0,
    requests: usage.requests || 0,
    words: content.trim().split(/\s+/).filter(Boolean).length,
    failures,
  }
}

/**
 * @param {string} dir - Batch folder
 */
async function report(dir) {
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
  /** @type {Expectation[]} */
  const expectations = (meta.messages || []).map(message =>
    typeof message === 'string' ? { text: message } : message
  )
  const files = (await readdir(dir))
    .filter(file => /^run-\d+\.json$/.test(file))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))

  const label = meta.prompt?.source ? basename(meta.prompt.source.split(' ')[0]) : '?'
  const described = meta.descriptions ? `  descriptions=${basename(meta.descriptions.source)}` : ''
  console.log(
    `## ${basename(dir)}  [${label}]  ${meta.model || ''}  ${meta.commit || ''}${described}`
  )

  /** @type {Map<number, {runs: number, failed: number, failures: string[]}>} */
  const perTurn = new Map()
  const totals = {
    errors: 0,
    misses: 0,
    lists: 0,
    unchanged: 0,
    ofAttached: 0,
    again: 0,
    promptTokens: 0,
    turns: 0,
    failed: 0,
    checks: 0,
  }

  for (const file of files) {
    const n = Number(file.match(/\d+/)?.[0])
    const messages = JSON.parse(await readFile(join(dir, file), 'utf8'))
    /** @type {any[]} */
    let states = []
    try {
      states = JSON.parse(await readFile(join(dir, `state-${n}.json`), 'utf8'))
    } catch {
      // A batch from before states were written: the document checks are skipped.
    }
    console.log(`  ${file}`)
    /** Paths read earlier in the conversation and not changed since. */
    const seen = new Set()
    /** Paths the writer attached, not changed since. */
    const attached = new Set()
    /** Those attached as the chat opened, which a summary keeps. */
    const opening = new Set()
    /** @type {string[]} What the writer has attached since the last turn. */
    let sent = []
    /** Which of the scenario's messages is answered next. */
    let next = 0
    for (const message of messages) {
      // A summary takes the place of what was read and attached above it,
      // all but the chat's opening. It answers a message of the scenario's
      // without being a turn.
      if (isCompaction(message)) {
        seen.clear()
        attached.clear()
        for (const path of opening) attached.add(path)
        if (/^\/compact\b/.test(expectations[next]?.text || '')) next++
        continue
      }
      if (message.role === 'user') {
        const paths = attachmentsOf(message).map(attachment => norm(attachment.path))
        sent.push(...paths)
        if (message === messages[0]) for (const path of paths) opening.add(path)
        continue
      }
      if (message.role !== 'assistant' || message.metadata?.command) continue
      const turn = message
      const i = next++
      // The writer's edit before the turn makes what the model has of it old.
      const edited = expectations[i]?.before?.edit?.path
      for (const held of edited ? [seen, attached, opening] : []) held.delete(norm(edited))
      // What is attached to the message is copied as it is sent, after the edit.
      for (const path of sent) attached.add(path)
      sent = []
      const holding = new Set([...attached, ...seen])
      const state = states[i]
      const m = measure({
        turn,
        expect: expectations[i] || { text: '' },
        holding,
        attached,
        state,
      })
      for (const path of m.reads) seen.add(path)
      // Its own writes it knows, but what it has of the document is old.
      for (const path of m.written) for (const held of [seen, attached, opening]) held.delete(path)

      const bits = [
        `T${i + 1}`,
        `reads=${m.reads.length}${m.ofAttached.length ? ` (attached ${m.ofAttached.length})` : ''}${m.again.length ? ` (again ${m.again.length})` : ''}`,
        m.misses ? `misses=${m.misses}` : '',
        m.searches ? `search=${m.searches}` : '',
        m.writes.length ? `writes=${m.writes.join(',')}` : '',
        m.notes.length ? `comments=${m.notes.join(',')}` : '',
        m.unchanged || m.lists ? `unchanged=${m.unchanged} lists=${m.lists}` : '',
        `req=${m.requests}`,
        `tok=${(m.promptTokens / 1000).toFixed(1)}k`,
        `words=${m.words}`,
        m.failures.length ? `FAIL ${m.failures.join('; ')}` : expectations[i] ? 'ok' : '',
      ].filter(Boolean)
      console.log(`    ${bits.join('  ')}`)
      for (const error of m.errors) console.log(`      ! ${error}`)

      totals.errors += m.errors.length
      totals.misses += m.misses
      totals.lists += m.lists
      totals.unchanged += m.unchanged
      totals.ofAttached += m.ofAttached.length
      totals.again += m.again.length
      totals.promptTokens += m.promptTokens
      totals.turns++
      const checks = Object.keys(expectations[i] || {}).filter(
        key => key !== 'text' && key !== 'before'
      ).length
      totals.checks += checks
      totals.failed += m.failures.length
      const bucket = perTurn.get(i) || { runs: 0, failed: 0, failures: [] }
      bucket.runs++
      if (m.failures.length) bucket.failed++
      bucket.failures.push(...m.failures)
      perTurn.set(i, bucket)
    }

    // A scenario that rewinds the chat at the end expects the project back as
    // it began.
    const rewind = (meta.runs || []).find((/** @type {any} */ run) => run.n === n)?.rewind
    if (rewind) {
      const short = [
        ...rewind.left.map((/** @type {string} */ edit) => `left ${edit}`),
        ...rewind.differs.map((/** @type {string} */ path) => `differs ${path}`),
      ]
      console.log(
        `    rewind  undone=${rewind.undone}  ${short.length ? `FAIL ${short.join('; ')}` : 'ok'}`
      )
      totals.checks++
      if (short.length) totals.failed++
    }
  }

  console.log(`  --`)
  console.log(
    `  runs=${files.length}  turns=${totals.turns}  tool errors=${totals.errors}  path misses=${totals.misses}  lists=${totals.lists}  unchanged=${totals.unchanged}  reads of attached=${totals.ofAttached}  reads again=${totals.again}  prompt tokens=${(totals.promptTokens / 1000).toFixed(0)}k (${(totals.promptTokens / 1000 / Math.max(1, totals.turns)).toFixed(1)}k a turn)  checks failed=${totals.failed}/${totals.checks}`
  )
  for (const [i, bucket] of [...perTurn].sort((a, b) => a[0] - b[0])) {
    if (!bucket.failed) continue
    const counts = new Map()
    for (const failure of bucket.failures) counts.set(failure, (counts.get(failure) || 0) + 1)
    const list = [...counts].map(([failure, count]) => `${failure}×${count}`).join('; ')
    console.log(`  T${i + 1} failed in ${bucket.failed}/${bucket.runs}: ${list}`)
  }
}

async function main() {
  const dirs = process.argv.slice(2)
  if (dirs.length === 0) {
    console.error('Usage: npm run tools -- <batch dir>...')
    process.exit(1)
  }
  for (const dir of dirs) await report(resolve(dir))
}

main().catch(error => {
  console.error(error.stack || error)
  process.exit(1)
})
