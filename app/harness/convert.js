/**
 * @module harness/convert
 * @description Convert PDFs to Markdown with a model, headless, one or a
 * whole folder of them.
 *
 * The same pipeline the app's Convert job runs: the section tree from the
 * PDF's bookmarks, or one structure request where it has none
 * (`jobs/sections.js`), then a request per section or run of sections,
 * each answer's headings put right and checked (`jobs/convert.js`). The
 * requests of every document share one pool, so a folder converts with as
 * many in flight as `--concurrency` allows.
 *
 *   npm run convert -- "harness/test-pdfs/Rules.pdf" --endpoint openrouter
 *   npm run convert -- harness/test-pdfs harness/research --out-dir harness/runs/all --concurrency 8
 *
 * `--pages a-b` converts only the requests that start on those pages, and
 * `--dry` asks no model at all: the tree, with the text under it as read —
 * for trying the structure, or the reading tools on it, at no cost.
 *
 * Each document's Markdown goes to the output folder as `<name>.md`, an
 * answer that failed its check beside it as `<name>.failed-<request>.md`,
 * and a report of the whole run as `report.json` and `report.md`.
 */

import './environment.js'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { resolveEndpoint } from './endpoints.js'
import { complete } from '../src/ai/complete.js'
import { resolveRouting } from '../src/ai/routing.js'
import { readPdfLayout } from '../src/files/pdf.js'
import { markdownSections } from '../src/utils/sections.js'
import { addUsage, asRead, assemble, convertRequest } from '../src/jobs/convert.js'
import {
  REQUEST_CHARS,
  givenHeadings,
  linesOfText,
  parseStructure,
  planRequests,
  requestLabel,
  requestText,
  structureMessages,
  structureOfLayout,
  unitsOf,
} from '../src/jobs/sections.js'

const args = process.argv.slice(2)
/** Options that take no value. */
const SWITCHES = ['--dry']
/** Every argument that is not an option or an option's value: the inputs. */
const positional = args.filter(
  (arg, at) =>
    !arg.startsWith('--') && !(args[at - 1]?.startsWith('--') && !SWITCHES.includes(args[at - 1]))
)
const input = positional[0]
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : fallback
}
if (!input) {
  console.error(
    'Usage: npm run convert -- <pdf, text file or folder>… [--endpoint name] [--model id] [--out-dir dir] [--concurrency n] [--budget chars] [--only text] [--effort level] [--pages a-b] [--dry]'
  )
  process.exit(1)
}

const endpoint = await resolveEndpoint(option('endpoint'))
const model = option('model', endpoint.model)
if (!model) throw new Error(`Endpoint "${endpoint.name}" names no model; pass --model`)
const provider = {
  id: 'provider_harness',
  name: endpoint.name,
  type: endpoint.type,
  endpoint: endpoint.endpoint,
  apiKey: endpoint.apiKey,
  routing: endpoint.routing ? resolveRouting(endpoint.routing) : undefined,
}
const effort = option('effort')
const overrides = effort ? { reasoningEffort: effort } : undefined
const budget = Number(option('budget', REQUEST_CHARS)) || REQUEST_CHARS
const concurrency = Math.max(1, Number(option('concurrency', 6)) || 6)
const only = option('only')
/** `--pages 120-140`: convert only the requests that start on those pages. */
const pages = option('pages') ? option('pages').split('-').map(Number) : null
/** `--dry`: no model at all — the tree, and the text under it as it was read. */
const dry = args.includes('--dry')
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
const outDir = option('out-dir', join('harness', 'runs', `convert-${stamp}`))
await mkdir(outDir, { recursive: true })

/**
 * Every PDF or text file under a path, following links.
 * @param {string} path
 * @returns {Promise<string[]>}
 */
async function inputsUnder(path) {
  const info = await stat(path)
  if (!info.isDirectory()) return [path]
  const found = []
  for (const entry of (await readdir(path)).sort()) {
    const child = join(path, entry)
    const childInfo = await stat(child)
    if (childInfo.isDirectory()) found.push(...(await inputsUnder(child)))
    else if (/\.pdf$/i.test(entry)) found.push(child)
  }
  return found
}

