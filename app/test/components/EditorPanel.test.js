import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import PrimeVue from 'primevue/config'
import EditorPanel from '@/components/writer/layout/EditorPanel.vue'
import { clearFileViews } from '@/composables/useFileView.js'
import { useFocusMode } from '@/composables/useFocusMode.js'

const { mockApi, toastAction } = await vi.hoisted(async () => {
  // Imports land after hoisted code runs, so vue is fetched here. The set is
  // reactive so the panel sees a document change kind, as it would the store.
  const { reactive } = await import('vue')
  const plainIds = reactive(new Set())
  return {
    toastAction: vi.fn(),
    mockApi: {
      tabs: { value: { open: [], active: null } },
      open: vi.fn(),
      keep: vi.fn(),
      closeTab: vi.fn(),
      get: vi.fn(),
      titlesOf: vi.fn(id => [id === 'doc_2' ? 'Two' : 'Untitled']),
      pathOf: vi.fn(id => (id === 'doc_2' ? 'Two' : 'Untitled')),
      displayTitle: vi.fn(document => document?.title || 'Untitled'),
      plainIds,
      isPlain: vi.fn(id => plainIds.has(id)),
      wouldSettle: vi.fn(() => false),
      currentContent: vi.fn(id => (plainIds.has(id) ? '* as typed' : '- as typed')),
      setContent: vi.fn(),
      setPlain: vi.fn((id, plain) => {
        if (plain) plainIds.add(id)
        else plainIds.delete(id)
      }),
    },
  }
})
vi.mock('@/composables/useDocuments', () => ({ useDocuments: () => mockApi }))
const isMobile = ref(false)
vi.mock('@/composables/useScreenSize.js', () => ({
  useScreenSize: () => ({ isMobile, isNarrow: ref(false) }),
}))
const mockCopyPath = vi.fn()
vi.mock('@/composables/useCopyPath.js', () => ({ useCopyPath: () => ({ copyPath: mockCopyPath }) }))
vi.mock('@/composables/useToast.js', () => ({ useToast: () => ({ action: toastAction }) }))
vi.mock('@/composables/useChats.js', () => ({
  useChats: () => ({ getChatById: id => (id === 'chat_1' ? { id, title: 'Heist' } : null) }),
}))

const Editor = {
  props: ['documentId'],
  emits: ['shortcuts'],
  template: '<div data-editor :data-id="documentId" @click="$emit(\'shortcuts\')" />',
}
const ShortcutsDialog = {
  props: ['visible'],
  template: '<div v-if="visible" data-shortcuts />',
}
const RawMarkdown = { props: ['documentId'], template: '<div data-raw :data-id="documentId" />' }
const mockOpenFind = vi.fn(() => true)
// A file the view shows as code has a find of its own: one here whose id says so.
const FileView = {
  props: ['documentId'],
  template: '<div data-file :data-id="documentId" />',
  setup(props, { expose }) {
    expose({ findable: props.documentId.startsWith('code'), openFind: mockOpenFind })
  },
}
const ChatTextView = {
  props: ['chatId', 'text'],
  template: '<div data-chat-text :data-chat="chatId" :data-text="text" />',
}
const EmptyEditor = { template: '<div data-empty />' }

const mountPanel = (tabs, props = {}) => {
  mockApi.tabs = ref(tabs)
  return mount(EditorPanel, {
    props: { storyId: 'story_1', ...props },
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      stubs: { Editor, RawMarkdown, EmptyEditor, FileView, ChatTextView, ShortcutsDialog },
    },
  })
}

