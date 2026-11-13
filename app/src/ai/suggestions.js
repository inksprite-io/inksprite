/**
 * @module ai/suggestions
 * @description The model setup has picked already when the writer reaches a
 * connection's list: one that answers a chat well, and costs nothing where
 * the account hasn't paid for anything yet.
 *
 * Design: `.llm/ai_setup_design.md`, "Step 2: setup".
 */

import { recommendedFor } from './recommended.js'

/** @typedef {import('./models.js').AIModel} AIModel */

/** OpenRouter's alias for its newest Sonnet, which the Default preset runs on. */
export const SONNET = '~anthropic/claude-sonnet-latest'

/** NanoGPT's. */
const NANOGPT_SONNET = 'anthropic/claude-sonnet-latest'

/** OpenRouter's free models, best first, among those that call tools, after the recommended one. */
const FREE_FIRST = [/gemma/i, /glm/i, /deepseek/i, /qwen3/i, /nemotron/i]

/** OpenAI's, best first. */
const OPENAI_FIRST = ['gpt-5.1', 'gpt-5', 'gpt-4.1', 'gpt-4o']

/**
 * The newest of these, by the numbers in their ids.
 * @param {AIModel[]} models
 * @returns {AIModel|undefined}
 */
const newest = models =>
  [...models].sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))[0]

/**
 * The model to start a connection on, or null for one with none.
 *
 * - One model, as a server at home with one loaded: that one.
 * - OpenRouter: a free model that calls tools for an account that has never
 *   bought credits, and Sonnet for any other.
 * - NanoGPT, Anthropic: the newest Sonnet. OpenAI: the first of a short list
 *   here.
 * - Anything else: the first in its list.
 *
 * @param {string} kindId - The connection's kind (`ai/providers.js`)
 * @param {AIModel[]} models - What it serves
 * @param {{freeTier?: boolean}} [account] - OpenRouter: what its key said
 * @returns {string|null}
 */
export function suggestModel(kindId, models, { freeTier = false } = {}) {
  if (models.length === 0) return null
  if (models.length === 1) return models[0].id
  if (kindId === 'openrouter') {
    if (freeTier) {
      const free = models.filter(model => model.free)
      const calling = free.filter(model => model.traits?.tools === true)
      const pool = calling.length > 0 ? calling : free
      const recommended = recommendedFor(kindId).find(
        entry => entry.free && pool.some(model => model.id === entry.model)
      )
      if (recommended) return recommended.model
      const best = FREE_FIRST.map(name => pool.find(model => name.test(model.id))).find(Boolean)
      return (best ?? pool[0] ?? models[0]).id
    }
    const sonnet =
      models.find(model => model.id === SONNET) ??
      newest(models.filter(model => /^anthropic\/claude-sonnet/.test(model.id)))
    return (sonnet ?? models[0]).id
  }
  if (kindId === 'nanogpt') {
    const sonnet =
      models.find(model => model.id === NANOGPT_SONNET) ??
      newest(models.filter(model => /^anthropic\/claude-sonnet-[\d.]+$/.test(model.id)))
    return (sonnet ?? models[0]).id
  }
  if (kindId === 'anthropic') {
    return (newest(models.filter(model => /sonnet/.test(model.id))) ?? models[0]).id
  }
  if (kindId === 'openai') {
    const first = OPENAI_FIRST.map(id => models.find(model => model.id === id)).find(Boolean)
    return (first ?? models[0]).id
  }
  return models[0].id
}
