import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import PrimeVue from 'primevue/config'
import TieredMenu from 'primevue/tieredmenu'
import { useHoverSubmenus } from '@/composables/useHoverSubmenus.js'

/** A window whose main pointer can hover or can't, and is wide or narrow. */
const screen = ({ hovers = true, narrow = false } = {}) => {
  window.matchMedia = vi.fn(query => ({
    matches: query === '(hover: hover)' ? hovers : narrow,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

const mountMenu = async () => {
  const menu = ref(null)
  const wrapper = mount(
    {
      components: { TieredMenu },
      template: `<TieredMenu ref="menu" :model="items" :popup="true" :pt="pt" />`,
      setup: () => ({
        menu,
        pt: useHoverSubmenus(menu),
        items: [{ label: 'Group', items: [{ label: 'Inside' }] }, { label: 'Plain' }],
      }),
    },
    { attachTo: document.body, global: { plugins: [PrimeVue], stubs: { teleport: true } } }
  )
  await nextTick()
  menu.value.show({ currentTarget: wrapper.element.parentElement })
  await nextTick()
  return { wrapper, menu }
}

/** How long the pointer has to rest on an item. */
const REST = 200

describe('useHoverSubmenus', () => {
  const original = window.matchMedia

  beforeEach(() => vi.useFakeTimers())

  afterEach(() => {
    vi.useRealTimers()
    window.matchMedia = original
    document.body.innerHTML = ''
  })

  /** The pointer reaching an item and resting there. */
  const restOn = async (wrapper, label) => {
    await content(wrapper, label).trigger('mouseenter')
    vi.advanceTimersByTime(REST)
    await nextTick()
  }

  /** The pointer crossing an item without stopping. */
  const crossOver = async (wrapper, label) => {
    await content(wrapper, label).trigger('mouseenter')
    vi.advanceTimersByTime(REST / 4)
    await content(wrapper, label).trigger('mouseleave')
    await nextTick()
  }

  /** The menu's items, by their labels. */
  const item = (wrapper, label) => wrapper.findAll('li').find(li => li.text().startsWith(label))
  const content = (wrapper, label) => item(wrapper, label).find('[data-pc-section="itemcontent"]')
  const expanded = wrapper => item(wrapper, 'Group').attributes('aria-expanded')

  it('opens a submenu on hover, with no click before it', async () => {
    screen()
    const { wrapper } = await mountMenu()
    expect(expanded(wrapper)).toBe('false')

    await restOn(wrapper, 'Group')
    expect(expanded(wrapper)).toBe('true')
  })

  it('shuts it once the pointer rests on another item', async () => {
    screen()
    const { wrapper } = await mountMenu()
    await restOn(wrapper, 'Group')

    await restOn(wrapper, 'Plain')
    expect(expanded(wrapper)).toBe('false')
  })

  it('keeps it while the pointer only crosses another item, on its way into it', async () => {
    screen()
    const { wrapper } = await mountMenu()
    await restOn(wrapper, 'Group')

    await crossOver(wrapper, 'Plain')
    vi.advanceTimersByTime(REST * 2)
    await nextTick()

    expect(expanded(wrapper)).toBe('true')
  })

  it('opens nothing as the pointer crosses an item on its way past', async () => {
    screen()
    const { wrapper } = await mountMenu()

    await crossOver(wrapper, 'Group')
    vi.advanceTimersByTime(REST * 2)
    await nextTick()

    expect(expanded(wrapper)).toBe('false')
  })

  it('opens nothing once the menu has shut with the pointer still resting', async () => {
    screen()
    const { wrapper, menu } = await mountMenu()

    await content(wrapper, 'Group').trigger('mouseenter')
    menu.value.hide()
    vi.advanceTimersByTime(REST)
    await nextTick()

    expect(menu.value.activeItemPath).toEqual([])
  })

  it('goes on opening on hover once the menu has closed and opened again', async () => {
    screen()
    const { wrapper, menu } = await mountMenu()

    menu.value.hide()
    await nextTick()
    menu.value.show({ currentTarget: wrapper.element.parentElement })
    await nextTick()

    await restOn(wrapper, 'Group')
    expect(expanded(wrapper)).toBe('true')
  })

  it('leaves a submenu open when its item is clicked', async () => {
    screen()
    const { wrapper } = await mountMenu()
    await restOn(wrapper, 'Group')

    await item(wrapper, 'Group').find('a').trigger('click')
    expect(expanded(wrapper)).toBe('true')
  })

  it('opens a submenu that is shut when its item is clicked', async () => {
    screen()
    const { wrapper } = await mountMenu()

    await item(wrapper, 'Group').find('a').trigger('click')
    expect(expanded(wrapper)).toBe('true')
  })

  it('leaves a menu alone where the pointer cannot hover: a tap opens and shuts', async () => {
    screen({ hovers: false })
    const { wrapper } = await mountMenu()

    await restOn(wrapper, 'Group')
    expect(expanded(wrapper)).toBe('false')

    await item(wrapper, 'Group').find('a').trigger('click')
    expect(expanded(wrapper)).toBe('true')

    await item(wrapper, 'Group').find('a').trigger('click')
    expect(expanded(wrapper)).toBe('false')
  })

  it('lets a click shut a submenu open inline in a narrow window', async () => {
    screen({ narrow: true })
    const { wrapper } = await mountMenu()

    await restOn(wrapper, 'Group')
    expect(expanded(wrapper)).toBe('false')

    await item(wrapper, 'Group').find('a').trigger('click')
    expect(expanded(wrapper)).toBe('true')

    await item(wrapper, 'Group').find('a').trigger('click')
    expect(expanded(wrapper)).toBe('false')
  })
})
