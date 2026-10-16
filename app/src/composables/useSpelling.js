/**
 * @module composables/useSpelling
 * @description The editor's spelling, for a project: the checker set to the
 * writer's settings and told the words the project knows, and what the menu
 * on a flagged word does with a word or a lint.
 *
 * A project knows the words in its own dictionary (`Story.spelling`) and the
 * names in its documents' titles, taken without asking: a character sheet
 * titled "Marisol Vey" teaches it both names. Only a word with a capital is
 * taken, so a title's ordinary words don't count. A typo in a title passes
 * too, which is the price.
 *
 * A phone keeps its keyboard's checker for now, and so does a writer who
 * switched the app's checker off, or whose checker failed to start.
 */

import { computed, watchEffect } from 'vue'
import { useApplicationState } from './useApplicationState'
import { useStoriesStore } from '@/stores/storiesStore'
import { useDocumentsStore } from '@/stores/documentsStore'
import { spellChecker } from '@/spelling/checker.js'
import { baseWord } from '@/spelling/engine.js'
import { hasTouchKeyboard } from '@/utils/touch.js'

/** A name in a title: a word that starts with a capital letter. */
const NAME = /\p{Lu}[\p{L}\p{M}'’]*/gu

/**
 * The names in a project's titles, each once, in order.
 *
 * @param {string[]} titles
 * @returns {string[]}
 */
export function namesIn(titles) {
  /** @type {Set<string>} */
  const names = new Set()
  for (const title of titles) {
    for (const [match] of title.matchAll(NAME)) {
      const name = baseWord(match)
      if (name.length > 1) names.add(name)
    }
  }
  return [...names].sort()
}

/**
 * A project's own dictionary, and the grammar it ignores: kept on the story,
 * changed here. What the dictionary manager and the editor's menu change.
 *
 * @param {string} storyId
 */
export function useProjectSpelling(storyId) {
  const storiesStore = useStoriesStore()

  /** @type {import('vue').ComputedRef<import('@/types/models.js').StorySpelling>} */
  const own = computed(() => storiesStore.getStory(storyId)?.spelling ?? {})

  /** The project's words, as added. */
  const words = computed(() => own.value.words ?? [])

  /** What the project ignores. */
  const ignored = computed(() => own.value.ignored ?? [])

  /**
   * Change the project's dictionary or what it ignores.
   *
   * @param {(spelling: import('@/types/models.js').StorySpelling) => import('@/types/models.js').StorySpelling|null} change
   *   Null for no change
   */
  const changeOwn = async change => {
    const story = storiesStore.getStory(storyId)
    if (!story) return
    const next = change(story.spelling ?? {})
    if (!next) return
    try {
      await storiesStore.updateStory(storyId, { spelling: next })
    } catch (error) {
      console.error("Could not keep the project's spelling:", error)
    }
  }

  /**
   * Put a word in this project's dictionary.
   * @param {string} word
   */
  const addWord = word =>
    changeOwn(spelling => {
      const base = baseWord(word)
      const words = spelling.words ?? []
      return base && !words.includes(base) ? { ...spelling, words: [...words, base] } : null
    })

  /**
   * Take a word out of this project's dictionary.
   * @param {string} word
   */
  const removeWord = word =>
    changeOwn(spelling => {
      const words = spelling.words ?? []
      return words.includes(word)
        ? { ...spelling, words: words.filter(known => known !== word) }
        : null
    })

  /**
   * Stop drawing one grammar lint, where it is.
   * @param {string} hash - The lint's hash, of it and the words around it
   */
  const ignore = hash =>
    changeOwn(spelling => {
      const ignored = spelling.ignored ?? []
      return ignored.includes(hash) ? null : { ...spelling, ignored: [...ignored, hash] }
    })

  return { words, ignored, addWord, removeWord, ignore }
}

/**
 * @param {string} storyId
 */
export function useSpelling(storyId) {
  const app = useApplicationState()
  const documentsStore = useDocumentsStore()
  const project = useProjectSpelling(storyId)

  const names = computed(() => {
    /** @type {string[]} */
    const titles = []
    for (const document of documentsStore.documents.values()) {
      if (document.storyId !== storyId || document.type === 'file' || !document.title) continue
      titles.push(document.title)
    }
    return namesIn(titles)
  })

  const touch = hasTouchKeyboard()

  /** Whether the editor is checked here, rather than by the browser. */
  const on = computed(
    () => !touch && app.spelling.value.enabled && spellChecker.status.value !== 'failed'
  )

  watchEffect(() => {
    const { enabled, dialect, grammar, words } = app.spelling.value
    spellChecker.configure({
      dialect: touch || !enabled ? null : dialect,
      words: [...words, ...project.words.value, ...names.value],
      grammar,
      ignored: project.ignored.value,
    })
  })

  /**
   * Put a word in the writer's dictionary, which every project knows.
   * @param {string} word
   */
  const addWord = word => app.addWord(baseWord(word))

  return { on, addWord, addProjectWord: project.addWord, ignore: project.ignore }
}
