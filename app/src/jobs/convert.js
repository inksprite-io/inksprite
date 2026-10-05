/**
 * @module jobs/convert
 * @description A document's text turned into Markdown by a model, a section
 * at a time, along a tree decided first.
 *
 * `jobs/sections.js` settles the headings and cuts the text into requests,
 * each with its headings written in. A model converts a request — tables,
 * paragraphs, lists — and hands the headings back as they were given; what
 * it changes of them is put back, a heading it adds at a level it may not
 * use becomes a bold line, and one it loses sends the request back as two
 * halves. The answers are joined, a table cut by a split made whole again,
 * and an index of links goes on top.
 *
 * Everything here is pure but the step that asks the model, which takes
 * the asking as a function. The job runner supplies it in the app; the
 * harness supplies its own.
 */

import convertPrompt from '@/ai/prompts/convert.md?raw'
import { indexOf, markdownSections } from '@/utils/sections.js'
import {
  ancestorsOf,
  givenHeadings,
  headingLine,
  requestText,
  splitUnit,
  wordsOfTitle,
} from './sections.js'

/** @typedef {import('./sections.js').SourceLine} SourceLine */
/** @typedef {import('./sections.js').PlannedHeading} PlannedHeading */
/** @typedef {import('./sections.js').Request} Request */

/** A Markdown heading line. */
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/

/** A line of a Markdown table. */
const TABLE_ROW = /^[ \t]*\|.*\|[ \t]*$/

/** The line under a table's header row. */
const TABLE_RULE = /^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/

/** How far an answer's word count may stray from its text's before it is refused. */
const TOO_SHORT = 0.85
const TOO_LONG = 1.2

/** Below this many words a request is too short for the count to mean anything. */
const COUNTED_FROM = 150

/**
 * Strip a code fence a model may have wrapped the whole answer in.
 *
 * @param {string} answer
 * @returns {string}
 */
export function unfence(answer) {
  const trimmed = answer.trim()
  const match = trimmed.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/)
  return match ? match[1] : trimmed
}

/**
 * The messages that ask a model to convert one request.
 *
 * @param {Object} args
 * @param {string} args.title - The document's title, for the model's bearings
 * @param {string} args.text - The request's text, headings written in
 * @param {PlannedHeading[]} args.above - The headings the text sits under
 * @param {boolean} args.continued - Whether the text goes on from a section begun before it
 * @returns {Array<{role: string, content: string}>}
 */
export function conversionMessages({ title, text, above, continued }) {
  const place =
    above.length > 0
      ? `This text sits under: ${above.map(headingLine).join(' / ')}.`
      : 'This text sits at the top of the document.'
  const going = continued
    ? ' It continues the section above from where the text before it stopped; its heading is not repeated.'
    : ''
  return [
    { role: 'system', content: convertPrompt.trim() },
    {
      role: 'user',
      content: `Document: ${title}\n\n${place}${going}\n\nConvert the following text to Markdown:\n\n${text}`,
    },
  ]
}

/**
 * How many words of running text a stretch has: letters only, so a table's
 * pipes and a page's numbers count for nothing on either side.
 *
 * @param {string} text
 * @returns {number}
 */
export function wordCount(text) {
  return (text.match(/\p{L}{2,}/gu) || []).length
}

/**
 * A text with any passage it gives twice kept once. Some PDFs give the
 * same passage twice — a sidebar drawn in two layers — and a model that
 * writes it once has dropped nothing; its words are counted against the
 * text's once. Only a run of lines repeated together counts: stat blocks
 * that share a line or two word for word are not a passage given twice.
 *
 * @param {string} text
 * @returns {string}
 */
