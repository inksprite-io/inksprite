/**
 * @module ai/tools/names
 * @description Generates plausible modern American names for NPCs.
 *
 * The pools are pre-filtered to one demographic slice (white / English) — see
 * ./data/names.js. Gender and count are the only inputs; widening that would
 * mean shipping more of the source data.
 *
 * Draws are weighted, so a scene full of generated NPCs reads like a real
 * roster — mostly familiar names with the occasional unusual one — rather than
 * a uniform sample where every name feels equally rare.
 */

import { FEMALE_FIRST_NAMES, MALE_FIRST_NAMES, SURNAMES } from './data/names.js'

/** @typedef {import('./registry.js').ToolDefinition} ToolDefinition */
/** @typedef {import('./data/names.js').WeightedName} WeightedName */

/** The two pools there are. See ./data/names.js for why there are two. */
export const GENDERS = ['female', 'male']

/** Enough for a tavern's worth of NPCs; past this the model is looping. */
export const MAX_NAMES = 25

/**
 * Draw one entry, weighted. Builds no lookup table: the pools are sorted by
 * descending weight, so the common names that dominate the mass are found in
 * the first handful of steps.
 *
 * @param {WeightedName[]} pool - [name, weight] pairs, heaviest first
 * @param {number} total - Sum of the pool's weights
 * @returns {string}
 */
function pickWeighted(pool, total) {
  let r = Math.random() * total
  for (const [name, weight] of pool) {
    r -= weight
    if (r < 0) return name
  }
  // Only reachable through floating-point drift at the very top of the range.
  return pool[pool.length - 1][0]
}

/** @param {WeightedName[]} pool */
const sumWeights = pool => pool.reduce((total, [, weight]) => total + weight, 0)

// Summed once per pool rather than per draw.
const TOTALS = {
  female: sumWeights(FEMALE_FIRST_NAMES),
  male: sumWeights(MALE_FIRST_NAMES),
  surname: sumWeights(SURNAMES),
}

/** @type {ToolDefinition} */
export const generateNamesDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'generate_names',
    description:
      'Generate plausible modern American names for NPCs. Draws are weighted by real-world frequency, so most results are ordinary and a few are unusual. Use this when you need a name and have no reason to prefer a particular one — it beats reaching for the same handful of names repeatedly.',
    parameters: {
      type: 'object',
      properties: {
        gender: {
          type: 'string',
          enum: GENDERS,
          description: 'Which first-name pool to draw from.',
        },
        count: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_NAMES,
          description: `How many names to generate (1-${MAX_NAMES}). Defaults to 1.`,
        },
      },
      required: ['gender'],
    },
  },
}

/**
 * @param {{ gender?: string, count?: number }} args
 * @returns {Promise<{names?: Array<{first: string, last: string, full: string}>, error?: string}>}
 */
export async function executeGenerateNames(args) {
  const gender = args?.gender
  if (!GENDERS.includes(gender)) {
    return { error: `generate_names needs a gender of: ${GENDERS.join(' or ')}.` }
  }

  const requested = args?.count === undefined ? 1 : Number(args.count)
  if (!Number.isInteger(requested) || requested < 1) {
    return { error: 'count must be a whole number of at least 1.' }
  }
  if (requested > MAX_NAMES) {
    return { error: `generate_names produces at most ${MAX_NAMES} names at a time.` }
  }

  const firstPool = gender === 'female' ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES

  const names = Array.from({ length: requested }, () => {
    const first = pickWeighted(firstPool, TOTALS[gender])
    const last = pickWeighted(SURNAMES, TOTALS.surname)
    return { first, last, full: `${first} ${last}` }
  })

  return { names }
}
