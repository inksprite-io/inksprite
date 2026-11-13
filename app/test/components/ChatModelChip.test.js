/* global MouseEvent */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ChatModelChip from '@/components/writer/chats/ChatModelChip.vue'

const providers = {
  openrouter: { id: 'openrouter', name: 'OpenRouter', type: 'openrouter' },
  local: { id: 'local', name: 'Box', type: 'generic', endpoint: 'http://box:1234/v1' },
}
vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ getProvider: id => providers[id] || null }),
}))

// The writer's connections that chat.
const theirs = ref([providers.openrouter, providers.local])
vi.mock('@/composables/useConnections.js', () => ({
  useConnections: () => ({ connectionsFor: () => theirs.value }),
}))

// The models chosen lately, newest first.
const recentModels = ref([])
vi.mock('@/composables/useApplicationState', () => ({
  useApplicationState: () => ({ recentModels }),
}))

// The chat's settings, as useChatSettings hands them over.
const preset = ref({ providerId: 'openrouter', model: 'some/model' })
const reasoningEffort = ref('medium')
const setModel = vi.fn()
const setReasoningEffort = vi.fn()
vi.mock('@/composables/useChatSettings', () => ({
  useChatSettings: () => ({ preset, setModel, reasoningEffort, setReasoningEffort }),
}))

// The models each connection's list describes, by connection.
const listed = ref({})
const load = vi.fn(async () => [])
vi.mock('@/composables/useModelLists', () => ({
  useModelLists: () => ({
    listOf: id => (listed.value[id] ? { models: listed.value[id] } : undefined),
    load,
  }),
}))

/** The popover, being asked to open and shut. */
const popover = { show: vi.fn(), hide: vi.fn(), toggle: vi.fn() }

/** Mount it with the popover open: its content, as it shows once opened. */
const mountQuick = (attrs = {}) =>
  mount(ChatModelChip, {
    props: { storyId: 'story_1', chatId: 'chat_1' },
    attrs,
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      stubs: {
        Popover: {
          template: '<div data-popover><slot /></div>',
          methods: popover,
        },
      },
    },
  })

const chip = wrapper => wrapper.find('[data-chat-model-chip]')

/** What the chip says, a part at a time: the connection, the model, the effort. */
const words = wrapper =>
  chip(wrapper)
    .findAll('span')
    .filter(span => span.element.children.length === 0)
    .map(span => span.text())

const modelSelect = wrapper => wrapper.findComponent('[data-quick-model]')
const effortSelect = wrapper => wrapper.findComponent('[data-quick-effort]')