export function withoutRepeats(text) {
  const lines = text.split('\n')
  const keys = lines.map(line => line.trim())
  /** @type {Map<string, number>} */
  const firstAt = new Map()
  keys.forEach((key, at) => {
    if (key.length >= 25 && !firstAt.has(key)) firstAt.set(key, at)
  })
  const drop = new Set()
  for (let at = 0; at < lines.length; at++) {
    const earlier = firstAt.get(keys[at])
    if (keys[at].length < 25 || earlier === undefined || earlier >= at) continue
    let run = 0
    while (
      at + run < lines.length &&
      earlier + run < at &&
      keys[at + run] === keys[earlier + run]
    ) {
      run++
    }
    if (run >= REPEATED_RUN) {
      for (let i = 0; i < run; i++) drop.add(at + i)
      at += run - 1
    }
  }
  return lines.filter((_, at) => !drop.has(at)).join('\n')
}

/** How many lines in a row have to repeat an earlier run to be a passage given twice. */
const REPEATED_RUN = 4

/**
 * How many single-character edits turn one string into another.
 * @param {string} a
 * @param {string} b
 */
function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, at) => at)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    previous = current
  }
  return previous[b.length]
}

/**
 * How a heading the model wrote stands to one it was given: the same
 * words, near enough the same — a letter the text had wrong, put right, as
 * a PDF that reads `ti` as `8` gives `Rou8nes` — or not the same heading.
 *
 * @param {string} written
 * @param {string} given
 * @returns {'same'|'near'|null}
 */
export function headingMatch(written, given) {
  const a = wordsOfTitle(written).join(' ')
  const b = wordsOfTitle(given).join(' ')
  if (a === b) return 'same'
  const allowed = Math.min(a.length, b.length) >= 8 ? Math.floor(b.length / 6) : 0
  return allowed > 0 && editDistance(a, b) <= allowed ? 'near' : null
}

/**
 * Text as it was read, made safe to put under its headings: a line of it
 * that starts with `#` — a comment in a code listing — is not a heading,
 * and is escaped so that no reader takes it for one. The given headings,
 * written in as Markdown, are left as they are.
 *
 * @param {string} text
 * @param {PlannedHeading[]} given
 * @returns {string}
 */
