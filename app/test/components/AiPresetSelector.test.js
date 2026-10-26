import { describe, it, expect, vi } from 'vitest'
import { computed, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import AiPresetSelector from '@/components/writer/settings/ai/AiPresetSelector.vue'

const presets = ref([{ id: 'p1', name: 'Default', isDefault: true }])
const shownId = ref('p1')
const createPreset = vi.fn(name => {
  const preset = { id: `p${presets.value.length + 1}`, name }
  presets.value = [...presets.value, preset]
  shownId.value = preset.id
  return preset
})
const setActiveAIPreset = vi.fn()

vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({
    presets: computed(() => presets.value),
    shownPreset: computed(() => presets.value.find(one => one.id === shownId.value) || null),
    showPreset: id => (shownId.value = id),
    createPreset,
    updatePreset: vi.fn(),
    deletePreset: vi.fn(),
    setActiveAIPreset,
  }),
}))

const mountSelector = () =>
  mount(AiPresetSelector, {
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
    attachTo: document.body,
  })

describe('AiPresetSelector', () => {
  it('shows the preset picked, and leaves the one chats run on as it was', async () => {
    presets.value = [
      { id: 'p1', name: 'Default', isDefault: true },
      { id: 'p2', name: 'GLM' },
    ]
    shownId.value = 'p1'
    const wrapper = mountSelector()

    await wrapper.findComponent({ name: 'Select' }).vm.$emit('update:modelValue', 'p2')

    expect(shownId.value).toBe('p2')
    expect(setActiveAIPreset).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('opens a new preset’s name to be changed, with the focus in it', async () => {
    presets.value = [{ id: 'p1', name: 'Default', isDefault: true }]
    shownId.value = 'p1'
    const wrapper = mountSelector()
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
