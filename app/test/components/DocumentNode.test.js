/* global Event */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'
import ToastService from 'primevue/toastservice'
import Tooltip from 'primevue/tooltip'
import DocumentNode from '../../src/components/writer/tree/DocumentNode.vue'
import { useDocuments, clearDocumentInstances } from '../../src/composables/useDocuments'
import { useDocumentsStore } from '../../src/stores/documentsStore'
import { useChatsStore } from '../../src/stores/chatsStore'
import { clearChatsInstances, useChats } from '../../src/composables/useChats'
import { LONG_PRESS_MS } from '../../src/composables/useLongPress.js'

const reextractFile = vi.fn()
vi.mock('../../src/files/write.js', () => ({ reextractFile: (...args) => reextractFile(...args) }))

vi.mock('../../src/stores/db', () => ({
  default: {
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
    },
    chatProfiles: { toArray: vi.fn(async () => []) },
    jobs: { put: vi.fn(async () => undefined) },
  },
}))

vi.mock('../../src/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

// A real ref, so the template unwraps it: a plain object reads as true there,
// and every row would think it was on a phone. Shared, so a test can be one.
const { screen } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { screen: { isMobile: ref(false) } }
})
vi.mock('../../src/composables/useScreenSize', () => ({ useScreenSize: () => screen }))

/** Run a test as on a phone. */
const onPhone = async run => {
  screen.isMobile.value = true
  try {
    await run()
  } finally {
    screen.isMobile.value = false
  }
}

// Reactive, so the tabs recorded on the story are seen to change, as the
// store's would be.
const { mockStory } = await vi.hoisted(async () => {
  const { reactive } = await import('vue')
  return { mockStory: reactive({ id: 'story_1', title: 'My Novel' }) }
})
vi.mock('../../src/stores/storiesStore', () => ({
  useStoriesStore: () => ({
    getStory: id => (id === 'story_1' ? mockStory : null),
    updateStory: vi.fn((_id, updates) => Object.assign(mockStory, updates)),
  }),
}))

// The summary panel pulls in AI plumbing this suite has no interest in.
vi.mock('../../src/components/writer/tree/DocumentSummary.vue', () => ({
  default: { name: 'DocumentSummary', template: '<div class="summary-stub" />' },
}))

const mountNode = (documentId, props = {}) =>
  mount(DocumentNode, {
    props: { storyId: 'story_1', documentId, ...props },
    global: {
      plugins: [PrimeVue, ConfirmationService, ToastService],
      directives: { tooltip: Tooltip },
    },
  })

/**
 * A node inside a tree on the page, so that the arrows have rows to move
 * between and focus somewhere to go.
 */
const mountInTree = (documentId, props = {}) =>
  mount(
    {
      components: { DocumentNode },
      template: '<div role="tree"><DocumentNode v-bind="$attrs" /></div>',
      inheritAttrs: false,
    },
    {
      attrs: { storyId: 'story_1', documentId, ...props },
      attachTo: document.body,
      global: {
        plugins: [PrimeVue, ConfirmationService, ToastService],
        directives: { tooltip: Tooltip },
      },
    }
  )

const row = (wrapper, documentId) => wrapper.find(`[data-document-id="${documentId}"]`)

