/**
 * @module utils/settingsFile
 * @description The writer's setup without their projects: what a settings
 * file can hold, which of it the writer picked, and what importing one
 * changes here.
 *
 * A settings file is a backup envelope (`utils/backup.js`) with the scope
 * `settings`: rows of the app tables a setup is made of, and the settings
 * kept outside the database that the writer picked. Everything here is plain
 * data in and out; reading and writing the rows is `composables/useBackup.js`.
 *
 * An item is one row, or one group of the outside settings. Importing works
 * by item: one not here is added, one here is replaced by the file's copy
 * when the two differ, and nothing is removed. A key the file leaves out
 * keeps the one here.
 *
 * Each item imported leaves a fingerprint of the file's copy behind. A file
 * left by a script is imported as the app opens, without asking, and skips
 * every item whose fingerprint is unchanged, so what the writer did to an
 * item since stands until the file changes that item. A file picked by hand
 * is imported whole, after the writer has seen what it changes.
 *
 * Design: `.llm/settings_import_design.md`.
 */

import { BUILT_IN_PROVIDERS } from '../ai/providers.js'
import { DEFAULT_PRESET_ID } from '../ai/defaults.js'

/** @typedef {import('./backup.js').TableData} TableData */
/** @typedef {import('../composables/useApplicationState.js').BackedUpSettings} BackedUpSettings */

/**
 * The app tables a setup is made of, in the order the export lists them.
 *
 * @typedef {'aiProviders'|'aiProfiles'|'chatProfiles'|'mcpServers'|'skills'|'skillWordings'|'webSearch'} SettingsTable
 *
 * @type {SettingsTable[]}
 */
export const SETTINGS_TABLES = [
  'aiProviders',
  'aiProfiles',
  'chatProfiles',
  'mcpServers',
  'skills',
  'skillWordings',
  'webSearch',
]

/**
 * The settings kept outside the database, in the groups the export offers
 * them: each group is one item.
 *
 * @typedef {'aiPreset'|'startingProfiles'|'narration'|'workflows'|'preferences'} SettingsGroup
 *
 * @type {Record<SettingsGroup, Array<keyof BackedUpSettings>>}
 */
export const SETTINGS_GROUPS = {
  aiPreset: ['aiPreset'],
  startingProfiles: ['chatProfileId', 'roleplayProfileId'],
  narration: ['narration'],
  workflows: ['workflows'],
  preferences: ['theme', 'applyEdits', 'nsfwProfiles', 'highlightSpeakers'],
}

/**
 * The groups left unpicked until the writer picks them: how one person likes
 * to work, which a setup handed to someone else shouldn't carry unasked.
 *
 * @type {ReadonlySet<SettingsGroup>}
 */
const UNPICKED = new Set(['preferences'])

/**
 * What each kind of item is called: as a heading, and in a sentence about
 * one of them or several.
 *
 * @type {Record<SettingsTable|'settings', {heading: string, one: string, many: string}>}
 */
export const KINDS = {
  aiProviders: { heading: 'Connections', one: 'connection', many: 'connections' },
  aiProfiles: { heading: 'Presets', one: 'preset', many: 'presets' },
  chatProfiles: { heading: 'Chat profiles', one: 'chat profile', many: 'chat profiles' },
  mcpServers: { heading: 'MCP servers', one: 'MCP server', many: 'MCP servers' },
  skills: { heading: 'Skills', one: 'skill', many: 'skills' },
  skillWordings: { heading: 'Skill wordings', one: 'skill wording', many: 'skill wordings' },
  webSearch: { heading: 'Web search', one: '', many: '' },
  settings: { heading: 'App settings', one: '', many: '' },
}

/**
 * Each group of settings by name, as a heading's item and in a sentence.
 *
 * @type {Record<SettingsGroup, {label: string, phrase: string}>}
 */
