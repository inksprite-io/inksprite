/**
 * @module cloud/setup
 * @description The writer's setup as sync sends it: the account's own
 * collection, beside each project's.
 *
 * It holds the rows of the app tables a setup is made of (connections with
 * their keys, presets, prompts, chat profiles, MCP servers, skills and their
 * wordings, web search) and the card library, and the settings kept outside
 * the database that a settings file carries, a group to a row. What is the
 * device's own stays out: Debug, Compact text, whether the spell checker is
 * on, where the panels are, the projects' views, and the sign-ins that
 * refresh (MCP servers' and Google's, never on a row).
 *
 * The engine keeps the collection's rows under `SETUP` where a project's
 * would be under its story's id. A story's id is `story_…`, so the two never
 * meet.
 *
 * Design: `.llm/sync_design.md`, "The account's own collection".
 */

import { DEFAULT_PRESET_ID } from '@/ai/defaults.js'
import { SETTINGS_GROUPS, rowId, untouchedBuiltIn } from '@/utils/settingsFile.js'

/** @typedef {import('@/composables/useApplicationState.js').BackedUpSettings} BackedUpSettings */
/** @typedef {import('@/utils/settingsFile.js').SettingsGroup} SettingsGroup */

/** What the account's collection is kept under, in place of a story's id. */
export const SETUP = 'setup'

/** The app tables the setup is made of, the card library's two among them. */
export const SETUP_TABLES = [
  'aiProviders',
  'aiProfiles',
  'aiPrompts',
  'chatProfiles',
  'mcpServers',
  'skills',
  'skillWordings',
  'webSearch',
  'cards',
  'cardFiles',
]

/** The settings kept outside the database, as rows of the collection: one a group. */
export const SETTINGS = 'settings'

/** Of the spelling settings, the device's own: a phone keeps its keyboard's checker. */
const DEVICE_SPELLING = ['enabled']

/**
 * What a row of the setup is known by in its table: a skill's wording by its
 * skill's name, the rest by their ids.
 *
 * @param {string} table
 * @param {any} row
 * @returns {string|undefined}
 */
export const idOf = (table, row) => (table === SETTINGS ? row?.id : rowId(table, row))

/**
 * A row of the setup as it is sent, without what is this device's alone: a
 * key the writer chose not to keep, why a server couldn't be listed here,
 * and a card's picture, whose bytes go as a file's do.
 *
 * @param {string} table
 * @param {any} row
 * @returns {any}
 */
export function asSent(table, row) {
  if (table === 'aiProviders' && row.rememberKey === false && 'apiKey' in row) {
    // eslint-disable-next-line no-unused-vars
    const { apiKey, ...kept } = row
    return kept
  }
  if (table === 'mcpServers' && 'error' in row) {
    // eslint-disable-next-line no-unused-vars
    const { error, ...kept } = row
    return kept
  }
  if (table === 'cardFiles') return { id: row.id, card: row.card }
  return row
}

/** How long after it was made a row can say it was changed, and have been changed by nobody. */
const SAME_MOMENT_MS = 1000

/**
 * Whether a row is one every install makes on its first start, as it made
 * it: a built-in connection with nothing of the writer's in it, or the
 * default preset never changed since. Such a row is never sent first, so
 * that a new device signed in before the one with the setup doesn't make its
 * empty defaults the account's.
 *
 * @param {string} table
 * @param {any} row
 * @returns {boolean}
 */
export function asMade(table, row) {
  if (!row) return false
  if (table === 'aiProviders') return untouchedBuiltIn(row)
  if (table === 'aiProfiles') {
    return row.id === DEFAULT_PRESET_ID && (row.updated ?? 0) - (row.created ?? 0) < SAME_MOMENT_MS
  }
  return false
}

/**
 * The settings kept outside the database, as the collection's rows: a group
 * each, the device's own left out.
 *
 * @param {BackedUpSettings} settings
 * @returns {any[]}
 */
export function settingsRows(settings) {
  return /** @type {SettingsGroup[]} */ (Object.keys(SETTINGS_GROUPS)).map(group => {
    /** @type {Record<string, unknown>} */
    const row = { id: group }
    for (const name of SETTINGS_GROUPS[group]) row[name] = settings[name]
    if (group === 'spelling' && settings.spelling) {
      row.spelling = Object.fromEntries(
        Object.entries(settings.spelling).filter(([name]) => !DEVICE_SPELLING.includes(name))
      )
    }
    return row
  })
}

/**
 * Settings rows back as the settings they hold, for the app to take.
 *
 * @param {any[]} rows
 * @returns {Partial<BackedUpSettings>}
 */
export function settingsOf(rows) {
  /** @type {Record<string, unknown>} */
  const settings = {}
  for (const row of rows) {
    const names = SETTINGS_GROUPS[/** @type {SettingsGroup} */ (row?.id)]
    if (!names) continue
    for (const name of names) if (row[name] !== undefined) settings[name] = row[name]
  }
  return /** @type {Partial<BackedUpSettings>} */ (settings)
}
