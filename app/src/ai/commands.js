/**
 * @module ai/commands
 * @description Slash commands: a tool the writer runs themselves.
 *
 * The oracle answers a question about the fiction, and until now only the model
 * could ask it. But the writer is at the table too, and half of what they want
 * settled is settled before there is anything to say — is the door locked, does
 * the guard hear it, does the rope hold — three rolls that shape the turn they
 * are about to type. Asking the model to ask on their behalf costs a whole turn
 * of narration to get one word back.
 *
 * So a command runs the tool here, with no inference at all, and what comes
 * back is written into the conversation as something already established. The
 * model reads it under the tag of whatever answered — `<oracle>` around the
 * question and the answer — and nothing about how the answer was reached. The
 * message itself holds only the answer; the tag goes on in ai/context/build.js,
 * which is what lets a command that does consult stream into its message the
 * way any other turn does.
 *
 * The working stays out: not the die, not the target. That is the same rule
 * `executeOracle` already follows for the model's own calls, and for the same
 * reason — a model handed the working narrates the working, and the writer
 * hears about a 73 against a target of 65.
 *
 * The likelihood is the exception, and only because it is not working. It is
 * what the writer thought of the odds before they rolled: a judgement about the
 * world, and one that changes what the answer means. A door that was unlikely
 * to be unlocked and is reads as a piece of luck; the same answer at even odds
 * reads as nothing at all. So it goes, when they named one — the default says
 * they had no opinion, and there is nothing in that worth passing on.
 *
 * ## How they are typed
 *
 * A command is a line, and everything after its name is the one thing it is
 * about:
 *
 *     /director This scene needs more tension.
 *     /roll 3d6+2
 *     /oracle(likely) Is the door locked?
 *     /compact(20) Keep the heist, drop the tavern.
 *     /name(female, 3)
 *     /tarot(1, full) Will she forgive him?
 *
 * No quoting. The first argument of every command worth having is a sentence,
 * and a grammar that makes the writer quote the sentence charges them for the
 * common case to leave room for a second argument that most commands do not
 * have. The few that do take it in parentheses, up against the name, where it
 * reads as a setting on the command rather than as part of the question.
 *
 * The one exception is a list, because a list of phrases has to say where each
 * phrase ends, and quotes are how everybody already says it:
 *
 *     /roll-table "a knife" "a letter" "nothing at all"
 *
 * A slash at the start of a line opens a menu of them in the message field,
 * each with its usage and a line saying what it does. The menu only finishes
 * the name: everything after it is typed the same way with the menu or
 * without. See `commandAtCaret` and composables/useCommandMenu.js.
 *
 * ## Whose turn they are
 *
 * The writer's, for the ones that settle something — they chose to ask, and the
 * answer is fact by the time anyone reads it. The assistant's for the ones that
 * consult, because an interpretation is prose a model wrote and pretending
 * otherwise costs the thing that makes a generated answer bearable to wait for:
 * watching it arrive. See `commandWritesProse`.
 *
 * ## Everyone in the scene
 *
 * `@` is a person, and what follows is what they said or did:
 *
 *     @cody I quickly hide in the closet.
 *     @emily "Ugh! I was having a nap! What do you want?"
 *
 * No list of them, because there is nothing to list: a game runs for an hour
 * before anyone writes a character note, and most of the cast never gets one.
 * The sigil is what makes that safe — `/` stays a closed set, so a name nothing
 * answers to is still a mistake worth naming. See CHARACTER.
 *
 * This module runs commands; it does not know they end up in a chat. What to do
 * with the record is composables/useChatCommands.js.
 */

import {
  executeOracle,
  executeRollTable,
  executeDrawTarot,
  parseDice,
  rollDice,
  DEFAULT_TAROT_DECK,
  LIKELIHOOD_TARGETS,
  MAX_TABLE_OPTIONS,
  MAX_TAROT_CARDS,
  TAROT_DECKS,
  TAROT_SPREAD,
} from './tools/rpg.js'
import { executeGenerateNames, GENDERS, MAX_NAMES } from './tools/names.js'
import { allSkills, onSkillsChanged } from './skills/index.js'
import { fillArgument, loadedByModel } from './skills/runner.js'
import { parseKeep } from './compaction.js'
import { getServer, onServersChanged, promptCommands } from '../mcp/servers.js'
import { describeFailure, getServerPrompt, promptText } from '../mcp/client.js'

/** @typedef {import('../types/models.js').ChatCommand} ChatCommand */
/** @typedef {import('./tools/registry.js').ToolContext} ToolContext */

/**
 * A command as the writer asked it: which one, what they said, and the setting
 * they put in parentheses if it takes one.
 *
 * @typedef {Object} CommandInput
 * @property {string} name
 * @property {string} input - Everything after the name, verbatim
 * @property {true} [character] - Set when the writer wrote `@`, meaning this is
 *   somebody rather than something
 * @property {string} [param] - The parenthesised setting, resolved to its
 *   default by `inspectCommand` when the writer left it out
 */

/** The likelihoods `/oracle` accepts, for anything that wants to list them. */
export const LIKELIHOODS = Object.keys(LIKELIHOOD_TARGETS)

/** What `/oracle` assumes when the writer does not say. */
const DEFAULT_LIKELIHOOD = 'fifty_fifty'

/**
 * A likelihood as the writer would say it out loud.
 *
 * Derived rather than listed, so a bucket added to LIKELIHOOD_TARGETS cannot
 * arrive without a name here. Only the even odds need saying differently: every
 * other bucket already reads as English once the underscore is a space.
 *
 * @param {string} value
 * @returns {string}
 */
function likelihoodLabel(value) {
  if (value === 'fifty_fifty') return '50/50'
  const said = value.replace(/_/g, ' ')
  return said.charAt(0).toUpperCase() + said.slice(1)
}

/**
 * @typedef {Object} CommandParameter
 * @property {string} name - What it is, for the error when it is wrong
 * @property {readonly string[]} [values] - What it accepts, when it is a choice
 * @property {string} [default] - What it means when it is left out
 * @property {(value: string) => string} [label] - What to call a value in front
 *   of the writer. The values themselves are written for the model — an enum it
 *   picks from, in the spelling the tool expects — and `fifty_fifty` is a fine
 *   thing to send and a poor thing to read.
 * @property {boolean} [send] - Whether the model should be told what it was
 *   asked under. For a parameter that is a judgement about the fiction rather
 *   than a setting on a tool: how surprising an answer is changes how it should
 *   be narrated. Only when the writer chose one — the default is the absence of
 *   a judgement, and there is nothing in that to pass on.
 */

