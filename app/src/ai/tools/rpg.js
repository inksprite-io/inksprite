/**
 * @module ai/tools/rpg
 * @description Lightweight oracle tools, of the kind a solo game keeps beside
 * its dice.
 *
 * - `oracle(question, likelihood)` answers yes/no questions about the fiction
 *   by rolling d100 against a target derived from the likelihood bucket, and
 *   answers in the four words the fiction can use: "yes", "no", or either of
 *   those made exceptional. The roll, the target and the bucket are how it got
 *   there, not part of the answer, and a model handed them starts narrating
 *   the arithmetic. Random events belong to the `interpret` skill, which the
 *   Game Master calls when it wants one — the oracle firing one off the back
 *   of a doubles roll made a yes/no question answer something else.
 *
 * - `drawCard()` turns over one card from the whole tarot deck, upright or
 *   reversed. It is not a tool: the card is a prompt to be read, and a model
 *   that reads it in the same breath as it narrates spends the turn arguing
 *   with it. The `interpret` skill draws it out of sight and hands back only
 *   what it made of it. See ../skills/interpret.
 *
 * - `roll_table(options)` picks one entry from a table the model supplies, for
 *   the ad-hoc tables a GM improvises at the table.
 *
 * - `rollDice(notation)` rolls dice notation — `3d6+2` — and says what each
 *   die came up as well as the total. The one roll behind both `/roll` and the
 *   model's `roll_dice` (see ./dice.js), so the writer and the model read their
 *   dice the same way.
 *
 * - `draw_tarot(count, deck)` turns over cards from a shuffled deck — three
 *   from the Major Arcana unless asked otherwise. The same draw the writer
 *   makes with `/tarot`. Unlike `drawCard`, the model is handed the cards
 *   themselves: a spread is something it asked for, to read as it chooses,
 *   where the `interpret` card answers a question it put to someone else.
 */

import { MAJOR_ARCANA, TAROT_DECK } from './data/tarot.js'

/** @typedef {import('./registry.js').ToolDefinition} ToolDefinition */

// ----------------------------------------------------------------------------
// Likelihood buckets → d100 target
// ----------------------------------------------------------------------------

/** @type {Record<string, number>} */
export const LIKELIHOOD_TARGETS = {
  nearly_impossible: 5,
  very_unlikely: 15,
  unlikely: 35,
  fifty_fifty: 50,
  likely: 65,
  very_likely: 85,
  nearly_certain: 95,
}

const LIKELIHOOD_KEYS = Object.keys(LIKELIHOOD_TARGETS)

// ----------------------------------------------------------------------------
// Dice
// ----------------------------------------------------------------------------

/**
 * @param {number} sides
 * @returns {number} 1–`sides` inclusive
 */
function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1
}

/** @returns {number} 1–100 inclusive */
function rollD100() {
  return rollDie(100)
}

/**
 * Ceilings on what a line of notation can ask for. Not a rule about play —
 * nothing at a table needs two hundred dice, and a mistyped `3d600000` should
 * come back as a mistake rather than as a number nobody wanted.
 */
const MAX_DICE = 100
const MAX_SIDES = 1000

/**
 * Dice, and any run of advantage and burden letters after them, at the point
 * the notation is read to: `3d6a`, `3d20b2`. A run, so dice carrying both are
 * read as one term to refuse.
 */
const DICE_AT = /(\d*)d(\d+)((?:[ab]\d*)*)/iy
/** `min(2d20)`, `max(2d20)`: dice of which only one counts. */
const KEPT_AT = /(min|max)\(([^)]*)\)/iy
/** What `min()` and `max()` take: dice of one kind, with no letters. */
const KEPT_DICE = /^(\d*)d(\d+)$/i
/**
 * A whole number, and not the start of a word, so `3a` is said to be wrong as
 * it was written. `x` multiplies, so it may follow one.
 */
