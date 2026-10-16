/**
 * @module spelling/engine
 * @description Harper, as the worker runs it: told the dialect and the words
 * it is to know, and asked about paragraphs, one text each. What comes back
 * is plain data, so it crosses to the page and is cached there by the text it
 * was asked about.
 *
 * Harper checks a hyphenated word a part at a time, and a hyphenated word
 * it is given matches nothing: "Wi-Fi" is "Wi" and "Fi". So the parts of one
 * carry the whole word (`word`), which is what a dictionary takes, and a
 * hyphenated word in a dictionary is kept here rather than given to Harper:
 * a misspelling inside it is dropped, and "Wi" on its own is still one.
 *
 * Harper takes about a quarter of a millisecond a word of prose it hasn't
 * seen, in Node and in a worker alike (15 Oct 2026, harper.js 2.10): a
 * screenful is quick, a novel is half a minute. Text it has seen comes back
 * much faster.
 *
 * Kept apart from the worker so that a test can run it in Node, where
 * Harper's `LocalLinter` works as it does in a worker.
 */

/** @typedef {import('harper.js').Linter} Linter */
/** @typedef {import('harper.js').Lint} Lint */

/**
 * A dialect of English the checker can be set to.
 *
 * @typedef {'american'|'british'|'australian'|'canadian'|'indian'} Dialect
 */

/**
 * One thing Harper found in a paragraph.
 *
 * @typedef {Object} LintInfo
 * @property {number} from - Where it starts in the text: a position in the
 *   JavaScript string, which Harper's spans already are
 * @property {number} to - Where it ends
 * @property {string} kind - Harper's kind of lint: `Spelling`, `Typo`,
 *   `Grammar`, `Agreement` and so on
 * @property {string} text - The text it is about
 * @property {string} [word] - For a misspelling in part of a hyphenated word,
 *   the whole word: "Wi-Fi" for "Wi". It is what goes into a dictionary.
 * @property {string} message - Harper's account of it, its markdown quotes made
 *   curly
 * @property {string[]} suggestions - What the text could become, best first
 * @property {string} [hash] - What Ignore keeps: a hash of the lint and the
 *   text either side of it (`lintHash`). Grammar only, since a word is added
 *   to a dictionary rather than ignored.
 */

/**
 * The checker's settings, as far as Harper is concerned.
 *
 * @typedef {Object} EngineConfig
 * @property {Dialect} dialect
 * @property {string[]} words - Words it is to know besides its own
 */

/** Harper's numbers for the dialects, as its `Dialect` enum has them. */
const DIALECT_NUMBERS = {
  american: 0,
  british: 1,
  australian: 2,
  canadian: 3,
  indian: 4,
}

/**
 * Harper's rules that are off. A long sentence is flagged by its length
 * alone, which in fiction is noise. Which others go is for a run over a real
 * manuscript to settle.
 */
const RULES_OFF = ['LongSentences']

/** The kinds a misspelt word comes as; every other kind is grammar. */
export const SPELLING_KINDS = new Set(['Spelling', 'Typo'])

