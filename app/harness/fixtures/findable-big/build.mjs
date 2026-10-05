/**
 * Build the `findable-big` fixture: everything in `findable`, read from its
 * files, and a journal of one short entry a day from March to October. Run
 * from app/: `node harness/fixtures/findable-big/build.mjs`.
 *
 * The journal makes the project more than a listing shows by default: with it
 * there are over 200 entries, so `list_documents` lists two levels and says the
 * journal holds 245 without naming them. Counting a month's entries, or opening
 * one day's, takes a listing of the journal itself. One entry carries a fact
 * nothing else has, which a read of that day turns up.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const base = JSON.parse(readFileSync(join(HERE, '../findable/project.json'), 'utf8'))

const TOPICS = [
  'the tokenizer for code blocks in notes',
  'the settings screen for the index cap',
  'profiling the BM25 path on long notes',
  'the sync conflict test cases',
  'the onboarding copy for search',
  'the fusion weights on the regression set',
  'the crash report from the beta group',
]

/** The one entry with something only it says. */
const NEEDLE = {
  '2026-09-14':
    'Found the cache warming bug: the index loaded before the model, so the first query paid for both. Fixed by loading the model first; the first query went from 1,400 ms to 210 ms.',
}

const journal = []
for (let day = new Date(Date.UTC(2026, 2, 1)); day <= new Date(Date.UTC(2026, 9, 31)); ) {
  const date = day.toISOString().slice(0, 10)
  const topic = TOPICS[journal.length % TOPICS.length]
  journal.push({
    path: `Notes/Journal/${date}`,
    content: NEEDLE[date] || `Spent most of the day on ${topic}. Nothing worth writing up yet.`,
  })
  day.setUTCDate(day.getUTCDate() + 1)
}

const project = {
  title: 'Findable',
  summary: base.summary,
  documents: [
    ...base.documents.map(entry => ({ ...entry, file: `../findable/${entry.file}` })),
    ...journal,
  ],
}

writeFileSync(join(HERE, 'project.json'), JSON.stringify(project, null, 2) + '\n')
console.log(`${project.documents.length} documents, ${journal.length} of them in the journal`)
