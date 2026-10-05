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
 * runner snapshots every document and the chat's pins after every turn.
 *
 * @example
 * npm run tools -- harness/runs/2026-09-26T10-00-00-findable-design
 */

import { readFile, readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

/** @param {string} path */
const norm = path => (path || '').trim().toLowerCase().replace(/^\/+/, '')

/**
 * @typedef {Object} Expectation
 * @property {string} text
 * @property {string[]} [mentions] - Regex sources the reply should match
 * @property {string[]} [reads] - Paths the turn should have to hand: read now, read
 *   earlier in the conversation and not edited by the writer since, or pinned
 * @property {string[]} [readsAgain] - Paths the turn should read now, whatever came
 *   before: a document the writer changed since the model read it
 * @property {string[]} [notRead] - Paths the turn should not read: pinned, or still
 *   in the conversation as they were
 * @property {boolean} [noRereads] - The turn should read nothing it already has to
 *   hand
 * @property {string[]} [calls] - Tools the turn should call at least once
 * @property {string[]} [finds] - Paths the turn should have found: read, or in a
 *   search result
 * @property {string[]} [findsAny] - Of which at least one should have been found
 * @property {boolean} [noWrites] - The turn should have changed nothing
 * @property {string[]} [pins] - Paths that should be pinned after the turn
 * @property {string[]} [pinnedAtEnd] - The whole pinned set after the turn
 * @property {{path: string, contains: string[]}} [document] - Passages the document should hold
 * @property {{path: string, patterns: string[]}} [notContains] - Passages it should not
 * @property {{path: string, contains: string[]}} [summary] - What its summary should say
 */

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
 * @param {Set<string>} holding - Paths read earlier in the conversation, and not
 *   edited by the writer since, or pinned at the start of the turn
 * @param {Set<string>} pinnedBefore
 * @param {any} state - The snapshot after the turn: {pinned: string[], documents: {path: {content, summary}}}
 */
function measure({ turn, expect, holding, pinnedBefore, state }) {
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
    ['create_document', 'edit_document', 'append_document', 'update_document'].includes(call.name)
  )
  // A read answered as unchanged cost nothing: its text was above already.
  const unchanged = reads.filter(call => call.result?.unchanged)
  const lists = calls.filter(call => call.name === 'list_documents')
  const errors = calls.filter(call => call.error)
  // A read of something pinned buys nothing: its text is in the block already.
  const rereads = readPaths.filter(path => pinnedBefore.has(path))
  // A read of something still in the conversation as it was read: another
  // part of a long document, or a model that lost track of what it has.
  const again = readPaths.filter(path => holding.has(path) && !pinnedBefore.has(path))
  const pinnedAfter = new Set((state?.pinned || []).map(norm))
  const documents = state?.documents || {}
  const docAt = (/** @type {string} */ path) =>
    Object.entries(documents).find(([key]) => norm(key) === norm(path))?.[1]

  /** @type {string[]} */
  const failures = []
  for (const pattern of missing(expect.mentions, content)) failures.push(`mentions ${pattern}`)
  // What the turn had to hand: read this turn, still in the conversation, or
  // pinned when the turn began.
  for (const path of expect.reads || []) {
    if (!holding.has(norm(path)) && !readPaths.includes(norm(path))) failures.push(`reads ${path}`)
  }
  for (const path of expect.readsAgain || []) {
    if (!readPaths.includes(norm(path))) failures.push(`reads again ${path}`)
  }
  for (const path of expect.notRead || []) {
    if (readPaths.includes(norm(path))) failures.push(`read ${path}`)
  }
  if (expect.noRereads && again.length) failures.push(`read again ${again.join(', ')}`)
  for (const name of expect.calls || []) {
    if (!calls.some(call => call.name === name)) failures.push(`calls ${name}`)
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
  for (const path of expect.pins || []) {
    if (!pinnedAfter.has(norm(path))) failures.push(`pins ${path}`)
  }
  if (expect.pinnedAtEnd) {
    const want = new Set(expect.pinnedAtEnd.map(norm))
    const same = want.size === pinnedAfter.size && [...want].every(path => pinnedAfter.has(path))
    if (!same) failures.push(`pinned=[${[...pinnedAfter].join(', ')}]`)
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
  if (expect.summary) {
    const doc = docAt(expect.summary.path)
    for (const pattern of missing(expect.summary.contains, doc?.summary || ''))
      failures.push(`summary lacks ${pattern}`)
  }

  const usage = turn.metadata?.usage || {}
  return {
    calls,
    reads: readPaths,
    searches: searches.length,
    writes: writes.map(call => `${call.name.replace('_document', '')}${call.error ? '!' : ''}`),
    written: writes.filter(call => !call.error).map(call => norm(call.args.path)),
    misses: misses.length,
    unchanged: unchanged.length,
    lists: lists.length,
    errors: errors.map(call => `${call.name}: ${call.error}`),
    rereads,
    again,
    promptTokens: usage.promptTokens || 0,
    requests: usage.requests || 0,
    words: content.trim().split(/\s+/).filter(Boolean).length,
    failures,
    pinnedAfter,
    pinnedBefore,
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
    rereads: 0,
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
    const turns = messages.filter(
      message => message.role === 'assistant' && !message.metadata?.command
    )

    console.log(`  ${file}`)
    /** Paths read earlier in the conversation and not changed since. */
    const seen = new Set()
    let pinned = new Set()
    turns.forEach((turn, i) => {
      // The writer's edit before the turn makes the model's read of it old.
      const edited = expectations[i]?.before?.edit?.path
      if (edited) seen.delete(norm(edited))
      const holding = new Set([...pinned, ...seen])
      const state = states[i]
      const m = measure({
        turn,
        expect: expectations[i] || { text: '' },
        holding,
        pinnedBefore: pinned,
        state,
      })
      for (const path of m.reads) seen.add(path)
      // Its own writes it knows, but its read of the document is old.
      for (const path of m.written) seen.delete(path)
      pinned = m.pinnedAfter.size || state ? m.pinnedAfter : pinned

      const bits = [
        `T${i + 1}`,
        `reads=${m.reads.length}${m.rereads.length ? ` (pinned ${m.rereads.length})` : ''}${m.again.length ? ` (again ${m.again.length})` : ''}`,
        m.misses ? `misses=${m.misses}` : '',
        m.searches ? `search=${m.searches}` : '',
        m.writes.length ? `writes=${m.writes.join(',')}` : '',
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
      totals.rereads += m.rereads.length
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
    })
  }

  console.log(`  --`)
  console.log(
    `  runs=${files.length}  turns=${totals.turns}  tool errors=${totals.errors}  path misses=${totals.misses}  lists=${totals.lists}  unchanged=${totals.unchanged}  reads of pinned=${totals.rereads}  reads again=${totals.again}  prompt tokens=${(totals.promptTokens / 1000).toFixed(0)}k (${(totals.promptTokens / 1000 / Math.max(1, totals.turns)).toFixed(1)}k a turn)  checks failed=${totals.failed}/${totals.checks}`
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
