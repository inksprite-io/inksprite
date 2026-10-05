/**
 * @module ai/tools/dice
 * @description Dice rolling tool for AI chat. Supports standard dice notation
 * like "1d20", "2d6+3", "4d6-1", etc.
 */

/**
 * Parse dice notation and return components
 * @param {string} notation - Dice notation (e.g., "1d20", "2d6+3")
 * @returns {{count: number, sides: number, modifier: number}|null} Parsed components or null if invalid
 */
export function parseDiceNotation(notation) {
  if (!notation || typeof notation !== 'string') {
    return null
  }

  // Normalize: lowercase, remove spaces
  const normalized = notation.toLowerCase().replace(/\s/g, '')

  // Match dice notation: [count]d<sides>[+/-modifier]
  const match = normalized.match(/^(\d*)d(\d+)([+-]\d+)?$/)

  if (!match) {
    return null
  }

  const count = match[1] ? parseInt(match[1], 10) : 1
  const sides = parseInt(match[2], 10)
  const modifier = match[3] ? parseInt(match[3], 10) : 0

  // Validate ranges
  if (count < 1 || count > 100) {
    return null
  }
  if (sides < 2 || sides > 1000) {
    return null
  }
  if (Math.abs(modifier) > 1000) {
    return null
  }

  return { count, sides, modifier }
}

/**
 * Roll dice based on parsed notation
 * @param {{count: number, sides: number, modifier: number}} parsed - Parsed dice notation
 * @returns {{total: number, rolls: number[], modifier: number}} Roll result
 */
export function rollDice(parsed) {
  const rolls = []

  for (let i = 0; i < parsed.count; i++) {
    rolls.push(Math.floor(Math.random() * parsed.sides) + 1)
  }

  const sum = rolls.reduce((a, b) => a + b, 0)
  const total = sum + parsed.modifier

  return {
    total,
    rolls,
    modifier: parsed.modifier,
  }
}

/**
 * Tool definition in OpenAI format
 * @type {import('./registry.js').ToolDefinition}
 */
export const diceToolDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'roll_dice',
    description:
      'Roll dice using standard dice notation. Use this when asked to roll dice, make random checks, or determine random outcomes. Examples: "1d20" (roll one 20-sided die), "2d6+3" (roll two 6-sided dice and add 3), "4d6-1" (roll four 6-sided dice and subtract 1).',
    parameters: {
      type: 'object',
      properties: {
        dice: {
          type: 'string',
          description:
            'Dice notation like "1d20", "2d6+3", "4d6-1". Format: [count]d<sides>[+/-modifier]',
        },
      },
      required: ['dice'],
    },
  },
}

/**
 * Execute the dice roll tool
 * @param {{dice: string}} args - Tool arguments
 * @returns {Promise<{total: number, rolls: number[], modifier: number, notation: string}|{error: string}>} Roll result
 */
export async function executeDiceTool(args) {
  const notation = args.dice

  const parsed = parseDiceNotation(notation)
  if (!parsed) {
    return {
      error: `Invalid dice notation: "${notation}". Use format like "1d20", "2d6+3", etc.`,
    }
  }

  const result = rollDice(parsed)
  return {
    ...result,
    notation,
  }
}
