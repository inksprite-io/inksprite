import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reactive } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ToggleSwitch from 'primevue/toggleswitch'
import ConnectionEditor from '@/components/writer/connections/ConnectionEditor.vue'
import ZeroDataRetention from '@/components/writer/settings/ai/ZeroDataRetention.vue'

/** The connections there are, by id. */
const rows = reactive(new Map())
const updateProvider = vi.fn((id, changes) => rows.set(id, { ...rows.get(id), ...changes }))
vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ getProvider: id => rows.get(id) ?? null, updateProvider }),
}))

const remove = vi.fn()
vi.mock('@/composables/useConnections.js', () => ({
  useConnections: () => ({ remove }),
}))

/** What the last confirm asked. */
let asked = null
vi.mock('primevue/useconfirm', () => ({
  useConfirm: () => ({ require: options => (asked = options) }),
}))

/** The connection's key and Connect, saying which connection it is on. */
const ConnectionForm = {
  name: 'ConnectionForm',
  props: ['mode', 'providerId', 'kindId', 'does', 'showState'],
  emits: ['shown'],
  mounted() {
    this.$emit('shown', this.providerId)
  },
  template: '<div data-connection-form />',
}
const ProviderRouting = {
  name: 'ProviderRouting',
  props: ['providerId'],
  template: '<div data-routing />',
}

/** @param {Record<string, any>} [props] */
const mountEditor = async (props = {}) => {
  const wrapper = mount(ConnectionEditor, {
    props,
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      stubs: { ConnectionForm, ProviderRouting },
    },
  })
  await flushPromises()
  return wrapper
}

const form = wrapper => wrapper.findComponent(ConnectionForm)
const zdr = wrapper => wrapper.findComponent(ZeroDataRetention)
const concurrency = wrapper => wrapper.find('[data-field="concurrency"]')