const GROUP_NAMES = {
  aiPreset: { label: 'Preset in use', phrase: 'the preset in use' },
  startingProfiles: { label: 'Profiles chats start on', phrase: 'the profiles chats start on' },
  narration: { label: 'Narration', phrase: 'the narration connection' },
  workflows: { label: 'Workflows', phrase: 'the workflows' },
  preferences: {
    label: 'Preferences: theme, edits, NSFW profiles, speaker colours',
    phrase: 'your preferences',
  },
}

/**
 * One thing a settings file can hold: a row of a table, or a group of the
 * outside settings.
 *
 * @typedef {Object} SettingsItem
 * @property {string} key - `table/id`, or `settings/group`
 * @property {SettingsTable|'settings'} kind
 * @property {string} name - What the writer calls it
 * @property {boolean} [picked] - Whether the export starts with it picked
 * @property {string[]} [needs] - The keys of the items it is no use without
 */

/**
 * What a row is known by in its table: its name for a skill's wording, which
 * is keyed by the skill's, and its id for the rest.
 *
 * @param {string} table
 * @param {any} row
 * @returns {string|undefined}
 */
export function rowId(table, row) {
  const id = table === 'skillWordings' ? row?.name : row?.id
  return typeof id === 'string' && id ? id : undefined
}

/**
 * @param {string} table
 * @param {string} id
 * @returns {string}
 */
const itemKey = (table, id) => `${table}/${id}`

/**
 * Whether every install has this row, made on its first start: a built-in
 * connection, or the default preset. One a file brings is a change to it,
 * even where the app hasn't made it yet, as it opens for the first time.
 *
 * @param {string} table
 * @param {string} id
 * @returns {boolean}
 */
function everyInstallHas(table, id) {
  if (table === 'aiProviders') return BUILT_IN_PROVIDERS.some(entry => entry.id === id)
  return table === 'aiProfiles' && id === DEFAULT_PRESET_ID
}

/**
 * Whether a built-in connection is as every install makes it, with nothing
 * of the writer's in it to carry: no key, no routing, its own address.
 *
 * @param {any} provider
 * @returns {boolean}
 */
function untouchedBuiltIn(provider) {
  const builtIn = BUILT_IN_PROVIDERS.find(entry => entry.id === provider.id)
  if (!builtIn) return false
  return (
    !provider.apiKey && !provider.routing && (provider.endpoint || '') === (builtIn.endpoint || '')
  )
}

/**
 * What a row is called in the export's list and in a sentence.
 *
 * @param {SettingsTable} table
 * @param {any} row
 * @returns {string}
 */
function rowName(table, row) {
  if (table === 'webSearch') return 'Web search'
  if (table === 'skillWordings') return `/${row.name}`
  return typeof row.name === 'string' && row.name ? row.name : rowId(table, row) || ''
}

/**
 * Everything the writer could put in a settings file, in the order the
 * export lists it.
 *
 * @param {Partial<Record<SettingsTable, any[]>>} tables - The rows here
 * @param {BackedUpSettings} settings - The outside settings here
 * @returns {SettingsItem[]}
 */
export function settingsItems(tables, settings) {
  /** @type {SettingsItem[]} */
  const items = []
  for (const table of SETTINGS_TABLES) {
    const rows = (tables[table] || []).filter(row => rowId(table, row))
    for (const row of rows) {
      if (table === 'aiProviders' && untouchedBuiltIn(row)) continue
      /** @type {SettingsItem} */
      const item = {
        key: itemKey(table, /** @type {string} */ (rowId(table, row))),
        kind: table,
        name: rowName(table, row),
        picked: true,
      }
      if (table === 'aiProfiles' && row.providerId) {
        item.needs = [itemKey('aiProviders', row.providerId)]
      }
      items.push(item)
    }
  }

  for (const group of /** @type {SettingsGroup[]} */ (Object.keys(SETTINGS_GROUPS))) {
    /** @type {SettingsItem} */
    const item = {
      key: itemKey('settings', group),
      kind: 'settings',
      name: GROUP_NAMES[group].label,
      picked: !UNPICKED.has(group),
    }
    const needs = settingsNeeds(group, settings)
    if (needs.length > 0) item.needs = needs
    items.push(item)
  }
  return items
}

