import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Checkbox from 'primevue/checkbox'
import Tree from 'primevue/tree'
import SettingsExportDialog from '../../src/components/writer/settings/SettingsExportDialog.vue'

const { backup, toast } = vi.hoisted(() => ({
  backup: { listSettings: vi.fn() },
  toast: { error: vi.fn() },
}))

vi.mock('@/composables/useBackup', () => ({ useBackup: () => backup }))
vi.mock('@/composables/useToast', () => ({ useToast: () => toast }))

const SETTINGS = [
  { key: 'aiProviders/provider_proxy', kind: 'aiProviders', name: 'Team proxy' },
  {
    key: 'aiProfiles/profile_team',
    kind: 'aiProfiles',
    name: 'Team',
    needs: ['aiProviders/provider_proxy'],
  },
  { key: 'settings/preferences', kind: 'settings', name: 'Preferences' },
]

const mountDialog = async () => {
  const wrapper = mount(SettingsExportDialog, {
    props: { visible: true },
    global: {
      plugins: [PrimeVue],
      stubs: {
        // Shown as the real one is, saying so as it opens.
        Dialog: {
          props: ['visible'],
          emits: ['show'],
          mounted() {
            this.$emit('show')
          },
          template: '<div v-if="visible" data-dialog><slot /><slot name="footer" /></div>',
        },
      },
    },
  })
  await flushPromises()
  return wrapper
}

const tree = wrapper => wrapper.findComponent(Tree)

/** Whether a box shows ticked. */
const isTicked = (wrapper, key) => Boolean(tree(wrapper).props('selectionKeys')[key]?.checked)

/** Tick boxes as the tree reports a click: the ticks as they now stand. */
const setTicks = async (wrapper, keys) => {
  await tree(wrapper).vm.$emit('update:selectionKeys', keys)
  await flushPromises()
}

const exportButton = wrapper => wrapper.findAll('button').find(b => b.text() === 'Export')

const ticked = { checked: true, partialChecked: false }

describe('SettingsExportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    backup.listSettings.mockResolvedValue(SETTINGS)
  })

  it('opens on the settings under a heading for each kind, all of them ticked', async () => {
    const wrapper = await mountDialog()
    expect(
      tree(wrapper)
        .props('value')
        .map(node => node.label)
    ).toEqual(['Connections', 'Presets', 'App settings'])
    for (const { key } of SETTINGS) expect(isTicked(wrapper, `setting:${key}`)).toBe(true)
  })

  it('hands over the settings ticked, without keys unless ticked, and closes', async () => {
    const wrapper = await mountDialog()
    await setTicks(wrapper, {
      'kind:aiProviders': ticked,
      'setting:aiProviders/provider_proxy': ticked,
    })
    await exportButton(wrapper).trigger('click')
    expect(wrapper.emitted('export')[0][0]).toEqual({
      picked: new Set(['aiProviders/provider_proxy']),
      includeApiKeys: false,
    })
    expect(wrapper.emitted('update:visible').at(-1)).toEqual([false])
  })

  it('includes keys when the box is ticked', async () => {
    const wrapper = await mountDialog()
    const keys = wrapper
      .findAllComponents(Checkbox)
      .find(box => box.props('inputId') === 'settings-export-include-api-keys')
    await keys.vm.$emit('update:modelValue', true)
    await exportButton(wrapper).trigger('click')
    expect(wrapper.emitted('export')[0][0].includeApiKeys).toBe(true)
  })

  it('ticks what a setting needs along with it', async () => {
    const wrapper = await mountDialog()
    await setTicks(wrapper, {})
    await setTicks(wrapper, { 'setting:aiProfiles/profile_team': ticked })
    expect(isTicked(wrapper, 'setting:aiProviders/provider_proxy')).toBe(true)
  })

  it('exports nothing with nothing ticked', async () => {
    const wrapper = await mountDialog()
    await setTicks(wrapper, {})
    expect(exportButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('says so when the settings can’t be read', async () => {
    backup.listSettings.mockRejectedValue(new Error('locked'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await mountDialog()
    expect(toast.error).toHaveBeenCalledWith("The settings couldn't be read. locked")
  })
})
