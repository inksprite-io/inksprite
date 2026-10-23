/**
 * AI Module
 *
 * Provides the AI context builder, the request format providers are spoken to
 * in (OpenAI's chat completions, and Anthropic's own API for Claude — see
 * ./anthropic.js), what each connection and model takes of the generation
 * settings (./capabilities.js, from the model lists in ./models.js), prompt
 * defaults, provider routing, compaction (what a conversation reads
 * as once it has outgrown its window — see ./compaction.js), asides (a
 * question and its answer left out of every request after them — see
 * ./asides.js), what the model
 * has read of the project and what of it has changed since (./context/reads.js),
 * how many requests each connection is asked at once and who goes first
 * (./gate.js), what a llama.cpp server says it has (./llamacpp.js), and the
 * tool registry for the inksprite chat and summarize features.
 *
 * @module ai
 */

export { buildContext } from './context/build.js'
export { buildCompletionBody, toWireMessages } from './wire.js'