describe('DocumentNode', () => {
  /** @type {ReturnType<typeof useDocuments>} */
  let api
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    vi.clearAllMocks()
    const store = useDocumentsStore()
    api = useDocuments('story_1')
    await api.init()

    // A project's folders come from the template it was created with, not from
    // init, so the tree these tests render is laid down here.
    store.createDocument({
      id: 'manuscript_story_1',
      storyId: 'story_1',
      parentId: 'root_story_1',
      type: 'folder',
      title: 'manuscript',
      ordered: true,
    })
    store.createDocument({
      id: 'notes_story_1',
      storyId: 'story_1',
      parentId: 'root_story_1',
      type: 'folder',
      title: 'notes',
    })
  })

  it('renders a folder and its children', () => {
    const act = api.createFolder('manuscript_story_1', 'First Act')
    api.createTextDocument(act.id, 'Opening')

    const wrapper = mountNode(act.id)

    expect(wrapper.text()).toContain('First Act')
    expect(wrapper.text()).toContain('Opening')
  })

  it('shows the bare title inside an ordered folder', () => {
    api.createFolder('manuscript_story_1', 'First Act')
    const second = api.createFolder('manuscript_story_1', 'Second Act')

    const text = mountNode(second.id).text()
    expect(text).toContain('Second Act')
    expect(text).not.toContain('2: Second Act')
  })

  it('opens a document when its row is clicked', async () => {
    const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
    const wrapper = mountNode(chapter.id)

    await wrapper.find('.group').trigger('click')

    // The old outline toggled a summary here; a document now opens.
    expect(wrapper.emitted('open')).toEqual([[chapter.id]])
  })

  it('keeps the tab a document opened in on a double-click', async () => {
    const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
    const wrapper = mountNode(chapter.id)
    api.open(chapter.id, { preview: true })
    expect(api.tabs.value.preview).toBe(chapter.id)

    await wrapper.find('.group').trigger('dblclick')

    expect(api.tabs.value.preview).toBeNull()
  })

  it('twists a folder open and shut instead of opening it', async () => {
    const act = api.createFolder('manuscript_story_1', 'First Act')
    api.createTextDocument(act.id, 'Opening')
    const wrapper = mountNode(act.id)

    await wrapper.find('.group').trigger('click')

    expect(wrapper.emitted('open')).toBeUndefined()
    expect(wrapper.text()).not.toContain('Opening')

    await wrapper.find('.group').trigger('click')
    expect(wrapper.text()).toContain('Opening')
  })

  it('marks the active document', () => {
    const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')

    const active = mountNode(chapter.id, { activeDocumentId: chapter.id })
    const inactive = mountNode(chapter.id, { activeDocumentId: 'something_else' })

    expect(active.find('.group').classes()).toContain('bg-surface-200')
    expect(inactive.find('.group').classes()).not.toContain('bg-surface-200')
  })

  it('indents by depth so nesting is legible', () => {
    const act = api.createFolder('manuscript_story_1', 'First Act')
    const row = mountNode(act.id, { depth: 2 }).find('.group')

    expect(row.attributes('style')).toContain('padding-left: 28px')
  })

  it('opens a rename input for a freshly created document', async () => {
    const created = api.createTextDocument('notes_story_1', '')
    api.requestRename(created.id)

    const wrapper = mountNode(created.id)
    await wrapper.vm.$nextTick()

    // A new node has no name; landing on "Untitled" would mean hunting for it.
    expect(wrapper.find('input').exists()).toBe(true)
  })

  it('opens a document in the editor as it is created', () => {
    const act = api.createFolder('manuscript_story_1', 'First Act')
    const wrapper = mountNode(act.id)
    const items = wrapper.findComponent({ name: 'ContextMenu' }).props('model')

    items.find(item => item.label === 'New document').command()

    const created = api.childrenOf(act.id).at(-1)
    expect(created.type).toBe('text')
    expect(api.tabs.value.active).toBe(created.id)
    expect(api.pendingRenameId.value).toBe(created.id)
  })

  it('puts the writer in a new document once they have named it', async () => {
    const created = api.createTextDocument('notes_story_1', '')
    api.open(created.id)
    api.requestRename(created.id)
    const focus = vi.spyOn(api, 'focus')
    const wrapper = mountNode(created.id)
    await wrapper.vm.$nextTick()

    const input = wrapper.find('input')
    await input.setValue('Chapter 1')
    await input.trigger('keyup.enter')

    expect(wrapper.emitted('open')).toEqual([[created.id]])
    expect(focus).toHaveBeenCalledWith(created.id)
  })

  it('leaves the focus where the writer took it when a new name is left by clicking away', async () => {
    const created = api.createTextDocument('notes_story_1', '')
    api.open(created.id)
    api.requestRename(created.id)
    const focus = vi.spyOn(api, 'focus')
    const wrapper = mountNode(created.id)
    await wrapper.vm.$nextTick()

    const input = wrapper.find('input')
    await input.setValue('Chapter 1')
    await input.trigger('blur')

    expect(api.get(created.id).title).toBe('Chapter 1')
    expect(wrapper.emitted('open')).toBeUndefined()
    expect(focus).not.toHaveBeenCalled()
  })

  it('writes a rename through to the store', async () => {
    const chapter = api.createTextDocument('notes_story_1', 'Old name')
    api.requestRename(chapter.id)
    const wrapper = mountNode(chapter.id)
    await wrapper.vm.$nextTick()

    const input = wrapper.find('input')
    await input.setValue('New name')
    await input.trigger('keyup.enter')

    expect(api.get(chapter.id).title).toBe('New name')
  })

  it('keeps the old name when a rename is cancelled', async () => {
    const chapter = api.createTextDocument('notes_story_1', 'Old name')
    api.requestRename(chapter.id)
    const wrapper = mountNode(chapter.id)
    await wrapper.vm.$nextTick()

    const input = wrapper.find('input')
    await input.setValue('Discarded')
    await input.trigger('keyup.escape')

    expect(api.get(chapter.id).title).toBe('Old name')
  })

  describe('a name something beside it has', () => {
    const renaming = async title => {
      api.createTextDocument('notes_story_1', 'Riley')
      const chapter = api.createTextDocument('notes_story_1', 'Old name')
      api.requestRename(chapter.id)
      const wrapper = mountNode(chapter.id)
      await wrapper.vm.$nextTick()
      const input = wrapper.find('input')
      await input.setValue(title)
      return { wrapper, input, chapter }
    }

    it('is said under the field on Enter, not as it is typed, in any case', async () => {
      const { wrapper, input } = await renaming('riley ')
      expect(wrapper.find('[data-rename-clash]').exists()).toBe(false)

      await input.trigger('keyup.enter')

      expect(wrapper.find('[data-rename-clash]').text()).toBe('“Riley” is already in this folder')
      expect(wrapper.find('input').attributes('aria-invalid')).toBe('true')
    })

    it('stops being said once the name is changed', async () => {
      const { wrapper, input } = await renaming('Riley')
      await input.trigger('keyup.enter')

      await input.setValue('Rile')
      expect(wrapper.find('[data-rename-clash]').exists()).toBe(false)
      await input.setValue('Riley')
      expect(wrapper.find('[data-rename-clash]').exists()).toBe(false)
    })

    it('says so at the top of the project, which is a folder too', async () => {
      const chapter = api.createTextDocument('root_story_1', 'Old name')
      api.requestRename(chapter.id)
      const wrapper = mountNode(chapter.id)
      await wrapper.vm.$nextTick()
      const input = wrapper.find('input')
      await input.setValue('Notes')
      await input.trigger('keyup.enter')

      expect(wrapper.find('[data-rename-clash]').text()).toBe('“notes” is already in this folder')
    })

    it('leaves the field open on Enter, to choose another', async () => {
      const { wrapper, input, chapter } = await renaming('Riley')
      await input.trigger('keyup.enter')

      expect(api.get(chapter.id).title).toBe('Old name')
      expect(wrapper.find('input').exists()).toBe(true)

      await input.setValue('Riley, again')
      expect(wrapper.find('[data-rename-clash]').exists()).toBe(false)
      await input.trigger('keyup.enter')
      expect(api.get(chapter.id).title).toBe('Riley, again')
    })

    it('keeps the old name when the field is left', async () => {
      const { wrapper, input, chapter } = await renaming('Riley')
      await input.trigger('blur')

      expect(api.get(chapter.id).title).toBe('Old name')
      expect(wrapper.find('input').exists()).toBe(false)
      expect(wrapper.find('[data-rename-clash]').exists()).toBe(false)
    })

    it('is not the document’s own, in another case', async () => {
      const { wrapper, input, chapter } = await renaming('OLD NAME')

      expect(wrapper.find('[data-rename-clash]').exists()).toBe(false)
      await input.trigger('keyup.enter')
      expect(api.get(chapter.id).title).toBe('OLD NAME')
    })
  })

  it('renders the project root with the story name and its folders beneath', () => {
    const wrapper = mountNode('root_story_1')

    expect(wrapper.text()).toContain('My Novel')
    // Rendering the root here is what puts the top level inside a drag list;
    // as a separate header it was the one place nothing could be dragged out of.
    expect(wrapper.text()).toContain('manuscript')
    expect(wrapper.text()).toContain('notes')
    expect(wrapper.findComponent({ name: 'draggable' }).exists()).toBe(true)
  })

  it('renders nothing for a document that has been deleted', () => {
    const chapter = api.createTextDocument('notes_story_1', 'Gone')
    api.remove(chapter.id)

    expect(mountNode(chapter.id).find('.group').exists()).toBe(false)
  })

  it('offers to hide a document from the AI, and to show it again', async () => {
    const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
    const wrapper = mountNode(chapter.id)
    const items = () => wrapper.findComponent({ name: 'ContextMenu' }).props('model')
    const labels = () => items().map(item => item.label)

    expect(wrapper.find('span.truncate').classes()).not.toContain('opacity-60')
    items()
      .find(item => item.label === 'Hide')
      .command()
    await wrapper.vm.$nextTick()

    expect(api.isHidden(chapter.id)).toBe(true)
    // The row dims, with no icon: the one it could carry would not be a
    // toggle. The same menu entry now does the reverse.
    expect(wrapper.find('span.truncate').classes()).toContain('opacity-60')
    expect(wrapper.find('.pi-eye-slash').exists()).toBe(false)
    expect(labels()).toContain('Unhide')
    expect(labels()).not.toContain('Hide')
  })

  it('dims everything under a hidden folder', () => {
    const act = api.createFolder('manuscript_story_1', 'First Act')
    api.createTextDocument(act.id, 'Opening')
    api.setHidden(act.id, true)

    const rows = mountNode(act.id).findAll('.group')

    expect(rows).toHaveLength(2)
    // Both read as out of the model's reach; the flag is the folder's to lift,
    // from its menu.
    for (const row of rows) {
      expect(row.find('span.truncate').classes()).toContain('opacity-60')
      expect(row.find('.pi-eye-slash').exists()).toBe(false)
    }
  })

  describe('with a chat open', () => {
    const CHAT = 'chat_1'
    let chats

    beforeEach(() => {
      clearChatsInstances()
      chats = useChatsStore()
      chats.chats.set(CHAT, { id: CHAT, storyId: 'story_1', title: 'Chat' })
    })

    const menuOf = wrapper => () => wrapper.findComponent({ name: 'ContextMenu' }).props('model')
    const pick = (items, label) =>
      items()
        .find(item => item.label === label)
        .command()
    const chatItems = [
      'Pin to chat',
      'Unpin from chat',
      'Hide from this chat',
      'Unhide in this chat',
    ]

    it('keeps the chat’s marks out of the menu, where the row’s toggles are', () => {
      const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
      const labels = menuOf(mountNode(chapter.id, { chatId: CHAT }))().map(item => item.label)

      expect(labels).toContain('Hide')
      for (const item of chatItems) expect(labels).not.toContain(item)
    })

    it('keeps them in the menu on a phone, which has no hover to find a toggle by', () =>
      onPhone(async () => {
        const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
        const wrapper = mountNode(chapter.id, { chatId: CHAT })
        const items = menuOf(wrapper)
        const labels = () => items().map(item => item.label)

        expect(labels()).toContain('Pin to chat')
        pick(items, 'Hide from this chat')
        await wrapper.vm.$nextTick()

        expect(chats.getChatById(CHAT).hiddenIds).toEqual([chapter.id])
        // The document's own flag is untouched: every other chat still sees it.
        expect(api.isHidden(chapter.id)).toBe(false)
        expect(labels()).toContain('Unhide in this chat')

        pick(items, 'Unhide in this chat')
        expect(chats.getChatById(CHAT).hiddenIds).toBeUndefined()
      }))

    it('offers nothing of the chat’s on what every chat is kept from', () =>
      onPhone(() => {
        const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
        api.setHidden(chapter.id, true)
        const wrapper = mountNode(chapter.id, { chatId: CHAT })

        const labels = menuOf(wrapper)().map(item => item.label)
        for (const item of chatItems) expect(labels).not.toContain(item)
        expect(wrapper.find('[data-toggle]').exists()).toBe(false)
      }))

    it('pins from the row, and unpins from the pin', async () => {
      const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
      const wrapper = mountNode(chapter.id, { chatId: CHAT })
      const pin = () => wrapper.find('[data-toggle="pin"]')

      const title = () => wrapper.find('span.truncate')
      expect(pin().attributes('aria-label')).toBe('Pin to this chat')
      expect(pin().attributes('aria-pressed')).toBe('false')
      expect(title().classes()).not.toContain('text-primary-600')

      await pin().trigger('click')

      expect(chats.getChatById(CHAT).pinnedIds).toEqual([chapter.id])
      expect(pin().attributes('aria-label')).toBe('Pinned to this chat')
      // At rest the row says so by its colour, not by an icon: the toggle
      // only shows on hover, whatever state it is in.
      expect(pin().classes()).toContain('opacity-0')
      expect(title().classes()).toContain('text-primary-600')
      expect(title().attributes('title')).toBe('In this chat’s context')

      await pin().trigger('click')

      expect(chats.getChatById(CHAT).pinnedIds).toBeUndefined()
      expect(pin().attributes('aria-label')).toBe('Pin to this chat')
      expect(title().classes()).not.toContain('text-primary-600')
    })

    it('marks the unstarted chat, which carries them into the chat it becomes', async () => {
      const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
      const chatsApi = useChats('story_1')
      const id = chatsApi.unstartedChat.value.id
      const wrapper = mountNode(chapter.id, { chatId: id })

      await wrapper.find('[data-toggle="pin"]').trigger('click')

      expect(chatsApi.unstartedChat.value.pinnedIds).toEqual([chapter.id])
      expect(wrapper.find('[data-toggle="pin"]').attributes('aria-label')).toBe(
        'Pinned to this chat'
      )
      chatsApi.startChat()
      expect(chats.getChatById(id).pinnedIds).toEqual([chapter.id])
    })

    it('shows a folder’s pin faintly on what is under it, and lets one thing go', async () => {
      const act = api.createFolder('manuscript_story_1', 'First Act')
      const opening = api.createTextDocument(act.id, 'Opening')
      chats.updateChat(CHAT, { pinnedIds: [act.id] })
      const rows = mountNode(act.id, { chatId: CHAT }).findAll('.group')
      const pinOf = row => row.find('[data-toggle="pin"]')

      expect(pinOf(rows[0]).attributes('aria-label')).toBe('Pinned to this chat')
      expect(pinOf(rows[0]).find('i').classes()).not.toContain('opacity-50')
      expect(pinOf(rows[1]).attributes('aria-label')).toBe('Pinned with the folder above')
      expect(pinOf(rows[1]).find('i').classes()).toContain('opacity-50')
      // Both are carried, and both say so.
      for (const row of rows)
        expect(row.find('span.truncate').classes()).toContain('text-primary-600')

      await pinOf(rows[1]).trigger('click')

      // The folder's pin stays the folder's; the document is shown instead,
      // which is in sight and not carried.
      expect(chats.getChatById(CHAT).pinnedIds).toEqual([act.id])
      expect(chats.getChatById(CHAT).shownIds).toEqual([opening.id])
      expect(pinOf(rows[1]).attributes('aria-label')).toBe('Pin to this chat')
      expect(rows[1].find('span.truncate').classes()).not.toContain('text-primary-600')
      // Not a matter of sight, so no eye says "shown".
      expect(rows[1].find('[data-toggle="sight"]').attributes('aria-pressed')).toBe('false')
    })

    it('hides from the row, and shows again from the eye', async () => {
      const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
      const wrapper = mountNode(chapter.id, { chatId: CHAT })
      const eye = () => wrapper.find('[data-toggle="sight"]')

      expect(eye().attributes('aria-label')).toBe('Hide from this chat')
      await eye().trigger('click')

      expect(chats.getChatById(CHAT).hiddenIds).toEqual([chapter.id])
      expect(eye().attributes('aria-label')).toBe('Hidden in this chat')
      expect(eye().attributes('aria-pressed')).toBe('true')
      expect(wrapper.find('span.truncate').classes()).toContain('opacity-60')

      await eye().trigger('click')

      expect(chats.getChatById(CHAT).hiddenIds).toBeUndefined()
      expect(eye().attributes('aria-label')).toBe('Hide from this chat')
    })

    it('offers an eye on what a hidden folder dims, and takes the override off again', async () => {
      const shelf = api.createFolder('notes_story_1', 'Characters')
      const vivi = api.createFolder(shelf.id, 'Vivi')
      chats.updateChat(CHAT, { hiddenIds: [shelf.id] })
      const wrapper = mountNode(vivi.id, { chatId: CHAT })
      const eye = () => wrapper.find('[data-toggle="sight"]')

      expect(eye().attributes('aria-label')).toBe('Unhide in this chat')
      await eye().trigger('click')

      expect(chats.getChatById(CHAT).shownIds).toEqual([vivi.id])
      expect(eye().attributes('aria-label')).toBe('Shown in this chat')

      // Back under the folder's hide: the override comes off rather than a
      // hide going on beside it.
      await eye().trigger('click')
      expect(chats.getChatById(CHAT).shownIds).toBeUndefined()
      expect(chats.getChatById(CHAT).hiddenIds).toEqual([shelf.id])
    })

    it('has no toggles without a chat, on the project’s sight, or on what every chat is kept from', () => {
      const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
      expect(mountNode(chapter.id).find('[data-toggle]').exists()).toBe(false)

      // The root's own row: the rows under it are its children's.
      const root = mountNode('root_story_1', { chatId: CHAT, canDelete: false }).find('.group')
      expect(root.find('[data-toggle="pin"]').exists()).toBe(true)
      expect(root.find('[data-toggle="sight"]').exists()).toBe(false)

      api.setHidden(chapter.id, true)
      expect(mountNode(chapter.id, { chatId: CHAT }).find('[data-toggle]').exists()).toBe(false)
    })

    it('does not open the document, or keep its tab, from a toggle', async () => {
      const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
      const wrapper = mountNode(chapter.id, { chatId: CHAT })

      await wrapper.find('[data-toggle="pin"]').trigger('click')
      await wrapper.find('[data-toggle="pin"]').trigger('dblclick')

      expect(wrapper.emitted('open')).toBeUndefined()
    })

    it('pins in place of a hide, not beside it', async () => {
      const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
      chats.updateChat(CHAT, { hiddenIds: [chapter.id] })
      const wrapper = mountNode(chapter.id, { chatId: CHAT })

      await wrapper.find('[data-toggle="pin"]').trigger('click')

      expect(chats.getChatById(CHAT).pinnedIds).toEqual([chapter.id])
      expect(chats.getChatById(CHAT).hiddenIds).toBeUndefined()
    })
  })

  it('does not offer to hide the project itself', () => {
    const labels = mountNode('root_story_1', { canDelete: false })
      .findComponent({ name: 'ContextMenu' })
      .props('model')
      .map(item => item.label)

    expect(labels).not.toContain('Hide')
  })

  it('offers to copy the path the tools address the document by', async () => {
    const act = api.createFolder('manuscript_story_1', 'First Act')
    const chapter = api.createTextDocument(act.id, 'Chapter 1')
    const wrapper = mountNode(chapter.id)
    const items = wrapper.findComponent({ name: 'ContextMenu' }).props('model')

    await items.find(item => item.label === 'Copy path').command()

    expect(writeText).toHaveBeenCalledWith('manuscript/First Act/Chapter 1')
  })

  it('switches a document between plain text and laid out from its menu', async () => {
    const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
    const wrapper = mountNode(chapter.id)
    const labels = () =>
      wrapper
        .findComponent({ name: 'ContextMenu' })
        .props('model')
        .map(item => item.label)

    const item = () =>
      wrapper
        .findComponent({ name: 'ContextMenu' })
        .props('model')
        .find(each => each.icon === 'pi pi-code')

    expect(item().label).toBe('Edit as plain text')
    item().command()
    await wrapper.vm.$nextTick()

    expect(api.isPlain(chapter.id)).toBe(true)
    expect(labels()).toContain('Edit as a document')
  })

  it('offers no plain-text switch on a folder', () => {
    const folder = api.createFolder('manuscript_story_1', 'Act')
    const wrapper = mountNode(folder.id)
    const labels = wrapper
      .findComponent({ name: 'ContextMenu' })
      .props('model')
      .map(item => item.label)

    expect(labels).not.toContain('Edit as plain text')
  })

  it('opens the actions at the pointer on right-click, and from the menu key', async () => {
    const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
    const wrapper = mountNode(chapter.id)
    const contextMenu = wrapper.findComponent({ name: 'ContextMenu' })

    await wrapper.find('.group').trigger('contextmenu', { clientX: 40, clientY: 12 })
    expect(contextMenu.emitted('before-show')).toHaveLength(1)
    expect(contextMenu.props('model').map(item => item.label)).toContain('Rename')

    await wrapper.find('.group').trigger('keydown', { key: 'ContextMenu' })
    expect(contextMenu.emitted('before-show')).toHaveLength(2)
  })

  it('has a menu button on a phone, and only there', async () => {
    const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
    expect(mountNode(chapter.id).find('.pi-ellipsis-h').exists()).toBe(false)

    await onPhone(() => {
      const wrapper = mountNode(chapter.id)
      expect(wrapper.find('.pi-ellipsis-h').exists()).toBe(true)
      // The same actions as the right-click menu: one set, however asked for.
      expect(
        wrapper
          .findComponent({ name: 'TieredMenu' })
          .props('model')
          .map(i => i.label)
      ).toEqual(
        wrapper
          .findComponent({ name: 'ContextMenu' })
          .props('model')
          .map(i => i.label)
      )
    })
  })

  describe('held under a finger', () => {
    const at = (x, y) => ({ touches: [{ clientX: x, clientY: y }] })

    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('opens the actions where the finger is, and does not open the document', async () => {
      const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
      const wrapper = mountNode(chapter.id)
      const contextMenu = wrapper.findComponent({ name: 'ContextMenu' })

      await row(wrapper, chapter.id).trigger('touchstart', at(40, 12))
      vi.advanceTimersByTime(LONG_PRESS_MS)
      expect(contextMenu.emitted('before-show')).toHaveLength(1)

      const lifted = new Event('touchend', { cancelable: true })
      row(wrapper, chapter.id).element.dispatchEvent(lifted)
      // The click a lifted finger makes would open the document under the menu.
      expect(lifted.defaultPrevented).toBe(true)
    })

    it('leaves a finger that moves first to scroll', async () => {
      const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
      const wrapper = mountNode(chapter.id)
      const contextMenu = wrapper.findComponent({ name: 'ContextMenu' })

      await row(wrapper, chapter.id).trigger('touchstart', at(40, 12))
      await row(wrapper, chapter.id).trigger('touchmove', at(40, 60))
      vi.advanceTimersByTime(LONG_PRESS_MS)

      expect(contextMenu.emitted('before-show')).toBeUndefined()
    })

    it('puts the actions away again when the finger goes on to drag the row', async () => {
      const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
      const wrapper = mountNode(chapter.id)
      const contextMenu = wrapper.findComponent({ name: 'ContextMenu' })

      await row(wrapper, chapter.id).trigger('touchstart', at(40, 12))
      vi.advanceTimersByTime(LONG_PRESS_MS)
      await row(wrapper, chapter.id).trigger('touchmove', at(40, 60))

      expect(contextMenu.emitted('before-hide')).toHaveLength(1)
    })
  })

  it('leaves the browser menu alone inside a rename', async () => {
    const chapter = api.createTextDocument('notes_story_1', 'Old name')
    api.requestRename(chapter.id)
    const wrapper = mountNode(chapter.id)
    await wrapper.vm.$nextTick()

    await wrapper.find('input').trigger('contextmenu')

    // Right-clicking the input is how you paste a title; that is the browser's.
    expect(wrapper.findComponent({ name: 'ContextMenu' }).emitted('before-show')).toBeUndefined()
  })

  describe('from the keyboard', () => {
    it('puts one row in the tab order: the document open, or else the root', () => {
      const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')

      const none = mountNode('root_story_1')
      expect(row(none, 'root_story_1').attributes('tabindex')).toBe('0')
      expect(row(none, chapter.id).attributes('tabindex')).toBe('-1')

      const open = mountNode('root_story_1', { activeDocumentId: chapter.id })
      expect(row(open, 'root_story_1').attributes('tabindex')).toBe('-1')
      expect(row(open, chapter.id).attributes('tabindex')).toBe('0')
      expect(row(open, chapter.id).attributes('aria-selected')).toBe('true')
    })

    it('opens a document on Enter and on Space', async () => {
      const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
      const wrapper = mountNode(chapter.id)

      await wrapper.find('.group').trigger('keydown', { key: 'Enter' })
      await wrapper.find('.group').trigger('keydown', { key: ' ' })

      expect(wrapper.emitted('open')).toEqual([[chapter.id], [chapter.id]])
    })

    it('twists a folder with the arrows', async () => {
      const act = api.createFolder('manuscript_story_1', 'First Act')
      api.createTextDocument(act.id, 'Opening')
      const wrapper = mountNode(act.id)
      const folder = wrapper.find('.group')
      expect(folder.attributes('aria-expanded')).toBe('true')

      await folder.trigger('keydown', { key: 'ArrowLeft' })
      expect(folder.attributes('aria-expanded')).toBe('false')
      expect(wrapper.text()).not.toContain('Opening')

      await folder.trigger('keydown', { key: 'ArrowRight' })
      expect(folder.attributes('aria-expanded')).toBe('true')
      expect(wrapper.text()).toContain('Opening')
    })

    it('moves between the rows on screen with the arrows', async () => {
      const act = api.createFolder('manuscript_story_1', 'First Act')
      const opening = api.createTextDocument(act.id, 'Opening')
      const wrapper = mountInTree('root_story_1')
      const root = row(wrapper, 'root_story_1')

      root.element.focus()
      await root.trigger('keydown', { key: 'ArrowDown' })
      expect(document.activeElement).toBe(row(wrapper, 'manuscript_story_1').element)

      await row(wrapper, 'manuscript_story_1').trigger('keydown', { key: 'End' })
      expect(document.activeElement).toBe(row(wrapper, 'notes_story_1').element)

      // Into an open folder, and back out to it.
      await row(wrapper, act.id).trigger('keydown', { key: 'ArrowRight' })
      expect(document.activeElement).toBe(row(wrapper, opening.id).element)
      await row(wrapper, opening.id).trigger('keydown', { key: 'ArrowLeft' })
      expect(document.activeElement).toBe(row(wrapper, act.id).element)

      await row(wrapper, act.id).trigger('keydown', { key: 'Home' })
      expect(document.activeElement).toBe(root.element)
      wrapper.unmount()
    })

    it('renames on F2', async () => {
      const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
      const wrapper = mountNode(chapter.id)

      await wrapper.find('.group').trigger('keydown', { key: 'F2' })

      expect(wrapper.find('input').exists()).toBe(true)
    })

    it('leaves the keys of a rename to the field', async () => {
      const chapter = api.createTextDocument('manuscript_story_1', 'Chapter 1')
      api.requestRename(chapter.id)
      const wrapper = mountNode(chapter.id)
      await wrapper.vm.$nextTick()

      await wrapper.find('input').trigger('keydown', { key: 'Enter' })

      expect(wrapper.emitted('open')).toBeUndefined()
    })
  })

  describe('a file', () => {
    const fileNode = (mime, content = '') =>
      useDocumentsStore().createDocument({
        storyId: 'story_1',
        parentId: 'notes_story_1',
        type: 'file',
        title: 'Paper',
        mime,
        size: 10,
        content,
      })
    const labelsOf = wrapper =>
      wrapper
        .findComponent({ name: 'ContextMenu' })
        .props('model')
        .map(item => item.label)
        .filter(Boolean)

    it('offers its text, a fresh reading of it, and the file itself', () => {
      const labels = labelsOf(mountNode(fileNode('application/pdf').id))
      expect(labels).toContain('Show as text')
      expect(labels).toContain('Re-extract text')
      expect(labels).toContain('Download')
      expect(labels).not.toContain('Edit as plain text')
    })

    it('offers conversion for a file with text, and not for a document or a conversion', () => {
      expect(labelsOf(mountNode(fileNode('application/pdf', 'Some text').id))).toContain(
        'Convert to Markdown…'
      )
      expect(labelsOf(mountNode(fileNode('application/pdf').id))).not.toContain(
        'Convert to Markdown…'
      )
      const written = useDocumentsStore().createDocument({
        storyId: 'story_1',
        parentId: 'notes_story_1',
        type: 'text',
        title: 'Rules (Markdown)',
        content: '# Rules\n\nText.',
      })
      useDocumentsStore().updateDocument(written.id, { convertedFrom: 'doc_pdf' })
      expect(labelsOf(mountNode(written.id))).not.toContain('Convert to Markdown…')
    })

    it('offers neither a fresh reading nor a conversion of an epub, whose chapters are documents', () => {
      const labels = labelsOf(mountNode(fileNode('application/epub+zip').id))
      expect(labels).toContain('Download')
      expect(labels).not.toContain('Re-extract text')
      expect(labels).not.toContain('Convert to Markdown…')
    })

    it('has no text to read again out of a picture', () => {
      const labels = labelsOf(mountNode(fileNode('image/png').id))
      expect(labels).toContain('Show as text')
      expect(labels).not.toContain('Re-extract text')
    })

    it('reads the text again straight away when there is none to lose', async () => {
      reextractFile.mockResolvedValue({ text: 'one two three' })
      const made = fileNode('application/pdf')
      const wrapper = mountNode(made.id)

      wrapper
        .findComponent({ name: 'ContextMenu' })
        .props('model')
        .find(item => item.label === 'Re-extract text')
        .command()
      await wrapper.vm.$nextTick()

      expect(reextractFile).toHaveBeenCalledWith('story_1', made.id)
    })

    it('asks first when there is text that would be replaced', async () => {
      const made = fileNode('application/pdf', 'edited by hand')
      const wrapper = mountNode(made.id)

      wrapper
        .findComponent({ name: 'ContextMenu' })
        .props('model')
        .find(item => item.label === 'Re-extract text')
        .command()
      await wrapper.vm.$nextTick()

      expect(reextractFile).not.toHaveBeenCalled()
    })
  })

  describe('a card folder', () => {
    it('offers to import the card again when its sidecar is there', () => {
      const store = useDocumentsStore()
      const folder = store.createDocument({
        storyId: 'story_1',
        parentId: 'notes_story_1',
        type: 'folder',
        title: 'Elara',
        kind: 'card',
      })
      store.createDocument({
        storyId: 'story_1',
        parentId: folder.id,
        type: 'text',
        title: '.card.json',
        kind: 'sidecar',
        content: '{}',
      })
      const wrapper = mountNode(folder.id)
      const item = wrapper
        .findComponent({ name: 'ContextMenu' })
        .props('model')
        .find(item => item.label === 'Re-import card…')

      item.command()
      expect(wrapper.emitted('reimport')).toEqual([[folder.id]])
    })

    it('has nothing to import again without the sidecar', () => {
      const folder = useDocumentsStore().createDocument({
        storyId: 'story_1',
        parentId: 'notes_story_1',
        type: 'folder',
        title: 'Elara',
        kind: 'card',
      })
      const labels = mountNode(folder.id)
        .findComponent({ name: 'ContextMenu' })
        .props('model')
        .map(item => item.label)
      expect(labels).not.toContain('Re-import card…')
    })
  })

  describe('importing', () => {
    /** The Import submenu's items, or undefined when the menu has none. */
    const importsOf = wrapper =>
      wrapper
        .findComponent({ name: 'ContextMenu' })
        .props('model')
        .find(item => item.label === 'Import')?.items

    it('offers every way in under one Import submenu, on a folder only', () => {
      const act = api.createFolder('manuscript_story_1', 'First Act')
      const wrapper = mountNode(act.id)
      const imports = importsOf(wrapper)
      expect(imports.map(item => item.label)).toEqual(['Files…', 'Folder…', 'Repository…'])

      for (const item of imports) item.command()
      expect(wrapper.emitted('import')).toEqual([[act.id]])
      expect(wrapper.emitted('import-folder')).toEqual([[act.id]])
      expect(wrapper.emitted('import-repository')).toEqual([[act.id]])

      const doc = api.createTextDocument('notes_story_1', 'Loose')
      expect(importsOf(mountNode(doc.id))).toBeUndefined()
    })

    it('offers Google Drive in it only when the build names a Google client', () => {
      const act = api.createFolder('manuscript_story_1', 'First Act')
      expect(importsOf(mountNode(act.id)).map(item => item.label)).not.toContain('Google Drive…')

      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-1')
      try {
        const wrapper = mountNode(act.id)
        const imports = importsOf(wrapper)
        expect(imports.map(item => item.label)).toEqual([
          'Files…',
          'Folder…',
          'Google Drive…',
          'Repository…',
        ])
        imports.find(item => item.label === 'Google Drive…').command()
        expect(wrapper.emitted('import-drive')).toEqual([[act.id]])
      } finally {
        vi.unstubAllEnvs()
      }
    })
  })

  describe('a document being converted', () => {
    it('spins its icon while a job works on it', async () => {
      const { useJobsStore } = await import('../../src/stores/jobsStore.js')
      const made = api.createTextDocument('notes_story_1', 'Rules')
      const store = useJobsStore()
      const job = await store.createJob({
        storyId: 'story_1',
        kind: 'convert',
        workflow: 'convert',
        documentId: made.id,
        title: 'Convert Rules',
        steps: [{ id: 'a', label: 'a', status: 'running' }],
      })
      await store.updateJob(job.id, { status: 'running' })

      const wrapper = mountNode(made.id)
      await wrapper.vm.$nextTick()

      expect(wrapper.find('[data-node-icon]').classes()).toContain('pi-spinner')

      await store.updateJob(job.id, { status: 'done' })
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-node-icon]').classes()).not.toContain('pi-spinner')
    })
  })
})