/** Requests in flight, across every document, held to the concurrency. */
let inFlight = 0
/** @type {Array<() => void>} */
const queue = []
/**
 * @template T
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
async function pooled(work) {
  if (inFlight >= concurrency) await new Promise(resolve => queue.push(resolve))
  inFlight++
  try {
    return await work()
  } finally {
    inFlight--
    queue.shift()?.()
  }
}

/** A failure of the connection or the provider, not of the answer: worth asking again. */
const TRANSIENT =
  /terminated|fetch failed|socket|ECONNRESET|ETIMEDOUT|network|timed? ?out|overloaded|rate limit|\b(429|5\d\d)\b/i

/**
 * Ask the model once, through the pool — and again, after a pause, when the
 * connection dropped or the provider was busy, up to three times.
 */
const ask = messages =>
  pooled(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await complete({ provider, model, messages, overrides })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (attempt >= 3 || !TRANSIENT.test(message)) throw error
        console.log(`  (asking again after: ${message.slice(0, 80)})`)
        await new Promise(resolve => setTimeout(resolve, 5000 * 3 ** attempt))
      }
    }
  })

/**
 * Convert one document and report on it.
 * @param {string} path
 */
async function convertOne(path) {
  const name = basename(path).replace(/\.[^.]+$/, '')
  const title = name
  const started = Date.now()
  /** @type {any} */
  const report = { name, path, model }
  try {
    let lines
    /** @type {any[]|null} */
    let planned = null
    if (/\.pdf$/i.test(path)) {
      const layout = await readPdfLayout(new Uint8Array(await readFile(path)))
      const structure = structureOfLayout(layout)
      lines = structure.lines
      planned = structure.headings
      report.pages = layout.pages.length
      report.bookmarks = layout.outline.length
      report.running = structure.removed
    } else {
      lines = linesOfText(await readFile(path, 'utf8'))
    }
    report.chars = lines.reduce((sum, line) => sum + line.text.length + 1, 0)
    if (!lines.some(line => line.text)) {
      report.error = 'No text.'
      return report
    }

    let usage = null
    let headings = []
    if (planned) {
      headings = planned
      report.tree = 'layout'
      report.fromType = planned.length - report.bookmarks
    } else if (dry) {
      report.tree = 'none'
    } else {
      const answer = await ask(structureMessages({ title, lines }))
      usage = addUsage(usage, answer.usage)
      try {
        headings = parseStructure(answer.content, lines)
        report.tree = 'model'
      } catch {
        report.tree = 'none'
      }
    }
    report.headings = headings.length
    const units = unitsOf(lines, headings)
    // A page range converts the requests that start inside it, cut along
    // the whole book's tree, so a sample reads as the whole would.
    const requests = planRequests(lines, units, budget).filter(request => {
      if (!pages) return true
      const page = lines[request.units[0].from]?.page ?? lines[request.units[0].from - 1]?.page
      return page !== null && page !== undefined && page >= pages[0] && page <= pages[1]
    })
    report.requests = requests.length
    report.retries = 0
    report.failed = []
    report.fallbacks = []

    const outputs = await Promise.all(
      requests.map(async request => {
        const label = requestLabel(lines, request, headings)
        const asked = Date.now()
        const said = (/** @type {string} */ how) =>
          console.log(
            `  ${name.slice(0, 28).padEnd(28)} ${label.slice(0, 44).padEnd(44)} ${how} ${Math.round((Date.now() - asked) / 1000)}s`
          )
        if (dry)
          return asRead(requestText(lines, request, headings), givenHeadings(request, headings))
        try {
          const done = await convertRequest({
            title,
            lines,
            headings,
            request,
            ask,
            note: (phase, problem) => {
              if (phase === 'retrying') report.retries++
              if (phase === 'fallback') report.fallbacks.push({ label, problem })
            },
          })
          usage = addUsage(usage, done.usage)
          if (done.fallback) {
            await writeFile(join(outDir, `${name}.fallback-${request.id}.md`), done.fallback.answer)
          }
          said(done.fallback ? `ok, part as read: ${done.fallback.problem}` : 'ok')
          return done.markdown
        } catch (error) {
          const problem = error instanceof Error ? error.message : String(error)
          said(`FAILED ${problem}`)
          report.failed.push({ request: request.id, label, problem })
          const answer = /** @type {any} */ (error)?.answer
          if (typeof answer === 'string') {
            await writeFile(join(outDir, `${name}.failed-${request.id}.md`), answer)
          }
          return `<!-- ${label}: conversion failed: ${problem} -->`
        }
      })
    )

    const markdown = assemble(outputs)
    await writeFile(join(outDir, `${name}.md`), markdown)
    const sections = markdownSections(markdown)
    report.outputChars = markdown.length
    report.outputHeadings = sections.length
    report.tableRows = markdown.split('\n').filter(line => /^\s*\|/.test(line)).length
    report.boldLines = markdown.split('\n').filter(line => /^\*\*[^*]+\*\*[:.]?$/.test(line)).length
    report.promptTokens = usage?.prompt_tokens || 0
    report.completionTokens = usage?.completion_tokens || 0
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  } finally {
    report.seconds = Math.round((Date.now() - started) / 1000)
  }
  const failed = report.failed?.length || 0
  console.log(
    `${name.slice(0, 48).padEnd(48)} ${String(report.pages ?? '-').padStart(4)}p ${String(report.tree ?? '-').padEnd(9)} ${String(report.headings ?? '-').padStart(4)}h ${String(report.requests ?? '-').padStart(3)}r ${String(report.retries ?? 0).padStart(2)} retried ${failed} failed ${String(report.seconds).padStart(5)}s${report.error ? `  ERROR ${report.error}` : ''}`
  )
  return report
}

