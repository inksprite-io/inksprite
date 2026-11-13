import { describe, it, expect } from 'vitest'
import { h, markRaw, Teleport } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import SectionLayout from '@/components/common/SectionLayout.vue'
import { useSectionHeading } from '@/components/common/sectionHeading.js'

const Icon = markRaw({ template: '<i />' })

/** A section's pane, saying which it is and the part it was told to show. */
const pane = name =>
  markRaw({
    props: ['part', 'note'],
    template: `<div data-pane="${name}" :data-pane-part="part" :data-note="note" />`,
  })

/** A section that puts a button of its own beside the heading. */
const Making = markRaw({
  setup() {
    const heading = useSectionHeading()
    return () =>
      h('div', { 'data-pane': 'making' }, [
        h(Teleport, { defer: true, to: heading, disabled: !heading }, [
          h('button', { 'data-action': 'make' }, 'Make'),
        ]),
      ])
  },
})

const SECTIONS = [
  { id: 'plain', label: 'Plain', icon: Icon, component: pane('plain'), props: { note: 'given' } },
  {
    id: 'split',
    label: 'Split',
    icon: Icon,
    component: pane('split'),
    parts: [
      { id: 'first', label: 'First part' },
      { id: 'second', label: 'Second part' },
    ],
  },
  { id: 'titled', label: 'Titled', title: 'A longer title', icon: Icon, component: pane('titled') },
  { id: 'making', label: 'Making', icon: Icon, component: Making },
]

const mountLayout = (props = {}, options = {}) =>
  mount(SectionLayout, {
    props: { sections: SECTIONS, label: 'Test sections', ...props },
    global: {
      plugins: [PrimeVue],
      stubs: { ScrollPanel: { template: '<div><slot /></div>' } },
    },
    ...options,
  })

/** The parts listed down the side, under the open section. */
const sideParts = wrapper => wrapper.find('nav [data-section-parts]')
/** The parts in a strip of their own, where the sections are across the top. */
const stripParts = wrapper =>
  wrapper.findAll('[data-section-parts]').find(one => !one.element.closest('nav'))