/** A word's possessive ending, with either apostrophe. */
const POSSESSIVE = /['’]s$/u

/**
 * A word as it is kept in a dictionary: without the possessive it was found
 * with. "Tavrek’s" is added as "Tavrek".
 *
 * @param {string} word
 * @returns {string}
 */
export const baseWord = word => word.trim().replace(POSSESSIVE, '')

/** A letter, a mark or a digit, or an apostrophe: what a part of a word is made of. */
const PART = /[\p{L}\p{M}\p{N}'\u2019]/u

/** What joins the parts of a hyphenated word: a hyphen, or one of Unicode's. */
const HYPHEN = /[-\u2010\u2011]/u

/** Whether a word is hyphenated: parts with a hyphen between. */
export const isHyphenated = (/** @type {string} */ word) =>
  /[\p{L}\p{M}\p{N}][-\u2010\u2011][\p{L}\p{M}\p{N}]/u.test(word)

/**
 * The whole word a stretch of a paragraph is in, across hyphens: "Wi-Fi" for
 * the "Fi" in it. A hyphen counts only with a part either side, so a dash
 * written as two hyphens still ends a word.
 *
 * @param {string} paragraph
 * @param {number} from
 * @param {number} to
 * @returns {string}
 */
export function wordAround(paragraph, from, to) {
  let start = from
  while (start > 0) {
    const before = paragraph[start - 1]
    if (PART.test(before)) start--
    else if (HYPHEN.test(before) && start > 1 && PART.test(paragraph[start - 2])) start--
    else break
  }
  let end = to
  while (end < paragraph.length) {
    const after = paragraph[end]
    if (PART.test(after)) end++
    else if (HYPHEN.test(after) && PART.test(paragraph[end + 1] ?? '')) end++
    else break
  }
  return paragraph.slice(start, end)
}

/**
 * The words Harper is given for the ones in a dictionary. It doesn't take a
 * possessive from a word it was given, so each comes with its own: "Tavrek's",
 * which it then reads with either apostrophe. A hyphenated word is left out,
 * as Harper would never match it (`hyphenatedIn`).
 *
 * @param {string[]} words
 * @returns {string[]}
 */
export function harperWords(words) {
  const given = new Set()
  for (const word of words) {
    const base = baseWord(word)
    if (!base || isHyphenated(base)) continue
    given.add(base)
    given.add(`${base}'s`)
  }
  return [...given]
}

/**
 * The hyphenated words in a dictionary, without their possessives.
 *
 * @param {string[]} words
 * @returns {Set<string>}
 */
export const hyphenatedIn = words => new Set(words.map(baseWord).filter(isHyphenated))

/**
 * Set Harper to a dialect and a list of words, in place of the last.
 *
 * @param {Linter} linter
 * @param {EngineConfig} config
 * @returns {Promise<Set<string>>} The hyphenated words, which `lintTexts` is
 *   to be given: Harper isn't
 */
export async function configure(linter, { dialect, words }) {
  await linter.setDialect(DIALECT_NUMBERS[dialect] ?? DIALECT_NUMBERS.american)
  const rules = await linter.getLintConfig()
  await linter.setLintConfig({
    ...rules,
    ...Object.fromEntries(RULES_OFF.map(rule => [rule, false])),
  })
  await linter.clearWords()
  const given = harperWords(words)
  if (given.length > 0) await linter.importWords(given)
  return hyphenatedIn(words)
}

/**
 * What a suggestion makes of the text: a replacement, nothing, or the text
 * with something after it. Harper's `SuggestionKind`: 0, 1 and 2.
 *
 * @param {import('harper.js').Suggestion} suggestion
 * @param {string} text
 * @returns {string}
 */
const replacementFor = (suggestion, text) => {
  const kind = suggestion.kind()
  if (kind === 1) return ''
  if (kind === 2) return text + suggestion.get_replacement_text()
  return suggestion.get_replacement_text()
}

/** Harper quotes a word in backticks, as markdown; the menu shows it in quotes. */
const plainMessage = (/** @type {string} */ message) =>
  message.replace(/`([^`]*)`/g, '\u201c$1\u201d').replace(/`/g, '')

/** How much of the paragraph either side of a lint its hash takes in. */
const AROUND = 30

/**
 * A short name for a lint where it stands: its kind, its text, and the words
 * either side of it in its paragraph. An edit there brings the lint back, and
 * one elsewhere in the paragraph doesn't. Ignoring is the page's to do (see
 * `spelling/checker` `shows`), so Harper's own ignore list isn't used.
 *
 * cyrb53, a 53-bit string hash, written in base 36.
 *
 * @param {string} kind
 * @param {string} paragraph
 * @param {number} from
 * @param {number} to
 * @returns {string}
 */
export function lintHash(kind, paragraph, from, to) {
  const start = Math.max(0, from - AROUND)
  const key = `${kind}\u0000${from - start}\u0000${to - from}\u0000${paragraph.slice(start, to + AROUND)}`
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * Check paragraphs, each on its own.
 *
 * @param {Linter} linter
 * @param {string[]} texts
 * @param {Set<string>} [hyphenated] - Hyphenated words known besides Harper's,
 *   as `configure` gives them
 * @returns {Promise<LintInfo[][]>}
 */
export async function lintTexts(linter, texts, hyphenated = new Set()) {
  /** @type {LintInfo[][]} */
  const results = []
  for (const paragraph of texts) {
    /** @type {LintInfo[]} */
    const infos = []
    const lints = paragraph.trim() ? await linter.lint(paragraph, { language: 'plaintext' }) : []
    for (const lint of lints) {
      const { start: from, end: to } = lint.span()
      const kind = lint.lint_kind()
      const text = paragraph.slice(from, to)
      /** @type {LintInfo} */
      const info = {
        from,
        to,
        kind,
        text,
        message: plainMessage(lint.message()),
        suggestions: [...new Set(lint.suggestions().map(s => replacementFor(s, text)))].filter(
          replacement => replacement !== text
        ),
      }
      if (SPELLING_KINDS.has(kind)) {
        const word = wordAround(paragraph, from, to)
        if (isHyphenated(word)) {
          if (hyphenated.has(baseWord(word))) continue
          info.word = word
        }
      } else {
        info.hash = lintHash(kind, paragraph, from, to)
      }
      infos.push(info)
    }
    results.push(infos)
  }
  return results
}
