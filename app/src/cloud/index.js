/**
 * @module cloud
 * @description Sync: the writer's projects, setup and card library kept in
 * step across their devices through a server of ours that can't read them.
 *
 * Each device keeps its own whole copy and works offline; the server keeps
 * every project as a collection of records it can't read, the setup as one
 * more, and answers what changed since a revision. A project can be shared
 * with friends by their friend codes, each one's chats in it their own. The
 * devices do everything that needs the content: encrypting it, merging what
 * two of them changed, and writing what came in where the app reads it. The
 * server is a program of its own, kept apart from the app.
 *
 * - **crypto** - The keys, made from the passphrase and at random, and what
 *   is sealed and hashed with them
 * - **account** - Making an account and signing a device in to one, and
 *   keeping it safe: the recovery code, a new passphrase
 * - **deviceName** - What a device calls itself in the account's list
 * - **api** - The server, as the device asks it
 * - **merge** - One row as two devices changed it, merged against the base
 * - **format** - What a synced row may hold, as a number beside its schema:
 *   a record of a newer one holds the pull until the app is updated
 * - **engine** - The rounds: the outbox sent, what others wrote brought in,
 *   the two merged, files' bytes in parts
 * - **local** - The app as the engine reaches it: the stores for what is
 *   loaded, storage for the rest
 * - **setup** - The writer's setup as sync sends it: which tables and
 *   settings, and what of them stays on the device
 * - **people** - Who is who, for sharing: this account, who is in each
 *   project shared, and whose a comment's post is
 *
 * `composables/useCloudSync` signs in and out and runs the rounds; Settings
 * › Sync and sharing is where the writer does it, always with
 * `sync.inksprite.io` but in a build with dev features (`config/dev.js`).
 *
 * Design: `.llm/sync_design.md`.
 */

export { createApi, CloudError } from './api.js'
export { signIn, signUp } from './account.js'
export { createEngine, SYNCED } from './engine.js'
export { mergeRow, mergeText } from './merge.js'
export { appLocal } from './local.js'