const NUMBER_AT = /\d+(?!(?![x×])\p{L})/iuy
/** What isn't dice or a number: a word, which is said back as it is. */
const WORD_AT = /[\p{L}\p{N}_.]+/uy
/**
 * The signs that join terms, and what each does: `x` and `×` multiply too.
 *
 * @type {Record<string, '+'|'-'|'*'|'/'>}
 */
const SIGNS = {
  '+': '+',
  '-': '-',
  '*': '*',
  x: '*',
  X: '*',
  '×': '*',
  '/': '/',
  '÷': '/',
}

/**
 * Dice of one kind in the notation, and which of them count: all of them, or
 * only so many of the lowest or the highest.
 *
 * @typedef {Object} DiceTerm
 * @property {string} written - The term as written, to name its line of working
 * @property {number} count - Every die thrown, the ones to be dropped too
 * @property {number} sides
 * @property {'min'|'max'} [keep] - Whether the lowest or the highest count
 * @property {number} [kept] - How many of them count, beside `keep`
 */

/**
 * The notation as it was read, a part at a time: dice, a number, a minus in
 * front of something, or two parts joined by a sign.
 *
 * @typedef {{type: 'dice', term: DiceTerm}
 *   | {type: 'number', value: number}
 *   | {type: 'negate', of: DiceNode}
 *   | {type: 'sign', sign: '+'|'-'|'*'|'/', left: DiceNode, right: DiceNode}} DiceNode
 */

/**
 * Notation that has been read: the dice it throws, in the order written, and
 * how they make the total.
 *
 * @typedef {Object} DiceNotation
 * @property {string} notation - As written
 * @property {DiceTerm[]} dice
 * @property {DiceNode} tree
 */

/** What is wrong with notation, said to whoever wrote it. */
class NotationError extends Error {}

/**
 * Read dice notation without rolling it.
 *
 * Separate from the roll because the two questions are asked at different
 * times: whether a line is dice at all can be answered while the writer is
 * still typing it, or when they edit one they already rolled, and neither
 * moment wants a new result. See ../commands.js.
 *
 * `3d6+2`, `d20`, `2d6+1d4+1`: dice and whole numbers, added and subtracted,
 * dice as well as numbers, so `2d6-2d6` is one pair of dice against another.
 * `*` (or `x`) multiplies, as in `5d4*10`, and `/` divides by a whole number,
 * rounding down, as in `8d6/2`. Dividing only by a number, because dividing by
 * dice is not a roll anyone makes, and dice can come to nothing.
 *
 * Spaces say how far a sign reaches. `3d6+1` is one roll at a table, so
 * `3d6+1 * 4` multiplies all of it, as the player means, where `3d6 + 1 * 4`
 * multiplies only the 1. Signs written alike, all spaced or none, go by
 * arithmetic's order, so `3d6+1*4` multiplies only the 1 too. Brackets say
 * otherwise: `(3d6 + 1) * 4`.
 *
 * `min(2d20)+1` and `max(2d20)+1` count only the lowest or the highest of the
 * dice in them: disadvantage and advantage. Dice of one kind, because the
 * higher of a d20 and a d4 is not a roll anyone makes.
 *
 * `3d6a` is three dice with an advantage die: one more is thrown and the lowest
 * dropped. `3d20b` is three with a burden die: one more, and the highest
 * dropped. A number says how many, as in `3d6a2`. Dice carry one or the other,
 * because whether the two cancel is for the game to say.
 *
 * Spaces are not read anywhere else, so `3d6 B2` is `3d6b2`.
 *
 * @param {string} notation - What the writer typed
 * @returns {DiceNotation|{error: string}}
 */