/**
 * The rows a group of settings names, which it is no use without.
 *
 * @param {SettingsGroup} group
 * @param {BackedUpSettings} settings
 * @returns {string[]}
 */
function settingsNeeds(group, settings) {
  /** @type {string[]} */
  const needs = []
  /**
   * @param {string} table
   * @param {unknown} id
   */
  const add = (table, id) => {
    if (typeof id === 'string' && id) needs.push(itemKey(table, id))
  }
  if (group === 'aiPreset') add('aiProfiles', settings.aiPreset)
  if (group === 'startingProfiles') {
    add('chatProfiles', settings.chatProfileId)
    add('chatProfiles', settings.roleplayProfileId)
  }
  if (group === 'narration') add('aiProviders', settings.narration?.providerId)
  if (group === 'workflows') {
    for (const workflow of Object.values(settings.workflows || {})) {
      add('aiProviders', workflow?.providerId)
    }
  }
  return needs
}

/**
 * The picked keys with what `key` needs added, and what that needs in turn,
 * of the items there are.
 *
 * @param {Set<string>} picked
 * @param {SettingsItem[]} items
 * @param {string} key - The item just picked
 * @returns {Set<string>} A new set
 */
export function pickWithNeeds(picked, items, key) {
  const byKey = new Map(items.map(item => [item.key, item]))
  const out = new Set(picked)
  const queue = [key]
  while (queue.length > 0) {
    const next = /** @type {string} */ (queue.pop())
    out.add(next)
    for (const need of byKey.get(next)?.needs || []) {
      if (byKey.has(need) && !out.has(need)) queue.push(need)
    }
  }
  return out
}

/**
 * The tables and outside settings of the items picked, ready for the
 * backup envelope.
 *
 * @param {Partial<Record<SettingsTable, any[]>>} tables - The rows here
 * @param {BackedUpSettings} settings - The outside settings here
 * @param {Set<string>} picked - The keys of the items to put in
 * @returns {{tables: TableData, settings: Partial<BackedUpSettings>}}
 */
export function pickSettings(tables, settings, picked) {
  /** @type {TableData} */
  const out = {}
  for (const table of SETTINGS_TABLES) {
    const rows = (tables[table] || []).filter(row => {
      const id = rowId(table, row)
      return id !== undefined && picked.has(itemKey(table, id))
    })
    if (rows.length > 0) out[table] = rows
  }

  /** @type {Partial<BackedUpSettings>} */
  const chosen = {}
  for (const [group, names] of Object.entries(SETTINGS_GROUPS)) {
    if (!picked.has(itemKey('settings', group))) continue
    for (const name of names) {
      if (settings[name] !== undefined) Object.assign(chosen, { [name]: settings[name] })
    }
  }
  return { tables: out, settings: chosen }
}

/**
 * Filename for a downloaded settings file, e.g. `inksprite-settings-2026-10-13.json`.
 *
 * @param {Date} date
 * @returns {string}
 */
export function settingsFilename(date) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `inksprite-settings-${stamp}.json`
}

/** What an MCP server last listed, which is news about it rather than a change to it. */
const LISTING = ['tools', 'prompts', 'listedAt', 'error']

/**
 * A row as it is compared and fingerprinted: without when it was made and
 * changed, without what a server last listed, and with an empty key the
 * same as none.
 *
 * @param {string} table
 * @param {any} row
 * @returns {object}
 */
function essence(table, row) {
  // eslint-disable-next-line no-unused-vars
  const { created, updated, version, ...rest } = row
  if (table === 'aiProviders' && !rest.apiKey) delete rest.apiKey
  if (table === 'mcpServers') for (const field of LISTING) delete rest[field]
  if (table === 'webSearch' && rest.keys) {
    rest.keys = Object.fromEntries(Object.entries(rest.keys).filter(([, key]) => key))
  }
  return rest
}

