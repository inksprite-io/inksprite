/**
 * @module harness/surface
 * @description Surface checks over a batch: the things a scorer would count
 * that a regular expression can count instead.
 *
 * For each run in a batch, reads the stored messages and reports words per
 * assistant turn, tool calls by name, a pre-tool preamble fused to the prose
 * ("I'll read the notes first.The knock…"), non-Latin script inside the
 * prose, turns with no content, and hits against the fixture's own phrase
 * list — the sample lines a character note quotes, the secrets a premise
 * says are unstated. Each fixture keeps that list in `surface.json`:
 * `phrases` is a map of label to case-insensitive regex source, `flags` is
 * the same for things worth counting that are not phrases, `counts` the same
 * again for things counted by how often they occur rather than whether, and
 * `firstTurn` asks for a second count over the opening turn alone.
 *
 * `--rules <file>` lays another spec of the same shape over the fixture's, for
 * a rule that belongs to something other than the project — a skill's house
 * style, say, counted the same way in a batch that ran with it and in one that
 * did not.
 *
 * `use_skill` calls are listed by what they asked for: a load by the skill's
 * name, a file read as `name:path`.
 *
 * This is not a score. It is the part of scoring that does not need a
 * reader, run before the readers so a rule that plainly did not hold is not
 * sent to five subagents.
 *
 * @example
 * npm run surface -- harness/runs/2026-09-17T16-30-52-riley-noah-argument
 */

import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * @typedef {Object} SurfaceSpec
 * @property {Record<string, string>} [phrases] - Label to regex source
 * @property {Record<string, string>} [flags] - Label to regex source
 * @property {Record<string, string>} [counts] - Label to regex source, counted per turn
 * @property {boolean} [firstTurn] - Also count phrases over the first turn alone
 */

/**
 * @param {string} name - Fixture folder name
 * @returns {Promise<SurfaceSpec>}
 */
