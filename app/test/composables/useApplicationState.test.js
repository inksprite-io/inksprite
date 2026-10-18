import { describe, it, expect, beforeEach, vi } from 'vitest'
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
      state.setChatProfileId('chatprofile_mine')
      state.setWorkflow('convert', { providerId: 'p1', model: 'strong', onImport: true })
      state.setNarration({ providerId: 'provider_openai_default', model: 'tts-1' })
      state.setTheme('dark')
      state.setHighlightSpeakers(false)

      expect(state.settingsForBackup()).toEqual({
        aiEnabled: false,
        aiPreset: 'preset_mine',
        applyEdits: 'ask',
        nsfwProfiles: true,
        blurNsfw: true,
        experimentalSkills: ['write'],
        roleplay: true,
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
})
