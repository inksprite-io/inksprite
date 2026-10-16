import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { computed, ref } from 'vue'
import PrimeVue from 'primevue/config'
import CardLibraryDialog from '@/components/writer/cards/CardLibraryDialog.vue'
import { useCardLibraryPanel } from '@/composables/useCardLibraryPanel.js'
import { useChatRequest } from '@/composables/useChatRequest.js'

const add = vi.fn()
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add }) }))

const fromLibrary = vi.fn()
const write = vi.fn()
vi.mock('@/composables/useCardImport', async importOriginal => ({
  ...(await importOriginal()),
  useCardImport: storyId => ({ fromLibrary, write: (...args) => write(storyId, ...args) }),
}))

const read = vi.fn()
const start = vi.fn()
vi.mock('@/composables/useCardChat', () => ({
  useCardChat: storyId => ({
    read,
    start: (...args) => start(storyId, ...args),
    lastUserName: () => 'Sam',
  }),
}))

/** The projects there are, by id, with their names. */
const stories = ref(new Map())
const create = vi.fn()
const open = vi.fn()
vi.mock('@/composables/useProjects', () => ({
  useProjects: () => ({
    projects: computed(() => [...stories.value.keys()].map(id => ({ id }))),
    init: async () => {},
    nameOf: id => stories.value.get(id) || 'Untitled',
    create: (...args) => create(...args),
    open: (...args) => open(...args),
  }),
}))

const markUsed = vi.fn()
const cards = new Map()
vi.mock('@/stores/cardLibraryStore.js', () => ({
  useCardLibraryStore: () => ({ markUsed, getCard: id => cards.get(id) || null }),
}))

/** The library, which these tests drive through what it is given. */
const CardLibrary = {
  name: 'CardLibrary',
  props: ['actionsFor', 'placesOf', 'busy'],
  emits: ['open-project'],
  template: '<div data-library />',
}

/** What the importer finds in a card, as far as the dialog cares. */
const found = (fields = {}) => ({ shape: 'card', title: 'Maren', systemPrompt: false, ...fields })

const mountDialog = (props = {}) =>
  mount(CardLibraryDialog, {
    props,
    global: {
      plugins: [PrimeVue],
      stubs: {
        Dialog: { template: '<div><slot /></div>' },
        CardLibrary,
        CardImportDialog: {
          name: 'CardImportDialog',
          props: ['visible', 'found'],
          emits: ['confirm', 'update:visible'],
          template: '<div v-if="visible" data-asking />',
        },
        CardChatDialog: {
          name: 'CardChatDialog',
          props: ['visible', 'card', 'lastUserName'],
          emits: ['confirm', 'update:visible'],
          template: '<div v-if="visible" data-chatting />',
        },
      },
    },
  })

/** A library card, with the projects it went into. */
const card = (projects = []) => {
  const row = { id: 'libcard_1', title: 'The Ferrywoman', name: 'Maren', tags: [], projects }
  cards.set(row.id, row)
  return row
}

const library = wrapper => wrapper.findComponent({ name: 'CardLibrary' })
const labels = (wrapper, row) =>
  library(wrapper)
    .props('actionsFor')(row)
    .map(a => a.label)
const run = (wrapper, row, label) =>
  library(wrapper)
    .props('actionsFor')(row)
    .find(a => a.label === label)
    .command()

