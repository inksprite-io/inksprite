import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AiConfigSection from '@/components/writer/settings/ai/AiConfigSection.vue'

describe('AiConfigSection', () => {
  it('has the preset the AI runs on, and no switch for it', () => {
    const wrapper = mount(AiConfigSection, {
      global: { stubs: { AiPresetGroup: { template: '<div data-preset-group />' } } },
    })
    expect(wrapper.find('[data-preset-group]').exists()).toBe(true)
    expect(wrapper.find('[data-ai-enabled]').exists()).toBe(false)
  })
})