/**
 * JSON with every object's keys in order, so the same data is always the
 * same text.
 *
 * @param {unknown} value
 * @returns {string}
 */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * A short fingerprint of some data (cyrb53): enough to tell one copy of an
 * item from the next, and no more.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function fingerprint(value) {
  const text = stableJson(value)
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * A row of the file's as it goes in here, over the row here with its id.
 *
 * The keys the file left out are this row's; so is when it was made. A
 * server's allowances are this row's too, unless the file was left by a
 * script, and its listing is whichever is newer. A file brought in by hand
 * that sends a connection or a server somewhere else takes this row's keys
 * no further: they're left out, and said to be, so a file can't make the
 * writer's key go to an address of its choosing.
 *
 * @param {SettingsTable} table
 * @param {any} row - The file's
 * @param {any} here - The row here, if there is one
 * @param {{byHand: boolean, now: number}} options
 * @returns {any}
 */
function mergeRow(table, row, here, { byHand, now }) {
  const merged = { ...row, updated: now }
  if (here?.created !== undefined) merged.created = here.created
  else if (merged.created === undefined) merged.created = now

  const moved =
    byHand &&
    (table === 'aiProviders'
      ? here?.type !== row.type || (here?.endpoint || '') !== (row.endpoint || '')
      : table === 'mcpServers' && here?.url !== row.url)

  if (table === 'aiProviders' && !row.apiKey && here?.apiKey && !moved) merged.apiKey = here.apiKey

  if (table === 'mcpServers') {
    const headers = row.headers || {}
    if (Object.keys(headers).length > 0) {
      const kept = (/** @type {string} */ name) => (moved ? '' : here?.headers?.[name])
      merged.headers = Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [name, value || kept(name) || ''])
      )
    }
    if (byHand) {
      merged.allowed = here?.allowed || []
      if (here?.allowAll) merged.allowAll = true
      else delete merged.allowAll
    }
    if (here && (here.listedAt || 0) > (row.listedAt || 0)) {
      for (const field of LISTING) {
        if (here[field] === undefined) delete merged[field]
        else merged[field] = here[field]
      }
    }
  }

  if (table === 'webSearch') {
    const keys = row.keys || {}
    const given = Object.fromEntries(Object.entries(keys).filter(([, key]) => key))
    const empty = Object.fromEntries(Object.keys(keys).map(service => [service, '']))
    merged.keys = { ...empty, ...(here?.keys || {}), ...given }
  }
  return merged
}

/**
 * What importing a settings file does here.
 *
 * @typedef {Object} SettingsImport
 * @property {TableData} rows - The rows to write, by table
 * @property {Partial<BackedUpSettings>} settings - The outside settings to take
 * @property {SettingsItem[]} added - Items not here before
 * @property {SettingsItem[]} changed - Items here that the file's copies replace
 * @property {Record<string, string>} fingerprints - Every item's fingerprint once this is done
 */

/**
 * Work out what a settings file changes here, writing nothing.
 *
 * @param {{tables: TableData, settings?: Partial<BackedUpSettings>}} file - Already moved forward to the running schema
 * @param {{tables: Partial<Record<SettingsTable, any[]>>, settings: BackedUpSettings}} here
 * @param {object} options
 * @param {boolean} options.byHand - Picked by the writer, who is shown what it
 *   changes, rather than left by a script and imported as the app opens
 * @param {Record<string, string>} [options.fingerprints] - Each item's as last imported
 * @param {number} [options.now] - Timestamp, injectable for tests
 * @returns {SettingsImport}
 */