export function parseDice(notation) {
  const written = (notation || '').trim()
  if (!written) return { error: 'Say what to roll, like 3d6+2.' }

  // The notation without its spaces, and for each place in it whether a space
  // was written beside it, which a sign there reads.
  let text = ''
  /** @type {boolean[]} */
  const spaced = []
  for (let i = 0; i < written.length; i++) {
    if (/\s/.test(written[i])) {
      if (spaced.length) spaced[spaced.length - 1] = true
      continue
    }
    spaced.push(i > 0 && /\s/.test(written[i - 1]))
    text += written[i]
  }

  /** @type {DiceTerm[]} */
  const dice = []
  let at = 0

  /** @param {RegExp} pattern - Sticky, so it matches where reading has got to */
  const take = pattern => {
    pattern.lastIndex = at
    const found = pattern.exec(text)
    if (found) at = pattern.lastIndex
    return found
  }
  /** @param {string} char */
  const takeChar = char => {
    if (text[at] !== char) return false
    at += 1
    return true
  }
  /** What is wrong where a term should be, or where one ended. */
  const unreadable = () => {
    if (at === 0 || at === text.length) {
      return new NotationError(`"${written}" is not dice. Roll something like 3d6+2.`)
    }
    const word = take(WORD_AT)
    if (word) return new NotationError(`"${word[0]}" is not dice. Roll something like 3d6+2.`)
    if (text[at] === ')') return new NotationError('There’s a ")" with no "(" before it.')
    return new NotationError(`Join dice with +, -, * or /, not "${text[at]}".`)
  }

  /**
   * The sign where reading has got to, if it is one of these and spaced as
   * asked.
   *
   * @param {string} signs
   * @param {boolean} loose - Whether a space is written beside it
   */
  const signAt = (signs, loose) => {
    const sign = SIGNS[text[at]]
    return sign && signs.includes(sign) && spaced[at] === loose ? sign : null
  }

  /**
   * Terms added and taken away: those joined by spaced signs, each of them
   * whatever is written without, or those joined by signs without spaces.
   *
   * @param {boolean} loose
   * @returns {DiceNode}
   */
  const sum = loose => {
    let left = product(loose)
    for (let sign = signAt('+-', loose); sign; sign = signAt('+-', loose)) {
      at += 1
      left = { type: 'sign', sign, left, right: product(loose) }
    }
    return left
  }

  /**
   * Terms multiplied and divided, before they are added.
   *
   * @param {boolean} loose
   * @returns {DiceNode}
   */
  const product = loose => {
    const term = () => (loose ? sum(false) : operand())
    let left = term()
    for (let sign = signAt('*/', loose); sign; sign = signAt('*/', loose)) {
      at += 1
      const right = term()
      if (sign === '/' && (right.type !== 'number' || right.value === 0)) {
        throw new NotationError('Divide by a whole number above 0, like 8d6/2.')
      }
      left = { type: 'sign', sign, left, right }
    }
    return left
  }

  /** @returns {DiceNode} */
  const operand = () => {
    if (takeChar('+')) return operand()
    if (takeChar('-')) return { type: 'negate', of: operand() }
    if (takeChar('(')) {
      const inside = sum(true)
      if (!takeChar(')')) throw new NotationError('There’s a "(" with no ")" after it.')
      return inside
    }

    const kept = take(KEPT_AT)
    if (kept) {
      const keep = /** @type {'min'|'max'} */ (kept[1].toLowerCase())
      const inside = KEPT_DICE.exec(kept[2])
      if (!inside) throw new NotationError(`Put dice of one kind in ${keep}(), like ${keep}(2d20).`)
      const term = { ...diceTerm(kept[0], inside[1], inside[2], ''), keep, kept: 1 }
      dice.push(term)
      return { type: 'dice', term }
    }

    const die = take(DICE_AT)
    if (die) {
      const term = diceTerm(die[0], die[1], die[2], die[3])
      dice.push(term)
      return { type: 'dice', term }
    }

    const number = take(NUMBER_AT)
    if (number) return { type: 'number', value: Number(number[0]) }

    throw unreadable()
  }

  try {
    const tree = sum(true)
    if (at < text.length) throw unreadable()
    if (dice.length === 0) return { error: `There are no dice in "${written}".` }
    return { notation: written, dice, tree }
  } catch (error) {
    if (error instanceof NotationError) return { error: error.message }
    throw error
  }
}

