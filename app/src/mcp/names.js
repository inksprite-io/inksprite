/**
 * @module mcp/names
 * @description What a server's tools are called to the model, and the group
 * they are switched by.
 *
 * A server's tools reach the model as `<prefix>__<tool>`, the way Claude Code
 * names them, cut to what a function name may be: 64 characters of letters,
 * digits, `_` and `-`. The prefix is made from the server's name once, when
 * it is added, and kept: a chat's switches and a turn's record name tools by
 * these names, and a rename that changed them would orphan both.
 */

/** What a server's tool group is keyed by, before the server's id. */
export const SERVER_GROUP_PREFIX = 'mcp:'

/** The longest a function name may be. */
const MAX_NAME = 64

/** The longest a prefix is made, leaving the tool most of the name. */
const MAX_PREFIX = 24

/**
 * The group a server's tools are registered under.
 *
 * @param {string} serverId
 * @returns {string}
 */
export function serverGroup(serverId) {
  return `${SERVER_GROUP_PREFIX}${serverId}`
}

/**
 * Whether a group is a server's, and which.
 *
 * @param {string|undefined} group
 * @returns {string|null} The server's id, or null for a group of the app's own
 */
export function serverOfGroup(group) {
  return group?.startsWith(SERVER_GROUP_PREFIX) ? group.slice(SERVER_GROUP_PREFIX.length) : null
}

/**
 * Text as a function name may hold it: letters, digits, `_` and `-`, with a
 * run of anything else as one `_`.
 *
 * @param {string} text
 * @returns {string}
 */
function slug(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
}

/**
 * The prefix for a server being added, from its name, unlike any other
 * server's.
 *
 * @param {string} name - What the writer called it
 * @param {string[]} [taken] - The other servers' prefixes
 * @returns {string}
 */
export function serverPrefix(name, taken = []) {
  const base = slug(name).toLowerCase().slice(0, MAX_PREFIX) || 'server'
  let prefix = base
  for (let n = 2; taken.includes(prefix); n++) {
    const suffix = `_${n}`
    prefix = `${base.slice(0, MAX_PREFIX - suffix.length)}${suffix}`
  }
  return prefix
}

/**
 * The names a server's tools reach the model by, in the order given. A name
 * that would come out the same as one already taken, or one before it, once
 * cut to length, gets a number.
 *
 * @param {string} prefix - The server's
 * @param {string[]} tools - The tools' own names
 * @param {string[]} [taken] - Names its other tools already have
 * @returns {string[]}
 */
export function exposedNames(prefix, tools, taken = []) {
  const head = `${prefix}__`
  const room = MAX_NAME - head.length
  const used = new Set(taken)
  /** @type {string[]} */
  const names = []
  for (const tool of tools) {
    const base = (slug(tool) || 'tool').slice(0, room)
    let name = `${head}${base}`
    for (let n = 2; used.has(name); n++) {
      const suffix = `_${n}`
      name = `${head}${base.slice(0, room - suffix.length)}${suffix}`
    }
    used.add(name)
    names.push(name)
  }
  return names
}