/**
 * @typedef {Object} CommandDefinition
 * @property {string} usage - How to type it, for the error when it is typed wrong
 * @property {string} description - What it does, in a line, for the menu the
 *   writer picks it from. Written for the writer, in any kind of chat: most of
 *   these came from the table, and none of them is only for it.
 * @property {CommandParameter} [param] - What goes in the parentheses, for the
 *   commands that have a second thing to say. Validated here rather than in
 *   `check`, so every command spells its choices the same way.
 * @property {boolean} [consults] - Whether running it costs a model call. One
 *   that does cannot be run before its record is written — the writer would
 *   watch an empty box — so it is written pending and filled in.
 * @property {boolean} [ownTurn] - Whether its record is a message of its own
 *   rather than a piece of the writer's turn. Almost nothing is: an answer the
 *   writer asked for is theirs to bring to the turn, whatever answered, and a
 *   voice that is not the Game Master's in the slot the Game Master narrates
 *   from is the one thing a model reliably copies. `/compact` is the exception
 *   because a summary is not a turn at all — it stands in for the conversation
 *   the turns were part of.
 * @property {boolean} [speaks] - Whether its record is the writer saying
 *   something, which asks for a reply the way a character's line does and a
 *   roll does not. A saved prompt.
 * @property {boolean} [derived] - Whether its answer follows from what it was
 *   given and nothing else, so the turn written out for an edit carries no
 *   answer under it and the edit fills it in again. `/director`'s answer is
 *   the sentence itself and needs no saying; a saved prompt's is its skill's
 *   instructions with the sentence put in.
 * @property {boolean} [repeatable] - Whether asking again could answer
 *   differently: a draw, or an inference. Those are the ones worth a retry, and
 *   the ones an edit must not quietly re-ask — a writer fixing a typo in a
 *   question is not asking for new dice. `/director` is neither: its answer is
 *   the sentence it was given, so editing it simply runs it again.
 * @property {(asked: CommandInput) => string|undefined} [check] - What can be
 *   known to be wrong without running it. Every command answers this, because
 *   it is also what an edit is judged by: an edit that keeps its answer never
 *   reaches `run`, and nothing else would catch an emptied question.
 * @property {string} [tag] - The tag its record renders under, when the name
 *   the writer types is the wrong word for the thing it produced. `/compact`
 *   is an instruction; what lands in the conversation is a summary.
 * @property {(asked: CommandInput) => {label?: string, detail?: string, keep?: number}} [preview] -
 *   Everything about the record that follows from the question alone. It is
 *   what the writer sees while a consulting command runs — a box that does not
 *   say what it is asking is a worse wait than one that does — and what an
 *   edited command is rebuilt from.
 * @property {(asked: CommandInput, context?: ToolContext) => Promise<{label?: string, detail?: string, keep?: number, result: string}|{error: string}>} run
 */

/**
 * The writer's own note about a compaction: what they asked for. Shown beside
 * the summary and never sent — the model is reading the record.
 *
 * The count comes back with it, because it is the one part of a preview that is
 * not only for reading: it is how far above the end of the conversation the
 * summary sits. An edited count therefore moves the summary without
 * re-summarising anything. See composables/useChatCommands.js.
 *
 * @param {string} instructions - What the writer asked this one to favour, if anything
 * @param {number} kept
 * @returns {{detail: string, keep: number}}
 */
function compactNote(instructions, kept) {
  return { detail: (instructions || '').trim(), keep: kept }
}

/**
 * What a `/name` was asked for: who, and how many.
 *
 * Two values in the parentheses rather than one, positional and comma
 * separated, because this is the one command with nothing to say after its
 * name — there is no sentence to put a second argument beside, so both of them
 * live where the setting lives.
 *
 * @param {string} [param] - What the writer put in the parentheses
 * @returns {{gender: string, count: number}|{error: string}}
 */
function parseNameAsk(param) {
  const [gender = '', count] = (param || '').split(',').map(part => part.trim())

  if (!GENDERS.includes(gender)) {
    return { error: `Name whom? Say ${GENDERS.join(' or ')}.` }
  }

  const wanted = count === undefined || count === '' ? 1 : Number(count)
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > MAX_NAMES) {
    return { error: `How many? A whole number from 1 to ${MAX_NAMES}, and "${count}" is not one.` }
  }

  return { gender, count: wanted }
}

/**
 * The ask, in words, for the writer's side of the record.
 *
 * Falls back to what was typed when it does not parse, because a label is not
 * the place a mistake gets reported — `check` has already said so.
 *
 * @param {string} param
 * @returns {string}
 */
function describeNameAsk(param) {
  const asked = parseNameAsk(param)
  if ('error' in asked) return param

  return asked.count === 1 ? `a ${asked.gender} name` : `${asked.count} ${asked.gender} names`
}

/**
 * The dice themselves, for the writer.
 *
 * Nothing when there is one die and nothing added to it: the total already is
 * the die, and repeating it reads as though something else happened.
 *
 * @param {{dice: number[], modifier: number}} rolled
 * @returns {string|undefined}
 */
function diceWorking({ dice, modifier }) {
  if (dice.length === 1 && !modifier) return undefined

  const thrown = dice.join(' + ')
  if (!modifier) return thrown
  return `${thrown} ${modifier > 0 ? '+' : '-'} ${Math.abs(modifier)}`
}

/** The decks `/tarot` can draw from, for the error when it is asked for another. */
const TAROT_DECK_NAMES = Object.keys(TAROT_DECKS)

/**
 * What a `/tarot` was asked for: how many cards, and from which deck.
 *
 * Two settings in the parentheses, in either order, because a number and a
 * deck are never mistaken for each other and there is nothing to be gained by
 * making the writer remember which comes first. Either can be left out.
 *
 * @param {string} [param] - What the writer put in the parentheses
 * @returns {{count: number, deck: string}|{error: string}}
 */
function parseTarotAsk(param) {
  let count = TAROT_SPREAD
  let deck = DEFAULT_TAROT_DECK

  for (const part of (param || '').split(',').map(each => each.trim())) {
    if (!part) continue

    if (/^\d+$/.test(part)) {
      count = Number(part)
      if (count < 1 || count > MAX_TAROT_CARDS) {
        return { error: `Draw between 1 and ${MAX_TAROT_CARDS} cards, not ${part}.` }
      }
      continue
    }

    if (TAROT_DECK_NAMES.includes(part)) {
      deck = part
      continue
    }

    return {
      error: `"${part}" is neither how many cards nor a deck. The decks are ${TAROT_DECK_NAMES.join(' and ')}.`,
    }
  }

  return { count, deck }
}

