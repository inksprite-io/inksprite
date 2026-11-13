import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'

describe('useSettingsPanel', () => {
  beforeEach(() => {
    const panel = useSettingsPanel()
    panel.close()
    panel.takeSection()
  })

  it('is one state for everyone who asks', () => {
    const asker = useSettingsPanel()
    const shower = useSettingsPanel()

    asker.open()
    expect(shower.visible.value).toBe(true)

    shower.close()
    expect(asker.visible.value).toBe(false)
  })

  it('hands a requested section over once', () => {
    const panel = useSettingsPanel()

    panel.open('skills')
    expect(panel.requestedSection.value).toBe('skills')
    expect(panel.takeSection()).toBe('skills')
    // Taken, so the settings do not keep jumping back to it.
    expect(panel.takeSection()).toBeNull()
  })

  it('names a project other than the one open only for the asking that named it', () => {
    const panel = useSettingsPanel()

    panel.open('project', undefined, 'story_other')
    expect(panel.requestedProject.value).toBe('story_other')

    panel.open('project')
    expect(panel.requestedProject.value).toBeNull()
  })

  it('opens on no section in particular when none is named', () => {
    const panel = useSettingsPanel()
    panel.open()
    expect(panel.visible.value).toBe(true)
    expect(panel.takeSection()).toBeNull()
  })
})