describe('ChatModelChip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    preset.value = { providerId: 'openrouter', model: 'some/model' }
    theirs.value = [providers.openrouter, providers.local]
    recentModels.value = []
    reasoningEffort.value = 'medium'
    listed.value = {}
  })

  it('lists the chat’s model, then those used lately, then the recommended ones', async () => {
    listed.value = { openrouter: [{ id: 'some/model', name: 'Some Model' }] }
    recentModels.value = [
      { providerId: 'local', model: 'qwen' },
      { providerId: 'openrouter', model: 'some/model' },
      // On a connection removed since.
      { providerId: 'gone', model: 'old' },
    ]
    const select = modelSelect(mountQuick())

    expect(select.props('modelValue')).toBe('openrouter\nsome/model')
    // Eight at most: the rest are OpenRouter's recommended ones.
    expect(select.props('options').map(one => [one.label, one.detail])).toEqual([
      ['Some Model', 'OpenRouter'],
      ['qwen', 'Box'],
      ['~anthropic/claude-sonnet-latest', 'OpenRouter'],
      ['z-ai/glm-5.2', 'OpenRouter'],
      ['~google/gemini-flash-latest', 'OpenRouter'],
      ['~moonshotai/kimi-latest', 'OpenRouter'],
      ['~deepseek/deepseek-pro-latest', 'OpenRouter'],
      ['google/gemma-4-31b-it:free', 'OpenRouter'],
    ])

    await select.vm.$emit('update:modelValue', 'local\nqwen')
    expect(setModel).toHaveBeenCalledWith('local', 'qwen')
  })

  it('offers no recommended ones for a connection with none, and names no connection where there is one', () => {
    theirs.value = [providers.local]
    preset.value = { providerId: 'local', model: 'qwen' }

    expect(
      modelSelect(mountQuick())
        .props('options')
        .map(one => [one.label, one.detail])
    ).toEqual([['qwen', '']])
  })

  it('offers a model only the efforts it takes, and shows the one it would be sent', async () => {
    // Always thinks, at two levels: no Disabled, and Medium is sent as High.
    listed.value = {
      openrouter: [
        {
          id: 'some/model',
          traits: {
            reasoning: { optional: false, levels: ['high', 'xhigh'], defaultLevel: 'high' },
          },
        },
      ],
    }
    const wrapper = mountQuick()
    const select = effortSelect(wrapper)

    expect(select.props('options').map(option => option.value)).toEqual(['high', 'xhigh'])
    expect(select.props('modelValue')).toBe('high')

    await select.vm.$emit('update:modelValue', 'xhigh')
    expect(setReasoningEffort).toHaveBeenCalledWith('xhigh')
  })

  it('offers what there always was while the model is not described', () => {
    expect(
      effortSelect(mountQuick())
        .props('options')
        .map(option => option.value)
    ).toEqual(['disabled', 'enabled', 'low', 'medium', 'high'])
  })

  it('greys the effort out for a model with none to choose, rather than taking it away', () => {
    preset.value = { providerId: 'local', model: 'qwen' }
    const select = effortSelect(mountQuick())

    expect(select.exists()).toBe(true)
    expect(select.props('disabled')).toBe(true)
  })

  it('opens the settings on every model from Other models…', async () => {
    const { useSettingsPanel } = await import('@/composables/useSettingsPanel.js')
    const panel = useSettingsPanel()
    panel.close()
    const wrapper = mountQuick()

    await wrapper.find('[data-action="other-models"]').trigger('click')

    expect(panel.visible.value).toBe(true)
    expect(panel.takeSection()).toBe('models')
    panel.close()
  })

  it('has Other models… as a button under the effort, not a row among the models', () => {
    const wrapper = mountQuick()
    const other = wrapper.find('[data-action="other-models"]')

    expect(other.element.tagName).toBe('BUTTON')
    expect(other.text()).toBe('Other models…')
    expect(
      modelSelect(wrapper)
        .props('options')
        .some(option => /other models/i.test(option.label))
    ).toBe(false)
    // The model, the effort, then the button.
    const order = [
      ...wrapper
        .find('[data-popover]')
        .element.querySelectorAll(
          '[data-quick-model], [data-quick-effort], [data-action="other-models"]'
        ),
    ]
    expect(order.at(-1)).toBe(other.element)
    expect(order).toHaveLength(3)
  })

  it('shuts the popover as Other models… opens the settings', async () => {
    const { useSettingsPanel } = await import('@/composables/useSettingsPanel.js')
    const wrapper = mountQuick()

    await wrapper.find('[data-action="other-models"]').trigger('click')

    expect(popover.hide).toHaveBeenCalled()
    useSettingsPanel().takeSection()
    useSettingsPanel().close()
  })

  describe('the chip', () => {
    it('says the connection, the model by its listed name, and the effort', () => {
      listed.value = { openrouter: [{ id: 'some/model', name: 'Some Model' }] }
      const wrapper = mountQuick()

      expect(words(wrapper)).toEqual(['OpenRouter', 'Some Model', 'Medium'])
      expect(chip(wrapper).attributes('aria-label')).toBe('Model: OpenRouter, Some Model, Medium')
      expect(chip(wrapper).attributes('aria-haspopup')).toBe('true')
    })

    it('leaves out the maker OpenRouter puts before a name, but says it to a screen reader', () => {
      listed.value = { openrouter: [{ id: 'some/model', name: 'Makers: Some Model' }] }
      const wrapper = mountQuick()

      expect(chip(wrapper).find('.font-medium').text()).toBe('Some Model')
      expect(chip(wrapper).attributes('aria-label')).toBe(
        'Model: OpenRouter, Makers: Some Model, Medium'
      )
    })

    it('says a model not listed by its id, without the path before it', () => {
      const wrapper = mountQuick()

      expect(chip(wrapper).find('.font-medium').text()).toBe('model')
    })

    it('says Thinking off and Thinking for a switch, and a level by its name', async () => {
      const wrapper = mountQuick()

      reasoningEffort.value = 'disabled'
      await wrapper.vm.$nextTick()
      expect(words(wrapper)).toEqual(['OpenRouter', 'model', 'Thinking off'])

      reasoningEffort.value = 'enabled'
      await wrapper.vm.$nextTick()
      expect(words(wrapper)).toEqual(['OpenRouter', 'model', 'Thinking'])

      reasoningEffort.value = 'high'
      await wrapper.vm.$nextTick()
      expect(words(wrapper)).toEqual(['OpenRouter', 'model', 'High'])
    })

    it('says no effort for a model with none to choose', () => {
      preset.value = { providerId: 'local', model: 'qwen' }
      const wrapper = mountQuick()

      expect(words(wrapper)).toEqual(['Box', 'qwen'])
      expect(chip(wrapper).attributes('aria-label')).toBe('Model: Box, qwen')
    })

    it('says Choose a model for a chat with none', () => {
      preset.value = null
      const wrapper = mountQuick()

      expect(chip(wrapper).text()).toBe('Choose a model')
      expect(chip(wrapper).attributes('aria-label')).toBe('Model: Choose a model')
      expect(modelSelect(wrapper).props('modelValue')).toBeNull()
    })

    it('leaves the connection out of a row under 28rem, and never shrinks the effort', () => {
      const wrapper = mountQuick()
      const connection = chip(wrapper)
        .findAll('span')
        .find(span => span.text() === 'OpenRouter')
      const effort = chip(wrapper)
        .findAll('span')
        .find(span => span.text() === 'Medium')

      // Hidden until the chips' row, a container, is `@md` wide: 28rem.
      expect(connection.classes()).toEqual(expect.arrayContaining(['hidden', '@md:inline']))
      expect(effort.classes()).toContain('flex-none')
      // The effort wraps out of sight before the model is cut.
      expect(effort.element.parentElement.className).toContain('flex-wrap')
      expect(effort.element.parentElement.className).toContain('overflow-hidden')
    })

    it('takes where the row places it, and leaves the popover out of it', () => {
      const wrapper = mountQuick({ class: 'ml-auto' })

      expect(chip(wrapper).classes()).toContain('ml-auto')
      expect(wrapper.find('[data-popover]').classes()).not.toContain('ml-auto')
    })

    it('opens its popover on a click, and beside itself when asked from elsewhere', async () => {
      const wrapper = mountQuick()

      await chip(wrapper).trigger('click')
      expect(popover.toggle).toHaveBeenCalledTimes(1)

      // Asked with no click, as a failed reply's fix asks.
      wrapper.vm.show()
      expect(popover.show).toHaveBeenLastCalledWith(
        { currentTarget: chip(wrapper).element },
        chip(wrapper).element
      )

      // Asked with the click on another button, as the banner's asks: the
      // click is handed on, so the popover does not take it for one outside.
      const button = document.createElement('button')
      const click = new MouseEvent('click')
      button.addEventListener('click', event => wrapper.vm.show(event))
      button.dispatchEvent(click)
      expect(popover.show).toHaveBeenLastCalledWith(click, chip(wrapper).element)
    })

    it('asks the chat’s connection what it serves, for the model’s name', () => {
      mountQuick()
      expect(load).toHaveBeenCalledWith('openrouter')

      load.mockClear()
      listed.value = { openrouter: [{ id: 'some/model', name: 'Some Model' }] }
      mountQuick()
      expect(load).not.toHaveBeenCalled()
    })
  })

  describe('in a row too narrow for the effort', () => {
    /** @type {() => void} */
    let resized

    beforeEach(() => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback) {
            resized = callback
          }
          observe() {}
          disconnect() {}
        }
      )
    })
    afterEach(() => vi.unstubAllGlobals())

    /** Give an element a box, as a layout would. */
    const box = (element, { top = 0, width = 0 }) =>
      (element.getBoundingClientRect = () => /** @type {DOMRect} */ ({ top, width }))

    it('holds the chip to the model’s whole name, and lets go once there is room again', async () => {
      const wrapper = mountQuick()
      const el = chip(wrapper).element
      const line = el.querySelector('span')
      const [name, effort] = line.children
      Object.defineProperty(name, 'scrollWidth', { value: 70 })

      // Both on one line: nothing held.
      box(el, { width: 150 })
      box(line, { width: 130 })
      box(name, { top: 0, width: 70 })
      box(effort, { top: 0, width: 40 })
      resized()
      await wrapper.vm.$nextTick()
      expect(el.style.maxWidth).toBe('')

      // The effort wrapped to a line of its own, out of sight: the chip is
      // what is around its line (20), the name (70), and a pixel.
      box(el, { width: 120 })
      box(line, { width: 100 })
      box(effort, { top: 16, width: 40 })
      resized()
      await wrapper.vm.$nextTick()
      expect(el.style.maxWidth).toBe('91px')

      // Held while the row has no room for the effort beside it…
      Object.defineProperty(el.parentElement, 'clientWidth', { value: 130, configurable: true })
      resized()
      await wrapper.vm.$nextTick()
      expect(el.style.maxWidth).toBe('91px')

      // …and let go once it has.
      Object.defineProperty(el.parentElement, 'clientWidth', { value: 300, configurable: true })
      resized()
      await wrapper.vm.$nextTick()
      expect(el.style.maxWidth).toBe('')
    })

    it('starts again when what the chip says changes', async () => {
      const wrapper = mountQuick()
      const el = chip(wrapper).element
      const line = el.querySelector('span')
      const [name, effort] = line.children
      Object.defineProperty(name, 'scrollWidth', { value: 70 })
      box(el, { width: 120 })
      box(line, { width: 100 })
      box(name, { top: 0 })
      box(effort, { top: 16, width: 40 })
      resized()
      await wrapper.vm.$nextTick()
      expect(el.style.maxWidth).toBe('91px')

      // A model with no effort to show has nothing to hold the chip for.
      preset.value = { providerId: 'local', model: 'qwen' }
      await wrapper.vm.$nextTick()
      await wrapper.vm.$nextTick()
      expect(el.style.maxWidth).toBe('')
    })
  })
})