/**
 * The ask, in words, for the writer's side of the record.
 *
 * The deck only when it is not the usual one, since the cards say the rest.
 * Falls back to what was typed when it does not parse; `check` has already
 * said what was wrong with it.
 *
 * @param {string} param
 * @returns {string}
 */
function describeTarotAsk(param) {
  const asked = parseTarotAsk(param)
  if ('error' in asked) return param

  const cards = asked.count === 1 ? '1 card' : `${asked.count} cards`
  return asked.deck === DEFAULT_TAROT_DECK ? cards : `${cards}, ${asked.deck} deck`
}

/**
 * The pieces of a table as typed: an option in straight or curly quotes, the
 * space or comma between two of them, or something outside the quotes that
 * should not be.
 */
const TABLE_TOKEN = /"([^"]*)"|“([^”]*)”|[\s,]+|(\S+)/g

/**
 * The options of a table, read out of their quotes.
 *
 * Quoted because they are phrases, and a phrase has to say where it ends.
 * Between them, a space or a comma, whichever the writer reached for. Anything
 * else outside the quotes is a mistake — an option that lost its quotes, most
 * often — and it is named rather than dropped, because dropping it would
 * change the odds the writer wrote.
 *
 * @param {string} input - What the writer typed after the name
 * @returns {{options: string[]}|{error: string}}
 */
function parseTable(input) {
  /** @type {string[]} */
  const options = []

  for (const [, straight, curly, stray] of (input || '').matchAll(TABLE_TOKEN)) {
    if (stray !== undefined)
      return { error: `Put each option in quotes: ${stray} is outside them.` }

    const option = straight ?? curly
    if (option === undefined) continue
    if (!option.trim()) return { error: 'An option has to say something.' }
    options.push(option.trim())
  }

  if (options.length < 2) return { error: 'A table needs at least two options.' }
  if (options.length > MAX_TABLE_OPTIONS) {
    return { error: `A table holds at most ${MAX_TABLE_OPTIONS} options.` }
  }

  return { options }
}

/**
 * The table, for the record: the options as a quoted list, however they were
 * separated when typed. Falls back to what was typed when it does not parse,
 * because a label is not the place a mistake gets reported.
 *
 * @param {string} input
 * @returns {string}
 */
function tableLabel(input) {
  const table = parseTable(input)
  if ('error' in table) return input

  return table.options.map(option => `"${option}"`).join(' ')
}

/**
 * The commands written here: everything the writer can type that is not a
 * skill — the ones that run a tool and no model, and `/director`, which runs
 * nothing at all. The skills' commands are made from the skills; see
 * `skillCommand`.
 *
 * @type {Record<string, CommandDefinition>}
 */
const WRITTEN = {
  director: {
    usage: '/director <direction>',
    description: 'Say what the next reply needs, as a direction to follow.',
    check({ input }) {
      if (!input) return 'Say what the turn needs: /director Wrap this scene up'
    },
    async run({ input }) {
      // Nothing was asked and nothing rolled — the writer simply said it. It
      // renders under the same tag the Director skill answers in, because from
      // the Game Master's side it is the same thing: what this turn needs,
      // decided by whoever was better placed to decide it.
      return { result: input }
    },
  },

  name: {
    usage: '/name(<gender>[, <how many>])',
    description: 'Make up names for someone new.',
    tag: 'names',
    repeatable: true,
    param: { name: 'gender and count', label: describeNameAsk },
    check({ input, param }) {
      if (!param) return 'Say who to name: /name(female) or /name(male, 3)'

      const asked = parseNameAsk(param)
      if ('error' in asked) return asked.error

      // The only command with nothing to say after its name. A sentence typed
      // here was meant for the turn, and dropping it silently would lose it.
      if (input) return 'It takes no words of its own. Put them on a line of their own.'
    },
    async run({ param }) {
      const asked = parseNameAsk(param)
      if ('error' in asked) return asked

      const outcome = await executeGenerateNames(asked)
      if (outcome.error) return { error: outcome.error }

      // One per line, because a list is a list. What was asked for is in the
      // parameter, so the record does not repeat it back.
      return { result: outcome.names.map(name => name.full).join('\n') }
    },
  },

  oracle: {
    usage: '/oracle(<likelihood>) <question>',
    description: 'Ask a yes-or-no question, at the odds you give it.',
    repeatable: true,
    param: {
      name: 'likelihood',
      values: LIKELIHOODS,
      default: DEFAULT_LIKELIHOOD,
      label: likelihoodLabel,
      send: true,
    },
    check({ input }) {
      if (!input) return 'Ask a question: /oracle(likely) Is the door locked?'
    },
    // No detail of its own: the odds it was asked at are in `param`, and one
    // copy of a fact is easier to keep true than two.
    preview: ({ input }) => ({ label: input }),
    async run({ input, param }) {
      const answer = await executeOracle({ question: input, likelihood: param })
      if (typeof answer !== 'string') return answer

      return { label: input, result: answer }
    },
  },

  roll: {
    usage: '/roll <dice>',
    description: 'Roll dice, like 3d6+2.',
    repeatable: true,
    check({ input }) {
      const notation = parseDice(input)
      if ('error' in notation) return notation.error
    },
    preview: ({ input }) => ({ label: input }),
    async run({ input }) {
      const rolled = rollDice(input)
      if ('error' in rolled) return rolled

      // The total is the answer and the dice are the working, split the way the
      // oracle splits its own: the fiction can use "13", and a model shown the
      // three dice that made it narrates the three dice.
      return { label: rolled.notation, detail: diceWorking(rolled), result: String(rolled.total) }
    },
  },

  'roll-table': {
    usage: '/roll-table "<option>" "<option>" ...',
    description: 'Pick one of the options you list, at random.',
    repeatable: true,
    check({ input }) {
      const table = parseTable(input)
      if ('error' in table) return table.error
    },
    preview: ({ input }) => ({ label: tableLabel(input) }),
    async run({ input }) {
      const table = parseTable(input)
      if ('error' in table) return table

      // The same roll the model makes on a table it improvises, and the same
      // split as the dice: the table is the question and the entry is the
      // answer. Which entry it was, counted down the table, is the working,
      // and the writer can see that for themselves.
      const rolled = await executeRollTable({ options: table.options })
      if (typeof rolled.result !== 'string') {
        return { error: rolled.error || 'Nothing came up.' }
      }

      return { label: tableLabel(input), result: rolled.result }
    },
  },

  tarot: {
    usage: '/tarot(<how many>, <deck>) [question]',
    description: 'Draw tarot cards, with or without a question.',
    repeatable: true,
    // No default: the record keeps what the writer asked for, and a draw they
    // asked nothing about reads as a draw rather than as "3 cards".
    param: { name: 'cards and deck', label: describeTarotAsk },
    check({ param }) {
      const asked = parseTarotAsk(param)
      if ('error' in asked) return asked.error
    },
    preview: ({ input }) => (input ? { label: input } : {}),
    async run({ input, param }) {
      const asked = parseTarotAsk(param)
      if ('error' in asked) return asked

      // The same draw the model makes with `draw_tarot`. The question is
      // optional: a draw with nothing asked is a reading of the scene as it
      // stands. The cards go where the oracle's answer goes — what the writer
      // drew is a fact about the turn they are taking — and they are quoted so
      // a name with spaces in it stays one card.
      const cards = await executeDrawTarot(asked)
      if (!Array.isArray(cards)) return cards

      return {
        ...(input ? { label: input } : {}),
        result: cards.map(card => `"${card}"`).join(' '),
      }
    },
  },
}

