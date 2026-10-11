import { describe, it, expect, vi, afterEach } from 'vitest'
import { computed, ref } from 'vue'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import AiPresetSelector from '@/components/writer/settings/ai/AiPresetSelector.vue'

const presets = ref([{ id: 'p1', name: 'Default', isDefault: true }])
const activeId = ref('p1')
const createPreset = vi.fn(name => {
  const preset = { id: `p${presets.value.length + 1}`, name }
  presets.value = [...presets.value, preset]
  activeId.value = preset.id
  return preset
})

vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({
    presets: computed(() => presets.value),
    activeAIPreset: computed(() => presets.value.find(one => one.id === activeId.value) || null),
    createPreset,
    updatePreset: vi.fn(),
    deletePreset: vi.fn(),
    setActiveAIPreset: id => (activeId.value = id),
  }),
}))

enableAutoUnmount(afterEach)

describe('AiPresetSelector', () => {
  it('opens a new preset’s name to be changed, with the focus in it', async () => {
    const wrapper = mount(AiPresetSelector, {
      global: { plugins: [PrimeVue], directives: { tooltip: {} } },
      attachTo: document.body,
    })
    const menu = wrapper.findComponent({ name: 'Menu' })
    const newPreset = menu.props('model').find(item => item.label === 'New preset')

    await newPreset.command()
    await flushPromises()

    expect(createPreset).toHaveBeenCalledWith('Default copy')
    const field = wrapper.find('input[aria-label="Preset name"]')
    expect(field.element.value).toBe('Default copy')
    expect(document.activeElement).toBe(field.element)
  })
})
