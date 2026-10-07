/**
 * @module composables/useApplicationState
 * @description Centralized application state management using localStorage for persistence
 *
 * @example
 * // Access active profile
 * const { activeAIPresetId, setActiveAIPresetId } = useApplicationState()
 *
 * // Set active profile
 * setActiveProfileId('profile_custom_creative')
 *
 * // Future: Access other state
 * const { getState, setState } = useApplicationState()
 * setState('ui.theme', 'dark')
 * const theme = getState('ui.theme')
 */

import { ref, computed, watch } from 'vue'
import { localStorage } from '@/utils/localStorage'

const STORAGE_KEY = 'inksprite_app_state'

// Default application state structure
const defaultState = {
  ai: {
    // Active AI profile. Stored under the legacy "chat" key so we don't have
    // to migrate IndexedDB-resident IDs from earlier per-mode profiles.
    activeChatProfileId: null,
  },
  system: {
    // Whether the assistant's changes to documents go straight in, or wait in
    // the chat for the writer to accept them. App-wide: how the writer wants
    // to work with the assistant, not a property of any one conversation.
    applyEdits: 'auto',
    // Whether the built-in profiles written for explicit content are offered.
    // Off until the writer switches it on, so nobody meets them by opening a
    // menu.
    nsfwProfiles: false,
  },
  debug: {
    // Keeps a copy of the request that opened each assistant turn. Off by
    // default: a saved context is as large as the conversation it was built
    // from, and it is only ever read by someone looking at it on purpose.
    enabled: false,
  },
  workflows: {
    // The provider and model that convert a document's text to Markdown, and
    // how hard the model thinks about it. Nulls run the active preset's; the
    // Workflows settings fill them from it the first time they open.
    // `onImport` converts every file with text as it is imported.
    convert: { providerId: null, model: null, reasoningEffort: null, onImport: false },
  },
  narration: {
    // The speech server documents are read aloud by. Where Kokoro-FastAPI
    // listens when run the way its docker-compose runs it, so a writer with
    // that running has nothing to set up.
    endpoint: 'http://localhost:8880/v1',
    apiKey: '',
    model: 'kokoro',
  },
  ui: {
    theme: 'system', // 'light', 'dark', or 'system'
    showProviderSetupDialog: true, // Show or hide the provider setup dialog
    showWelcomeDialog: true, // Show or hide the welcome dialog
    // Whether the editor colours each speaker's lines while the narration is
    // showing beside it.
    highlightSpeakers: true,
    lorebook: {
      sortBy: 'name', // 'name', 'category', or 'updated'
      sortOrder: 'asc', // 'asc' or 'desc'
    },
  },
}

/**
 * Load state from localStorage with defaults
 * @returns {object} Merged state
 */
const loadState = () => {
  const stored = localStorage.get(STORAGE_KEY)
  if (!stored) return defaultState

  // Deep merge to preserve default structure
  const merged = JSON.parse(JSON.stringify(defaultState))

  // Merge stored state
  if (stored.ai) {
    Object.assign(merged.ai, stored.ai)
  }
  if (stored.system) {
    Object.assign(merged.system, stored.system)
  }
  if (stored.debug) {
    Object.assign(merged.debug, stored.debug)
  }
  // Called roles until they were renamed workflows; a state saved before then
  // has them under the old name, and is read as if it had the new one.
  const workflows = stored.workflows || stored.roles
  if (workflows) {
    for (const [name, settings] of Object.entries(workflows)) {
      merged.workflows[name] = { ...(merged.workflows[name] || {}), ...settings }
    }
  }
  if (stored.narration) {
    Object.assign(merged.narration, stored.narration)
  }
  if (stored.ui) {
    Object.assign(merged.ui, stored.ui)
    // Preserve nested lorebook settings
    if (stored.ui.lorebook) {
      merged.ui.lorebook = { ...merged.ui.lorebook, ...stored.ui.lorebook }
    }
  }

  // Earlier versions split the active profile across activeChatProfileId /
  // activeWriteProfileId / activeAdventureProfileId. Collapse onto the
  // canonical chat key, picking whichever stored value is set.
  const ai = merged.ai
  ai.activeChatProfileId =
    ai.activeChatProfileId || ai.activeWriteProfileId || ai.activeAdventureProfileId || null
  delete ai.activeWriteProfileId
  delete ai.activeAdventureProfileId

  return merged
}