/**
 * Dice as written, read: how many, how many sides, and any advantage or burden
 * dice, which add to what is thrown and say which count.
 *
 * @param {string} written - The term, for saying what is wrong with it
 * @param {string} count - The number before the `d`, if any
 * @param {string} sides
 * @param {string} letters - Any run of `a` and `b` after it, with their numbers
 * @returns {DiceTerm}
 */
function diceTerm(written, count, sides, letters) {
  const extra = /^([ab])(\d*)$/i.exec(letters)
  if (/a/i.test(letters) && /b/i.test(letters)) {
    throw new NotationError(
      `"${written}" has both advantage and burden dice. Give it one or the other.`
    )
  }
  if (letters && !extra) {
    throw new NotationError(`"${written}" is not dice. Roll something like 3d6+2.`)
  }

  const left = count === '' ? 1 : Number(count)
  const added = !extra ? 0 : extra[2] === '' ? 1 : Number(extra[2])
  const thrown = left + added
  if (left < 1 || thrown > MAX_DICE) {
    throw new NotationError(
      `Roll between 1 and ${MAX_DICE} dice at a time, not ${left < 1 ? left : thrown}.`
    )
  }
  const faces = Number(sides)
  if (faces < 2 || faces > MAX_SIDES) {
    throw new NotationError(`A die has between 2 and ${MAX_SIDES} sides, not ${faces}.`)
  }

  if (!added) return { written, count: left, sides: faces }
  const keep = extra?.[1].toLowerCase() === 'a' ? 'max' : 'min'
  return { written, count: thrown, sides: faces, keep, kept: left }
}

/**
 * A roll as `roll_dice` answers it, and as `/roll` keeps it.
 *
 * The dice go with the total, kept apart by kind, because how a roll reads is
 * often in the dice rather than the sum: the lower of two d20s, doubles, the
 * highest of three. A flat list of numbers cannot say which were the d4s.
 *
 * Where dice were dropped, the ones that count go too. A game that counts
 * successes has no use for the total, and a reader told which three of four dice
 * stand has no sorting to get wrong.
 *
 * Each term's dice are the next so many of their kind, in the order the
 * notation throws them, so the dice by kind say which term threw which: see
 * `workingOf`, which shows them term by term.
 *
 * @typedef {Object} DiceRoll
 * @property {string} roll - The notation, as written
 * @property {Record<string, number[]>} dice - What each die came up, by kind:
 *   `{d6: [4, 2, 5], d4: [3]}`. Every die thrown, the ones dropped too, in the
 *   notation's order.
 * @property {Record<string, number[]>} [kept] - The dice that count, by kind and
 *   in the same order, where any were dropped
 * @property {number} [modifier] - Rolls from before dice could be multiplied:
 *   the numbers added and taken away, summed. No longer written, as `(2d6+1)*2`
 *   has nothing it could say
 * @property {number} total
 */

/**
 * Where each of the notation's dice terms is among the dice of its kind: the
 * next so many, in the order written.
 *
 * Null where the dice are not as many as the notation throws, as in a roll
 * saved by a version that read the notation another way.
 *
 * @param {DiceNotation} asked
 * @param {Record<string, number[]>} dice - What the dice came up, by kind
 * @returns {Map<DiceTerm, number[]>|null}
 */
function facesByTerm(asked, dice) {
  /** @type {Record<string, number>} */
  const taken = {}
  /** @type {Map<DiceTerm, number[]>} */
  const faces = new Map()
  for (const term of asked.dice) {
    const kind = `d${term.sides}`
    const from = taken[kind] ?? 0
    const thrown = (dice[kind] ?? []).slice(from, from + term.count)
    if (thrown.length !== term.count) return null
    faces.set(term, thrown)
    taken[kind] = from + term.count
  }
  return faces
}

/**
 * Which of a term's dice count, by where they fall among them.
 *
 * @param {DiceTerm} term
 * @param {number[]} faces - What the term's dice came up
 * @returns {Set<number>}
 */
