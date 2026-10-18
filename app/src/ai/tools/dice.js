/**
 * @module ai/tools/dice
 * @description The model's dice: `roll_dice`, the same roll as the writer's
 * `/roll`, read the same way. It answers with the roll itself — the dice by
 * kind, the modifier, and the total — where `/roll` writes the same dice as
 * lines in the writer's turn. See `DiceRoll` in ./rpg.js.
 */

import { rollDice } from './rpg.js'

/**
 * Tool definition in OpenAI format
 * @type {import('./registry.js').ToolDefinition}
 */
export const diceToolDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'roll_dice',
    description:
      'Roll dice using standard dice notation. Use this when asked to roll dice, make random checks, or determine random outcomes. Examples: "1d20" (roll one 20-sided die), "2d6+3" (roll two 6-sided dice and add 3), "4d6-1" (roll four 6-sided dice and subtract 1). Answers with each die by kind, the modifier, and the total.',
    parameters: {
      type: 'object',
      properties: {
        dice: {
          type: 'string',
          description:
            'Dice notation like "1d20", "2d6+3", "4d6-1", "2d6+1d4". Dice and whole numbers, added or subtracted.',
        },
      },
      required: ['dice'],
    },
  },
}

/**
 * Execute the dice roll tool
 * @param {{dice: string}} args - Tool arguments
 * @returns {Promise<import('./rpg.js').DiceRoll|{error: string}>}
 */
export async function executeDiceTool(args) {
  return rollDice(args.dice)
}
