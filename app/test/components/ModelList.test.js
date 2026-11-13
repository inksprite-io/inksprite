import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reactive } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ModelList from '@/components/writer/models/ModelList.vue'
import ModelPicker from '@/components/writer/models/ModelPicker.vue'
import MultiSelect from 'primevue/multiselect'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import { setActivePinia, createPinia } from 'pinia'
import { useApplicationState } from '@/composables/useApplicationState'
import { recommendedFor } from '@/ai/recommended.js'

const providers = {
  p_or: { id: 'p_or', name: 'OpenRouter', type: 'openrouter' },
  p_box: { id: 'p_box', name: 'Box', type: 'generic', endpoint: 'http://box:1234/v1' },
}
vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ getProvider: id => providers[id] ?? null }),
}))

/** The lists asked for, by connection. */
const lists = reactive(new Map())
const load = vi.fn(async id => {
  lists.set(id, { loading: false, models: [] })
  return []
})
vi.mock('@/composables/useModelLists', () => ({
  useModelLists: () => ({ listOf: id => lists.get(id), load }),
}))

/** The writer's connections that chat. */
let theirs = [providers.p_box]
vi.mock('@/composables/useConnections.js', () => ({
  useConnections: () => ({ connectionsFor: () => theirs }),
}))

const MODELS = [
  { id: 'a/paid', name: 'Paid', pricing: { prompt: 0.000003, completion: 0.000015 } },
  { id: 'b/free', name: 'Free one', free: true, traits: { tools: true } },
  { id: 'c/plain', name: 'Plain' },
]

const mountList = (providerIds, options = {}) =>
  mount(ModelList, {
    props: { providerIds, choice: null },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
    attachTo: document.body,
    ...options,
  })

const shown = wrapper => wrapper.findAll('[data-model]').map(row => row.attributes('data-model'))
/** The models under a group's heading, in order. */
const inGroup = (wrapper, key) => {
  const names = []
  let node = wrapper.find(`[data-group="${key}"]`).element.nextElementSibling
  while (node && !node.hasAttribute('data-group')) {
    names.push(node.getAttribute('data-model'))
    node = node.nextElementSibling
  }
  return names
}

/** Open the filters from the search. */
const openFilters = async wrapper => {
  await wrapper.find('[data-action="filter-models"]').trigger('click')
  await flushPromises()
}