describe('ConnectionEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asked = null
    rows.clear()
    rows.set('p_nano', { id: 'p_nano', name: 'NanoGPT', type: 'nanogpt', apiKey: 'sk-nano' })
    rows.set('p_or', { id: 'p_or', name: 'OpenRouter', type: 'openrouter', apiKey: 'sk-or' })
    rows.set('p_box', {
      id: 'p_box',
      name: 'Box',
      type: 'generic',
      endpoint: 'http://box:1234/v1',
    })
    rows.set('p_slots', {
      id: 'p_slots',
      name: 'Slots',
      type: 'llamacpp',
      endpoint: 'http://slots:8080',
    })
  })

  describe('the form', () => {
    it('is the connection’s own, saying how it answered where nothing else does', async () => {
      const wrapper = await mountEditor({ providerId: 'p_box' })

      expect(form(wrapper).props()).toMatchObject({
        mode: 'edit',
        providerId: 'p_box',
        showState: true,
      })
    })

    it('leaves how it answered to its card, in one', async () => {
      const wrapper = await mountEditor({ providerId: 'p_box', inCard: true })
      expect(form(wrapper).props('showState')).toBe(false)
    })

    it('is a new connection’s with none given, with nothing under it until one is made', async () => {
      const wrapper = await mountEditor({ kindId: 'nanogpt', does: 'chat' })

      expect(form(wrapper).props()).toMatchObject({
        mode: 'add',
        providerId: null,
        kindId: 'nanogpt',
        does: 'chat',
      })
      expect(concurrency(wrapper).exists()).toBe(false)
      expect(wrapper.find('[data-action="remove-connection"]').exists()).toBe(false)

      // The form made one: its settings follow, and its holder is told.
      await form(wrapper).vm.$emit('shown', 'p_nano')
      expect(wrapper.emitted('shown')?.at(-1)).toEqual(['p_nano'])
      expect(zdr(wrapper).exists()).toBe(true)
      expect(wrapper.find('[data-action="remove-connection"]').exists()).toBe(true)
    })
  })

  describe('zero data retention', () => {
    it('is NanoGPT’s switch, on until it is switched off', async () => {
      const wrapper = await mountEditor({ providerId: 'p_nano' })

      expect(zdr(wrapper).props()).toEqual({ modelValue: true, overridden: false })
      expect(wrapper.find('[data-routing]').exists()).toBe(false)
    })

    it('is kept off beside what the routing held, and put back by the reset', async () => {
      rows.set('p_nano', { ...rows.get('p_nano'), routing: { ignore: ['alder'] } })
      const wrapper = await mountEditor({ providerId: 'p_nano' })

      await wrapper
        .findComponent(ZeroDataRetention)
        .findComponent(ToggleSwitch)
        .vm.$emit('update:modelValue', false)

      expect(updateProvider).toHaveBeenLastCalledWith('p_nano', {
        routing: { ignore: ['alder'], zdr: false },
      })
      expect(zdr(wrapper).props()).toEqual({ modelValue: false, overridden: true })

      await wrapper.find('button[aria-label="Reset Zero data retention"]').trigger('click')

      expect(updateProvider).toHaveBeenLastCalledWith('p_nano', {
        routing: { ignore: ['alder'], zdr: true },
      })
      expect(zdr(wrapper).props()).toEqual({ modelValue: true, overridden: false })
    })

    it('is among OpenRouter’s provider routing instead, on an OpenRouter connection', async () => {
      const wrapper = await mountEditor({ providerId: 'p_or' })

      expect(wrapper.findComponent(ProviderRouting).props('providerId')).toBe('p_or')
      expect(zdr(wrapper).exists()).toBe(false)
    })

    it('is nowhere on any other connection, which routes nothing', async () => {
      const wrapper = await mountEditor({ providerId: 'p_box' })

      expect(zdr(wrapper).exists()).toBe(false)
      expect(wrapper.find('[data-routing]').exists()).toBe(false)
    })
  })

  describe('requests at once', () => {
    it('says what each kind is asked at once until a number is typed', async () => {
      expect(concurrency(await mountEditor({ providerId: 'p_or' })).attributes('placeholder')).toBe(
        'No limit'
      )
      expect(
        concurrency(await mountEditor({ providerId: 'p_box' })).attributes('placeholder')
      ).toBe('1')
      expect(
        concurrency(await mountEditor({ providerId: 'p_slots' })).attributes('placeholder')
      ).toBe('One per slot')
    })

    it('keeps a whole number from one up as the field is left, or on Enter', async () => {
      const wrapper = await mountEditor({ providerId: 'p_box' })

      await concurrency(wrapper).setValue(' 3 ')
      await concurrency(wrapper).trigger('blur')
      expect(updateProvider).toHaveBeenLastCalledWith('p_box', { concurrency: 3 })

      await concurrency(wrapper).setValue('2')
      await concurrency(wrapper).trigger('keydown.enter')
      expect(updateProvider).toHaveBeenLastCalledWith('p_box', { concurrency: 2 })
    })

    it('goes back to the kind’s own once it is emptied', async () => {
      rows.set('p_box', { ...rows.get('p_box'), concurrency: 4 })
      const wrapper = await mountEditor({ providerId: 'p_box' })
      expect(concurrency(wrapper).element.value).toBe('4')

      await concurrency(wrapper).setValue('')
      await concurrency(wrapper).trigger('blur')

      expect(updateProvider).toHaveBeenLastCalledWith('p_box', { concurrency: undefined })
    })

    it('puts back what was there for anything else, keeping nothing', async () => {
      rows.set('p_box', { ...rows.get('p_box'), concurrency: 4 })
      const wrapper = await mountEditor({ providerId: 'p_box' })

      for (const typed of ['0', '-2', '1.5', 'many']) {
        await concurrency(wrapper).setValue(typed)
        await concurrency(wrapper).trigger('blur')
        expect(concurrency(wrapper).element.value).toBe('4')
      }
      expect(updateProvider).not.toHaveBeenCalled()
    })

    it('is not asked of a connection that only speaks', async () => {
      const id = 'provider_kokoro_default'
      rows.set(id, { id, name: 'Kokoro', type: 'generic', endpoint: 'http://localhost:8880/v1' })
      const wrapper = await mountEditor({ providerId: id })

      expect(concurrency(wrapper).exists()).toBe(false)
      expect(wrapper.find('[data-action="remove-connection"]').exists()).toBe(true)
    })
  })

  describe('Remove', () => {
    it('asks first, saying a key can’t be brought back, then removes it and says so', async () => {
      const wrapper = await mountEditor({ providerId: 'p_nano' })

      await wrapper.find('[data-action="remove-connection"]').trigger('click')

      expect(asked.message).toBe("Remove NanoGPT? Its key can't be brought back.")
      expect(remove).not.toHaveBeenCalled()

      asked.accept()
      expect(remove).toHaveBeenCalledWith('p_nano')
      expect(wrapper.emitted('removed')).toHaveLength(1)
    })

    it('says nothing of a key where the connection has none', async () => {
      const wrapper = await mountEditor({ providerId: 'p_box' })
      await wrapper.find('[data-action="remove-connection"]').trigger('click')
      expect(asked.message).toBe('Remove Box?')
    })
  })
})
