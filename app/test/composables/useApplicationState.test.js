/* global structuredClone */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { useApplicationState } from '@/composables/useApplicationState'

describe('useApplicationState', () => {
  beforeEach(() => {
    useApplicationState().resetState()
  })

  describe('spelling', () => {
    it("starts on, in the dialect of the browser's language, with grammar", () => {
      // happy-dom's browser speaks American English.
      expect(useApplicationState().spelling.value).toEqual({
        enabled: true,
        dialect: 'american',
        grammar: true,
        words: [],
      })
    })

    it('switches off and on, keeping its dialect', () => {
      const { setSpellingEnabled, setSpellingDialect, spelling } = useApplicationState()
      setSpellingDialect('british')
      setSpellingEnabled(false)
      expect(spelling.value).toMatchObject({ enabled: false, dialect: 'british' })
      setSpellingEnabled(true)
      expect(spelling.value).toMatchObject({ enabled: true, dialect: 'british' })
    })

    it('takes only a dialect it knows', () => {
      const { setSpellingDialect, spelling } = useApplicationState()
      setSpellingDialect('british')
      // @ts-expect-error - the point of the test
      setSpellingDialect('browser')
      expect(spelling.value.dialect).toBe('british')
    })

    it("reads the browser's own checker, as a state saved before the switch has it, as off", async () => {
      window.localStorage.setItem(
        'inksprite_app_state',
        JSON.stringify({ spelling: { dialect: 'browser', grammar: true, words: [] } })
      )
      vi.resetModules()
      const fresh = await import('@/composables/useApplicationState')
      expect(fresh.useApplicationState().spelling.value).toMatchObject({
        enabled: false,
        dialect: 'american',
      })
      window.localStorage.removeItem('inksprite_app_state')
    })

    it('keeps each word once, and lets it go', () => {
      const { addWord, removeWord, spelling } = useApplicationState()
      addWord('Tavrek')
      addWord('Tavrek')
      addWord('Quellith')
      expect(spelling.value.words).toEqual(['Tavrek', 'Quellith'])
      removeWord('Tavrek')
      expect(spelling.value.words).toEqual(['Quellith'])
    })

    it('goes into a backup as chosen, and comes back', () => {
      const state = useApplicationState()
      expect(state.settingsForBackup().spelling).toEqual({
        enabled: null,
        dialect: null,
        grammar: true,
        words: [],
      })
      state.setSpellingDialect('canadian')
      state.setSpellingEnabled(false)
      state.setGrammar(false)
      state.addWord('Tavrek')
      const saved = state.settingsForBackup().spelling
      state.resetState()
      state.restoreSettings({ spelling: saved })
      expect(state.spelling.value).toEqual({
        enabled: false,
        dialect: 'canadian',
        grammar: false,
        words: ['Tavrek'],
      })
    })

    it("takes a backup's choice left to the browser's language as left to it here", () => {
      const state = useApplicationState()
      state.setSpellingEnabled(false)
      state.setSpellingDialect('british')
      state.restoreSettings({
        spelling: { enabled: null, dialect: null, grammar: true, words: [] },
      })
      expect(state.settingsForBackup().spelling).toMatchObject({ enabled: null, dialect: null })
    })

    it("reads a backup's browser's own checker as off", () => {
      const state = useApplicationState()
      state.restoreSettings(
        /** @type {any} */ ({ spelling: { dialect: 'browser', grammar: true, words: [] } })
      )
      expect(state.spelling.value.enabled).toBe(false)
    })

    it('keeps what a file gets wrong as it was', () => {
      const state = useApplicationState()
      state.addWord('Tavrek')
      state.setSpellingDialect('british')
      state.restoreSettings(
        /** @type {any} */ ({
          spelling: { enabled: 'yes', dialect: 'klingon', grammar: 'yes', words: [3] },
        })
      )
      expect(state.spelling.value).toEqual({
        enabled: true,
        dialect: 'british',
        grammar: true,
        words: ['Tavrek'],
      })
    })
  })

  describe('applyEdits', () => {
    it("applies the assistant's changes automatically until told otherwise", () => {
      expect(useApplicationState().applyEdits.value).toBe('auto')
    })

    it('is app-wide: set once, read everywhere', () => {
      const { setApplyEdits } = useApplicationState()
      setApplyEdits('ask')
      expect(useApplicationState().applyEdits.value).toBe('ask')
      setApplyEdits('auto')
      expect(useApplicationState().applyEdits.value).toBe('auto')
    })

    it('ignores a mode it does not know', () => {
      const { setApplyEdits, applyEdits } = useApplicationState()
      setApplyEdits('ask')
      // @ts-expect-error - the point of the test
      setApplyEdits('maybe')
      expect(applyEdits.value).toBe('ask')
    })
  })

  describe('workflows', () => {
    it('reads a state saved while they were called roles', async () => {
      window.localStorage.setItem(
        'inksprite_app_state',
        JSON.stringify({
          roles: { convert: { providerId: 'p1', model: 'strong', onImport: true } },
        })
      )
      vi.resetModules()
      const fresh = await import('@/composables/useApplicationState')

      expect(fresh.useApplicationState().workflows.value.convert).toMatchObject({
        providerId: 'p1',
        model: 'strong',
        onImport: true,
      })
      window.localStorage.removeItem('inksprite_app_state')
    })

    it('keeps what one is set to, and leaves the rest of it', () => {
      const { setWorkflow, workflows } = useApplicationState()
      setWorkflow('convert', { providerId: 'p1', model: 'strong' })
      setWorkflow('convert', { reasoningEffort: 'low' })

      expect(workflows.value.convert).toMatchObject({
        providerId: 'p1',
        model: 'strong',
        reasoningEffort: 'low',
        onImport: false,
      })
    })
  })

  describe('askBeforeExploring', () => {
    it('asks until switched off, and app-wide', () => {
      const a = useApplicationState()
      const b = useApplicationState()
      expect(a.askBeforeExploring.value).toBe(true)
      a.setAskBeforeExploring(false)
      expect(b.askBeforeExploring.value).toBe(false)
      expect(a.state.value.system.askBeforeExploring).toBe(false)
    })

    it('reads the switch from a state saved while explore was a workflow', async () => {
      window.localStorage.setItem(
        'inksprite_app_state',
        JSON.stringify({
          workflows: {
            convert: { providerId: 'p1', model: 'strong' },
            explore: { providerId: 'p1', model: 'cheap', askFirst: false },
          },
        })
      )
      vi.resetModules()
      const fresh = (await import('@/composables/useApplicationState')).useApplicationState()

      expect(fresh.askBeforeExploring.value).toBe(false)
      // Moved, not copied: nothing else reads it there.
      expect(fresh.workflows.value.explore).toEqual({
        providerId: 'p1',
        model: 'cheap',
      })
      expect(fresh.settingsForBackup().askBeforeExploring).toBe(false)
      window.localStorage.removeItem('inksprite_app_state')
    })

    it('keeps the switch where it is now over one left where it was', async () => {
      window.localStorage.setItem(
        'inksprite_app_state',
        JSON.stringify({
          system: { askBeforeExploring: true },
          workflows: { explore: { askFirst: false } },
        })
      )
      vi.resetModules()
      const fresh = (await import('@/composables/useApplicationState')).useApplicationState()

      expect(fresh.askBeforeExploring.value).toBe(true)
      expect(fresh.workflows.value.explore).not.toHaveProperty('askFirst')
      window.localStorage.removeItem('inksprite_app_state')
    })

    it('takes it from a backup or a settings file made since, or from before', () => {
      const state = useApplicationState()
      state.restoreSettings({ askBeforeExploring: false })
      expect(state.askBeforeExploring.value).toBe(false)

      // From before, it was the Explore workflow's.
      state.restoreSettings(
        /** @type {any} */ ({ workflows: { explore: { providerId: null, askFirst: true } } })
      )
      expect(state.askBeforeExploring.value).toBe(true)
      expect(state.workflows.value.explore).not.toHaveProperty('askFirst')

      // One that has both says it where it is now.
      state.restoreSettings(
        /** @type {any} */ ({
          askBeforeExploring: false,
          workflows: { explore: { askFirst: true } },
        })
      )
      expect(state.askBeforeExploring.value).toBe(false)

      // And one that has neither leaves it.
      state.restoreSettings({ theme: 'dark' })
      expect(state.askBeforeExploring.value).toBe(false)
    })
  })

  describe('nsfwProfiles', () => {
    it('is off until switched on, and app-wide', () => {
      const a = useApplicationState()
      const b = useApplicationState()
      expect(a.nsfwProfiles.value).toBe(false)
      a.setNsfwProfiles(true)
      expect(b.nsfwProfiles.value).toBe(true)
      a.setNsfwProfiles(false)
      expect(b.nsfwProfiles.value).toBe(false)
    })
  })

  describe('experimentalSkills', () => {
    it('has each off until switched on, and app-wide', () => {
      const a = useApplicationState()
      const b = useApplicationState()
      expect(a.experimentalSkills.value).toEqual([])
      a.setExperimentalSkill('write', true)
      a.setExperimentalSkill('interpret', true)
      a.setExperimentalSkill('write', true)
      expect(b.experimentalSkills.value).toEqual(['interpret', 'write'])
      a.setExperimentalSkill('write', false)
      expect(b.experimentalSkills.value).toEqual(['interpret'])
    })

    it('reads anything but a list of names as none on', () => {
      const state = useApplicationState()
      state.state.value.system.experimentalSkills = true

      expect(state.experimentalSkills.value).toEqual([])
    })
  })

  describe('aiEnabled', () => {
    it('is on until switched off, and app-wide', () => {
      const a = useApplicationState()
      const b = useApplicationState()
      expect(a.aiEnabled.value).toBe(true)
      a.setAiEnabled(false)
      expect(b.aiEnabled.value).toBe(false)
      a.setAiEnabled(true)
      expect(b.aiEnabled.value).toBe(true)
    })
  })

  describe('compactText', () => {
    it('is on until switched off, and app-wide', () => {
      const a = useApplicationState()
      const b = useApplicationState()
      expect(a.compactText.value).toBe(true)
      a.setCompactText(false)
      expect(b.compactText.value).toBe(false)
      a.setCompactText(true)
      expect(b.compactText.value).toBe(true)
    })
  })

  describe('debug', () => {
    it('is off until switched on, and app-wide', () => {
      const a = useApplicationState()
      const b = useApplicationState()
      expect(a.debug.value).toBe(false)
      a.setDebug(true)
      expect(b.debug.value).toBe(true)
      a.setDebug(false)
      expect(b.debug.value).toBe(false)
    })

    it('counts the switch saved under its old name, and writes the new one', () => {
      const app = useApplicationState()
      app.state.value.debug = { saveContext: true }
      expect(app.debug.value).toBe(true)

      app.setDebug(false)
      expect(app.debug.value).toBe(false)
      expect(app.state.value.debug.saveContext).toBeUndefined()
      expect(app.state.value.debug.enabled).toBe(false)
    })
  })
  describe('extensions', () => {
    it('has none decided until the app decides them', () => {
      const state = useApplicationState()
      expect(state.extensionOn('roleplay')).toBeUndefined()
      expect(state.roleplay.value).toBe(false)
    })

    it('has roleplay only with its extension on and the AI', () => {
      const state = useApplicationState()
      state.setExtension('roleplay', true)
      expect(state.extensionOn('roleplay')).toBe(true)
      expect(state.roleplay.value).toBe(true)

      state.setAiEnabled(false)
      expect(state.roleplay.value).toBe(false)
      expect(state.extensionOn('roleplay')).toBe(true)
    })

    it('takes the switch from a backup that has it, and keeps it from one that has not', () => {
      const state = useApplicationState()
      state.setExtension('roleplay', true)
      state.restoreSettings({ theme: 'dark' })
      expect(state.extensionOn('roleplay')).toBe(true)

      state.restoreSettings({ roleplay: false })
      expect(state.extensionOn('roleplay')).toBe(false)
    })
  })

  describe('settings in a backup', () => {
    it('carries the choices worth taking to another computer', () => {
      const state = useApplicationState()
      state.setAiEnabled(false)
      state.setActiveAIPresetId('preset_mine')
      state.setApplyEdits('ask')
      state.setNsfwProfiles(true)
      state.setExperimentalSkill('write', true)
      state.setExtension('roleplay', true)
      state.setExtension('python', true)
      state.setPythonProfiles(['chatprofile_mine'])
      state.setPythonTimeLimit(3600)
      state.setChatProfileId('chatprofile_mine')
      state.setWorkflow('convert', { providerId: 'p1', model: 'strong', onImport: true })
      state.setNarration({ providerId: 'provider_openai_default', model: 'tts-1' })
      state.setTheme('dark')
      state.setHighlightSpeakers(false)

      expect(state.settingsForBackup()).toEqual({
        aiEnabled: false,
        aiPreset: 'preset_mine',
        applyEdits: 'ask',
        askBeforeExploring: true,
        nsfwProfiles: true,
        blurNsfw: true,
        experimentalSkills: ['write'],
        roleplay: true,
        python: true,
        pythonProfiles: ['chatprofile_mine'],
        pythonTimeLimit: 3600,
        chatProfileId: 'chatprofile_mine',
        roleplayProfileId: null,
        workflows: {
          convert: {
            providerId: 'p1',
            model: 'strong',
            reasoningEffort: null,
            onImport: true,
          },
        },
        narration: { providerId: 'provider_openai_default', model: 'tts-1' },
        theme: 'dark',
        highlightSpeakers: false,
        spelling: { enabled: null, dialect: null, grammar: true, words: [] },
      })
    })

    it('are plain all through, for sync to keep in IndexedDB', () => {
      const state = useApplicationState()
      state.setWorkflow('convert', {
        allowedProviders: ['anthropic'],
        ignoredProviders: ['novita'],
      })
      state.addWord('Zorb')

      expect(() => structuredClone(state.settingsForBackup())).not.toThrow()
    })

    it('leaves out what belongs to this browser', () => {
      const state = useApplicationState()
      state.setDebug(true)
      state.setCompactText(false)

      const settings = state.settingsForBackup()
      expect(JSON.stringify(settings)).not.toMatch(/debug|compact|Dialog/i)
    })

    it('takes them back, and writes them out at once for the reload', () => {
      const state = useApplicationState()
      state.restoreSettings({
        aiEnabled: false,
        aiPreset: 'preset_mine',
        applyEdits: 'ask',
        nsfwProfiles: true,
        experimentalSkills: ['interpret', 7],
        roleplayProfileId: 'chatprofile_cards',
        workflows: {
          convert: {
            providerId: 'p1',
            model: 'strong',
            ignoredProviders: ['novita'],
            onImport: true,
          },
        },
        narration: { providerId: 'provider_openai_default', model: 'tts-1' },
        theme: 'dark',
        highlightSpeakers: false,
      })

      expect(state.settingsForBackup()).toMatchObject({
        aiEnabled: false,
        aiPreset: 'preset_mine',
        applyEdits: 'ask',
        nsfwProfiles: true,
        experimentalSkills: ['interpret'],
        roleplayProfileId: 'chatprofile_cards',
        workflows: {
          convert: {
            providerId: 'p1',
            model: 'strong',
            ignoredProviders: ['novita'],
            onImport: true,
          },
        },
        theme: 'dark',
        highlightSpeakers: false,
      })
      const saved = JSON.parse(window.localStorage.getItem('inksprite_app_state') || '{}')
      expect(saved.ui.theme).toBe('dark')
      expect(saved.system.applyEdits).toBe('ask')
      expect(saved.narration).toEqual({ providerId: 'provider_openai_default', model: 'tts-1' })
    })

    it('keeps what the file leaves out or gets wrong', () => {
      const state = useApplicationState()
      state.setTheme('light')
      state.setNsfwProfiles(true)

      state.restoreSettings(
        /** @type {any} */ ({
          theme: 'purple',
          aiEnabled: 'no',
          nsfwProfiles: 'yes',
          applyEdits: 'sometimes',
          workflows: { convert: { model: 7, ignoredProviders: 'novita', onImport: true } },
        })
      )

      expect(state.theme.value).toBe('light')
      expect(state.aiEnabled.value).toBe(true)
      expect(state.nsfwProfiles.value).toBe(true)
      expect(state.applyEdits.value).toBe('auto')
      expect(state.workflows.value.convert).toMatchObject({ model: null, onImport: true })
      expect(state.workflows.value.convert).not.toHaveProperty('ignoredProviders')
    })
  })

  describe('in more than one window', () => {
    /** Another window of the app saves its settings. */
    const savedElsewhere = state => {
      const newValue = JSON.stringify(state)
      window.localStorage.setItem('inksprite_app_state', newValue)
      window.dispatchEvent(
        new window.StorageEvent('storage', {
          key: 'inksprite_app_state',
          newValue,
          storageArea: window.localStorage,
        })
      )
    }

    it('takes the settings another window saved, without saving them back', async () => {
      const { aiEnabled } = useApplicationState()
      await nextTick()

      savedElsewhere({ system: { aiEnabled: false } })
      await nextTick()
      expect(aiEnabled.value).toBe(false)
      // As the other window wrote it, not this one's fuller copy of it.
      expect(window.localStorage.getItem('inksprite_app_state')).toBe(
        JSON.stringify({ system: { aiEnabled: false } })
      )
    })

    it('saves its own next change on top of them', async () => {
      const { aiEnabled, setAiEnabled, spelling } = useApplicationState()
      savedElsewhere({ system: { aiEnabled: false }, spelling: { dialect: 'british' } })
      await nextTick()

      setAiEnabled(true)
      await nextTick()
      const saved = JSON.parse(window.localStorage.getItem('inksprite_app_state'))
      expect(saved.system.aiEnabled).toBe(true)
      expect(saved.spelling.dialect).toBe('british')
      expect(aiEnabled.value).toBe(true)
      expect(spelling.value.dialect).toBe('british')
    })
  })
})