describe('ModelList', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    lists.clear()
    useApplicationState().state.value.ai.modelUses = []
    window.localStorage.clear()
    // Every card drawn: nothing here says which are near the screen.
    vi.stubGlobal('IntersectionObserver', undefined)
  })

  it('keeps the box, empty, where the connection lists no models, and asks again from the search', async () => {
    lists.set('p_box', { loading: false, models: [] })
    const wrapper = mountList(['p_box'])

    expect(wrapper.find('[aria-label="Models"]').exists()).toBe(true)
    expect(shown(wrapper)).toEqual([])

    await wrapper.find('[data-action="refresh-models"]').trigger('click')
    expect(load).toHaveBeenCalledWith('p_box')
    wrapper.unmount()
  })

  it('shows only the free ones while the filters’ switch says so', async () => {
    lists.set('p_or', { loading: false, models: MODELS })
    const wrapper = mountList(['p_or'])
    expect(shown(wrapper)).toEqual(['b/free', 'a/paid', 'c/plain'])

    await openFilters(wrapper)
    // One connection: nothing to choose among.
    expect(document.body.querySelector('[data-filter="connections"]')).toBeNull()
    expect(document.body.querySelector('[data-filter="tools"]')).toBeNull()
    wrapper.findComponent(ToggleSwitch).vm.$emit('update:modelValue', true)
    await flushPromises()

    expect(shown(wrapper)).toEqual(['b/free'])
    wrapper.unmount()
  })

  it('groups every connection’s models under its name, each saying which serves it', async () => {
    lists.set('p_or', { loading: false, models: MODELS })
    lists.set('p_box', { loading: false, models: [{ id: 'local', name: 'local' }] })
    const wrapper = mountList(['p_or', 'p_box'])

    expect(wrapper.find('[data-group="connection:p_or"]').text()).toBe('OpenRouter')
    expect(inGroup(wrapper, 'connection:p_or')).toEqual(['b/free', 'a/paid', 'c/plain'])
    expect(inGroup(wrapper, 'connection:p_box')).toEqual(['local'])
    const box = wrapper.find('[data-connection="p_box"]')
    expect(box.find('[data-model-connection]').text()).toBe('Box')
    // Laid out as the others are, its name and id both, its price blank.
    expect(box.text()).toContain('local')
    expect(box.find('[data-price]').exists()).toBe(true)

    await openFilters(wrapper)
    wrapper.findComponent(MultiSelect).vm.$emit('update:modelValue', ['p_box'])
    await flushPromises()
    expect(shown(wrapper)).toEqual(['local'])
    expect(wrapper.find('[data-action="filter-models"]').classes()).toContain('!text-primary-600')
    wrapper.unmount()
  })

  it('sorts each connection’s by cost, the name settling ties, and keeps the order', async () => {
    lists.set('p_or', {
      loading: false,
      models: [
        { id: 'dear', name: 'Dear', pricing: { prompt: 0.00001, completion: 0.00003 } },
        { id: 'cheap-b', name: 'B cheap', pricing: { prompt: 0.000001, completion: 0.000002 } },
        { id: 'cheap-a', name: 'A cheap', pricing: { prompt: 0.000001, completion: 0.000002 } },
        { id: 'unknown', name: 'Aardvark' },
      ],
    })
    const wrapper = mountList(['p_or'])
    expect(shown(wrapper)).toEqual(['cheap-a', 'unknown', 'cheap-b', 'dear'])

    await openFilters(wrapper)
    wrapper.findComponent(Select).vm.$emit('update:modelValue', 'cost')
    await flushPromises()

    expect(shown(wrapper)).toEqual(['cheap-a', 'cheap-b', 'dear', 'unknown'])
    wrapper.unmount()
    expect(shown(mountList(['p_or']))).toEqual(['cheap-a', 'cheap-b', 'dear', 'unknown'])
  })

  it('lists first the latest five that answered, the most written first', async () => {
    const models = 'abcdefg'.split('').map(letter => ({ id: letter, name: letter }))
    lists.set('p_or', { loading: false, models })
    const app = useApplicationState()
    // Oldest first: g is the latest, and a dropped for being sixth.
    for (const [letter, tokens] of [
      ['a', 9000],
      ['c', 10],
      ['d', 500],
      ['e', 20],
      ['f', 300],
      ['g', 40],
    ])
      app.noteModelUse('p_or', letter, tokens)
    app.noteModelUse('p_gone', 'x', 99999)
    const wrapper = mountList(['p_or'])

    expect(wrapper.find('[data-group="recent"]').text()).toBe('Recent models')
    expect(inGroup(wrapper, 'recent')).toEqual(['d', 'f', 'g', 'e', 'c'])
    // Under its connection too.
    expect(inGroup(wrapper, 'connection:p_or')).toEqual(models.map(model => model.id))
    wrapper.unmount()
  })

  it('lists the recommended ones under Recommended and their connection both', async () => {
    const [first] = recommendedFor('openrouter')
    lists.set('p_or', { loading: false, models: [...MODELS, { id: first.model, name: 'Zed' }] })
    const wrapper = mountList(['p_or'])

    expect(inGroup(wrapper, 'recommended')).toEqual([first.model])
    expect(inGroup(wrapper, 'connection:p_or')).toContain(first.model)
    wrapper.unmount()
  })

  it('chooses a model on the connection it is listed under', async () => {
    lists.set('p_or', { loading: false, models: MODELS })
    lists.set('p_box', { loading: false, models: [{ id: 'a/paid', name: 'Paid' }] })
    const wrapper = mountList(['p_or', 'p_box'])

    await wrapper
      .find('[data-connection="p_box"][data-model="a/paid"] [data-card-toggle]')
      .trigger('click')

    expect(wrapper.emitted('update:choice')[0]).toEqual([{ providerId: 'p_box', model: 'a/paid' }])
    await wrapper.setProps({ choice: { providerId: 'p_box', model: 'a/paid' } })
    const toggle = (connection, model) =>
      wrapper.find(`[data-connection="${connection}"][data-model="${model}"] [data-card-toggle]`)
    expect(toggle('p_box', 'a/paid').attributes('aria-current')).toBe('true')
    expect(toggle('p_or', 'a/paid').attributes('aria-current')).toBeUndefined()
    // With nothing to open on, nothing opens.
    expect(wrapper.find('[data-card-body]').exists()).toBe(false)
    wrapper.unmount()
  })

  describe('a card', () => {
    /** What a card opens on, as its holder gives it: the model's settings. */
    const chosen = { chosen: '<div data-settings-of>{{ params.model.id }}</div>' }
    const mountOpening = providerIds => mountList(providerIds, { slots: chosen })
    const card = (wrapper, model, connection = 'p_or') =>
      wrapper.find(`[data-connection="${connection}"][data-model="${model}"]`)
    const sliders = (wrapper, model, connection) =>
      card(wrapper, model, connection).find('[data-action="model-settings"]')

    beforeEach(() => lists.set('p_or', { loading: false, models: MODELS }))

    it('chooses the model clicked without opening it', async () => {
      const wrapper = mountOpening(['p_or'])

      await card(wrapper, 'a/paid').find('[data-card-toggle]').trigger('click')

      expect(wrapper.emitted('update:choice')).toEqual([[{ providerId: 'p_or', model: 'a/paid' }]])
      expect(wrapper.emitted('use')).toBeUndefined()
      expect(wrapper.find('[data-card-body]').exists()).toBe(false)
      // A card to choose, not one that opens, to a screen reader.
      expect(
        card(wrapper, 'a/paid').find('[data-card-toggle]').attributes('aria-expanded')
      ).toBeUndefined()
      wrapper.unmount()
    })

    it('takes at once the one clicked twice', async () => {
      const wrapper = mountOpening(['p_or'])

      await card(wrapper, 'c/plain').find('[data-card-toggle]').trigger('dblclick')

      expect(wrapper.emitted('use')).toEqual([[{ providerId: 'p_or', model: 'c/plain' }]])
      wrapper.unmount()
    })

    it('opens a model’s settings from the button at its end, and shuts them', async () => {
      const wrapper = mountOpening(['p_or'])
      const button = sliders(wrapper, 'a/paid')
      expect(button.attributes('aria-label')).toBe('Paid settings')
      expect(button.attributes('aria-expanded')).toBe('false')

      await button.trigger('click')

      expect(button.attributes('aria-expanded')).toBe('true')
      expect(card(wrapper, 'a/paid').find('[data-card-body] [data-settings-of]').text()).toBe(
        'a/paid'
      )
      // Opened, not chosen.
      expect(wrapper.emitted('update:choice')).toBeUndefined()

      await button.trigger('click')
      expect(button.attributes('aria-expanded')).toBe('false')
      expect(wrapper.find('[data-card-body]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('opens one at a time, whether or not it is the chosen one', async () => {
      const wrapper = mountOpening(['p_or'])
      await wrapper.setProps({ choice: { providerId: 'p_or', model: 'a/paid' } })

      await sliders(wrapper, 'c/plain').trigger('click')
      expect(wrapper.findAll('[data-settings-of]').map(one => one.text())).toEqual(['c/plain'])

      await sliders(wrapper, 'a/paid').trigger('click')
      expect(wrapper.findAll('[data-settings-of]').map(one => one.text())).toEqual(['a/paid'])
      // The chosen one stays chosen, opened or not.
      expect(card(wrapper, 'a/paid').find('[data-card-toggle]').attributes('aria-current')).toBe(
        'true'
      )
      wrapper.unmount()
    })

    it('opens a model where its button was clicked, of the two places it is listed', async () => {
      useApplicationState().noteModelUse('p_or', 'a/paid', 100)
      const wrapper = mountOpening(['p_or'])
      const both = wrapper.findAll('[data-connection="p_or"][data-model="a/paid"]')
      expect(both).toHaveLength(2)

      await both[1].find('[data-action="model-settings"]').trigger('click')

      expect(both[0].find('[data-card-body]').exists()).toBe(false)
      expect(both[1].find('[data-card-body]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('has no such button where its holder gives nothing to open on', () => {
      const wrapper = mountList(['p_or'])
      expect(wrapper.find('[data-action="model-settings"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('tints the chosen one only where it is the one in use', async () => {
      const wrapper = mountList(['p_or'], {
        props: {
          providerIds: ['p_or'],
          choice: { providerId: 'p_or', model: 'a/paid' },
          tint: false,
        },
      })
      const toggle = () => card(wrapper, 'a/paid').find('[data-card-toggle]')
      expect(toggle().attributes('aria-current')).toBeUndefined()

      await wrapper.setProps({ tint: true })
      expect(toggle().attributes('aria-current')).toBe('true')
      wrapper.unmount()
    })
  })

  describe('a group’s heading', () => {
    beforeEach(() => {
      lists.set('p_or', { loading: false, models: MODELS })
      lists.set('p_box', { loading: false, models: [{ id: 'local', name: 'local' }] })
    })

    const heading = (wrapper, key) => wrapper.find(`[data-group="${key}"]`)

    it('shuts its group to the heading alone on a click, and opens it again', async () => {
      const wrapper = mountList(['p_or', 'p_box'])
      expect(heading(wrapper, 'connection:p_or').attributes()).toMatchObject({
        role: 'button',
        tabindex: '0',
        'aria-expanded': 'true',
      })

      await heading(wrapper, 'connection:p_or').trigger('click')

      expect(heading(wrapper, 'connection:p_or').attributes('aria-expanded')).toBe('false')
      expect(heading(wrapper, 'connection:p_or').text()).toBe('OpenRouter')
      expect(inGroup(wrapper, 'connection:p_or')).toEqual([])
      // The others as they were.
      expect(heading(wrapper, 'connection:p_box').attributes('aria-expanded')).toBe('true')
      expect(shown(wrapper)).toEqual(['local'])

      await heading(wrapper, 'connection:p_or').trigger('click')
      expect(heading(wrapper, 'connection:p_or').attributes('aria-expanded')).toBe('true')
      expect(inGroup(wrapper, 'connection:p_or')).toEqual(['b/free', 'a/paid', 'c/plain'])
      wrapper.unmount()
    })

    it('shuts and opens from the keyboard', async () => {
      const wrapper = mountList(['p_or', 'p_box'])

      await heading(wrapper, 'connection:p_box').trigger('keydown', { key: 'Enter' })
      expect(inGroup(wrapper, 'connection:p_box')).toEqual([])

      await heading(wrapper, 'connection:p_box').trigger('keydown', { key: ' ' })
      expect(inGroup(wrapper, 'connection:p_box')).toEqual(['local'])
      wrapper.unmount()
    })

    it('keeps the groups shut on the device', async () => {
      const first = mountList(['p_or', 'p_box'])
      await heading(first, 'connection:p_or').trigger('click')
      first.unmount()

      expect(JSON.parse(window.localStorage.getItem('ui.models.shut'))).toEqual(['connection:p_or'])
      const second = mountList(['p_or', 'p_box'])
      expect(heading(second, 'connection:p_or').attributes('aria-expanded')).toBe('false')
      expect(shown(second)).toEqual(['local'])

      await heading(second, 'connection:p_or').trigger('click')
      expect(JSON.parse(window.localStorage.getItem('ui.models.shut'))).toEqual([])
      second.unmount()
    })

    it('shows a group that is alone in full, having no heading to open it by', () => {
      window.localStorage.setItem('ui.models.shut', JSON.stringify(['connection:p_or']))
      const wrapper = mountList(['p_or'])

      expect(wrapper.find('[data-group]').exists()).toBe(false)
      expect(shown(wrapper)).toEqual(['b/free', 'a/paid', 'c/plain'])
      wrapper.unmount()
    })
  })

  describe('a long list', () => {
    /** The observers made, each with what it watches and how to tell it. */
    const observers = []

    /** Say which rows are near the screen, and which no longer are. */
    const settle = async (elements, isIntersecting) => {
      const [observer] = observers
      observer.callback(elements.map(target => ({ target, isIntersecting })))
      await flushPromises()
    }

    const row = (wrapper, model) => wrapper.find(`[data-model="${model}"]`)
    const isBlank = (wrapper, model) => row(wrapper, model).attributes('data-model-blank') === ''

    beforeEach(() => {
      observers.length = 0
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(callback, options) {
            this.callback = callback
            this.options = options
            this.watched = new Set()
            observers.push(this)
          }
          observe(element) {
            this.watched.add(element)
          }
          unobserve(element) {
            this.watched.delete(element)
          }
          disconnect() {
            this.watched.clear()
          }
        }
      )
      lists.set('p_or', { loading: false, models: MODELS })
    })

    it('draws only the cards near the screen, and a blank of a card’s height for the rest', async () => {
      const wrapper = mountList(['p_or'])

      // Every row is there, so the list is as long as if all were drawn.
      expect(shown(wrapper)).toEqual(['b/free', 'a/paid', 'c/plain'])
      expect(wrapper.findAll('[data-model-blank]')).toHaveLength(3)
      expect(wrapper.find('[data-card-item]').exists()).toBe(false)
      expect(row(wrapper, 'b/free').classes()).toContain('min-h-14')

      await settle([row(wrapper, 'b/free').element, row(wrapper, 'a/paid').element], true)

      expect(isBlank(wrapper, 'b/free')).toBe(false)
      expect(isBlank(wrapper, 'a/paid')).toBe(false)
      expect(isBlank(wrapper, 'c/plain')).toBe(true)
      expect(row(wrapper, 'a/paid').text()).toContain('Paid')
      expect(shown(wrapper)).toEqual(['b/free', 'a/paid', 'c/plain'])
      wrapper.unmount()
    })

    it('watches the box that scrolls, and some way past its top and bottom', () => {
      const wrapper = mountList(['p_or'])

      expect(observers).toHaveLength(1)
      expect(observers[0].options.root).toBe(wrapper.find('[data-card-list]').element)
      expect(observers[0].options.rootMargin).toBe('400px 0px')
      expect(observers[0].watched.size).toBe(3)
      wrapper.unmount()
      expect(observers[0].watched.size).toBe(0)
    })

    it('blanks a card again once it is scrolled away', async () => {
      const wrapper = mountList(['p_or'])
      await settle([row(wrapper, 'a/paid').element], true)
      expect(isBlank(wrapper, 'a/paid')).toBe(false)
      // The card is what is watched now, in the blank's place.
      expect(observers[0].watched.has(row(wrapper, 'a/paid').element)).toBe(true)
      expect(observers[0].watched.size).toBe(3)

      await settle([row(wrapper, 'a/paid').element], false)

      expect(isBlank(wrapper, 'a/paid')).toBe(true)
      wrapper.unmount()
    })

    it('keeps the open card drawn when it is scrolled away, until it is shut', async () => {
      const wrapper = mountList(['p_or'], {
        slots: { chosen: '<div data-settings-of>{{ params.model.id }}</div>' },
      })
      await settle([row(wrapper, 'a/paid').element, row(wrapper, 'c/plain').element], true)
      await row(wrapper, 'a/paid').find('[data-action="model-settings"]').trigger('click')

      await settle([row(wrapper, 'a/paid').element, row(wrapper, 'c/plain').element], false)

      expect(isBlank(wrapper, 'c/plain')).toBe(true)
      expect(isBlank(wrapper, 'a/paid')).toBe(false)
      expect(row(wrapper, 'a/paid').find('[data-settings-of]').text()).toBe('a/paid')

      await row(wrapper, 'a/paid').find('[data-action="model-settings"]').trigger('click')
      expect(isBlank(wrapper, 'a/paid')).toBe(true)
      wrapper.unmount()
    })

    it('draws every card where the browser can’t say which are near', () => {
      vi.stubGlobal('IntersectionObserver', undefined)
      const wrapper = mountList(['p_or'])

      expect(wrapper.find('[data-model-blank]').exists()).toBe(false)
      expect(wrapper.findAll('[data-card-item]')).toHaveLength(3)
      wrapper.unmount()
    })
  })
})

describe('ModelPicker', () => {
  beforeEach(() => {
    lists.clear()
    lists.set('p_box', { loading: false, models: [{ id: 'local', name: 'local' }] })
  })

  const mountPicker = () =>
    mount(ModelPicker, {
      props: { providerId: 'p_box', model: 'local' },
      global: {
        plugins: [PrimeVue],
        directives: { tooltip: {} },
        stubs: {
          ModelSettings: {
            props: ['providerId', 'model'],
            template: '<div data-model-settings />',
          },
        },
      },
    })

  it('lists every one of the writer’s connections, with no connection to choose first', () => {
    theirs = [providers.p_box, providers.p_or]
    const wrapper = mountPicker()

    expect(wrapper.find('[data-field="connection"]').exists()).toBe(false)
    expect(wrapper.findComponent(ModelList).props('providerIds')).toEqual(['p_box', 'p_or'])
  })
})
