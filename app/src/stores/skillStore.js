/**
 * @module stores/skillStore
 * @description The writer's own skills — the library.
 *
 * Each is kept as its SKILL.md, text and all, with the other files that came
 * with it; the text is the skill, read by the same parser the built-ins are
 * (`ai/skills/format.js`). The built-ins ship as source and are not here.
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
import { setLibrarySkills } from '@/ai/skills/index.js'
import { storage } from '@/storage/index.js'
import { onTablesWritten } from '@/platform/windows.js'

/** @typedef {import('../types/models.js').StoredSkill} StoredSkill */
/** @typedef {import('../types/models.js').SkillFile} SkillFile */

/** @returns {string} */
function generateSkillId() {
  return `skill_${nanoid()}`
}

export const useSkillStore = defineStore('skills', () => {
  /** @type {import('vue').Ref<Map<string, StoredSkill>>} */
  const skills = ref(new Map())

  const syncStore = useSyncStore()

  /** @type {import('vue').Ref<Promise<void>|null>} */
  const initializePromise = ref(null)

  /** Whether the library has been read: until then nothing is known to be gone. */
  const loaded = ref(false)

  /** Hand the library as it stands to the registry. */
  function publish() {
    setLibrarySkills(Array.from(skills.value.values()))
  }

  /** Read the library, and hand it to the registry. */
  async function initialize() {
    /** @type {StoredSkill[]} */
    let stored = []
    try {
      stored = await storage.all('skills')
    } catch (error) {
      console.error('Failed to load skills from database:', error)
    }
    for (const skill of stored) skills.value.set(skill.id, skill)
    console.log(`Loaded ${skills.value.size} skills`)
    loaded.value = true
    publish()
  }

  // Another window wrote them: read again.
  onTablesWritten(['skills'], async () => {
    if (!initializePromise.value) return
    const stored = await storage.all('skills')
    skills.value = new Map(stored.map(skill => [skill.id, skill]))
    publish()
  })

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

  return {
    skills,
    loaded,
    ensureInitialized,
    createSkill,
    updateSkill,
    deleteSkill,
    getSkill,
    getAllSkills,
  }
})
