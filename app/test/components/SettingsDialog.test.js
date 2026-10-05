import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SettingsDialog from '@/components/writer/settings/SettingsDialog.vue'

vi.mock('@/components/writer/settings/Settings.vue', () => ({
  default: { name: 'Settings', template: '<div data-settings />' },
}))

const Dialog = {
  name: 'Dialog',
  props: ['visible', 'closeOnEscape'],
  template: '<div data-dialog :data-close-on-escape="String(closeOnEscape)"><slot /></div>',
}

describe('SettingsDialog', () => {
  it('keeps Escape for itself, so a dialog opened over it is the only one closed', () => {
    const wrapper = mount(SettingsDialog, {
      props: { visible: true },
      global: { stubs: { Dialog } },
    })
    expect(wrapper.find('[data-dialog]').attributes('data-close-on-escape')).toBe('false')
  })
})