export function planImport(file, here, { byHand, fingerprints = {}, now = Date.now() }) {
  /** @type {SettingsImport} */
  const plan = { rows: {}, settings: {}, added: [], changed: [], fingerprints: { ...fingerprints } }

  for (const table of SETTINGS_TABLES) {
    const rows = Array.isArray(file.tables?.[table]) ? file.tables[table] : []
    const hereById = new Map((here.tables[table] || []).map(row => [rowId(table, row), row]))
    for (const row of rows) {
      const id = rowId(table, row)
      if (!id) continue
      const key = itemKey(table, id)
      const print = fingerprint(essence(table, row))
      const unchanged = plan.fingerprints[key] === print
      plan.fingerprints[key] = print
      if (unchanged && !byHand) continue

      const current = hereById.get(id)
      const merged = mergeRow(table, row, current, { byHand, now })
      if (current && stableJson(essence(table, merged)) === stableJson(essence(table, current))) {
        continue
      }
      ;(plan.rows[table] ||= []).push(merged)
      const item = { key, kind: table, name: rowName(table, row) }
      ;(current || everyInstallHas(table, id) ? plan.changed : plan.added).push(item)
    }
  }

  const settings = file.settings && typeof file.settings === 'object' ? file.settings : {}
  for (const group of /** @type {SettingsGroup[]} */ (Object.keys(SETTINGS_GROUPS))) {
    const names = SETTINGS_GROUPS[group].filter(name => settings[name] !== undefined)
    if (names.length === 0) continue
    const key = itemKey('settings', group)
    const value = Object.fromEntries(names.map(name => [name, settings[name]]))
    const print = fingerprint(value)
    const unchanged = plan.fingerprints[key] === print
    plan.fingerprints[key] = print
    if (unchanged && !byHand) continue

    const current = Object.fromEntries(names.map(name => [name, here.settings[name]]))
    if (stableJson(value) === stableJson(current)) continue
    Object.assign(plan.settings, value)
    plan.changed.push({ key, kind: 'settings', name: GROUP_NAMES[group].label })
  }
  return plan
}

/**
 * Whether importing would change anything here.
 *
 * @param {SettingsImport} plan
 * @returns {boolean}
 */
export const changesAnything = plan => plan.added.length + plan.changed.length > 0

/**
 * Words joined as a list is in a sentence: `a`, `a and b`, `a, b and c`.
 *
 * @param {string[]} words
 * @returns {string}
 */
function listed(words) {
  if (words.length <= 1) return words[0] || ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** How many of a kind are named in a sentence before they are counted instead. */
const NAMED = 3

/**
 * Items as a sentence's list: by kind, in the export's order, each kind by
 * name when there are few and by count when there are more.
 *
 * @param {SettingsItem[]} items
 * @returns {string}
 */
function itemsInWords(items) {
  /** @type {string[]} */
  const phrases = []
  for (const kind of [...SETTINGS_TABLES, 'settings']) {
    const ofKind = items.filter(item => item.kind === kind)
    if (ofKind.length === 0) continue
    if (kind === 'settings') {
      for (const item of ofKind) {
        const group = /** @type {SettingsGroup} */ (item.key.slice('settings/'.length))
        phrases.push(GROUP_NAMES[group]?.phrase || item.name)
      }
      continue
    }
    if (kind === 'webSearch') {
      phrases.push('the web search setup')
      continue
    }
    const { one, many } = KINDS[/** @type {SettingsTable} */ (kind)]
    const names = ofKind.map(item => item.name)
    if (names.length === 1) phrases.push(`the ${one} ${names[0]}`)
    else if (names.length <= NAMED) phrases.push(`the ${many} ${listed(names)}`)
    else phrases.push(`${names.length} ${many}`)
  }
  return listed(phrases)
}

/**
 * What an import adds and changes, in a sentence or two: "Adds the
 * connection Work proxy and the preset Work. Changes the preset in use."
 *
 * @param {SettingsImport} plan
 * @param {{done?: boolean}} [options] - Said of an import that has happened
 * @returns {string}
 */
export function describeImport(plan, { done = false } = {}) {
  /** @type {string[]} */
  const sentences = []
  if (plan.added.length > 0) {
    sentences.push(`${done ? 'Added' : 'Adds'} ${itemsInWords(plan.added)}.`)
  }
  if (plan.changed.length > 0) {
    sentences.push(`${done ? 'Changed' : 'Changes'} ${itemsInWords(plan.changed)}.`)
  }
  return sentences.join(' ')
}