const inputs = []
for (const path of positional) inputs.push(...(await inputsUnder(path)))
const chosen = inputs.filter(path => !only || path.includes(only))
console.log(
  `${chosen.length} documents, ${model} on ${endpoint.name}, ${concurrency} requests at a time, up to ${budget} chars each → ${outDir}`
)
const started = Date.now()
const reports = await Promise.all(chosen.map(convertOne))

const total = key => reports.reduce((sum, report) => sum + (report[key] || 0), 0)
const summary = {
  model,
  endpoint: endpoint.name,
  effort: effort || 'default',
  budget,
  documents: reports.length,
  seconds: Math.round((Date.now() - started) / 1000),
  requests: total('requests'),
  retries: total('retries'),
  failedRequests: reports.reduce((sum, report) => sum + (report.failed?.length || 0), 0),
  fallbacks: reports.reduce((sum, report) => sum + (report.fallbacks?.length || 0), 0),
  errors: reports.filter(report => report.error).length,
  promptTokens: total('promptTokens'),
  completionTokens: total('completionTokens'),
}
await writeFile(join(outDir, 'report.json'), JSON.stringify({ summary, reports }, null, 2) + '\n')

const rows = reports.map(
  report =>
    `| ${report.name.slice(0, 60)} | ${report.pages ?? '-'} | ${report.tree ?? '-'} | ${report.headings ?? '-'} | ${report.outputHeadings ?? '-'} | ${report.tableRows ?? '-'} | ${report.requests ?? '-'} | ${report.retries ?? 0} | ${report.failed?.length ?? 0} | ${report.seconds} | ${report.error || (report.failed || []).map(one => one.problem).join('; ')} |`
)
await writeFile(
  join(outDir, 'report.md'),
  [
    `# Conversion run`,
    '',
    '```json',
    JSON.stringify(summary, null, 2),
    '```',
    '',
    '| Document | Pages | Tree | Planned headings | Output headings | Table rows | Requests | Retried | Failed | Seconds | Problems |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n')
)
console.log(`\n${JSON.stringify(summary)}\n→ ${outDir}`)
