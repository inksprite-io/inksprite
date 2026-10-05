import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Splitter from 'primevue/splitter'
import DesktopView from '@/components/writer/layout/DesktopView.vue'
import { DEFAULT_LAYOUT } from '@/components/writer/layout/layout.js'

/**
 * A panel that remembers the project it was mounted for. A panel binds to a
 * project's state once, in setup, so what it shows after the project changes
 * is whatever it was given first — unless it was replaced.
 */
const boundPanel = attr => ({
  props: ['storyId'],
  setup(props) {
    return { boundTo: props.storyId }
  },
  template: `<div ${attr} :data-bound="boundTo" />`,
})

const stubs = {
  LeftSidebar: boundPanel('data-sidebar'),
  EditorPanel: boundPanel('data-editor'),
  ChatPanel: boundPanel('data-chat'),
}

const mountView = storyId =>
  mount(DesktopView, {
    props: { layout: DEFAULT_LAYOUT, storyId },
    global: { plugins: [PrimeVue], stubs },
  })

describe('DesktopView', () => {
  it('gives a project switched to panels of its own', async () => {
    const wrapper = mountView('story_a')
    expect(wrapper.find('[data-editor]').attributes('data-bound')).toBe('story_a')

    await wrapper.setProps({ storyId: 'story_b' })

    expect(wrapper.find('[data-editor]').attributes('data-bound')).toBe('story_b')
    expect(wrapper.find('[data-chat]').attributes('data-bound')).toBe('story_b')
  })

  it('passes each panel’s toggle up as the other panel’s name', async () => {
    const asking = (attr, event) => ({
      props: ['storyId'],
      emits: [event],
      template: `<button ${attr} @click="$emit('${event}')" />`,
    })
    const wrapper = mount(DesktopView, {
      props: { layout: DEFAULT_LAYOUT, storyId: 'story_a' },
      global: {
        plugins: [PrimeVue],
        stubs: {
          LeftSidebar: boundPanel('data-sidebar'),
          EditorPanel: asking('data-editor', 'toggle-chat'),
          ChatPanel: asking('data-chat', 'toggle-editor'),
        },
      },
    })

    await wrapper.find('[data-editor]').trigger('click')
    await wrapper.find('[data-chat]').trigger('click')

    expect(wrapper.emitted('toggle')).toEqual([['chat'], ['editor']])
  })

  it('hides a panel rather than taking it down, and keeps what was in it', async () => {
    const wrapper = mountView('story_a')
    const splitters = () => wrapper.findAllComponents(Splitter).map(c => c.element)
    const [outer, inner] = splitters()
    const chat = wrapper.find('[data-chat]').element

    await wrapper.setProps({ layout: { ...DEFAULT_LAYOUT, chat: false } })

    // A chat of any length is not something to build twice: the panel is
    // hidden, its splitter untouched, and what was in it is still there.
    const panelOf = attr => wrapper.find(attr).element.parentElement
    expect(wrapper.find('[data-chat]').element).toBe(chat)
    expect(panelOf('[data-chat]').style.display).toBe('none')
    expect(splitters()[0]).toBe(outer)
    expect(splitters()[1]).toBe(inner)

    await wrapper.setProps({ layout: { ...DEFAULT_LAYOUT, chat: true, sidebar: false } })

    expect(wrapper.find('[data-chat]').element).toBe(chat)
    expect(panelOf('[data-chat]').style.display).toBe('')
    expect(panelOf('[data-sidebar]').style.display).toBe('none')
  })
})