describe('EditorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearFileViews()
    window.sessionStorage.clear()
    mockApi.plainIds.clear()
    mockApi.wouldSettle.mockReturnValue(false)
    mockApi.get.mockImplementation(id => ({ id, type: 'text', title: id === 'doc_2' ? 'Two' : '' }))
  })

  afterEach(() => {
    useFocusMode().leave()
    isMobile.value = false
  })

  it('shows the strip and the editor on the tab showing', () => {
    const wrapper = mountPanel({ open: ['doc_1', 'doc_2'], active: 'doc_2' })
    expect(wrapper.findAll('[role="tab"]').map(t => t.text())).toEqual(['Untitled', 'Two'])
    expect(wrapper.find('[data-tab-id="doc_2"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[data-editor]').attributes('data-id')).toBe('doc_2')
    expect(wrapper.find('[data-empty]').exists()).toBe(false)
  })

  it("offers to copy a tab's path from its menu", () => {
    const wrapper = mountPanel({ open: ['doc_1', 'doc_2'], active: 'doc_1' })
    const actions = wrapper.findComponent({ name: 'EditorTabs' }).props('actions')

    const items = actions('doc_2')
    expect(items[0].label).toBe('Copy path')
    items[0].command()
    expect(mockCopyPath).toHaveBeenCalledWith('doc_2')
  })

  it('names tabs of one title by as much of their path as tells them apart', () => {
    const paths = { doc_1: ['foo', 'bar', 'a'], doc_2: ['baz', 'bar', 'a'], doc_3: ['b'] }
    mockApi.titlesOf.mockImplementation(id => paths[id])
    mockApi.get.mockImplementation(id => ({ id, title: paths[id].at(-1) }))
    mockApi.pathOf.mockImplementation(id => paths[id].join('/'))

    const wrapper = mountPanel({ open: ['doc_1', 'doc_2', 'doc_3'], active: 'doc_1' })

    expect(wrapper.findAll('[role="tab"]').map(t => t.text())).toEqual([
      'foo/bar/a',
      'baz/bar/a',
      'b',
    ])
    expect(wrapper.find('[data-tab-id="doc_3"]').attributes('title')).toBe('b')
  })

  it('marks the preview, and keeps it on a double-click', async () => {
    const wrapper = mountPanel({ open: ['doc_1', 'doc_2'], active: 'doc_2', preview: 'doc_2' })
    expect(wrapper.find('[data-tab-id="doc_2"]').attributes('data-preview')).toBe('true')
    expect(wrapper.find('[data-tab-id="doc_1"]').attributes('data-preview')).toBeUndefined()

    await wrapper.find('[data-tab-id="doc_2"]').trigger('dblclick')
    expect(mockApi.keep).toHaveBeenCalledWith('doc_2')
  })

  it('shows what to do with nothing open, and no strip when there is no chat beside it', () => {
    const wrapper = mountPanel({ open: [], active: null })
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect(wrapper.find('[data-editor]').exists()).toBe(false)
    expect(wrapper.find('[data-empty]').exists()).toBe(true)
  })

  it('carries the chat’s toggle at the end of the strip, even with nothing open', async () => {
    const wrapper = mountPanel({ open: [], active: null }, { chatShowing: true })
    const toggle = () => wrapper.find('[data-panel-toggle="chat"]')

    // The strip is the panel's header, and the toggle is what makes it one.
    expect(wrapper.find('[role="tablist"]').exists()).toBe(true)
    expect(wrapper.find('[data-empty]').exists()).toBe(true)
    expect(toggle().attributes('aria-label')).toBe('Hide chat')

    await toggle().trigger('click')
    expect(wrapper.emitted('toggle-chat')).toHaveLength(1)

    await wrapper.setProps({ chatShowing: false })
    expect(toggle().attributes('aria-label')).toBe('Show chat')
  })

  it('shows the document alone in focus mode, further down, and the strip again after', async () => {
    const wrapper = mountPanel({ open: ['doc_1', 'doc_2'], active: 'doc_2' }, { chatShowing: true })
    const pageTop = () =>
      wrapper.find('[data-editor]').element.parentElement.style.getPropertyValue('--page-top')

    useFocusMode().enter()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect(wrapper.find('[data-editor]').attributes('data-id')).toBe('doc_2')
    expect(pageTop()).toBe('15vh')

    useFocusMode().leave()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="tablist"]').exists()).toBe(true)
    expect(pageTop()).toBe('')
  })

  it('offers focus mode between the find and the chat’s toggle, and goes in on a click', async () => {
    const wrapper = mountPanel({ open: ['doc_1'], active: 'doc_1' }, { chatShowing: true })
    const ends = wrapper
      .findAll('[data-action], [data-panel-toggle]')
      .map(button => button.attributes('data-action') || button.attributes('data-panel-toggle'))
    expect(ends).toEqual(['find', 'focus', 'chat'])
    expect(wrapper.find('[data-action="focus"]').attributes('aria-label')).toBe('Focus mode')

    await wrapper.find('[data-action="focus"]').trigger('click')

    expect(useFocusMode().focused.value).toBe(true)
  })

  it('offers no focus mode with nothing open, or on a phone, which has no key to leave it by', () => {
    expect(
      mountPanel({ open: [], active: null }, { chatShowing: true })
        .find('[data-action="focus"]')
        .exists()
    ).toBe(false)

    isMobile.value = true
    const phone = mountPanel({ open: ['doc_1'], active: 'doc_1' })
    expect(phone.find('[role="tablist"]').exists()).toBe(true)
    expect(phone.find('[data-action="focus"]').exists()).toBe(false)
  })

  it('brings a tab forward and closes one through the document API', async () => {
    const wrapper = mountPanel({ open: ['doc_1', 'doc_2'], active: 'doc_1' })
    await wrapper.find('[data-tab-id="doc_2"]').trigger('click')
    expect(mockApi.open).toHaveBeenCalledWith('doc_2')

    await wrapper.find('[data-tab-id="doc_1"] button').trigger('click')
    expect(mockApi.closeTab).toHaveBeenCalledWith('doc_1')
  })

  /** A tab's menu entry for switching kind, taken from the tab strip. */
  const plainTextItem = (wrapper, id) =>
    wrapper
      .findComponent({ name: 'EditorTabs' })
      .props('actions')(id)
      .find(item => item.label === 'Edit in plain text editor')

  it('shows a plain document as text, and a structured one laid out', () => {
    mockApi.plainIds.add('doc_2')
    const asText = mountPanel({ open: ['doc_1', 'doc_2'], active: 'doc_2' })
    expect(asText.find('[data-raw]').attributes('data-id')).toBe('doc_2')
    expect(asText.find('[data-editor]').exists()).toBe(false)
    expect(plainTextItem(asText, 'doc_2').icon).toBe('pi pi-check')
    // Its tab says so; the other's does not.
    const tabs = asText.findComponent({ name: 'EditorTabs' }).props('items')
    expect(tabs.map(item => item.plain)).toEqual([false, true])
    // Either kind has a find of its own.
    expect(asText.find('[data-action="find"]').exists()).toBe(true)

    const laidOut = mountPanel({ open: ['doc_1', 'doc_2'], active: 'doc_1' })
    expect(laidOut.find('[data-editor]').attributes('data-id')).toBe('doc_1')
    expect(plainTextItem(laidOut, 'doc_1').icon).toBe('pi pi-code')
    expect(laidOut.find('[data-action="find"]').exists()).toBe(true)
  })

  it('lists the editor’s keys when the editor asks, or from a laid-out tab’s menu', async () => {
    const wrapper = mountPanel({ open: ['doc_1', 'doc_2'], active: 'doc_1' })
    expect(wrapper.find('[data-shortcuts]').exists()).toBe(false)

    await wrapper.find('[data-editor]').trigger('click')
    expect(wrapper.find('[data-shortcuts]').exists()).toBe(true)

    mockApi.plainIds.add('doc_2')
    const actions = wrapper.findComponent({ name: 'EditorTabs' }).props('actions')
    expect(actions('doc_1').map(item => item.label)).toContain('Keyboard shortcuts')
    // The plain text editor has keys of its own.
    expect(actions('doc_2').map(item => item.label)).not.toContain('Keyboard shortcuts')
  })

  it('offers a find, without the replace, on a file shown as code', async () => {
    mockApi.get.mockImplementation(id => ({ id, type: 'file', title: id, mime: 'text/javascript' }))
    mockApi.titlesOf.mockImplementation(() => ['tides.js'])
    mockApi.pathOf.mockImplementation(() => 'tides.js')
    const wrapper = mountPanel({ open: ['code_1'], active: 'code_1' })
    await wrapper.vm.$nextTick()

    const find = wrapper.find('[data-action="find"]')
    expect(find.attributes('aria-label')).toBe('Find')
    await find.trigger('click')
    expect(mockOpenFind).toHaveBeenCalled()
  })

  it('shows a file as the file, and as its text from the menu', async () => {
    mockApi.get.mockImplementation(id =>
      id === 'pdf_1'
        ? { id, type: 'file', title: 'Paper', mime: 'application/pdf' }
        : { id, type: 'text', title: '' }
    )
    mockApi.titlesOf.mockImplementation(() => ['Paper'])
    mockApi.pathOf.mockImplementation(() => 'Paper')
    mockApi.plainIds.add('pdf_1')
    const wrapper = mountPanel({ open: ['pdf_1'], active: 'pdf_1' })
    expect(wrapper.find('[data-file]').attributes('data-id')).toBe('pdf_1')
    expect(wrapper.find('[data-raw]').exists()).toBe(false)
    expect(wrapper.find('[data-action="find"]').exists()).toBe(false)

    const actions = wrapper.findComponent({ name: 'EditorTabs' }).props('actions')
    // A file is never a document to lay out, so there is no kind to switch.
    expect(actions('pdf_1').map(item => item.label)).toEqual(['Copy path', 'Show as text'])

    actions('pdf_1')[1].command()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-raw]').attributes('data-id')).toBe('pdf_1')
    expect(wrapper.find('[data-file]').exists()).toBe(false)
    expect(actions('pdf_1')[1].label).toBe('Show the file')
  })

  it("makes a tab's document plain, and a document again, with nothing to undo when nothing changes", async () => {
    const wrapper = mountPanel({ open: ['doc_1'], active: 'doc_1' })

    plainTextItem(wrapper, 'doc_1').command()
    await wrapper.vm.$nextTick()
    expect(mockApi.setPlain).toHaveBeenCalledWith('doc_1', true)
    expect(wrapper.find('[data-raw]').exists()).toBe(true)

    plainTextItem(wrapper, 'doc_1').command()
    await wrapper.vm.$nextTick()
    expect(mockApi.setPlain).toHaveBeenLastCalledWith('doc_1', false)
    expect(toastAction).not.toHaveBeenCalled()
    expect(wrapper.find('[data-editor]').exists()).toBe(true)
  })

  it('rewrites text the editor would write differently, and offers it back', () => {
    mockApi.plainIds.add('doc_1')
    mockApi.wouldSettle.mockReturnValue(true)
    const wrapper = mountPanel({ open: ['doc_1'], active: 'doc_1' })

    plainTextItem(wrapper, 'doc_1').command()

    expect(mockApi.setPlain).toHaveBeenCalledWith('doc_1', false)
    expect(toastAction).toHaveBeenCalledTimes(1)
    const [, undo, { changes }] = toastAction.mock.calls[0]
    expect(undo.label).toBe('Undo')
    expect(changes).toEqual([{ removed: ['* as typed'], added: ['- as typed'] }])

    undo.command()
    expect(mockApi.setPlain).toHaveBeenLastCalledWith('doc_1', true)
    expect(mockApi.setContent).toHaveBeenCalledWith('doc_1', '* as typed')
  })

  it('offers no switch on a tab that is not a text document', () => {
    mockApi.get.mockImplementation(id => ({ id, type: 'folder', title: '' }))
    const wrapper = mountPanel({ open: ['doc_1'], active: 'doc_1' })

    expect(plainTextItem(wrapper, 'doc_1')).toBeUndefined()
  })

  describe("a chat's text", () => {
    beforeEach(() => {
      mockApi.get.mockImplementation(id =>
        id.startsWith('chat:') ? null : { id, type: 'text', title: id === 'doc_2' ? 'Two' : '' }
      )
    })

    it('shows in a tab named for it, as text with a find of its own', () => {
      const wrapper = mountPanel({
        open: ['doc_2', 'chat:chat_1:prompt'],
        active: 'chat:chat_1:prompt',
      })

      expect(wrapper.findAll('[role="tab"]').map(t => t.text())).toEqual(['Two', 'System prompt'])
      expect(wrapper.find('[data-tab-id="chat:chat_1:prompt"]').attributes('title')).toBe(
        'Heist/System prompt'
      )
      const view = wrapper.find('[data-chat-text]')
      expect(view.attributes('data-chat')).toBe('chat_1')
      expect(view.attributes('data-text')).toBe('prompt')
      expect(wrapper.find('[data-editor]').exists()).toBe(false)
      expect(wrapper.find('[data-action="find"]').exists()).toBe(true)
    })

    it('is told apart from another chat’s by the chat', () => {
      const wrapper = mountPanel({
        open: ['chat:chat_1:note', 'chat:chat_new:note'],
        active: 'chat:chat_1:note',
      })

      expect(wrapper.findAll('[role="tab"]').map(t => t.text())).toEqual([
        "Heist/Author's note",
        "Untitled chat/Author's note",
      ])
    })

    it('has nothing on its menu', () => {
      const wrapper = mountPanel({ open: ['chat:chat_1:prompt'], active: 'chat:chat_1:prompt' })
      const actions = wrapper.findComponent({ name: 'EditorTabs' }).props('actions')

      expect(actions('chat:chat_1:prompt')).toEqual([])
    })
  })

  it('follows the tab that comes forward', async () => {
    const wrapper = mountPanel({ open: ['doc_1', 'doc_2'], active: 'doc_1' })
    mockApi.tabs.value = { open: ['doc_1', 'doc_2'], active: 'doc_2' }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-editor]').attributes('data-id')).toBe('doc_2')
  })
})
