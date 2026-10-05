/**
 * AI Module
 *
 * Provides the AI context builder, the request format providers are spoken to
 * in, prompt defaults, provider routing, compaction (what a conversation reads
 * as once it has outgrown its window — see ./compaction.js), what the model
 * has read of the project and what of it has changed since (./context/reads.js),
 * and the tool registry for the InkSprite chat and summarize features.
 *
 * @module ai
 */

export { buildContext } from './context/build.js'
export { buildCompletionBody, toWireMessages } from './wire.js'
