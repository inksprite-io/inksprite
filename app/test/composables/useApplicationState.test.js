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
})