/**
 * The command a skill the writer can call is typed as: `/interpret`, `/write`,
 * `/compact`. Everything about it follows from the skill — where its answer
 * goes most of all — so a skill gets its command by being in the registry.
 *
 * Whatever the skill is, running it is the skill itself, not a second copy of
 * it: `/interpret` makes the same draw the model's call does, and reads it
 * against the same story. What differs is only who asked, and where the answer
 * lands.
 *
 * - **result**: a record in the writer's turn, labelled with what they asked,
 *   the way the oracle's answer is. An answer the writer asked for is theirs
 *   to bring to the turn, whatever answered it.
 * - **reply**: a message of its own, because a scene is not a piece of the
 *   writer's turn. What was asked sits beside it for the writer and is never
 *   sent: the model reads a draft the writer asked for, the way it reads a
 *   summary, and what was asked is in their next line if it matters. Write's
 *   record is tagged `draft`, which is its word for what it makes; a skill of
 *   the writer's is tagged with its own name, since not everything written as
 *   the reply is a draft.
 * - **summary**: a message of its own, standing in for the conversation above
 *   it, with the count of turns it sits above in its parentheses.
 *
 * A skill that joins the conversation rather than running on its own is a
 * saved prompt when the writer calls it; see `savedPrompt`. One whose answer
 * is an edit has no command: its answer belongs in a document, not in a turn.
 *
 * @param {import('./skills/index.js').Skill} skill - One the writer can call
 * @returns {CommandDefinition|null}
 */
function skillCommand(skill) {
  if (!skill.fork) return savedPrompt(skill)

  const ask = skill.ask
  if (!ask) return null

  const summary = skill.output === 'summary'
  const hint = skill.argumentHint ? ` ${skill.argumentHint}` : ''
  const needs = needsItsArgument(skill)

  const shared = {
    usage: `/${skill.name}${summary ? '(<turns to keep>)' : ''}${hint}`,
    description: skill.summary,
    consults: true,
    repeatable: true,
  }

  if (summary) {
    return {
      ...shared,
      tag: 'summary',
      ownTurn: true,
      param: { name: 'turns to keep' },
      check(asked) {
        const { param } = asked
        if (parseKeep(param) === null) {
          return `Turns to keep has to be a whole number, and "${param}" is not one.`
        }
        return needs(asked)
      },
      preview: ({ input, param }) => compactNote(input, parseKeep(param)),
      async run({ input, param }, context = {}) {
        const kept = parseKeep(param)
        const outcome = await ask(input, context, { past: kept ?? undefined })
        if ('error' in outcome) return outcome

        return { ...compactNote(input, kept), result: outcome.answer }
      },
    }
  }

  if (skill.output === 'reply') {
    return {
      ...shared,
      ...(skill.builtIn ? { tag: 'draft' } : {}),
      ownTurn: true,
      check: needs,
      preview: ({ input }) => ({ detail: input }),
      async run({ input }, context = {}) {
        const outcome = await ask(input, context)
        if ('error' in outcome) return outcome

        return { detail: input, result: outcome.answer }
      },
    }
  }

  if (skill.output === 'result') {
    return {
      ...shared,
      check: needs,
      preview: ({ input }) => ({ label: input }),
      async run({ input }, context = {}) {
        const outcome = await ask(input, context)
        if ('error' in outcome) return outcome

        return { label: input, result: outcome.answer }
      },
    }
  }

  return null
}

/**
 * What a skill with a named argument says when it is called with nothing after
 * its name. A named argument is required.
 *
 * @param {import('./skills/index.js').Skill} skill
 * @returns {(asked: CommandInput) => string|undefined}
 */
function needsItsArgument(skill) {
  return ({ input }) => {
    if (skill.argument && !input) return `/${skill.name} needs something to go on.`
  }
}

/**
 * A skill the writer calls that joins the conversation rather than running on
 * its own: `/tighten the fight scene`. A prompt they saved.
 *
 * Nothing runs. Its instructions — a profile's rewording, when there is one —
 * with what they typed put in, are the record's answer, which is what the
 * model reads, under the skill's name. What they typed sits beside it for them.
 *
 * It asks for a reply, where a roll does not: it is the writer saying
 * something, the way a character's line is. It is never asked again, because
 * nothing about it was drawn, and an edit fills it in again from the skill as
 * it is now rather than keeping the old text — the rule `/director` follows
 * for the same reason.
 *
 * One the model could load too is loaded by this, the same as if the model
 * had: `load` on the record says so, and the chat keeps it the way it keeps
 * the model's loads — under a summary, in the list of what is loaded, until
 * the writer drops it. See ai/skills/loads.js.
 *
 * @param {import('./skills/index.js').Skill} skill
 * @returns {CommandDefinition}
 */
function savedPrompt(skill) {
  return {
    usage: `/${skill.name}${skill.argumentHint ? ` ${skill.argumentHint}` : ''}`,
    description: skill.summary,
    speaks: true,
    derived: true,
    check: needsItsArgument(skill),
    preview: ({ input }) => (input ? { detail: input } : {}),
    async run({ input }, context = {}) {
      const base = context.promptFor?.(skill.name) || skill.body
      return {
        prompt: /** @type {const} */ (true),
        ...(loadedByModel(skill) ? { load: /** @type {const} */ (true) } : {}),
        ...(input ? { detail: input } : {}),
        result: fillArgument(base, skill.argument, input),
      }
    },
  }
}

