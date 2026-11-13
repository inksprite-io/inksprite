/**
 * @module ai/recommended
 * @description The models the picker lists first, each with the routing it
 * runs best on: a short list kept here and updated with releases, not drawn
 * from OpenRouter's rankings, which aren't an API anyone promises.
 *
 * OpenRouter's "latest" aliases where there is one, so the list keeps up
 * with a family's new versions by itself. What a model's samplers start at
 * comes from OpenRouter's list (`defaults` in ai/models.js), not from here.
 *
 * Design: `.llm/ai_setup_design.md`, "Step 3: models".
 */

/**
 * @typedef {Object} RecommendedModel
 * @property {string} model - The model's id on the connection
 * @property {boolean} [free] - The one for an account that has never bought credits
 * @property {import('./routing.js').ModelUpstreams} [routing] - The upstreams
 *   it runs best on, which its settings start with
 */

/**
 * Recommended, by connection kind: OpenRouter's, and the same families on
 * NanoGPT, which routes them its own way.
 * @type {Readonly<Record<string, ReadonlyArray<RecommendedModel>>>}
 */
export const RECOMMENDED = Object.freeze({
  openrouter: Object.freeze([
    { model: '~anthropic/claude-sonnet-latest' },
    {
      // Served badly by its own maker's endpoint and by Alibaba's; best by
      // SiliconFlow and Novita, then anyone else inside the floor.
      model: 'z-ai/glm-5.2',
      routing: {
        allowedProviders: ['siliconflow', 'novita'],
        fallbacks: true,
        ignoredProviders: ['alibaba', 'z-ai'],
      },
    },
    { model: '~google/gemini-flash-latest' },
    { model: '~moonshotai/kimi-latest' },
    { model: '~deepseek/deepseek-pro-latest' },
    { model: 'google/gemma-4-31b-it:free', free: true },
  ]),
  nanogpt: Object.freeze([
    { model: 'anthropic/claude-sonnet-latest' },
    { model: 'z-ai/glm-latest' },
    { model: 'google/gemini-flash-latest' },
    { model: 'moonshotai/kimi-latest' },
    { model: 'deepseek/deepseek-latest' },
  ]),
})

/**
 * The recommended models of a connection kind.
 * @param {string|null|undefined} kindId
 * @returns {ReadonlyArray<RecommendedModel>}
 */
export function recommendedFor(kindId) {
  return (kindId && RECOMMENDED[kindId]) || []
}

/**
 * The routing a recommended model comes with, or undefined for any other.
 * @param {string|null|undefined} kindId
 * @param {string} model
 * @returns {import('./routing.js').ModelUpstreams|undefined}
 */
export function recommendedRouting(kindId, model) {
  return recommendedFor(kindId).find(entry => entry.model === model)?.routing
}