// Global reactive state
const state = ref(loadState())

// Auto-persist to localStorage on changes
watch(
  state,
  newState => {
    localStorage.set(STORAGE_KEY, newState)
  },
  { deep: true }
)

/**
 * Where documents are read aloud: a speech server's address, a key if it
 * wants one, and the model to ask for. See `tts/client.js`.
 *
 * @typedef {Object} NarrationConnection
 * @property {string} endpoint
 * @property {string} apiKey
 * @property {string} model
 */

/**
 * Application state composable
 *
 * @returns {{
 *   state: import('vue').Ref<object>,
 *   activeAIPresetId: import('vue').ComputedRef<string>,
 *   setActiveAIPresetId: (profileId: string) => void,
 *   getActiveAIPresetId: () => string,
 *   debug: import('vue').ComputedRef<boolean>,
 *   setDebug: (on: boolean) => void,
 *   applyEdits: import('vue').ComputedRef<'auto'|'ask'>,
 *   setApplyEdits: (mode: 'auto'|'ask') => void,
 *   nsfwProfiles: import('vue').ComputedRef<boolean>,
 *   setNsfwProfiles: (on: boolean) => void,
 *   narration: import('vue').ComputedRef<NarrationConnection>,
 *   workflows: import('vue').ComputedRef<Record<string, import('../types/models.js').WorkflowSettings>>,
 *   setWorkflow: (name: string, patch: Partial<import('../types/models.js').WorkflowSettings>) => void,
 *   setNarration: (patch: Partial<NarrationConnection>) => void,
 *   highlightSpeakers: import('vue').ComputedRef<boolean>,
 *   setHighlightSpeakers: (highlight: boolean) => void,
 *   theme: import('vue').ComputedRef<'light'|'dark'|'system'>,
 *   setTheme: (theme: 'light'|'dark'|'system') => void,
 *   getTheme: () => 'light'|'dark'|'system',
 *   setLorebookSortBy: (field: 'name'|'category'|'updated') => void,
 *   getLorebookSortBy: () => 'name'|'category'|'updated',
 *   setLorebookSortOrder: (order: 'asc'|'desc') => void,
 *   getLorebookSortOrder: () => 'asc'|'desc',
 *   showProviderSetupDialog: import('vue').ComputedRef<boolean>,
 *   setShowProviderSetupDialog: (show: boolean) => void,
 *   getShowProviderSetupDialog: () => boolean,
 *   showWelcomeDialog: import('vue').ComputedRef<boolean>,
 *   setShowWelcomeDialog: (show: boolean) => void,
 *   getShowWelcomeDialog: () => boolean,
 *   checkAndShowWelcomeDialog: () => Promise<void>,
 *   getState: (path: string) => any,
 *   setState: (path: string, value: any) => void,
 *   resetState: () => void
 * }}
 */