function countedAt({ keep, kept }, faces) {
  if (!keep) return new Set(faces.keys())
  return new Set(
    faces
      .map((face, at) => ({ face, at }))
      .sort((a, b) => (keep === 'max' ? b.face - a.face : a.face - b.face))
      .slice(0, kept)
      .map(({ at }) => at)
  )
}

/**
 * The faces of a term that count, in the order they were thrown.
 *
 * @param {DiceTerm} term
 * @param {number[]} faces
 * @returns {number[]}
 */
function facesKept(term, faces) {
  const counted = countedAt(term, faces)
  return faces.filter((_, at) => counted.has(at))
}

/**
 * What the notation comes to, given what each dice term counts for.
 *
 * Division rounds down, as the games that halve damage say to.
 *
 * @param {DiceNode} node
 * @param {(term: DiceTerm) => number} counted
 * @returns {number}
 */
function valueOf(node, counted) {
  switch (node.type) {
    case 'dice':
      return counted(node.term)
    case 'number':
      return node.value
    case 'negate':
      return -valueOf(node.of, counted)
    case 'sign': {
      const left = valueOf(node.left, counted)
      const right = valueOf(node.right, counted)
      if (node.sign === '+') return left + right
      if (node.sign === '-') return left - right
      if (node.sign === '*') return left * right
      return Math.floor(left / right)
    }
  }
}

/**
 * The roll the notation makes of the dice: each term's dice taken in turn from
 * their kind, those that count worked through the notation's arithmetic.
 *
 * Apart from the throw because a roll the writer edits is worked out again from
 * the dice they wrote. See ../commands.js.
 *
 * @param {DiceNotation} asked - The notation, read
 * @param {Record<string, number[]>} dice - What the dice came up, by kind, as
 *   many of each as the notation throws
 * @returns {DiceRoll}
 */
export function rollFrom(asked, dice) {
  const faces = /** @type {Map<DiceTerm, number[]>} */ (facesByTerm(asked, dice))
  /** @type {Record<string, number[]>} */
  const kept = {}
  for (const term of asked.dice) {
    const kind = `d${term.sides}`
    kept[kind] = [...(kept[kind] ?? []), ...facesKept(term, faces.get(term) ?? [])]
  }

  const total = valueOf(asked.tree, term =>
    facesKept(term, faces.get(term) ?? []).reduce((sum, face) => sum + face, 0)
  )
  const dropped = asked.dice.some(({ count, kept = count }) => kept < count)
  return { roll: asked.notation, dice, ...(dropped && { kept }), total }
}

/**
 * Roll what the notation asks for.
 *
 * @param {string} notation - What the writer typed
 * @returns {DiceRoll|{error: string}}
 */
export function rollDice(notation) {
  const asked = parseDice(notation)
  if ('error' in asked) return asked

  /** @type {Record<string, number[]>} */
  const dice = {}
  for (const { count, sides } of asked.dice) {
    const kind = (dice[`d${sides}`] ??= [])
    for (let i = 0; i < count; i++) kind.push(rollDie(sides))
  }

  return rollFrom(asked, dice)
}

/**
 * A piece of a line of working: some of its text, or the dice a term dropped,
 * which are drawn struck through.
 *
 * @typedef {{text: string, dropped?: true}} WorkingPart
 */

/**
 * A roll's dice as they are read: a line for each term, the dice it dropped
 * first, lowest first and struck through, then those that count as they fell,
 * as in `3d6a2: ~~1, 2~~, 6, 4, 2 → 12`. Each term on a line of its own, so
 * which die went with which is plain where the dice by kind run two d20 terms
 * together.
 *
 * Only the dice, which nothing else on screen says: the arithmetic is the
 * notation's, above them, and the total is below. A line is named by its term
 * only where there are others, and says what its dice come to only where more
 * than one counts and the term isn't the whole roll. Nothing for a lone die,
 * which the total already is, nor for a roll whose dice this notation doesn't
 * throw.
 *
 * @param {DiceRoll} roll
 * @returns {WorkingPart[][]}
 */