async function loadSpec(name) {
  try {
    return JSON.parse(await readFile(join(HERE, 'fixtures', name, 'surface.json'), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return {}
  }
}

/**
 * @param {Record<string, string>} [patterns]
 * @param {string} text
 * @returns {string[]} Labels whose pattern matched
 */
function hits(patterns, text) {
  return Object.entries(patterns || [])
    .filter(([, source]) => new RegExp(source, 'i').test(text))
    .map(([label]) => label)
}

/**
 * How often each pattern occurs in a text.
 *
 * @param {Record<string, string>} patterns
 * @param {string} text
 * @returns {Record<string, number>}
 */
function occurrences(patterns, text) {
  return Object.fromEntries(
    Object.entries(patterns).map(([label, source]) => [
      label,
      (text.match(new RegExp(source, 'gi')) || []).length,
    ])
  )
}

/**
 * The `use_skill` calls in a turn, by what each asked for: the skill's name
 * for a load, `name:path` for one of its files.
 *
 * @param {any} turn
 * @returns {string[]}
 */
function skillCalls(turn) {
  const asked = []
  for (const step of turn.metadata?.apiTrajectory || []) {
    for (const call of step.tool_calls || []) {
      if (call.function?.name !== 'use_skill') continue
      let args = {}
      try {
        args = JSON.parse(call.function.arguments || '{}')
      } catch {
        // Recorded as it came; the name alone says enough.
      }
      asked.push(args.file ? `${args.name}:${args.file}` : String(args.name))
    }
  }
  return asked
}

/**
 * The assistant's turns in a run, whichever runner wrote it.
 *
 * `run.js` stores the chat's messages; `gm.js` stores its own turns, each
 * with the narration the player saw and the stages that produced it. Both
 * come back here in the chat shape, so the counts below read either.
 *
 * @param {any[]} stored - A run's JSON as written
 * @returns {any[]}
 */
function assistantTurns(stored) {
  if (stored.length > 0 && 'narration' in stored[0]) {
    return stored.map(turn => ({
      role: 'assistant',
      content: turn.narration,
      metadata: {
        apiTrajectory: (turn.stages || []).map((/** @type {any} */ stage) => ({
          tool_calls: (stage.calls || []).map((/** @type {any} */ call) => ({
            function: { name: call.name },
          })),
        })),
      },
    }))
  }
  return stored.filter(message => message.role === 'assistant')
}

/**
 * Tool calls across a turn's trajectory, by name.
 *
 * @param {any} turn
 * @returns {Record<string, number>}
 */
function toolCalls(turn) {
  /** @type {Record<string, number>} */
  const calls = {}
  for (const step of turn.metadata?.apiTrajectory || []) {
    for (const call of step.tool_calls || []) {
      const name = call.function?.name || '?'
      calls[name] = (calls[name] || 0) + 1
    }
  }
  return calls
}

/** @param {string} text */
const words = text => text.trim().split(/\s+/).filter(Boolean).length

/**
 * @param {SurfaceSpec} base
 * @param {SurfaceSpec} [extra]
 * @returns {SurfaceSpec}
 */
function merge(base, extra) {
  if (!extra) return base
  return {
    ...base,
    phrases: { ...base.phrases, ...extra.phrases },
    flags: { ...base.flags, ...extra.flags },
    counts: { ...base.counts, ...extra.counts },
  }
}

/**
 * @param {string} dir - Batch folder
 * @param {SurfaceSpec} [rules] - Laid over the fixture's own spec
 */
async function report(dir, rules) {
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
  const spec = merge(await loadSpec(meta.fixture), rules)
  const files = (await readdir(dir))
    .filter(file => /^run-\d+\.json$/.test(file))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))

  // A built-in's source reads `builtin_chat (src/ai/prompts/chat.md)`; the
  // id is the label, and a file's name is its own.
  const label = meta.prompt?.source
    ? basename(meta.prompt.source.split(' ')[0])
    : meta.arch
      ? `gm ${meta.arch}`
      : '?'
  console.log(`## ${basename(dir)}  [${label}]  ${meta.model || ''}`)
  for (const file of files) {
    const turns = assistantTurns(JSON.parse(await readFile(join(dir, file), 'utf8')))
    if (turns.length === 0) {
      console.log(`  ${file}: no assistant turns`)
      continue
    }
    const contents = turns.map(turn => turn.content || '')
    const all = contents.join('\n')
    const first = contents[0]
    const last = contents[contents.length - 1]

    /** @type {Record<string, number>} */
    const calls = {}
    for (const turn of turns) {
      for (const [name, count] of Object.entries(toolCalls(turn)))
        calls[name] = (calls[name] || 0) + count
    }
    const callList = Object.entries(calls)
      .sort()
      .map(([name, count]) => `${name}=${count}`)
      .join(' ')

    const parts = [
      `words=${turns.length === 1 ? words(last) : JSON.stringify(contents.map(words))}`,
      callList,
      /^(I'?ll|I will|Let me)\b/.test(first.trim()) ? 'FUSED-PREAMBLE' : '',
      /[぀-ヿ㐀-鿿가-힯]/.test(all) ? 'SCRIPT-LEAK' : '',
      contents.some(text => text.trim().length < 80) ? 'EMPTY-TURN' : '',
    ].filter(Boolean)

    const phraseHits = hits(spec.phrases, turns.length === 1 ? last : all)
    parts.push(
      `phrases=${phraseHits.length}${phraseHits.length ? ` (${phraseHits.join(', ')})` : ''}`
    )
    if (spec.firstTurn && turns.length > 1) {
      const firstHits = hits(spec.phrases, first)
      parts.push(`turn1=${firstHits.length}${firstHits.length ? ` (${firstHits.join(', ')})` : ''}`)
    }
    for (const label of hits(spec.flags, all)) parts.push(`[${label}]`)

    const loads = turns.map(skillCalls)
    if (loads.some(asked => asked.length)) {
      parts.push(
        `skills=${turns.length === 1 ? loads[0].join(',') : JSON.stringify(loads.map(asked => asked.join(',')))}`
      )
    }
    if (spec.counts) {
      const perTurn = contents.map(text => occurrences(spec.counts || {}, text))
      const counted = Object.keys(spec.counts).map(label =>
        turns.length === 1
          ? `${label}=${perTurn[0][label]}`
          : `${label}=${perTurn.map(counts => counts[label]).join('/')}`
      )
      parts.push(`{${counted.join(' ')}}`)
    }

    console.log(`  ${file}: ${parts.join('  ')}`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const at = args.indexOf('--rules')
  /** @type {SurfaceSpec|undefined} */
  let rules
  if (at !== -1) {
    const file = args[at + 1]
    if (!file) throw new Error('--rules needs a file')
    rules = JSON.parse(await readFile(resolve(file), 'utf8'))
    args.splice(at, 2)
  }
  if (args.length === 0) {
    console.error('Usage: npm run surface -- [--rules <file>] <batch dir>...')
    process.exit(1)
  }
  for (const dir of args) await report(resolve(dir), rules)
}

main().catch(error => {
  console.error(error.stack || error)
  process.exit(1)
})
