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
 * - `rollDice(notation)` rolls what the writer wrote down — `3d6+2`. Also not a
 *   tool: a model asked to roll dice is being asked to invent a number, and the
 *   writer reaching for dice is reaching for the one thing at the table that
 *   nobody gets to choose. It is `/roll`, and nothing else calls it.
 *
 * - `drawTarot(count, deck)` turns over cards from a shuffled deck — three from
 *   the Major Arcana unless asked otherwise. Not a tool, for the reason
 *   `drawCard` is not: the cards are a prompt to be read against the story,
 *   and these are the writer's to read. It is `/tarot`.
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

/** Terms of `XdY`, split off the modifiers between them. */
const DIE_TERM = /^\+?(\d*)d(\d+)$/i
const CONSTANT_TERM = /^([+-]?\d+)$/

/**
 * Read dice notation without rolling it.
 *
 * Separate from the roll because the two questions are asked at different
 * times: whether a line is dice at all can be answered while the writer is
 * still typing it, or when they edit one they already rolled, and neither
 * moment wants a new result. See ../commands.js.
 *
 * `3d6+2`, `d20`, `2d6+1d4+1`: dice added together, with whole-number modifiers
 * on the end. A modifier may be negative; a die may not, because a term the
 * writer meant to subtract is rare enough that reading it wrong is worse than
 * refusing it.
 *
 * @param {string} notation - What the writer typed
 * @returns {{notation: string, dice: Array<{count: number, sides: number}>, modifier: number}|{error: string}}
 */
export function parseDice(notation) {
  const written = (notation || '').trim()
  if (!written) return { error: 'Say what to roll, like 3d6+2.' }

  /** @type {Array<{count: number, sides: number}>} */
  const dice = []
  let modifier = 0

  // Split before each sign rather than on it, so the sign stays with the term
  // it belongs to and a leading one does not leave an empty first term.
  for (const term of written.replace(/\s+/g, '').split(/(?=[+-])/)) {
    const die = DIE_TERM.exec(term)
    if (die) {
      const count = die[1] === '' ? 1 : Number(die[1])
      const sides = Number(die[2])
      if (count < 1 || count > MAX_DICE) {
        return { error: `Roll between 1 and ${MAX_DICE} dice at a time, not ${count}.` }
      }
      if (sides < 2 || sides > MAX_SIDES) {
        return { error: `A die has between 2 and ${MAX_SIDES} sides, not ${sides}.` }
      }
      dice.push({ count, sides })
      continue
    }

    const constant = CONSTANT_TERM.exec(term)
    if (constant) {
      modifier += Number(constant[1])
      continue
    }

    return { error: `"${term}" is not dice. Roll something like 3d6+2.` }
  }

  if (dice.length === 0) return { error: `There are no dice in "${written}".` }

  return { notation: written, dice, modifier }
}

/**
 * Roll what the notation asks for.
 *
 * The dice come back individually as well as summed, because which of them is
 * the answer depends on who is asking: the writer wants to see the 6 and the
 * two 1s, and the fiction only ever needed the total.
 *
 * @param {string} notation - What the writer typed
 * @returns {{notation: string, dice: number[], modifier: number, total: number}|{error: string}}
 */
export function rollDice(notation) {
  const asked = parseDice(notation)
  if ('error' in asked) return asked

  /** @type {number[]} */
  const dice = []
  for (const { count, sides } of asked.dice) {
    for (let i = 0; i < count; i++) dice.push(rollDie(sides))
  }

  return {
    notation: asked.notation,
    dice,
    modifier: asked.modifier,
    total: dice.reduce((sum, die) => sum + die, 0) + asked.modifier,
  }
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
 * here and no model is handed them raw, for the reason `drawCard` gives —
 * they mean nothing until somebody reads them against the scene in front of
 * them, and that somebody is the writer.
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
