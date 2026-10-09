/**
 * @module stores/skillStore
 * @description The writer's own skills — the library.
 *
 * Each is kept as its SKILL.md, text and all, with the other files that came
 * with it; the text is the skill, read by the same parser the built-ins are
 * (`ai/skills/format.js`). The built-ins ship as source and are not here; what
 * is, beside the writer's own, is their wording of a built-in, for every chat
 * — the prompt alone, kept only while it differs from the file's.
 *
 * Whatever the library holds is handed to the skills registry the moment it
 * changes, so the model's tools and the writer's commands are made from what
 * is here now. See `setLibrarySkills` in ai/skills.
 *
 * This keeps rows and nothing more: whether a name is free, and what a rename
 * carries with it, are `composables/useSkills.js`.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { nanoid } from 'nanoid'
import { useSyncStore } from './syncStore.js'
import { BUILT_IN_SKILLS, setLibrarySkills, setSkillWordings } from '@/ai/skills/index.js'
import db from './db'

/** @typedef {import('../types/models.js').StoredSkill} StoredSkill */
/** @typedef {import('../types/models.js').SkillFile} SkillFile */
/** @typedef {import('../types/models.js').SkillWording} SkillWording */

/** @returns {string} */
function generateSkillId() {
  return `skill_${nanoid()}`
}

export const useSkillStore = defineStore('skills', () => {
  /** @type {import('vue').Ref<Map<string, StoredSkill>>} */
  const skills = ref(new Map())

  /** @type {import('vue').Ref<Map<string, SkillWording>>} */
  const wordings = ref(new Map())

  const syncStore = useSyncStore()

  /** @type {import('vue').Ref<Promise<void>|null>} */
  const initializePromise = ref(null)

  /** Hand the library as it stands to the registry. */
  function publish() {
    setLibrarySkills(Array.from(skills.value.values()))
  }

  /** Hand the wordings as they stand to the registry. */
  function publishWordings() {
    setSkillWordings(Array.from(wordings.value.values()))
  }

  /**
   * Read both tables before keeping either, then keep and publish them in one
   * go: what is made from the library reads the registry when the library
   * changes, so the two must never be seen apart.
   */
  async function initialize() {
    /** @type {StoredSkill[]} */
    let stored = []
    try {
      stored = await db.skills.toArray()
    } catch (error) {
      console.error('Failed to load skills from database:', error)
    }
    /** @type {SkillWording[]} */
    let reworded = []
    try {
      reworded = await db.skillWordings.toArray()
    } catch (error) {
      console.error('Failed to load skill wordings from database:', error)
    }

    for (const skill of stored) skills.value.set(skill.id, skill)
    for (const wording of reworded) wordings.value.set(wording.name, wording)
    console.log(`Loaded ${skills.value.size} skills`)
    publish()
    publishWordings()
  }

  /** @returns {Promise<void>} */
  function ensureInitialized() {
    if (!initializePromise.value) initializePromise.value = initialize()
    return initializePromise.value
  }

  ensureInitialized()

  /**
   * @param {{name: string, text: string, files?: SkillFile[]}} opts
   * @returns {StoredSkill}
   */
  function createSkill({ name, text, files = [] }) {
    /** @type {StoredSkill} */
    const skill = {
      id: generateSkillId(),
      name,
      text,
      files,
      version: 1,
      created: Date.now(),
      updated: Date.now(),
    }

    skills.value.set(skill.id, skill)
    syncStore.trackChange('skills', skill.id, skill)
    publish()
    return skill
  }

  /**
   * @param {string} skillId
   * @param {{name?: string, text?: string, files?: SkillFile[]}} updates
   * @returns {StoredSkill|null}
   */
  function updateSkill(skillId, updates) {
    const skill = skills.value.get(skillId)
    if (!skill) {
      console.error(`Failed to update skill, '${skillId}' not found`)
      return null
    }

    /** @type {StoredSkill} */
    const updated = {
      ...skill,
      ...updates,
      id: skill.id,
      created: skill.created,
      version: (skill.version || 1) + 1,
      updated: Date.now(),
    }

    skills.value.set(skillId, updated)
    syncStore.trackChange('skills', skillId, updated)
    publish()
    return updated
  }

  /**
   * @param {string} skillId
   * @returns {boolean}
   */
  function deleteSkill(skillId) {
    if (!skills.value.has(skillId)) return false

    skills.value.delete(skillId)
    syncStore.trackDelete('skills', skillId)
    publish()
    return true
  }

  /**
   * @param {string} skillId
   * @returns {StoredSkill|null}
   */
  function getSkill(skillId) {
    return skills.value.get(skillId) || null
  }

  /** @returns {StoredSkill[]} By name */
  function getAllSkills() {
    return Array.from(skills.value.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Have a built-in run under this in every chat whose profile has no wording
   * of its own. Words that are its file's, or nothing but space, are no
   * wording, and take away the one there was — so a skill put back the way it
   * ships keeps picking up the app's improvements to it.
   *
   * @param {string} name - The built-in's
   * @param {string} prompt
   * @returns {boolean} Whether there is such a built-in
   */
  function setWording(name, prompt) {
    const skill = BUILT_IN_SKILLS.find(one => one.name === name)
    if (!skill) {
      console.error(`Failed to reword skill, '${name}' is not a built-in`)
      return false
    }

    const trimmed = (prompt || '').trim()
    if (!trimmed || trimmed === skill.body.trim()) {
      if (wordings.value.delete(name)) {
        syncStore.trackDelete('skillWordings', name)
        publishWordings()
      }
      return true
    }

    /** @type {SkillWording} */
    const wording = { name, prompt, updated: Date.now() }
    wordings.value.set(name, wording)
    syncStore.trackChange('skillWordings', name, wording)
    publishWordings()
    return true
  }

  /**
   * @param {string} name - A built-in's
   * @returns {string|null} The writer's wording of it, when they have one
   */
  function getWording(name) {
    return wordings.value.get(name)?.prompt ?? null
  }

  return {
    skills,
    wordings,
    ensureInitialized,
    createSkill,
    updateSkill,
    deleteSkill,
    getSkill,
    getAllSkills,
    setWording,
    getWording,
  }
})