describe('DocumentNode, in a repository', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store
  let repository
  let folder
  let source

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    vi.clearAllMocks()
    store = useDocumentsStore()
    await useDocuments('story_1').init()
    repository = store.createDocument({
      storyId: 'story_1',
      parentId: 'root_story_1',
      type: 'folder',
      kind: 'repository',
      title: 'widgets',
      source: { from: 'github', name: 'acme/widgets', imported: 1 },
    })
    folder = store.createDocument({
      storyId: 'story_1',
      parentId: repository.id,
      type: 'folder',
      title: 'src',
    })
    source = store.createDocument({
      storyId: 'story_1',
      parentId: folder.id,
      type: 'file',
      title: 'index.ts',
      mime: 'text/x-typescript',
      content: 'export {}\n',
    })
  })

  const labelsOf = wrapper =>
    wrapper
      .findComponent({ name: 'ContextMenu' })
      .props('model')
      .map(item => item.label)
      .filter(Boolean)

  it('offers a refresh on the repository, and nothing that makes or imports inside it', () => {
    const labels = labelsOf(mountNode(repository.id))
    expect(labels).toContain('Refresh repository…')
    expect(labels).toContain('Rename')
    expect(labels).toContain('Delete')
    for (const label of ['New document', 'New folder', 'Import']) {
      expect(labels).not.toContain(label)
    }
  })

  it('offers no rename inside it, which a refresh would undo', () => {
    expect(labelsOf(mountNode(folder.id))).not.toContain('Rename')
    expect(labelsOf(mountNode(folder.id))).not.toContain('New document')
  })

  it('offers a source file for download and copying its path, and not as text, a conversion or a fresh reading', () => {
    const labels = labelsOf(mountNode(source.id))
    expect(labels).toContain('Download')
    expect(labels).toContain('Copy path')
    for (const label of ['Show as text', 'Convert to Markdown…', 'Re-extract text', 'Rename']) {
      expect(labels).not.toContain(label)
    }
  })

  it('offers a repository import on an ordinary folder', () => {
    const imports = mountNode('root_story_1', { canDelete: false })
      .findComponent({ name: 'ContextMenu' })
      .props('model')
      .find(item => item.label === 'Import').items
    expect(imports.map(item => item.label)).toContain('Repository…')
  })

  it('draws a repository by where it came from, and a source file as code', () => {
    expect(mountNode(repository.id).find('[data-node-icon]').classes()).toContain('pi-github')
    expect(mountNode(source.id).find('[data-node-icon]').classes()).toContain('pi-code')
  })

  it('lets nothing be dragged into a repository or out of one', () => {
    const api = useDocuments('story_1')
    expect(api.canDropInto(folder.id, 'manuscript_story_1')).toBe(false)
    expect(api.canDropInto('root_story_1', source.id)).toBe(false)
    expect(api.canDropInto('root_story_1', repository.id)).toBe(true)
  })
})