export function workingOf(roll) {
  const asked = parseDice(roll.roll)
  if ('error' in asked) return []
  const alone = asked.tree.type === 'dice'
  if (alone && asked.dice[0].count === 1) return []
  const faces = facesByTerm(asked, roll.dice)
  if (!faces) return []

  return asked.dice.map(term => {
    const thrown = faces.get(term) ?? []
    const counted = countedAt(term, thrown)
    const dropped = thrown.filter((_, at) => !counted.has(at)).sort((a, b) => a - b)
    const kept = thrown.filter((_, at) => counted.has(at))

    /** @type {WorkingPart[]} */
    const line = []
    /** @param {string} text */
    const write = text => {
      const last = line.at(-1)
      if (last && !last.dropped) last.text += text
      else line.push({ text })
    }
    if (asked.dice.length > 1) write(`${term.written}: `)
    if (dropped.length) {
      line.push({ text: dropped.join(', '), dropped: true })
      write(', ')
    }
    write(kept.join(', '))
    if (!alone && kept.length > 1) write(` → ${kept.reduce((sum, face) => sum + face, 0)}`)
    return line
  })
}

/**
 * The working as text, for the model, a copy and the writer's edit: a line
 * for each term, the dice that were dropped struck through as Markdown strikes,
 * `~~1, 2~~`, which is how dice bots have long shown them.
 *
 * @param {WorkingPart[][]} lines
 * @returns {string}
 */
export function workingText(lines) {
  return lines
    .map(line => line.map(({ text, dropped }) => (dropped ? `~~${text}~~` : text)).join(''))
    .join('\n')
}

/**
 * Whether two throws are the same dice for the notation: each term's faces the
 * same, in whatever order. The working shows a term's dropped dice first, so
 * dice read back from it can be the same throw written in another order.
 *
 * @param {DiceNotation} asked
 * @param {Record<string, number[]>} one - Dice by kind
 * @param {Record<string, number[]>} other
 * @returns {boolean}
 */
export function sameThrow(asked, one, other) {
  const these = facesByTerm(asked, one)
  const those = facesByTerm(asked, other)
  if (!these || !those) return false
  /** @param {number[]} faces */
  const sorted = faces => [...faces].sort((a, b) => a - b).join()
  return asked.dice.every(term => sorted(these.get(term) ?? []) === sorted(those.get(term) ?? []))
}

/**
 * @param {number} roll
 * @param {number} target
 * @returns {{ result: 'yes'|'no', exceptional: boolean }}
 */
export function interpretRoll(roll, target) {
  const excYesMax = Math.floor(target / 5)
  const excNoMin = 101 - Math.floor((100 - target) / 5)
  if (roll <= target) {
    return { result: 'yes', exceptional: roll <= excYesMax && excYesMax >= 1 }
  }
  return { result: 'no', exceptional: roll >= excNoMin && excNoMin <= 100 }
}

// ----------------------------------------------------------------------------
// oracle
// ----------------------------------------------------------------------------

/** @type {ToolDefinition} */
export const oracleDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'oracle',
    description:
      'Ask a yes/no question. Use this when the answer is 1) genuinely uncertain, and 2) narratively interesting. Answers with one of "yes", "no", "exceptional yes", or "exceptional no".  Exceptional answers are more dramatic: "Is the door locked?" -> "exceptional yes" -> "The door is locked and barred from the inside."',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The yes/no question being asked.',
        },
        likelihood: {
          type: 'string',
          enum: LIKELIHOOD_KEYS,
          description:
            'How likely a "yes" feels in the fiction: nearly_impossible, very_unlikely, unlikely, fifty_fifty, likely, very_likely, nearly_certain.',
        },
      },
      required: ['question', 'likelihood'],
    },
  },
}

