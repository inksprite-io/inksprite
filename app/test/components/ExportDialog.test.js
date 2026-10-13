import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Checkbox from 'primevue/checkbox'
import RadioButton from 'primevue/radiobutton'
import ExportDialog from '../../src/components/writer/settings/ExportDialog.vue'

const { backup, toast } = vi.hoisted(() => ({
  backup: { listSettings: vi.fn() },
  toast: { error: vi.fn() },
}))

vi.mock('@/composables/useBackup', () => ({ useBackup: () => backup }))
vi.mock('@/composables/useToast', () => ({ useToast: () => toast }))

const ITEMS = [
  { key: 'aiProviders/provider_proxy', kind: 'aiProviders', name: 'Team proxy', picked: true },
  {
    key: 'aiProfiles/profile_team',
    kind: 'aiProfiles',
    name: 'Team',
    picked: true,
    needs: ['aiProviders/provider_proxy'],
  },
  { key: 'mcpServers/mcp_tracker', kind: 'mcpServers', name: 'Tracker', picked: true },
  {
    key: 'settings/preferences',
    kind: 'settings',
    name: 'Preferences: theme, edits, NSFW profiles, speaker colours',
    picked: false,
  },
]

const mountDialog = async () => {
  const wrapper = mount(ExportDialog, {
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

/** Choose everything or the settings, as the writer would. */
const choose = async (wrapper, kind) => {
  const radio = wrapper
    .findAllComponents(RadioButton)
    .find(button => button.props('value') === kind)
  await radio.vm.$emit('update:modelValue', kind)
  await flushPromises()
}

/** The box beside an item. */
const boxOf = (wrapper, key) => wrapper.find(`[data-item="${key}"]`).findComponent(Checkbox)

const isPicked = (wrapper, key) => boxOf(wrapper, key).props('modelValue')

const exportButton = wrapper => wrapper.find('[data-action="export"]')

describe('ExportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    backup.listSettings.mockResolvedValue(ITEMS)
  })

  it('opens on everything, without the settings list, not reading them', async () => {
    const wrapper = await mountDialog()

    expect(wrapper.find('[data-settings-items]').exists()).toBe(false)
    expect(backup.listSettings).not.toHaveBeenCalled()
  })

  it('saves everything, without keys unless ticked, and closes', async () => {
    const wrapper = await mountDialog()

    await exportButton(wrapper).trigger('click')
    expect(wrapper.emitted('export')[0]).toEqual([{ kind: 'backup', includeApiKeys: false }])
    expect(wrapper.emitted('update:visible')).toEqual([[false]])
  })

  it('includes keys when the box is ticked', async () => {
    const wrapper = await mountDialog()

    const keys = wrapper
      .findAllComponents(Checkbox)
      .find(box => box.props('inputId') === 'export-include-api-keys')
    await keys.vm.$emit('update:modelValue', true)
    await exportButton(wrapper).trigger('click')

    expect(wrapper.emitted('export')[0][0].includeApiKeys).toBe(true)
  })

  describe('settings', () => {
    it('lists each item under its kind’s heading, the preferences left unpicked', async () => {
      const wrapper = await mountDialog()
      await choose(wrapper, 'settings')

      expect(wrapper.findAll('h4').map(heading => heading.text())).toEqual([
        'Connections',
        'Presets',
        'MCP servers',
        'App settings',
      ])
      expect(isPicked(wrapper, 'aiProfiles/profile_team')).toBe(true)
      expect(isPicked(wrapper, 'settings/preferences')).toBe(false)
    })

    it('picks what an item needs along with it', async () => {
      const wrapper = await mountDialog()
      await choose(wrapper, 'settings')

      await boxOf(wrapper, 'aiProviders/provider_proxy').vm.$emit('update:modelValue', false)
      await boxOf(wrapper, 'aiProfiles/profile_team').vm.$emit('update:modelValue', false)
      expect(isPicked(wrapper, 'aiProviders/provider_proxy')).toBe(false)

      await boxOf(wrapper, 'aiProfiles/profile_team').vm.$emit('update:modelValue', true)
      expect(isPicked(wrapper, 'aiProviders/provider_proxy')).toBe(true)
    })

    it('hands over what was picked', async () => {
      const wrapper = await mountDialog()
      await choose(wrapper, 'settings')

      await boxOf(wrapper, 'mcpServers/mcp_tracker').vm.$emit('update:modelValue', false)
      await exportButton(wrapper).trigger('click')

      const [choice] = wrapper.emitted('export')[0]
      expect(choice.kind).toBe('settings')
      expect([...choice.picked].sort()).toEqual([
        'aiProfiles/profile_team',
        'aiProviders/provider_proxy',
      ])
      expect(choice.includeApiKeys).toBe(false)
    })

    it('reads the settings once, however often they are chosen', async () => {
      const wrapper = await mountDialog()
      await choose(wrapper, 'settings')
      await boxOf(wrapper, 'mcpServers/mcp_tracker').vm.$emit('update:modelValue', false)
      await choose(wrapper, 'backup')
      await choose(wrapper, 'settings')

      expect(backup.listSettings).toHaveBeenCalledTimes(1)
      expect(isPicked(wrapper, 'mcpServers/mcp_tracker')).toBe(false)
    })

    it('exports nothing with nothing picked', async () => {
      backup.listSettings.mockResolvedValue([ITEMS[3]])
      const wrapper = await mountDialog()
      await choose(wrapper, 'settings')

      expect(exportButton(wrapper).attributes('disabled')).toBeDefined()
    })

    it('goes back to everything when the settings can’t be read', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      backup.listSettings.mockRejectedValue(new Error('closed'))
      const wrapper = await mountDialog()
      await choose(wrapper, 'settings')

      expect(toast.error).toHaveBeenCalledWith("The settings couldn't be read: closed")
      expect(wrapper.find('[data-settings-items]').exists()).toBe(false)
      await exportButton(wrapper).trigger('click')
      expect(wrapper.emitted('export')[0][0].kind).toBe('backup')
    })
  })
})