export function useApplicationState() {
  // The one AI preset in use — the provider, model and sampling everything
  // runs on. Stored under `activeChatProfileId`, which is two renames out of
  // date and stays that way: it is a key in somebody's saved settings, and it
  // has nothing to do with the chat profiles a chat is stamped from.

  const setActiveAIPresetId = profileId => {
    state.value.ai.activeChatProfileId = profileId
  }
  const getActiveAIPresetId = () => state.value.ai.activeChatProfileId
  const activeAIPresetId = computed(() => state.value.ai.activeChatProfileId)

  /**
   * Whether the debug switch is on: each assistant turn keeps the request
   * that opened it, and a chat can be exported with its words taken out.
   * The switch used to be only the first of those, under its old name, and a
   * setting saved under that name still counts.
   * @type {import('vue').ComputedRef<boolean>}
   */
  const debug = computed(
    () => state.value.debug?.enabled === true || state.value.debug?.saveContext === true
  )

  /**
   * @param {boolean} on
   */
  const setDebug = on => {
    if (!state.value.debug) state.value.debug = {}
    state.value.debug.enabled = on === true
    delete state.value.debug.saveContext
  }

  /**
   * Whether the assistant's changes to documents wait on the writer. Anything
   * but an explicit ask means they go in, as they always did.
   * @type {import('vue').ComputedRef<'auto'|'ask'>}
   */
  const applyEdits = computed(() => (state.value.system?.applyEdits === 'ask' ? 'ask' : 'auto'))

  /**
   * @param {'auto'|'ask'} mode
   */
  const setApplyEdits = mode => {
    if (mode !== 'auto' && mode !== 'ask') return
    if (!state.value.system) state.value.system = {}
    state.value.system.applyEdits = mode
  }

  /**
   * Whether the NSFW chat profiles are offered. See `nsfw` on a profile in
   * ai/profiles.
   * @type {import('vue').ComputedRef<boolean>}
   */
  const nsfwProfiles = computed(() => state.value.system?.nsfwProfiles === true)

  /**
   * @param {boolean} on
   */
  const setNsfwProfiles = on => {
    if (!state.value.system) state.value.system = {}
    state.value.system.nsfwProfiles = on === true
  }

  /**
   * The speech server, as far as it is set. Fields a stored state lacks are
   * the defaults, so a state written before there was a speech server has
   * Kokoro's usual address.
   * @type {import('vue').ComputedRef<NarrationConnection>}
   */
  const narration = computed(() => ({
    ...defaultState.narration,
    ...(state.value.narration || {}),
  }))

  /**
   * Change some of the speech server's details, leaving the rest.
   * @param {Partial<NarrationConnection>} patch
   */
  const setNarration = patch => {
    state.value.narration = { ...narration.value, ...patch }
  }

  /**
   * The workflows and the models they run on, as far as they are set.
   * @type {import('vue').ComputedRef<Record<string, import('../types/models.js').WorkflowSettings>>}
   */
  const workflows = computed(() => {
    /** @type {Record<string, import('../types/models.js').WorkflowSettings>} */
    const merged = {}
    for (const [name, settings] of Object.entries(defaultState.workflows)) {
      merged[name] = { ...settings, ...(state.value.workflows?.[name] || {}) }
    }
    for (const [name, settings] of Object.entries(state.value.workflows || {})) {
      if (!merged[name]) merged[name] = { providerId: null, model: null, ...settings }
    }
    return merged
  })

  /**
   * Change how a workflow is run, leaving the rest of it.
   * @param {string} name
   * @param {Partial<import('../types/models.js').WorkflowSettings>} patch
   */
  const setWorkflow = (name, patch) => {
    state.value.workflows = {
      ...(state.value.workflows || {}),
      [name]: { ...(workflows.value[name] || { providerId: null, model: null }), ...patch },
    }
  }

  /**
   * Whether the editor colours each speaker's lines while the narration is
   * showing. On unless switched off.
   * @type {import('vue').ComputedRef<boolean>}
   */
  const highlightSpeakers = computed(() => state.value.ui?.highlightSpeakers !== false)

  /** @param {boolean} highlight */
  const setHighlightSpeakers = highlight => {
    state.value.ui.highlightSpeakers = highlight === true
  }

  /**
   * Set the theme
   * @param {'light'|'dark'|'system'} theme - Theme to set
   */
  const setTheme = theme => {
    if (['light', 'dark', 'system'].includes(theme)) {
      state.value.ui.theme = theme
    }
  }

  /**
   * Get the current theme
   * @returns {'light'|'dark'|'system'} Current theme
   */
  const getTheme = () => {
    return state.value.ui.theme || 'system'
  }

  /**
   * Computed ref for reactive theme
   * @type {import('vue').ComputedRef<'light'|'dark'|'system'>}
   */
  const theme = computed(() => state.value.ui.theme || 'system')

  /**
   * Get state value by dot notation path
   * @param {string} path - Dot notation path (e.g., 'ai.activeChatProfileId')
   * @returns {*} Value at path or undefined
   */
  const getState = path => {
    return path.split('.').reduce((obj, key) => obj?.[key], state.value)
  }

  /**
   * Set state value by dot notation path
   * @param {string} path - Dot notation path (e.g., 'ui.theme')
   * @param {*} value - Value to set
   */
  const setState = (path, value) => {
    const keys = path.split('.')
    const lastKey = keys.pop()
    const target = keys.reduce((obj, key) => {
      if (!obj[key]) obj[key] = {}
      return obj[key]
    }, state.value)
    target[lastKey] = value
  }

  /**
   * Set lorebook sort by field
   * @param {'name'|'category'|'updated'} field - Field to sort by
   */
  const setLorebookSortBy = field => {
    if (['name', 'category', 'updated'].includes(field)) {
      state.value.ui.lorebook.sortBy = field
    }
  }

  /**
   * Get lorebook sort by field
   * @returns {'name'|'category'|'updated'} Sort by field
   */
  const getLorebookSortBy = () => {
    return state.value.ui?.lorebook?.sortBy || 'name'
  }

  /**
   * Set lorebook sort order
   * @param {'asc'|'desc'} order - Sort order
   */
  const setLorebookSortOrder = order => {
    if (['asc', 'desc'].includes(order)) {
      state.value.ui.lorebook.sortOrder = order
    }
  }

  /**
   * Get lorebook sort order
   * @returns {'asc'|'desc'} Sort order
   */
  const getLorebookSortOrder = () => {
    return state.value.ui?.lorebook?.sortOrder || 'asc'
  }

  /**
   * Set show provider setup dialog state
   * @param {boolean} show - Whether to show the provider setup dialog
   */
  const setShowProviderSetupDialog = show => {
    state.value.ui.showProviderSetupDialog = show
  }

  /**
   * Get show provider setup dialog state
   * @returns {boolean} Whether to show the provider setup dialog
   */
  const getShowProviderSetupDialog = () => {
    return state.value.ui?.showProviderSetupDialog !== false // Default to true if not set
  }

  /**
   * Computed ref for reactive show provider setup dialog state
   * @type {import('vue').ComputedRef<boolean>}
   */
  const showProviderSetupDialog = computed(() => state.value.ui?.showProviderSetupDialog !== false)

  /**
   * Set show welcome dialog state
   * @param {boolean} show - Whether to show the welcome dialog
   */
  const setShowWelcomeDialog = show => {
    state.value.ui.showWelcomeDialog = show
    // If closing the dialog, save the "don't show again" preference
    if (!show) {
      localStorage.set('ui.welcome.provider-setup.dont-show-again', true)
    }
  }

  /**
   * Get show welcome dialog state
   * @returns {boolean} Whether to show the welcome dialog
   */
  const getShowWelcomeDialog = () => {
    return state.value.ui?.showWelcomeDialog !== false // Default to true if not set
  }

  /**
   * Computed ref for reactive show welcome dialog state
   * @type {import('vue').ComputedRef<boolean>}
   */
  const showWelcomeDialog = computed(() => state.value.ui?.showWelcomeDialog !== false)

  /**
   * Check if the welcome dialog should be shown and show it if necessary
   * Should be called after AI config is initialized
   */
  const checkAndShowWelcomeDialog = async () => {
    // Small delay to ensure everything is properly initialized
    await new Promise(resolve => setTimeout(resolve, 100))

    // Check if user has opted out
    const dontShowAgain = localStorage.get('ui.welcome.provider-setup.dont-show-again', false)
    if (dontShowAgain) {
      state.value.ui.showWelcomeDialog = false
      return
    }

    // Show dialog if user hasn't seen it before
    state.value.ui.showWelcomeDialog = true
  }

  /**
   * Reset state to defaults
   */
  const resetState = () => {
    state.value = JSON.parse(JSON.stringify(defaultState))
  }

  return {
    // Full state ref for advanced usage
    state,

    // Active AI profile
    activeAIPresetId,
    setActiveAIPresetId,
    getActiveAIPresetId,

    // Debug specific
    debug,
    setDebug,

    // How the assistant's document changes are applied
    applyEdits,
    setApplyEdits,

    // Whether the NSFW chat profiles are offered
    nsfwProfiles,
    setNsfwProfiles,

    // The speech server, and whether speakers' lines are coloured
    narration,
    workflows,
    setWorkflow,
    setNarration,
    highlightSpeakers,
    setHighlightSpeakers,

    // Theme specific
    theme,
    setTheme,
    getTheme,

    // Lorebook specific
    setLorebookSortBy,
    getLorebookSortBy,
    setLorebookSortOrder,
    getLorebookSortOrder,

    // Show provider setup dialog specific
    showProviderSetupDialog,
    setShowProviderSetupDialog,
    getShowProviderSetupDialog,

    // Show welcome dialog specific
    showWelcomeDialog,
    setShowWelcomeDialog,
    getShowWelcomeDialog,
    checkAndShowWelcomeDialog,

    // Generic state access for future use
    getState,
    setState,
    resetState,
  }
}