describe('SectionLayout', () => {
  it('lists the sections, and opens on the first where none is named', () => {
    const wrapper = mountLayout()

    expect(wrapper.find('nav').attributes('aria-label')).toBe('Test sections')
    expect(wrapper.findAll('[data-section]').map(one => one.text())).toEqual([
      'Plain',
      'Split',
      'Titled',
      'Making',
    ])
    expect(wrapper.find('[data-section="plain"]').attributes('aria-current')).toBe('page')
    expect(wrapper.find('[data-pane="plain"]').attributes('data-note')).toBe('given')
    expect(wrapper.find('h2').text()).toBe('Plain')
  })

  it('asks for the section clicked, and shows the one it is given', async () => {
    const wrapper = mountLayout({ modelValue: 'plain' })

    await wrapper.find('[data-section="titled"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['titled']])
    // Its holder says which is open.
    expect(wrapper.find('[data-pane="plain"]').exists()).toBe(true)

    await wrapper.setProps({ modelValue: 'titled' })
    expect(wrapper.find('[data-pane="titled"]').exists()).toBe(true)
    expect(wrapper.find('[data-pane="plain"]').exists()).toBe(false)
    // The heading is its title, where that is not its label.
    expect(wrapper.find('h2').text()).toBe('A longer title')
  })

  it('has no parts for a section that is whole', () => {
    const wrapper = mountLayout({ modelValue: 'plain' })

    expect(wrapper.find('[data-section-parts]').exists()).toBe(false)
    expect(wrapper.find('[data-section="plain"]').attributes('aria-expanded')).toBeUndefined()
    expect(wrapper.find('[data-pane="plain"]').attributes('data-pane-part')).toBeUndefined()
  })

  it('lists the open section’s parts under it, on its first, with the heading the part’s', () => {
    const wrapper = mountLayout({ modelValue: 'split' })

    const section = wrapper.find('[data-section="split"]')
    expect(section.attributes('aria-expanded')).toBe('true')
    // The part is the page; the section only holds it.
    expect(section.attributes('aria-current')).toBe('true')
    const parts = sideParts(wrapper)
    expect(parts.element.previousElementSibling).toBe(section.element)
    expect(parts.findAll('[data-part]').map(one => one.text())).toEqual([
      'First part',
      'Second part',
    ])
    expect(parts.find('[data-part="first"]').attributes('aria-current')).toBe('page')
    expect(parts.find('[data-part="second"]').attributes('aria-current')).toBeUndefined()
    expect(wrapper.find('h2').text()).toBe('First part')
    expect(wrapper.find('[data-pane="split"]').attributes('data-pane-part')).toBe('first')
  })

  it('says a section with parts is shut while another is open', () => {
    const wrapper = mountLayout({ modelValue: 'plain' })
    expect(wrapper.find('[data-section="split"]').attributes('aria-expanded')).toBe('false')
  })

  it('asks for the part clicked, and shows the one it is given', async () => {
    const wrapper = mountLayout({ modelValue: 'split', part: 'first' })

    await sideParts(wrapper).find('[data-part="second"]').trigger('click')
    expect(wrapper.emitted('update:part')).toEqual([['second']])

    await wrapper.setProps({ part: 'second' })
    expect(sideParts(wrapper).find('[data-part="second"]').attributes('aria-current')).toBe('page')
    expect(wrapper.find('h2').text()).toBe('Second part')
    expect(wrapper.find('[data-pane="split"]').attributes('data-pane-part')).toBe('second')
  })

  it('shows the first part where the one named is not among them', () => {
    const wrapper = mountLayout({ modelValue: 'split', part: 'gone' })

    expect(wrapper.find('h2').text()).toBe('First part')
    expect(wrapper.find('[data-pane="split"]').attributes('data-pane-part')).toBe('first')
  })

  it('has the parts in a strip of their own on a phone, where the sections are across the top', async () => {
    const wrapper = mountLayout({ modelValue: 'split', part: 'second' })

    // Down the side they are under the section, and only where there is room.
    expect(sideParts(wrapper).classes()).toEqual(expect.arrayContaining(['hidden', 'md:flex']))
    const strip = stripParts(wrapper)
    expect(strip.classes()).toEqual(expect.arrayContaining(['flex', 'md:hidden']))
    expect(strip.element.previousElementSibling).toBe(wrapper.find('nav').element)
    expect(strip.findAll('[data-part]').map(one => one.text())).toEqual([
      'First part',
      'Second part',
    ])
    expect(strip.find('[data-part="second"]').attributes('aria-current')).toBe('page')

    await strip.find('[data-part="first"]').trigger('click')
    expect(wrapper.emitted('update:part')).toEqual([['first']])
  })

  it('puts what stands over the sections first in the list', () => {
    const wrapper = mountLayout({}, { slots: { 'nav-start': '<div data-over />' } })
    expect(wrapper.find('nav').element.firstElementChild?.hasAttribute('data-over')).toBe(true)
  })

  it('has a place beside the heading for the open section’s own buttons', async () => {
    const wrapper = mountLayout({ modelValue: 'making' }, { attachTo: document.body })
    await flushPromises()

    const heading = wrapper.find('h2')
    expect(heading.text()).toBe('Making')
    const beside = heading.element.nextElementSibling
    expect(beside?.querySelector('[data-action="make"]')).not.toBeNull()
    // Not in the section itself.
    expect(wrapper.find('[data-pane="making"] [data-action="make"]').exists()).toBe(false)

    // Gone with the section that put it there.
    await wrapper.setProps({ modelValue: 'plain' })
    await flushPromises()
    expect(wrapper.find('[data-action="make"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