/**
 * The answer, and nothing else.
 *
 * A string rather than an object, because there is one thing to say and the
 * fiction can use all four values as written. What it used to return — the
 * question echoed back, the bucket, the target, the raw d100 — was the working
 * rather than the answer, and a model given the working narrates it: the
 * player hears about a 73 against a target of 65.
 *
 * @param {{ question: string, likelihood: string }} args
 * @returns {Promise<'yes'|'no'|'exceptional yes'|'exceptional no'|{error: string}>}
 */
export async function executeOracle(args) {
  const target = LIKELIHOOD_TARGETS[args.likelihood]
  if (target === undefined) {
    return {
      error: `Unknown likelihood "${args.likelihood}". Use one of: ${LIKELIHOOD_KEYS.join(', ')}.`,
    }
  }

  const { result, exceptional } = interpretRoll(rollD100(), target)
  return exceptional ? `exceptional ${result}` : result
}

// ----------------------------------------------------------------------------
// roll_table
// ----------------------------------------------------------------------------

/**
 * Guard against a table so long it is obviously a mistake — a model looping on
 * generation, say — rather than a real one a GM would write.
 */
export const MAX_TABLE_OPTIONS = 100

/** @type {ToolDefinition} */
export const rollTableDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'roll_table',
    description:
      'Roll on a random table you supply: give the options and one is chosen at random, with equal odds for each. Use this for the ad-hoc tables a GM improvises — what the guard is carrying, which exit the noise came from, what the rumor turns out to be. List an option more than once to make it likelier. For yes/no questions use the oracle instead.',
    parameters: {
      type: 'object',
      properties: {
        options: {
          type: 'array',
          items: { type: 'string' },
          description:
            'The entries on the table, each a short phrase. Repeat an entry to weight it.',
        },
        table_name: {
          type: 'string',
          description: 'What the table is for, e.g. "contents of the satchel". Echoed back.',
        },
      },
      required: ['options'],
    },
  },
}

/**
 * @param {{ options?: string[], table_name?: string }} args
 * @returns {Promise<{table_name?: string, options_count?: number, roll?: number, result?: string, error?: string}>}
 */
export async function executeRollTable(args) {
  const options = Array.isArray(args?.options)
    ? args.options.filter(o => typeof o === 'string' && o.trim()).map(o => o.trim())
    : []

  if (options.length === 0) {
    return { error: 'roll_table needs a non-empty list of string options.' }
  }
  if (options.length > MAX_TABLE_OPTIONS) {
    return { error: `roll_table accepts at most ${MAX_TABLE_OPTIONS} options.` }
  }

  const index = Math.floor(Math.random() * options.length)

  return {
    ...(args.table_name ? { table_name: args.table_name } : {}),
    options_count: options.length,
    // 1-based so it reads like a table roll rather than an array index.
    roll: index + 1,
    result: options[index],
  }
}

// ----------------------------------------------------------------------------
// tarot
// ----------------------------------------------------------------------------

/**
 * The decks a draw can come from, by the name the writer asks for them under.
 *
 * The Major Arcana is the default because its twenty-two cards are the ones
 * that carry an archetype each — The Tower, The Lovers, Death — and a draw
 * from all seventy-eight is mostly pips. The full deck is there for a reading
 * that wants them.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const TAROT_DECKS = Object.freeze({
  major: MAJOR_ARCANA,
  full: TAROT_DECK,
})

/** The deck a draw comes from when the writer does not say. */
export const DEFAULT_TAROT_DECK = 'major'

/** How many cards a draw turns over when the writer does not say: a past, present and future. */
export const TAROT_SPREAD = 3

/**
 * The most a draw can ask for. The Celtic Cross is ten, and nothing anyone
 * reads is bigger; a number past it is a typo.
 */
export const MAX_TAROT_CARDS = 10

