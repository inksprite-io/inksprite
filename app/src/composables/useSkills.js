import { computed } from 'vue'
import { useSkillStore } from '@/stores/skillStore.js'
import { useChatProfileStore } from '@/stores/chatProfileStore.js'
import { useChatsStore } from '@/stores/chatsStore.js'
import { BUILT_IN_SKILLS, parseSkill } from '@/ai/skills/index.js'
import { COMMANDS } from '@/ai/commands.js'
import { hasTool } from '@/ai/tools/index.js'
import db from '@/stores/db.js'

/**
 * @module composables/useSkills
 * @description The writer's own skills: the library, and what the rest of the
 * app asks of it.
 *
 * The rows are `stores/skillStore.js`; the skills made from them — the model's
 * tools, the writer's commands — are the registry in ai/skills, which the
 * store keeps up to date. This is what components and the turn reach for, and
 * where a skill is checked before it is kept: that its file reads, and that its
 * name is free.
 */

/** @typedef {import('../types/models.js').StoredSkill} StoredSkill */
/** @typedef {import('../types/models.js').SkillFile} SkillFile */

/**
 * Settings of a profile's or a chat's with a skill's old name changed to its
 * new one: its wording, when it is a profile's, and whether its tool is
 * switched off. Nothing, when nothing in them names it.
 *
 * @param {{skills?: Record<string, any>, disabledTools?: string[]}} settings
 * @param {string} from
 * @param {string} to
 * @returns {{skills?: Record<string, any>, disabledTools?: string[]}|null}
 */
export function renamedIn(settings, from, to) {
  /** @type {{skills?: Record<string, any>, disabledTools?: string[]}} */
  const changes = {}

  const worded = settings?.skills
  if (worded && from in worded) {
    const { [from]: wording, ...rest } = worded
    changes.skills = to in rest ? rest : { ...rest, [to]: wording }
  }

  const off = settings?.disabledTools
  if (Array.isArray(off) && off.includes(from)) {
    changes.disabledTools = [...new Set(off.map(name => (name === from ? to : name)))]
  }

  return Object.keys(changes).length > 0 ? changes : null
}

/**
 * A skill found in what the writer handed over, as the import shows it before
 * anything is kept.
 *
 * @typedef {Object} ImportRow
 * @property {string} path - Where it was found
 * @property {string} text - Its SKILL.md
 * @property {SkillFile[]} files - What came with it
 * @property {string[]} dropped - What was left behind, and why
 * @property {string[]} ignored - Fields in it this app does not use
 * @property {string[]} errors - Why its file does not read; it cannot come in
 * @property {string} name - What it is called, when it reads
 * @property {string|null} replaces - One of the writer's own it would replace,
 *   having the same name
 * @property {string} problem - Why it cannot come in under its name, when it
 *   is not one of theirs that has it: it needs another
 */

/**
 * @returns {{
 *   ready: () => Promise<void>,
 *   skills: import('vue').ComputedRef<StoredSkill[]>,
 *   getSkill: (id: string) => StoredSkill|null,
 *   nameProblem: (name: string, exceptId?: string|null) => string,
 *   saveSkill: (skill: {id?: string|null, text: string, files?: SkillFile[]}) => Promise<{skill: StoredSkill}|{errors: string[]}>,
 *   deleteSkill: (id: string) => boolean,
 *   planImport: (found: import('@/ai/skills/bundle.js').FoundSkill[]) => ImportRow[],
 *   importSkills: (rows: ImportRow[]) => Promise<{imported: number, failed: string[]}>,
 * }}
 */