/**
 * Every command there is: the ones written here, and one for each skill the
 * writer can call. A written command keeps its name if a skill has the same
 * one — `/director` is the writer's own direction, and the Director skill is
 * the model's to ask.
 *
 * The skills' part is made again whenever the writer's library changes, in
 * place, so everything holding this table sees the change.
 *
 * @type {Record<string, CommandDefinition>}
 */
export const COMMANDS = { ...WRITTEN }

/** The commands the skills gave, as last made. */
let fromSkills = /** @type {string[]} */ ([])

function makeSkillCommands() {
  for (const name of fromSkills) delete COMMANDS[name]
  fromSkills = []

  for (const skill of allSkills()) {
    if (!skill.user || skill.name in COMMANDS) continue
    const command = skillCommand(skill)
    if (!command) continue
    COMMANDS[skill.name] = command
    fromSkills.push(skill.name)
  }
}

makeSkillCommands()
onSkillsChanged(makeSkillCommands)

/**
 * A prompt a connected server offers, as a command: `/glossary:outline the
 * lighthouse`. Like a saved prompt, its text goes into the writer's turn
 * under its name, and the model answers it. Unlike one, the server writes the
 * text when it is asked, and can put its own things in it — an issue's
 * description, a template it keeps — so it is fetched afresh every time, an
 * edit included.
 *
 * What was typed after the name fills the argument the prompt needs; a
 * prompt that takes none gets it after its text, as a saved prompt does.
 *
 * @param {import('../mcp/servers.js').PromptCommand} made
 * @returns {CommandDefinition}
 */
function serverPromptCommand({ name, server, prompt, argument }) {
  const required = argument?.required === true
  return {
    usage: `/${name}${argument ? ` <${argument.name}>` : ''}`,
    description: prompt.description || prompt.title || `A prompt from ${server.name}.`,
    speaks: true,
    derived: true,
    check: ({ input }) =>
      required && !input ? `/${name} needs its ${argument?.name}.` : undefined,
    preview: ({ input }) => (input ? { detail: input } : {}),
    async run({ input }) {
      const live = getServer(server.id)
      if (!live) return { error: `${server.name} is no longer connected.` }
      const said = (input || '').trim()
      try {
        const answer = await getServerPrompt(
          live,
          prompt.name,
          argument && said ? { [argument.name]: said } : {}
        )
        const text = promptText(answer)
        if (!text) return { error: `${server.name} sent the prompt back empty.` }
        return {
          prompt: /** @type {const} */ (true),
          ...(said ? { detail: said } : {}),
          result: argument || !said ? text : `${text}\n\nARGUMENTS: ${said}`,
        }
      } catch (error) {
        return { error: describeFailure(error) }
      }
    },
  }
}

/** The commands the servers' prompts gave, as last made. */
let fromServers = /** @type {string[]} */ ([])

function makeServerCommands() {
  for (const name of fromServers) delete COMMANDS[name]
  fromServers = []

  for (const made of promptCommands()) {
    if (made.name in COMMANDS) continue
    COMMANDS[made.name] = serverPromptCommand(made)
    fromServers.push(made.name)
  }
}

makeServerCommands()
onServersChanged(makeServerCommands)

/**
 * Everyone else at the table.
 *
 * `@emily` is a character, and there is no list of them to check against — a
 * game gets played for an hour before anybody writes a character note, and half
 * of them never get one. So the writer says who is speaking and that is who is
 * speaking.
 *
 * The sigil is what makes that free. `@` is a person and `/` is an instruction
 * to the application, which is what both already mean everywhere else, and it
 * leaves `/` a closed set — so a mistyped `/directr` is still a complaint
 * naming what there is, rather than a character called directr.
 *
 * Nothing is inferred and nothing is rolled. It is the writer's turn, said in
 * somebody's voice: `<cody>` around what they did, the same way everything else
 * here is tagged with whatever it came from.
 *
 * @type {CommandDefinition}
 */
const CHARACTER = {
  usage: '@<name> <what they say or do>',
  description: 'Say what somebody in the scene says or does.',
  check({ name, input }) {
    if (!input) return `Say what ${name} says or does.`
  },
  async run({ input }) {
    return { result: input }
  },
}

/** What there is, for the error when the writer asks for something else. */
function unknownCommand(name) {
  const known = listCommands()
    .map(each => `/${each.name}`)
    .join(', ')
  return `No command called /${name}. There is ${known} — and @${name} if ${name} is a person.`
}

/**
 * A command as the `/` menu lists it.
 *
 * @typedef {Object} CommandEntry
 * @property {string} name - What follows the slash
 * @property {string} usage - How to type it, name and all
 * @property {string} description - What it does, in a line
 * @property {boolean} consults - Whether it calls the model, and so takes
 *   seconds where the rest take none
 * @property {boolean} takesParam - Whether it has a setting in parentheses.
 *   Completing one stops at the name, so the writer can open them or not.
 */

/**
 * Every command the writer can type, in alphabetical order, for the menu.
 *
 * Only the `/` ones. `@` has no list to offer, for the reason there is none to
 * check a name against: most of the cast never gets a note.
 *
 * @returns {CommandEntry[]}
 */
