/**
 * Generate the standup notes for the `findable` fixture, and list them in
 * project.json. Run from app/: `node harness/fixtures/findable/standups.mjs`.
 *
 * Nineteen short notes, three a week from the kickoff to late September, so
 * the project listing is long the way a real one is and the model has to find
 * things among them. A few carry facts that appear nowhere else — a measured
 * latency, a count — which only a search or a read of the right day turns up.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = join(HERE, 'standups')
mkdirSync(DIR, { recursive: true })

/** @type {Record<string, string[]>} Lines by person, in roughly the project's order. */
const LINES = {
  Dana: [
    'Lining up interviews; two heavy note-takers booked for next week.',
    'First interview done (Priya). Writing it up.',
    'Priya write-up in Notes. Second interview slipped to Friday.',
    'Cap analysis: 6% of users are over 50,000 chunks, 1% over 100,000.',
    'Second interview: same three query types as Priya, same distrust of a search button.',
    'Started the regression query set from the interview transcripts.',
    'Query set at 120; aiming for 200 by the 18th.',
    'Query set assembled: 212 queries, 40% exact-phrase, 35% names, 25% topic.',
    'Reviewing the design doc. Latency section is stale.',
    'Talking to design about the exact-match badge in results.',
  ],
  Marcus: [
    'BM25 prototype over chunks running on the test corpus. 12 ms per query.',
    'Chunker at 256/32 per Ferreira. Index build 40 s for 6,000 notes.',
    'Added the bi-encoder to the prototype. Fusion next.',
    'RRF fusion in. Hybrid list looks better on the topic queries by eye.',
    'Grouping results by note; best chunk decides the position.',
    'Timing every stage in the pipeline; logs per keystroke.',
    'Trying the 22M reranker over the top 20.',
    '22M reranker over the top 20 measured at 17 ms; end to end 118 ms per keystroke on the low-spec laptop.',
    'Reranker stays. Cleaning up the timing logs for the design doc.',
    'Recency tiebreak in. Exact-match flag wired to the API.',
  ],
  Ines: [
    'Reading Ferreira and Okonkwo. Notes into Papers/ by Wednesday.',
    'Ferreira and Okonkwo notes in Papers.',
    'Sato and Brennan read; their hard-negative definition differs from our glossary.',
    'Presenting Okonkwo at the meeting; recommending hybrid.',
    'Lindqvist on the pile; the reranker question hangs on it.',
    'Lindqvist read. 22M at 38 ms for 50 candidates. Notes in Papers.',
    'Adeyemi and Zhou read. Notes in Papers.',
    'Presenting Lindqvist on the 9th.',
    'Design doc latency section still says 200 ms; on my list.',
    'Design doc: reranking and latency sections still to do.',
  ],
  Tom: [
    'Measuring embedding model load on the low-spec laptop.',
    '110M bi-encoder loads in 900 ms cold. Keep it resident.',
    'Reranker spike: 340M cross-encoder, 190 ms for 50 candidates. Too slow.',
    'Vendor comparison written up, then made moot by the no-server rule.',
    'Vector quantization: int8 is 4x smaller and recall is unchanged within 0.3.',
    'Flat vector index at 50,000 chunks scans in 18 ms; no need for HNSW yet.',
    'Indexer running in a worker; typing no longer stalls during reindex.',
    'Retiring the reranker spike; added a note that it is superseded.',
    'Startup: model load moved off the first paint.',
    'Disk layout for the two indexes under the data directory.',
  ],
}

/** Mondays, Wednesdays and Fridays from 2026-08-14 to 2026-09-25. */
const dates = []
for (let day = new Date('2026-08-14T00:00:00Z'); day <= new Date('2026-09-25T00:00:00Z'); ) {
  const weekday = day.getUTCDay()
  if (weekday === 1 || weekday === 3 || weekday === 5) dates.push(day.toISOString().slice(0, 10))
  day = new Date(day.getTime() + 24 * 3600 * 1000)
}

const people = Object.keys(LINES)
const entries = []
dates.forEach((date, at) => {
  const lines = people.map(person => {
    const list = LINES[person]
    // Each person moves through their lines at their own pace; not every
    // standup has everyone.
    const index = Math.min(list.length - 1, Math.floor((at * list.length) / dates.length))
    return `- **${person}**: ${list[index]}`
  })
  const skip = (at * 7) % people.length
  if (at % 3 === 1) lines.splice(skip, 1)
  const body = `# Standup ${date}\n\n${lines.join('\n')}\n`
  const file = `standups/${date}.md`
  writeFileSync(join(HERE, file), body)
  entries.push({
    path: `Notes/Standups/${date}`,
    file,
    summary: `Standup: one line each from ${lines.map(line => line.match(/\*\*(\w+)\*\*/)?.[1]).join(', ')}.`,
  })
})

const projectFile = join(HERE, 'project.json')
const project = JSON.parse(readFileSync(projectFile, 'utf8'))
project.documents = [
  ...project.documents.filter(entry => !entry.path.startsWith('Notes/Standups/')),
  ...entries,
]
writeFileSync(projectFile, `${JSON.stringify(project, null, 2)}\n`)
console.log(
  `${entries.length} standups written; project.json lists ${project.documents.length} documents`
)
