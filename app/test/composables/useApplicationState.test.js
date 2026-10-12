import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useApplicationState } from '@/composables/useApplicationState'

describe('useApplicationState', () => {
  beforeEach(() => {
    useApplicationState().resetState()
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
  describe('settings in a backup', () => {
    it('carries the choices worth taking to another computer', () => {
      const state = useApplicationState()
      state.setActiveAIPresetId('preset_mine')
      state.setApplyEdits('ask')
      state.setNsfwProfiles(true)
      state.setChatProfileId('chatprofile_mine')
      state.setWorkflow('convert', { providerId: 'p1', model: 'strong', onImport: true })
      state.setNarration({ providerId: 'provider_openai_default', model: 'tts-1' })
      state.setTheme('dark')
      state.setHighlightSpeakers(false)

      expect(state.settingsForBackup()).toEqual({
        aiPreset: 'preset_mine',
        applyEdits: 'ask',
        nsfwProfiles: true,
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
        aiPreset: 'preset_mine',
        applyEdits: 'ask',
        nsfwProfiles: true,
        roleplayProfileId: 'chatprofile_cards',
        workflows: { convert: { providerId: 'p1', model: 'strong', onImport: true } },
        narration: { providerId: 'provider_openai_default', model: 'tts-1' },
        theme: 'dark',
        highlightSpeakers: false,
      })

      expect(state.settingsForBackup()).toMatchObject({
        aiPreset: 'preset_mine',
        applyEdits: 'ask',
        nsfwProfiles: true,
        roleplayProfileId: 'chatprofile_cards',
        workflows: { convert: { providerId: 'p1', model: 'strong', onImport: true } },
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
          nsfwProfiles: 'yes',
          applyEdits: 'sometimes',
          workflows: { convert: { model: 7, onImport: true } },
        })
      )

      expect(state.theme.value).toBe('light')
      expect(state.nsfwProfiles.value).toBe(true)
      expect(state.applyEdits.value).toBe('auto')
      expect(state.workflows.value.convert).toMatchObject({ model: null, onImport: true })
    })
  })
})
