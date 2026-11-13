/**
 * @module ai/tools/dice
 * @description The model's dice: `roll_dice`, the same roll as the writer's
 * `/roll`, read the same way. It answers with the roll itself — its working,
 * the dice by kind, those that count if any were dropped, and the total — where
 * `/roll` writes the same working as lines in the writer's turn. See
 * `DiceRoll` and `workingOf` in ./rpg.js.
 *
 * `min()` and `max()` still roll, but the description leaves them out, so the
 * model has one way to write advantage.
 */

import { rollDice, workingOf, workingText } from './rpg.js'

/**
 * Tool definition in OpenAI format
 * @type {import('./registry.js').ToolDefinition}
 */
export const diceToolDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'roll_dice',
    description:
      'Roll dice using standard dice notation. Use this when asked to roll dice, make random checks, or determine random outcomes. Examples: "1d20" (roll one 20-sided die), "2d6+3" (roll two 6-sided dice and add 3), "4d6-1" (roll four 6-sided dice and subtract 1), "d20a+5" (advantage: roll two d20s, keep the higher, add 5), "3d6a" (an advantage die: roll four d6s, drop the lowest; this is how to write "4d6 drop the lowest"), "3d20b" (a burden die, or disadvantage: roll four d20s, drop the highest), "3d20a2" (two advantage dice: roll five d20s, drop the lowest two), "2d6-1d6" (one roll taken from another), "5d4*10" (multiplied), "8d6/2" (halved, rounding down), "3d6+1 * 2" (doubles all of 3d6+1). Answers with the working, a line of dice for each term with the dropped ones first and struck through like ~~1, 2~~, each die by kind, the dice that count if any were dropped, and the total.',
    parameters: {
      type: 'object',
      properties: {
        dice: {
          type: 'string',
          description:
            'Dice notation like "1d20", "2d6+3", "4d6-1", "2d6+1d4", "d20b+1", "3d6a2", "3d6+1 * 2". Dice and whole numbers, added, subtracted or multiplied, divided by a whole number, with brackets. Spaces group: what is written without spaces counts as one, so "3d6+1 * 2" doubles all of 3d6+1 and "3d6 + 1 * 2" only the 1. "a" or "b" after dice throws that many more and drops as many, "a" the lowest and "b" the highest; with no number, one. The number before "d" is how many dice are left after dropping, so "3d6a" throws four and "4d6a" throws five.',
        },
      },
      required: ['dice'],
    },
  },
}

/**
 * Execute the dice roll tool
 *
 * The working goes in beside the dice, for what the dice by kind can't say:
 * which term threw which.
 *
 * @param {{dice: string}} args - Tool arguments
 * @returns {Promise<import('./rpg.js').DiceRoll & {working?: string}|{error: string}>}
 */
export async function executeDiceTool(args) {
  const rolled = rollDice(args.dice)
  if ('error' in rolled) return rolled

  const { total, ...rest } = rolled
  const working = workingText(workingOf(rolled))
  return { ...rest, ...(working && { working }), total }
}
