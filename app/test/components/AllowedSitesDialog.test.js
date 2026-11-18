import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import AllowedSitesDialog from '@/components/writer/settings/AllowedSitesDialog.vue'
import { useWebSearchStore } from '@/stores/webSearchStore.js'
import { setWebSearch } from '@/web/config.js'

vi.mock('@/storage/index.js', () => ({
  storage: { get: vi.fn(async () => undefined) },
}))
vi.mock('@/stores/syncStore.js', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const mountDialog = async () => {
  const wrapper = mount(AllowedSitesDialog, {
    props: { visible: true },
    global: {
      plugins: [PrimeVue],
      stubs: { Dialog: { props: ['visible'], template: '<div v-if="visible"><slot /></div>' } },
    },
  })
  await flushPromises()
  return wrapper
}

/** @param {Awaited<ReturnType<typeof mountDialog>>} wrapper */
const listed = wrapper => wrapper.findAll('[data-allowed-site]').map(site => site.text())

/** The sites always allowed, as they are kept. */
const kept = () => useWebSearchStore().setup.allowedSites

/**
 * Type into the add field and press Enter.
 * @param {Awaited<ReturnType<typeof mountDialog>>} wrapper
 * @param {string} text
 */
const add = async (wrapper, text) => {
  const field = wrapper.find('[data-add-site]')
  await field.setValue(text)
  await field.trigger('keydown', { key: 'Enter' })
}

describe('AllowedSitesDialog', () => {
  beforeEach(() => setActivePinia(createPinia()))

  afterEach(() => setWebSearch(null))

  it('lists the sites always allowed, in order', async () => {
    useWebSearchStore().update({
      allowedSites: ['tides.example', 'almanac.example', 'Harbour.example:8080'],
    })
    const wrapper = await mountDialog()

    expect(listed(wrapper)).toEqual(['almanac.example', 'Harbour.example:8080', 'tides.example'])
    expect(wrapper.find('[data-no-sites]').exists()).toBe(false)
  })

  it('says when there are no sites', async () => {
    const wrapper = await mountDialog()

    expect(listed(wrapper)).toEqual([])
    expect(wrapper.find('[data-no-sites]').text()).toBe('No sites yet.')
  })

  it('adds a site typed by its name', async () => {
    const wrapper = await mountDialog()
    expect(wrapper.find('[data-add-site]').attributes('placeholder')).toBe('Add a site')

    await add(wrapper, 'tides.example')

    expect(kept()).toEqual(['tides.example'])
    expect(listed(wrapper)).toEqual(['tides.example'])
    expect(/** @type {HTMLInputElement} */ (wrapper.find('[data-add-site]').element).value).toBe('')
  })

  it('adds a name with a port as that port alone', async () => {
    const wrapper = await mountDialog()

    await add(wrapper, 'Tides.example:8080')

    expect(kept()).toEqual(['tides.example:8080'])
  })

  it('adds the site a whole address is on', async () => {
    const wrapper = await mountDialog()

    await add(wrapper, 'https://tides.example/tables/today?port=north')
    await add(wrapper, 'http://almanac.example:8443/moon')

    expect(kept()).toEqual(['tides.example', 'almanac.example:8443'])
  })

  it('adds several at once, parted by spaces or commas', async () => {
    const wrapper = await mountDialog()

    await add(
      wrapper,
      'tides.example, almanac.example  https://harbour.example/berths,charts.example'
    )

    expect(kept()).toEqual([
      'tides.example',
      'almanac.example',
      'harbour.example',
      'charts.example',
    ])
  })

  it('adds nothing for a site that is there already, or for nothing typed', async () => {
    useWebSearchStore().update({ allowedSites: ['tides.example'] })
    const wrapper = await mountDialog()

    await add(wrapper, 'https://tides.example/tables')
    await add(wrapper, '  ')

    expect(kept()).toEqual(['tides.example'])
  })

  it('takes a site off from its button', async () => {
    useWebSearchStore().update({ allowedSites: ['tides.example', 'almanac.example'] })
    const wrapper = await mountDialog()

    await wrapper.find('[aria-label="Remove tides.example"]').trigger('click')

    expect(kept()).toEqual(['almanac.example'])
    expect(listed(wrapper)).toEqual(['almanac.example'])
  })
})