export function useSkills() {
  const store = useSkillStore()

  /**
   * Why this cannot be a skill of the writer's, or nothing when it can.
   *
   * A name is what the writer types and what the model calls, so it has to be
   * free of both: not a built-in's, not a command's, not a tool's, and not
   * another of theirs.
   *
   * @param {string} name
   * @param {string|null} [exceptId] - The skill being saved, which may keep its own
   * @returns {string}
   */
  const nameProblem = (name, exceptId = null) => {
    const theirs = store.getAllSkills().find(one => one.name === name && one.id !== exceptId)
    if (theirs) return `You already have a skill called ${name}.`

    const own = exceptId ? store.getSkill(exceptId) : null
    const keepingItsName = own?.name === name
    if (BUILT_IN_SKILLS.some(one => one.name === name)) return `${name} is a built-in skill.`
    if (!keepingItsName && name in COMMANDS) return `There is already a /${name}.`
    if (!keepingItsName && hasTool(name)) return `The model already has a tool called ${name}.`
    return ''
  }

  /**
   * Carry what hangs on a skill's name across a rename: each profile's wording
   * of it, and every chat and profile that switched its tool off. The records of
   * old turns keep the name they were run under.
   *
   * @param {string} from
   * @param {string} to
   */
  const carryRename = async (from, to) => {
    const profiles = useChatProfileStore()
    await profiles.ensureInitialized()
    for (const profile of profiles.getAllProfiles()) {
      const changes = renamedIn(profile.settings, from, to)
      // The store merges settings, so the fields that changed are all it needs.
      if (changes) profiles.updateProfile(profile.id, { settings: /** @type {any} */ (changes) })
    }

    // The chats that are open are the store's to change; the rest are only in
    // the database, and are changed there.
    const chats = useChatsStore()
    for (const chat of chats.chats.values()) {
      const changes = renamedIn(chat, from, to)
      if (changes?.disabledTools)
        chats.updateChat(chat.id, { disabledTools: changes.disabledTools })
    }
    try {
      const stored = await db.chats.toArray()
      for (const chat of stored) {
        if (chats.chats.has(chat.id)) continue
        const changes = renamedIn(chat, from, to)
        if (changes?.disabledTools) {
          await db.chats.update(chat.id, { disabledTools: changes.disabledTools })
        }
      }
    } catch (error) {
      console.error('Failed to carry a skill’s rename to chats that are not open:', error)
    }
  }

  /**
   * Keep a skill: a new one, or a change to one already kept.
   *
   * Refused, with every reason, when its file does not read or its name is not
   * free. A change of name carries the rewordings and the switches with it.
   *
   * @param {{id?: string|null, text: string, files?: SkillFile[]}} skill
   * @returns {Promise<{skill: StoredSkill}|{errors: string[]}>}
   */
  const saveSkill = async ({ id = null, text, files }) => {
    const read = parseSkill(text)
    if ('errors' in read) return { errors: read.errors }

    const { name } = read.skill
    const problem = nameProblem(name, id)
    if (problem) return { errors: [problem] }

    if (!id) {
      return { skill: store.createSkill({ name, text, files: files || [] }) }
    }

    const before = store.getSkill(id)
    if (!before) return { errors: ['That skill is no longer in the library.'] }

    const saved = store.updateSkill(id, { name, text, ...(files ? { files } : {}) })
    if (!saved) return { errors: ['That skill is no longer in the library.'] }
    if (before.name !== name) await carryRename(before.name, name)
    return { skill: saved }
  }

  /**
   * What would happen to each skill found, if it came in: whether its file
   * reads, whether it would replace one of the writer's own of the same name,
   * and whether its name needs changing first — for a built-in's, a command's,
   * a tool's, or another's in the same batch.
   *
   * @param {import('@/ai/skills/bundle.js').FoundSkill[]} found
   * @returns {ImportRow[]}
   */
  const planImport = found => {
    /** @type {Set<string>} */
    const seen = new Set()
    return found.map(one => {
      const row = { ...one, ignored: [], errors: [], name: '', replaces: null, problem: '' }
      const read = parseSkill(one.text)
      if ('errors' in read) return { ...row, errors: read.errors }

      const { name } = read.skill
      const theirs = store.getAllSkills().find(skill => skill.name === name)
      const problem = seen.has(name)
        ? `Another skill here is called ${name}.`
        : theirs
          ? ''
          : nameProblem(name)
      seen.add(name)

      return { ...row, ignored: read.ignored, name, replaces: theirs?.id ?? null, problem }
    })
  }

  /**
   * Keep the skills the writer chose to bring in: a new skill each, or, for one
   * with the name of one of theirs, that one replaced — which is what bringing
   * a skill in again after changing it elsewhere should do.
   *
   * @param {ImportRow[]} rows
   * @returns {Promise<{imported: number, failed: string[]}>}
   */
  const importSkills = async rows => {
    let imported = 0
    /** @type {string[]} */
    const failed = []
    for (const row of rows) {
      const saved = await saveSkill({ id: row.replaces, text: row.text, files: row.files })
      if ('errors' in saved) failed.push(`${row.name || row.path}: ${saved.errors.join(' ')}`)
      else imported++
    }
    return { imported, failed }
  }

  return {
    /**
     * Resolves once the library has been read and handed to the registry, so
     * a turn started the moment the app opens still has the writer's skills.
     */
    ready: () => store.ensureInitialized(),
    /** The library, by name. */
    skills: computed(() => store.getAllSkills()),
    getSkill: id => store.getSkill(id),
    nameProblem,
    saveSkill,
    deleteSkill: id => store.deleteSkill(id),
    planImport,
    importSkills,
  }
}