export function listCommands() {
  return Object.entries(COMMANDS)
    .map(([name, command]) => ({
      name,
      usage: command.usage,
      description: command.description,
      consults: Boolean(command.consults),
      takesParam: Boolean(command.param),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The commands a partly typed name could be finishing: those that start with
 * it, then those with a later word that does, so `table` still finds
 * `/roll-table`. Only the start of a word, because a letter found anywhere is
 * found in most of them. Matched however it is capitalised, as the commands
 * are.
 *
 * @param {string} typed - The name so far, without its slash
 * @returns {CommandEntry[]}
 */
export function matchCommands(typed) {
  const query = (typed || '').toLowerCase()
  const all = listCommands()
  const starts = all.filter(entry => entry.name.startsWith(query))
  // A server's prompt is a later word too: `outline` finds `glossary:outline`.
  const later = all.filter(
    entry =>
      !entry.name.startsWith(query) &&
      (entry.name.includes(`-${query}`) || entry.name.includes(`:${query}`))
  )
  return [...starts, ...later]
}

/**
 * A line typed so far, up to the caret, that is still the name of a command:
 * a slash at the start of it, perhaps after some space, and the name's own
 * characters since. The name's characters are `COMMAND_LINE`'s.
 */
const TYPING_NAME = /^(\s*)\/([A-Za-z][\w'-]*(?::[\w'-]*)?)?$/

/**
 * The command name the caret is in, if it is in one.
 *
 * A command is a line, so only a slash at the start of one counts: a slash in
 * the middle of a sentence is punctuation. `start` is the slash, and `end` is
 * where the name stops, which can be past the caret — completing a name the
 * caret is inside replaces all of it rather than leaving its tail.
 *
 * @param {string} text - The whole draft
 * @param {number} caret - Where the caret is in it
 * @returns {{start: number, end: number, typed: string}|null}
 */
export function commandAtCaret(text, caret) {
  const draft = text || ''
  if (caret < 0 || caret > draft.length) return null

  const lineStart = draft.lastIndexOf('\n', caret - 1) + 1
  const match = TYPING_NAME.exec(draft.slice(lineStart, caret))
  if (!match) return null

  const rest = /^[\w':-]*/.exec(draft.slice(caret))?.[0] || ''
  return {
    start: lineStart + match[1].length,
    end: caret + rest.length,
    typed: match[2] || '',
  }
}

/**
 * What answers to this, or null if nothing does.
 *
 * The sigil decides, not the name. A command is matched however it was
 * capitalised, because there is one `/oracle` and shouting at it should still
 * roll; `@oracle` is somebody called Oracle, which is a perfectly good name for
 * somebody in the kind of story that has an oracle in it.
 *
 * @param {{name: string, character?: boolean}} command
 * @returns {CommandDefinition|null}
 */
function definitionFor(command) {
  if (command.character) return CHARACTER
  return COMMANDS[command.name.toLowerCase()] || null
}

/**
 * A sigil, a name, an optional parenthesised setting, and the rest of the line.
 *
 * Apostrophes and hyphens are in the name because names have them, and a line
 * that comes back as a character called `o` is worse than no character at all.
 * A colon joins a server to one of its prompts (`/glossary:outline`); a
 * character is never named that way, so `@Vivi:hi` is Vivi saying `:hi`.
 */
const COMMAND_LINE = /^([/@])([A-Za-z][\w'-]*(?::[A-Za-z][\w'-]*)?)(?:\(([^)]*)\))?\s*([\s\S]*)$/

/**
 * Split a typed line into a command and what it was given.
 *
 * The input is taken whole and unquoted, newlines included — `splitInput` hands
 * this one line at a time, but an edited command is one command and can be a
 * paragraph. Anything not a command is not this module's business and comes
 * back null, so the caller can send it as the message it is.
 *
 * @param {string} input - What the writer typed
 * @returns {CommandInput|null}
 */
export function parseCommand(input) {
  const match = COMMAND_LINE.exec((input || '').trim())
  if (!match) return null

  const [, sigil, name, param, said] = match
  // Only a command's name has a colon in it: a character's ends there, and
  // the rest is what they said.
  if (sigil === '@' && name.includes(':')) {
    const character = name.slice(0, name.indexOf(':'))
    return {
      name: character,
      character: /** @type {const} */ (true),
      input: input
        .trim()
        .slice(1 + character.length)
        .trim(),
    }
  }
  return {
    // As typed. A command's name is canonicalised where it is looked up; a
    // character's is theirs, and Mrs-Hale is not mrs-hale.
    name,
    ...(sigil === '@' ? { character: /** @type {const} */ (true) } : {}),
    ...(param?.trim() ? { param: param.trim() } : {}),
    input: said.trim(),
  }
}

/**
 * The line that would ask this again.
 *
 * The inverse of `parseCommand`, for putting a command back in front of the
 * writer to edit. A record holds what was asked rather than the keystrokes that
 * asked it, so this is what a stored command looks like written down.
 *
 * @param {CommandInput} asked
 * @returns {string}
 */
export function formatCommand({ name, param, input, character }) {
  const sigil = character ? '@' : '/'
  return `${sigil}${name}${param ? `(${param})` : ''}${input ? ` ${input}` : ''}`
}

/** An answer written under the command it answers. */
const ANSWER_LINE = /^>[ \t]?(.*)$/

/**
 * Write a piece of a turn as the writer would type it.
 *
 * A command, and beneath it the answer it got — which is what makes the text
 * form of a turn lossless enough to edit. Two identical questions are told
 * apart by the answers written under them, which no amount of matching them up
 * afterwards could manage.
 *
 * Nothing is written under a command whose answer is the thing it was given:
 * a direction and a character's line would only be saying it twice.
 *
 * @param {import('../types/models.js').MessageSegment} segment
 * @returns {string}
 */
export function formatSegment(segment) {
  if (segment.type !== 'command') return segment.content

  const { command } = segment
  const line = formatCommand(command)
  if (!command.result || command.result === command.input) return line
  // Nor under one whose answer is only ever what it was given, filled in: an
  // edit fills it in again from what the line says now.
  if (!command.character && definitionFor(command)?.derived) return line

  return [line, ...command.result.split('\n').map(said => `> ${said}`)].join('\n')
}

/**
 * A whole turn as the writer would type it, for putting it back in front of
 * them to change.
 *
 * @param {import('../types/models.js').MessageSegment[]} segments
 * @returns {string}
 */
export function formatTurn(segments) {
  return (segments || []).map(formatSegment).join('\n')
}

/**
 * A message that is one command and its answer, as the writer would type it:
 * the command on its first line, and the answer under it as it reads.
 *
 * Not quoted, as a piece of a turn's answer is. A turn mixes commands with
 * prose, and the quotes are what say which lines answer which command; a
 * summary or a draft is one command and nothing else, so everything under it
 * is its answer. And it is the one answer a writer rewrites whole — a summary
 * put right in another window and pasted back — which a `> ` on every line
 * would make them write out again.
 *
 * @param {ChatCommand} command
 * @returns {string}
 */
export function formatAnswered(command) {
  const line = formatCommand(command)
  const answer = formatSegment({ type: 'command', command }) === line ? '' : command.result
  return answer ? `${line}\n\n${answer}` : line
}

/**
 * Read back what `formatAnswered` wrote, once the writer has been at it.
 *
 * The first line is the command and everything under it is the answer, as
 * written. An answer quoted the way a turn's are, line by line, is taken out
 * of its quotes, because that is how these were written before and how a
 * writer used to them may still write one. Nothing under the command is no
 * answer, which asks it again.
 *
 * @param {string} text
 * @returns {Array<{type: 'text', content: string}|({type: 'command'} & CommandInput & {result?: string})>}
 *   The command alone, or what `splitInput` makes of text that does not open
 *   with one, for the caller to refuse
 */
export function splitAnswered(text) {
  const [first, ...rest] = (text || '').trim().split('\n')
  const parsed = parseCommand(first)
  if (!parsed) return splitInput(text)

  let lines = rest
  const written = lines.filter(line => line.trim())
  if (written.length > 0 && written.every(line => ANSWER_LINE.test(line))) {
    lines = lines.map(line => ANSWER_LINE.exec(line)?.[1] ?? line)
  }

  const answer = lines.join('\n').trim()
  return [{ type: 'command', ...parsed, ...(answer ? { result: answer } : {}) }]
}

/**
 * Break a submission into the things it is, in the order they were written.
 *
 * A turn is a sequence the writer orders, and the order carries meaning: the
 * character opens the fridge, the oracle says whether there is anything in it,
 * and the Director is told to narrate her disappointment — each about what came
 * before. A whole-message test for a leading slash can only put one command
 * first, so every line is judged on its own, and runs of ordinary lines stay
 * together as the paragraphs they are. Order is the whole point and is
 * preserved.
 *
 * A command may be written with its answer under it, which is how an edited
 * turn keeps the answers it already had — and how the writer overrules one.
 *
 * @param {string} input - Everything the writer submitted
 * @returns {Array<{type: 'text', content: string}|({type: 'command'} & CommandInput & {result?: string})>}
 */
export function splitInput(input) {
  /** @type {Array<{type: 'text', content: string}|({type: 'command'} & CommandInput & {result?: string})>} */
  const segments = []
  /** @type {string[]} */
  let said = []

  const flush = () => {
    const content = said.join('\n').trim()
    if (content) segments.push({ type: /** @type {const} */ ('text'), content })
    said = []
  }

  for (const line of (input || '').split('\n')) {
    // An answer belongs to the command directly above it. Anywhere else a line
    // opening with `>` is a blockquote, which is prose.
    const answer = ANSWER_LINE.exec(line)
    const open = segments[segments.length - 1]
    if (answer && said.length === 0 && open?.type === 'command') {
      open.result = open.result === undefined ? answer[1] : `${open.result}\n${answer[1]}`
      continue
    }

    const parsed = parseCommand(line)
    if (!parsed) {
      said.push(line)
      continue
    }
    flush()
    segments.push({ type: /** @type {const} */ ('command'), ...parsed })
  }

  flush()
  return segments
}

/**
 * The command as it will actually run: what the writer put in the parentheses,
 * or what the command means when they leave them off.
 *
 * @param {CommandDefinition} command
 * @param {CommandInput} parsed
 * @returns {CommandInput}
 */
function withParam(command, { name, input, param, character }) {
  const value = param || command.param?.default
  return {
    name,
    input,
    ...(character ? { character: /** @type {const} */ (true) } : {}),
    ...(value ? { param: value } : {}),
  }
}

/**
 * What is wrong with the parentheses, if anything.
 *
 * @param {CommandDefinition} command
 * @param {CommandInput} parsed
 * @returns {string|undefined}
 */
function checkParam(command, { name, param }) {
  if (!param) return
  if (!command.param) return `/${name} takes nothing in parentheses.`

  const { name: what, values } = command.param
  if (values && !values.includes(param)) {
    return `Unknown ${what} "${param}". Use one of: ${values.join(', ')}.`
  }
}

/**
 * Run a parsed command and return the record of it.
 *
 * What was asked is kept as the writer put it rather than as the command made
 * use of it, because a rerun has to ask the same question — and because what
 * the writer typed is the only thing that is still true if a command's
 * arguments change shape later.
 *
 * @param {CommandInput} parsed
 * @param {ToolContext} [context] - What a consulting command needs to
 *   reach a model. Supplied by whoever is running the chat, the same way a
 *   skill's is — see ai/tools/registry.js.
 * @returns {Promise<ChatCommand|{error: string}>}
 */
export async function runCommand(parsed, context = {}) {
  const { asked, error } = inspectCommand(parsed)
  if (error) return { error }

  const command = definitionFor(asked)
  const outcome = await command.run(asked, context)
  if ('error' in outcome) return { error: `${outcome.error}\n${command.usage}` }

  return { ...asked, ...outcome }
}

/**
 * The command as the model should read it: what was asked, and what came back.
 *
 * Tagged with the command's own name, so a run of them reads as a run of
 * answers rather than as the writer saying several things at once — and so the
 * model can tell which words are the fiction's and which are the writer's.
 *
 * @param {ChatCommand} command
 * @returns {string}
 */
export function renderCommand(command) {
  const body = [command.label, command.result].filter(Boolean).join('\n')
  const tag = commandTag(command)
  return `<${tag}${saidUnder(command)}>\n${body}\n</${tag}>`
}

/**
 * What the tag says about the question besides asking it.
 *
 * The likelihood, and only when the writer named one. It is not the working —
 * the die and the target are, and they stay out — it is what the writer thought
 * of the odds before they rolled, which is a fact about the world and changes
 * what the answer means. A door that was unlikely to be unlocked and is reads
 * as a piece of luck; the same answer at even odds reads as nothing at all.
 *
 * The values are an enum the parameter checked, so there is nothing here that
 * needs escaping.
 *
 * @param {ChatCommand} command
 * @returns {string}
 */
function saidUnder(command) {
  const spec = definitionFor(command)?.param
  if (!spec?.send || !command.param || command.param === spec.default) return ''
  return ` ${spec.name}="${command.param}"`
}

/**
 * What a command's answer is called, which is not always the command's name.
 *
 * `/compact` is an instruction; what lands in the conversation is a summary,
 * and that is what both the model and the reader should see it as. A character
 * is only ever called what they are called.
 *
 * @param {{name: string, character?: boolean}} command
 * @returns {string}
 */
export function commandTag(command) {
  const named = command.character ? null : COMMANDS[command.name.toLowerCase()]?.tag
  return named || command.name
}

/**
 * The working, as the writer should read it.
 *
 * A parameter that says how to name its values is the truth about what was
 * asked — the record keeps the value the tool wanted, and this is what to put
 * on screen. A compaction shows what it was told to favour. Everything else has
 * already written its own note: the dice a roll threw.
 *
 * @param {ChatCommand} command
 * @returns {string}
 */
export function commandDetail(command) {
  const definition = definitionFor(command)
  // What it was told to favour, and nothing about how much it kept: records
  // from before say that in their detail too.
  if (definition?.tag === 'summary') return (command.input || '').trim()
  const spec = definition?.param
  if (spec?.label && command.param) return spec.label(command.param)
  return command.detail || ''
}

/**
 * Whether this record is somebody rather than something.
 *
 * Read off the record rather than worked out from the name, because the name is
 * not enough to work it out from: `@oracle` is a character, and a command added
 * later must not turn a record written today into something it never was.
 *
 * @param {{name: string, character?: boolean}} command
 * @returns {boolean}
 */
export function commandIsCharacter(command) {
  return command.character === true
}

/**
 * Whether this record is the writer saying something, and so asks for a reply:
 * a character's line, or a saved prompt. A roll, an oracle, a direction settle
 * something before there is a turn to take, and ask for nothing.
 *
 * @param {{name: string, character?: boolean}} command
 * @returns {boolean}
 */
export function commandSpeaks(command) {
  return (
    commandIsCharacter(command) ||
    commandIsPrompt(command) ||
    definitionFor(command)?.speaks === true
  )
}

/**
 * Whether this record is a saved prompt: a skill's instructions, filled in,
 * as the writer's words. Read off the record, like a character, so it still
 * is one after its skill has gone.
 *
 * @param {{name: string, prompt?: boolean}} command
 * @returns {boolean}
 */
export function commandIsPrompt(command) {
  return command.prompt === true
}

/**
 * Whether running this costs a model call, and so whose turn it lands in.
 *
 * @param {{name: string, character?: boolean}} command
 * @returns {boolean}
 */
export function commandConsults(command) {
  return definitionFor(command)?.consults === true
}

/**
 * Whether this answer is a message rather than a piece of the writer's turn.
 *
 * See `ownTurn`. Nearly everything answers into the turn that asked, including
 * the one command that reaches a model to do it — where the answer came from is
 * not the same question as whose turn it is.
 *
 * @param {{name: string, character?: boolean}} command
 * @returns {boolean}
 */
export function commandTakesTurn(command) {
  return definitionFor(command)?.ownTurn === true
}

/**
 * A turn's segments as the one message they are.
 *
 * The joining `mergeAdjacentTurns` used to do on the wire, done once when the
 * turn is written instead — which is what lets a message hold the pieces the
 * writer made it out of and still be the single thing the model reads. A
 * command that answered nothing and asked nothing contributes nothing, the same
 * rule expandMessage follows.
 *
 * @param {import('../types/models.js').MessageSegment[]} segments
 * @returns {string}
 */
export function assembleTurn(segments) {
  return (segments || [])
    .map(segment => {
      if (segment.type !== 'command') return segment.content
      const { label, result } = segment.command
      return label || result ? renderCommand(segment.command) : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

/**
 * What can be said about a command before running it.
 *
 * For the caller that has to decide whether a message can be written yet. A
 * command that consults is written before it has an answer, so this is the
 * last point at which refusing it costs nothing.
 *
 * @param {CommandInput} parsed
 * @returns {{consults: boolean, repeatable: boolean, asked: CommandInput, label?: string, detail?: string, keep?: number, error?: string}}
 */
export function inspectCommand(parsed) {
  const command = definitionFor(parsed)
  if (!command) {
    return {
      consults: false,
      repeatable: false,
      asked: parsed,
      error: unknownCommand(parsed.name),
    }
  }

  // A command's name is stored the one way it is spelled, so a record of one
  // reads back the same however it was typed. A character keeps their own.
  const asked = withParam(command, {
    ...parsed,
    name: parsed.character ? parsed.name : parsed.name.toLowerCase(),
  })
  const shape = {
    consults: command.consults === true,
    repeatable: command.repeatable === true,
    asked,
  }

  const wrong = checkParam(command, parsed) || command.check?.(asked)
  if (wrong) return { ...shape, error: `${wrong}\n${command.usage}` }

  return { ...shape, ...command.preview?.(asked) }
}

/**
 * A command with its question and no answer: what it was, asked.
 *
 * The state a consulting command is in twice — while it runs, and if it fails.
 * The question is what both have to keep, since it is the part the writer wrote
 * and the part they would have to retype.
 *
 * @param {CommandInput} parsed
 * @returns {ChatCommand}
 */
export function askedCommand(parsed) {
  const { asked, label, detail, keep } = inspectCommand(parsed)
  return {
    ...asked,
    ...(label ? { label } : {}),
    ...(detail ? { detail } : {}),
    ...(keep === undefined ? {} : { keep }),
    result: '',
  }
}

/**
 * A command that is still being answered.
 *
 * @param {CommandInput} parsed
 * @returns {ChatCommand}
 */
export function pendingCommand(parsed) {
  return { ...askedCommand(parsed), pending: true }
}

/**
 * Whether this answer wants the room a paragraph needs.
 *
 * The oracle's answer is one of four words and a direction is a sentence, and
 * both read as what they are on a line of their own. An interpretation and a
 * character's turn are prose, and prose wants the shape a message has.
 *
 * For the ones that consult it goes further: they are stored as the assistant
 * turns they are, holding the answer as their content and nothing else,
 * streamed in as the model writes it and tagged only on the way to the wire.
 * What that buys is everything an assistant turn already had — the text
 * arriving as it is written rather than landing whole after a wait with no sign
 * of progress. See composables/useChatCommands.js.
 *
 * @param {{name: string, character?: boolean}} command
 * @returns {boolean}
 */
export function commandWritesProse(command) {
  return commandIsCharacter(command) || commandConsults(command)
}

/**
 * What a piece of a turn reads as, in the chat: a text piece's words, or the
 * prose a command answered with. A die or a table answers in a box of its own,
 * not in prose, and reads as nothing here.
 *
 * @param {import('../types/models.js').MessageSegment} segment
 * @returns {string}
 */
export function segmentProse(segment) {
  if (segment.type === 'text') return segment.content
  return commandWritesProse(segment.command) ? segment.command.result || '' : ''
}

/**
 * What the record of an answer that has not arrived yet looks like, on its way
 * into a turn: the question, and room for the rest.
 *
 * @param {CommandInput} parsed
 * @returns {import('../types/models.js').MessageSegment}
 */
export function pendingSegment(parsed) {
  return { type: 'command', command: pendingCommand(parsed) }
}

/**
 * Whether asking this again could answer differently.
 *
 * Dice and inference: the commands worth offering a retry on, and the ones an
 * edit leaves answered rather than quietly asking again. See the `repeatable`
 * flag above.
 *
 * @param {{name: string, character?: boolean}} command
 * @returns {boolean}
 */
export function commandRepeatable(command) {
  return definitionFor(command)?.repeatable === true
}