export function asRead(text, given) {
  const headings = new Set(given.map(headingLine))
  return text
    .split('\n')
    .map(line => (/^#/.test(line) && !headings.has(line) ? `\\${line}` : line))
    .join('\n')
}

/**
 * Put an answer's headings right. Each given heading is found in order —
 * as a heading at any level, or as a bold line the model demoted it to, in
 * the same words or near enough — and written back at the level it was
 * given, exactly as given unless the model put a misread letter right. A heading the
 * model added is kept only below the given heading it falls under; above
 * that, or before any given heading where none may go, it becomes a bold
 * line, since the tree is not the model's to change.
 *
 * A given heading with nothing under it — one that groups the headings
 * after it — is easy for a model to drop; when it is, it is written back in
 * before the next one.
 *
 * @param {string} markdown
 * @param {PlannedHeading[]} given
 * @param {number} floor - The level an added heading must be below: 6,
 *   where nothing may be added, as a conversion has it; lower lets a model
 *   add headings under the given ones
 * @param {boolean[]} [empty] - For each given heading, whether it has no text of its own
 * @returns {{markdown: string, missing: PlannedHeading[]}}
 */
export function fixHeadings(markdown, given, floor, empty = []) {
  const lines = markdown.split('\n')
  let next = 0
  let level = floor
  let fence = false
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]
    if (/^[ \t]{0,3}(```|~~~)/.test(line)) {
      fence = !fence
      continue
    }
    if (fence) continue
    const heading = line.match(HEADING)
    const bold = !heading ? line.match(/^\*\*(.+?)\*\*[:.]?$/) : null
    const text = heading ? heading[2] : bold ? bold[1] : null
    if (text === null) continue
    let match = next
    while (match < given.length && !headingMatch(text, given[match].title) && empty[match]) {
      match++
    }
    const how = match < given.length ? headingMatch(text, given[match].title) : null
    if (how) {
      // A near match keeps the model's wording, which put a letter right,
      // at the level it was given.
      const wanted =
        how === 'same'
          ? headingLine(given[match])
          : `${'#'.repeat(given[match].level)} ${text.trim()}`
      // A heading with nothing under it, named like the one after it — a
      // group and its only entry — is written once by a model; both go back.
      let last = match
      while (
        last + 1 < given.length &&
        empty[last] &&
        headingMatch(given[last + 1].title, given[last].title)
      ) {
        last++
      }
      lines[at] = [
        ...given.slice(next, match).map(headingLine),
        wanted,
        ...given.slice(match + 1, last + 1).map(headingLine),
      ].join('\n\n')
      level = Math.max(level, given[last].level)
      next = last + 1
      continue
    }
    if (heading && heading[1].length <= level) lines[at] = `**${heading[2]}**`
  }
  return { markdown: lines.join('\n'), missing: given.slice(next) }
}

/**
 * Whether an answer is a conversion of its request, and if not, why not:
 * cut off, empty, missing a heading it was given, or far from the text's
 * length in words — shorter is text dropped or summarised, longer is text
 * made up.
 *
 * @param {Object} args
 * @param {string} args.text - What was sent
 * @param {string} args.markdown - The answer, headings put right
 * @param {PlannedHeading[]} args.missing - Given headings the answer lacks
 * @param {string|null} [args.finishReason]
 * @returns {string|null} What is wrong, or null when nothing is
 */
export function checkConversion({ text, markdown, missing, finishReason }) {
  if (finishReason === 'length') return 'The answer was cut off before the end of the text.'
  if (!markdown.trim()) return 'The answer was empty.'
  if (missing.length > 0) {
    return `Headings are missing from the answer: ${missing
      .slice(0, 3)
      .map(heading => `"${headingLine(heading)}"`)
      .join(', ')}.`
  }
  const sent = wordCount(withoutRepeats(text))
  if (sent >= COUNTED_FROM) {
    const got = wordCount(markdown)
    if (got < sent * TOO_SHORT) {
      return `The answer is shorter than the text: ${got} words for ${sent}.`
    }
    if (got > sent * TOO_LONG) {
      return `The answer is longer than the text: ${got} words for ${sent}.`
    }
  }
  return null
}

/**
 * The columns of a table row.
 * @param {string} row
 */
const cellsOf = row =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(cell => cell.trim())

/**
 * Two converted pieces as one. Where the first ends in a table and the
 * second, a continued part of the same section, opens with a table of as
 * many columns, they are one table cut by the split: the second's header
 * row goes if it repeats the first's, and becomes a row if it does not —
 * a model given a table's middle makes its first row the header.
 *
 * @param {string} first
 * @param {string} second
 * @returns {string}
 */
export function joinConverted(first, second) {
  const a = first.trimEnd()
  const b = second.trimStart()
  if (!a) return b
  if (!b) return a
  const left = a.split('\n')
  const right = b.split('\n')
  const last = left[left.length - 1]
  if (
    TABLE_ROW.test(last) &&
    right.length >= 2 &&
    TABLE_ROW.test(right[0]) &&
    TABLE_RULE.test(right[1]) &&
    cellsOf(last).length === cellsOf(right[0]).length
  ) {
    let top = left.length - 1
    while (top > 0 && TABLE_ROW.test(left[top - 1])) top--
    const header = cellsOf(left[top]).join('|').toLowerCase()
    const repeated = cellsOf(right[0]).join('|').toLowerCase() === header
    return [...left, ...(repeated ? [] : [right[0]]), ...right.slice(2)].join('\n')
  }
  return `${a}\n\n${b}`
}

/**
 * Two halves of a request, for asking again. A request of several units is
 * cut between them; a request of one is cut inside it, at a paragraph near
 * its middle. Null when there is nothing to cut.
 *
 * @param {SourceLine[]} lines
 * @param {Request} request
 * @returns {[Request, Request]|null}
 */
export function splitRequest(lines, request) {
  if (request.units.length > 1) {
    const middle = Math.ceil(request.units.length / 2)
    return [
      { id: `${request.id}a`, units: request.units.slice(0, middle) },
      { id: `${request.id}b`, units: request.units.slice(middle) },
    ]
  }
  const unit = request.units[0]
  if (!unit) return null
  let chars = 0
  for (let at = unit.from; at < unit.to; at++) chars += lines[at].text.length + 1
  if (chars < 2000) return null
  const parts = splitUnit(lines, unit, Math.ceil(chars / 2))
  if (parts.length < 2) return null
  // A third part, from a cut that fell short of the middle, rides with the second.
  const rest = parts.slice(1)
  const second = { ...rest[0], to: rest[rest.length - 1].to }
  return [
    { id: `${request.id}a`, units: [parts[0]] },
    { id: `${request.id}b`, units: [second] },
  ]
}

/**
 * Convert one request: ask, put the headings right, check, and — when the
 * check fails — ask again as two halves, twice over at most.
 *
 * @param {Object} args
 * @param {string} args.title
 * @param {SourceLine[]} args.lines
 * @param {PlannedHeading[]} args.headings
 * @param {Request} args.request
 * @param {(messages: Array<{role: string, content: string}>) => Promise<{content: string, finishReason: string|null, usage?: any}>} args.ask
 * @param {(phase: 'checking'|'retrying'|'fallback', detail?: string) => void} [args.note] - Told what is happening, for a status line
 * @param {number} [depth] - How many times this request has been halved already
 * @returns {Promise<{markdown: string, usage?: any, fallback?: {problem: string, answer: string}}>}
 *   `fallback` when some part of it could not be converted and went in as the text was read
 */
export async function convertRequest({ title, lines, headings, request, ask, note }, depth = 0) {
  const text = requestText(lines, request, headings)
  const first = request.units[0]
  const answer = await ask(
    conversionMessages({
      title,
      text,
      above: ancestorsOf(request, headings),
      continued: Boolean(first && first.heading !== null && first.part > 0),
    })
  )
  note?.('checking')
  const empty = request.units
    .filter(unit => unit.heading !== null && unit.part === 0)
    .map(unit => !lines.slice(unit.from, unit.to).some(line => line.text))
  const fixed = fixHeadings(
    unfence(answer.content),
    givenHeadings(request, headings),
    // The tree is settled before the model sees the text: a heading it adds
    // is a bold line, at any level.
    6,
    empty
  )
  const problem = checkConversion({
    text,
    markdown: fixed.markdown,
    missing: fixed.missing,
    finishReason: answer.finishReason,
  })
  if (!problem) return { markdown: fixed.markdown, usage: answer.usage }

  const halves = depth < 2 ? splitRequest(lines, request) : null
  if (!halves) {
    // Asked as small as it goes, and still not a conversion: the text as it
    // was read goes in under its headings, so the tree is whole and one bad
    // answer does not stop a book. What came back rides along for a look.
    note?.('fallback', problem)
    return {
      markdown: asRead(text, givenHeadings(request, headings)),
      usage: answer.usage,
      fallback: { problem, answer: fixed.markdown },
    }
  }
  note?.('retrying', problem)
  const one = await convertRequest(
    { title, lines, headings, request: halves[0], ask, note },
    depth + 1
  )
  const two = await convertRequest(
    { title, lines, headings, request: halves[1], ask, note },
    depth + 1
  )
  return {
    markdown: joinConverted(one.markdown, two.markdown),
    usage: addUsage(addUsage(answer.usage, one.usage), two.usage),
    ...(one.fallback || two.fallback ? { fallback: one.fallback || two.fallback } : {}),
  }
}

/**
 * The converted document: the answers joined in order, and an index of
 * links to its sections on top.
 *
 * @param {string[]} outputs - In request order
 * @returns {string}
 */
export function assemble(outputs) {
  const body = outputs.reduce((sofar, output) => joinConverted(sofar, output), '').trim()
  const index = indexOf(markdownSections(body))
  return index ? `${index}\n\n---\n\n${body}\n` : `${body}\n`
}

/**
 * @param {any} a
 * @param {any} b
 * @returns {any}
 */
export function addUsage(a, b) {
  if (!a) return b
  if (!b) return a
  return {
    prompt_tokens: (a.prompt_tokens || 0) + (b.prompt_tokens || 0),
    completion_tokens: (a.completion_tokens || 0) + (b.completion_tokens || 0),
    total_tokens: (a.total_tokens || 0) + (b.total_tokens || 0),
  }
}
