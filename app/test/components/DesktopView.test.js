import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import DesktopView from '@/components/writer/layout/DesktopView.vue'
import { DEFAULT_LAYOUT } from '@/components/writer/layout/layout.js'

const isNarrow = ref(false)
vi.mock('@/composables/useScreenSize', () => ({
  useScreenSize: () => ({ isMobile: ref(false), isNarrow }),
}))

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
  beforeEach(() => {
    isNarrow.value = false
    window.localStorage.clear()
  })

  it('keeps the widths a splitter is dragged to for the next session', () => {
    const wrapper = mountView('story_a')
    const [row, content] = wrapper.findAllComponents(Splitter)

    row.vm.$emit('resizeend', { sizes: [30, 70] })
    content.vm.$emit('resizeend', { sizes: [50, 50] })
    wrapper.unmount()

    const next = mountView('story_a')
    const sizes = next.findAllComponents(SplitterPanel).map(panel => panel.props('size'))
    expect(sizes).toEqual([30, 70, 50, 50])
  })

  it('starts from the starting widths with none kept, or none usable', () => {
    window.localStorage.setItem('ui.writer.splitter.row', '{"not":"sizes"}')
    const wrapper = mountView('story_a')
    const sizes = wrapper.findAllComponents(SplitterPanel).map(panel => panel.props('size'))
    expect(sizes).toEqual([20, 80, 62, 38])
  })

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

  describe('in a narrow window', () => {
    const asking = (attr, event, payload) => ({
      props: ['storyId', 'chatShowing'],
      emits: [event],
      template: `<button ${attr} :data-chat-showing="chatShowing" @click="$emit('${event}', ${payload})" />`,
    })
    const mountNarrow = layout => {
      isNarrow.value = true
      return mount(DesktopView, {
        props: { layout, storyId: 'story_a' },
        global: {
          plugins: [PrimeVue],
          stubs: {
            LeftSidebar: asking('data-sidebar', 'select-chat', "'chat_2'"),
            EditorPanel: asking('data-editor', 'toggle-chat', ''),
            ChatPanel: boundPanel('data-chat'),
          },
        },
      })
    }
    const panelOf = (wrapper, attr) => wrapper.find(attr).element.parentElement

    it('folds the chat away while the sidebar is open, and says so to its toggle', () => {
      const wrapper = mountNarrow(DEFAULT_LAYOUT)

      expect(panelOf(wrapper, '[data-chat]').style.display).toBe('none')
      expect(panelOf(wrapper, '[data-sidebar]').style.display).toBe('')
      expect(wrapper.find('[data-editor]').attributes('data-chat-showing')).toBe('false')
    })

    it('shows the folded chat by closing the sidebar', async () => {
      const wrapper = mountNarrow(DEFAULT_LAYOUT)

      await wrapper.find('[data-editor]').trigger('click')

      expect(wrapper.emitted('toggle')).toEqual([['sidebar']])
    })

    it('opens a chat picked from the list in place of the list', async () => {
      const wrapper = mountNarrow(DEFAULT_LAYOUT)

      await wrapper.find('[data-sidebar]').trigger('click')

      expect(wrapper.emitted('select-chat')).toEqual([['chat_2']])
      expect(wrapper.emitted('toggle')).toEqual([['sidebar']])
    })

    it('leaves the sidebar alone when the chat is not folded', async () => {
      const wrapper = mountNarrow({ ...DEFAULT_LAYOUT, chat: false })

      await wrapper.find('[data-sidebar]').trigger('click')
      await wrapper.find('[data-editor]').trigger('click')

      expect(wrapper.emitted('toggle')).toEqual([['chat']])
    })
  })
})