/**
 * Cards off the top of a shuffled deck, in the order they came.
 *
 * Without replacement, because there is one of each: The Tower turning up
 * twice is not a stronger omen but a mistake. The cards are not interpreted
 * here: they mean nothing until somebody reads them against the scene in
 * front of them, the writer or the model that drew them.
 *
 * @param {number} [count] - How many to turn over
 * @param {readonly string[]} [cards] - The deck to draw from, one of TAROT_DECKS
 * @returns {string[]}
 */
export function drawTarot(count = TAROT_SPREAD, cards = TAROT_DECKS[DEFAULT_TAROT_DECK]) {
  const deck = [...cards]
  /** @type {string[]} */
  const drawn = []
  while (drawn.length < count && deck.length > 0) {
    const [card] = deck.splice(Math.floor(Math.random() * deck.length), 1)
    drawn.push(card)
  }
  return drawn
}

/** The decks a draw can come from, for the tool's enum and its errors. */
const TAROT_DECK_NAMES = Object.keys(TAROT_DECKS)

/** @type {ToolDefinition} */
export const drawTarotDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'draw_tarot',
    description: `Draw tarot cards from a shuffled deck, each card at most once. Use this for a reading in the fiction, or for inspiration when you want an image to build on. The cards mean nothing until you read them against the scene. For a yes/no question use the oracle instead.`,
    parameters: {
      type: 'object',
      properties: {
        count: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_TAROT_CARDS,
          description: `How many cards to draw, 1 to ${MAX_TAROT_CARDS}. Defaults to ${TAROT_SPREAD}: past, present and future.`,
        },
        deck: {
          type: 'string',
          enum: TAROT_DECK_NAMES,
          description:
            'Which deck: "major" for the 22 cards of the Major Arcana, "full" for all 78. Defaults to "major".',
        },
        question: {
          type: 'string',
          description: 'What the reading is about, if anything.',
        },
      },
    },
  },
}

/**
 * The cards, in the order they came, and nothing else.
 *
 * The question is not echoed: like the oracle's, the model already knows what
 * it asked, and the cards are the answer to it. Count and deck are checked
 * here rather than trusted to the schema, which a model does not always keep
 * to; a count sent as "3" is read as the number it says.
 *
 * @param {{ count?: number|string, deck?: string, question?: string }} [args]
 * @returns {Promise<string[]|{error: string}>}
 */
export async function executeDrawTarot(args) {
  const count = Number(args?.count ?? TAROT_SPREAD)
  const deck = args?.deck ?? DEFAULT_TAROT_DECK

  if (!Number.isInteger(count) || count < 1 || count > MAX_TAROT_CARDS) {
    return { error: `Draw between 1 and ${MAX_TAROT_CARDS} cards, not ${args?.count}.` }
  }
  if (!TAROT_DECK_NAMES.includes(deck)) {
    return { error: `Unknown deck "${deck}". Use one of: ${TAROT_DECK_NAMES.join(', ')}.` }
  }

  return drawTarot(count, TAROT_DECKS[deck])
}

/**
 * @typedef {Object} DrawnCard
 * @property {string} card - Its name, as TAROT_DECK has it
 * @property {boolean} reversed - Whether it came up upside down
 */

/**
 * One card from the whole deck, and which way up it came: what the
 * `interpret` skill reads against the story.
 *
 * The card means nothing on its own — that is the point of it. It is a nudge
 * out of whatever the writer of the scene would have reached for next, and it
 * only becomes anything once someone reads it against the fiction in front of
 * them. Which is why nothing here interprets it and no model is handed it raw.
 *
 * The whole deck rather than the Major Arcana a writer's spread starts from:
 * one card is asked to answer every question in a game, and twenty-two
 * archetypes come round again within an evening, where the minor cards bring
 * the everyday — a quarrel, a windfall, a rival — with a suit to say what
 * kind. Reversed half the time, as a reader lays them: the card's meaning
 * blocked or turned inward, and twice the answers from the same deck.
 *
 * @returns {DrawnCard}
 */
export function drawCard() {
  const [card] = drawTarot(1, TAROT_DECK)
  return { card, reversed: Math.random() < 0.5 }
}