describe('CardLibraryDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    cards.clear()
    stories.value = new Map([
      ['story_open', 'Thief'],
      ['story_wren', 'The Ferrywoman'],
      ['story_other', 'Harbour'],
    ])
    fromLibrary.mockResolvedValue(found())
    write.mockResolvedValue({ title: 'Maren', documents: 6, folderId: 'folder_1' })
    create.mockResolvedValue({ id: 'story_new' })
    read.mockResolvedValue({ title: 'Maren', greetings: [] })
    start.mockResolvedValue({ id: 'chat_new' })
    useChatRequest().take('story_new')
  })

  afterEach(() => useCardLibraryPanel().close())

  describe('what a card offers', () => {
    it('starts a new project, with no project open', () => {
      useCardLibraryPanel().open()
      expect(labels(mountDialog(), card())).toEqual(['New project'])
    })

    it('adds to the project open, by its name', () => {
      useCardLibraryPanel().open()
      expect(labels(mountDialog({ storyId: 'story_open' }), card())).toEqual([
        'New project',
        'Add to Thief',
      ])
    })

    it('opens the project made for it first, then the others it is in', () => {
      useCardLibraryPanel().open()
      const row = card([
        { storyId: 'story_other', folderId: 'f2', at: 1 },
        { storyId: 'story_wren', folderId: 'f1', made: true, at: 2 },
        { storyId: 'story_gone', folderId: 'f3', made: true, at: 3 },
      ])
      expect(labels(mountDialog({ storyId: 'story_open' }), row)).toEqual([
        'Open The Ferrywoman',
        'New project',
        'Add to Thief',
        'Open Harbour',
      ])
    })

    it('offers neither adding to nor opening the project open, when it is in it', () => {
      useCardLibraryPanel().open()
      const row = card([{ storyId: 'story_open', folderId: 'f1', at: 1 }])
      expect(labels(mountDialog({ storyId: 'story_open' }), row)).toEqual(['New project'])
      expect(
        library(mountDialog({ storyId: 'story_open' }))
          .props('placesOf')(row)
          .map(place => place.name)
      ).toEqual(['Thief'])
    })

    it('imports into the folder it was picked for, and nothing else', () => {
      useCardLibraryPanel().open({ into: 'folder_9' })
      expect(labels(mountDialog({ storyId: 'story_open' }), card())).toEqual(['Import'])
    })
  })

  it('adds a card to the project open, notes where it went, and closes', async () => {
    useCardLibraryPanel().open()
    const wrapper = mountDialog({ storyId: 'story_open' })
    run(wrapper, card(), 'Add to Thief')
    await flushPromises()

    expect(write).toHaveBeenCalledWith('story_open', found(), {
      parentId: undefined,
      useSystemPrompt: false,
    })
    expect(markUsed).toHaveBeenCalledWith('libcard_1', {
      storyId: 'story_open',
      folderId: 'folder_1',
    })
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', detail: 'Imported Maren (6 documents).' })
    )
    expect(useCardLibraryPanel().visible.value).toBe(false)
  })

  it('imports a card picked for a folder into that folder', async () => {
    useCardLibraryPanel().open({ into: 'folder_9' })
    const wrapper = mountDialog({ storyId: 'story_open' })
    run(wrapper, card(), 'Import')
    await flushPromises()

    expect(write).toHaveBeenCalledWith('story_open', found(), {
      parentId: 'folder_9',
      useSystemPrompt: false,
    })
  })

  it("asks first about a card's system prompt, and writes with the answer", async () => {
    fromLibrary.mockResolvedValue(found({ systemPrompt: true }))
    useCardLibraryPanel().open()
    const wrapper = mountDialog({ storyId: 'story_open' })
    run(wrapper, card(), 'Add to Thief')
    await flushPromises()
    expect(write).not.toHaveBeenCalled()
    expect(wrapper.find('[data-asking]').exists()).toBe(true)

    wrapper.findComponent({ name: 'CardImportDialog' }).vm.$emit('confirm', {
      useSystemPrompt: true,
    })
    await flushPromises()
    expect(write).toHaveBeenCalledWith('story_open', found({ systemPrompt: true }), {
      parentId: undefined,
      useSystemPrompt: true,
    })
  })

  describe('a new project', () => {
    it('is named for the card, holds it, and opens on the chat its questions start', async () => {
      useCardLibraryPanel().open()
      const wrapper = mountDialog({ storyId: 'story_open' })
      run(wrapper, card(), 'New project')
      await flushPromises()

      expect(create).toHaveBeenCalledWith('The Ferrywoman', { open: false })
      expect(write).toHaveBeenCalledWith('story_new', found(), { useSystemPrompt: false })
      expect(markUsed).toHaveBeenCalledWith('libcard_1', {
        storyId: 'story_new',
        folderId: 'folder_1',
        made: true,
      })
      expect(useCardLibraryPanel().visible.value).toBe(false)
      expect(read).toHaveBeenCalledWith('folder_1')
      const chat = wrapper.findComponent({ name: 'CardChatDialog' })
      expect(chat.props('visible')).toBe(true)
      expect(chat.props('lastUserName')).toBe('Sam')
      expect(open).not.toHaveBeenCalled()

      chat.vm.$emit('confirm', { userName: 'Riley', greeting: 1 })
      await flushPromises()
      expect(start).toHaveBeenCalledWith(
        'story_new',
        { title: 'Maren', greetings: [] },
        { userName: 'Riley', greeting: 1 }
      )
      expect(useChatRequest().requested.value).toEqual({
        storyId: 'story_new',
        chatId: 'chat_new',
      })
      expect(open).toHaveBeenCalledWith('story_new')
    })

    it('opens with the card in it when the chat is put off', async () => {
      useCardLibraryPanel().open()
      const wrapper = mountDialog()
      run(wrapper, card(), 'New project')
      await flushPromises()

      wrapper.findComponent({ name: 'CardChatDialog' }).vm.$emit('update:visible', false)
      await flushPromises()
      expect(start).not.toHaveBeenCalled()
      expect(useChatRequest().requested.value).toBeNull()
      expect(open).toHaveBeenCalledWith('story_new')
    })
  })

  it('opens a project the card is in, and closes', () => {
    useCardLibraryPanel().open()
    const wrapper = mountDialog({ storyId: 'story_open' })
    run(
      wrapper,
      card([{ storyId: 'story_wren', folderId: 'f1', made: true, at: 1 }]),
      'Open The Ferrywoman'
    )

    expect(open).toHaveBeenCalledWith('story_wren')
    expect(useCardLibraryPanel().visible.value).toBe(false)
  })

  it('says why nothing was imported, and stays open', async () => {
    fromLibrary.mockImplementation(async () => {
      throw new Error('gone')
    })
    useCardLibraryPanel().open()
    const wrapper = mountDialog({ storyId: 'story_open' })
    run(wrapper, card(), 'Add to Thief')
    await flushPromises()

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ detail: 'Nothing imported: gone' }))
    expect(useCardLibraryPanel().visible.value).toBe(true)
    expect(markUsed).not.toHaveBeenCalled()
  })
})
