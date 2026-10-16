/* global Blob, KeyboardEvent */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import CardLibrary from '@/components/writer/cards/CardLibrary.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { useCardLibraryStore } from '@/stores/cardLibraryStore.js'

/** The two tables, as storage holds them. */
const tables = { cards: new Map(), cardFiles: new Map() }

vi.mock('@/storage/index.js', () => ({
  storage: {
    all: vi.fn(async table => [...tables[table].values()]),
    count: vi.fn(async table => tables[table].size),
    get: vi.fn(async (table, id) => tables[table].get(id)),
    put: vi.fn(async (table, row) => {
      tables[table].set(row.id, row)
    }),
    remove: vi.fn(async (table, ids) => {
      for (const id of ids) tables[table].delete(id)
    }),
  },
}))

vi.mock('@/stores/syncStore.js', () => ({
  useSyncStore: () => ({
    trackChange: (table, id, row) => tables[table].set(id, row),
    trackDelete: (table, id) => tables[table].delete(id),
  }),
}))

vi.mock('@/cards/thumbnail.js', () => ({ makeThumbnail: async () => null }))

const downloadBlob = vi.fn()
vi.mock('@/files/download.js', () => ({ downloadBlob: (...args) => downloadBlob(...args) }))

/** Each question asked, answered by the test. */
const require = vi.fn()
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require }) }))

/**
 * A card in the library, with the card it was made from beside it.
 *
 * @param {string} title
 * @param {Object} [fields]
 */
const keep = (title, fields = {}) => {
  const id = `libcard_${title}`
  tables.cards.set(id, {
    id,
    name: title,
    title,
    creator: 'someone',
    tags: [],
    notes: `${title} notes`,
    greetings: 1,
    lore: 0,
    systemPrompt: false,
    hash: id,
    added: 0,
    ...fields,
  })
  tables.cardFiles.set(id, {
    id,
    card: {
      spec: 'chara_card_v2',
      data: {
        name: title,
        description: `${title} keeps the tollhouse ledger.`,
        first_mes: 'You made it.',
        creator_notes: '<p>Made for testing.</p>',
        character_book: { entries: [{ keys: ['ledger'], comment: 'The ledger', content: 'x' }] },
      },
    },
    image: null,
    thumbnail: null,
  })
  return id
}

const mountLibrary = async (props = {}) => {
  const wrapper = mount(CardLibrary, {
    props,
    global: {
      plugins: [PrimeVue, ToastService],
      directives: { tooltip: {} },
    },
  })
  await flushPromises()
  return wrapper
}

/** What a card offers, as the window would give it: the action asked for is noted. */
const used = []
const offer = (...names) => ({
  actionsFor: card =>
    names.map(label => ({
      id: label,
      label,
      icon: 'pi pi-plus',
      command: () => used.push([label, card.id]),
    })),
})

const titles = wrapper => wrapper.findAll('[data-card]').map(tile => tile.attributes('aria-label'))

describe('CardLibrary', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    tables.cards.clear()
    tables.cardFiles.clear()
    useApplicationState().resetState()
  })

  it('keeps the order chosen for the next time it opens', async () => {
    keep('Bram', { added: 2 })
    keep('Alder', { added: 1 })
    const first = await mountLibrary()
    expect(titles(first)).toEqual(['Bram', 'Alder'])

    first.findComponent('[data-card-order]').vm.$emit('update:modelValue', 'name')
    await flushPromises()
    expect(titles(first)).toEqual(['Alder', 'Bram'])
    first.unmount()

    expect(titles(await mountLibrary())).toEqual(['Alder', 'Bram'])
  })

  describe('tag suggestions', () => {
    const search = wrapper => wrapper.find('input[data-card-search]')
    const offered = wrapper =>
      wrapper.findAll('[data-suggestion]').map(option => option.attributes('data-suggestion'))

    beforeEach(() => {
      keep('Maren', { tags: ['female', 'Fantasy'] })
      keep('Iska', { tags: ['female', 'older_female'] })
      keep('Bram', { tags: ['male'] })
    })

    it('offers the tags a word starts, as tag:, with how many cards have them', async () => {
      const wrapper = await mountLibrary()
      await search(wrapper).setValue('fema')

      expect(offered(wrapper)).toEqual(['female', 'older_female'])
      const first = wrapper.find('[data-suggestion="female"]')
      expect(first.text()).toMatch(/tag:female\s*2/)
      expect(wrapper.find('[data-suggestion="older_female"]').text()).toContain('tag:older female')
    })

    it('chooses one with Enter, taking the word out of the search', async () => {
      const wrapper = await mountLibrary()
      await search(wrapper).setValue('bram fema')
      await search(wrapper).trigger('keydown', { key: 'ArrowDown' })
      await search(wrapper).trigger('keydown', { key: 'Enter' })

      expect(search(wrapper).element.value).toBe('bram')
      expect(
        wrapper.find('[data-card-tags] [data-tag="older_female"]').attributes('aria-pressed')
      ).toBe('true')
      expect(titles(wrapper)).toEqual([])
    })

    it('chooses one with a click', async () => {
      const wrapper = await mountLibrary()
      await search(wrapper).setValue('tag:fe')
      await wrapper.find('[data-suggestion="female"]').trigger('mousedown')

      expect(search(wrapper).element.value).toBe('')
      expect(titles(wrapper).sort()).toEqual(['Iska', 'Maren'])
      expect(offered(wrapper)).toEqual([])
    })

    it('puts them away on Escape, without letting the window have it', async () => {
      const wrapper = await mountLibrary()
      await search(wrapper).setValue('fema')
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      const outside = vi.fn()
      document.addEventListener('keydown', outside)
      search(wrapper).element.dispatchEvent(escape)
      await flushPromises()
      document.removeEventListener('keydown', outside)

      expect(offered(wrapper)).toEqual([])
      expect(outside).not.toHaveBeenCalled()
    })

    it('waits for two letters, unless tag: is typed', async () => {
      const wrapper = await mountLibrary()
      await search(wrapper).setValue('f')
      expect(offered(wrapper)).toEqual([])

      await search(wrapper).setValue('tag:')
      expect(offered(wrapper)).toEqual(['female', 'Fantasy', 'male', 'older_female'])
    })

    it('filters by a tag: typed out in full, as if chosen', async () => {
      const wrapper = await mountLibrary()
      await search(wrapper).setValue('tag:older_female ')
      expect(titles(wrapper)).toEqual(['Iska'])
    })
  })

  it('says so when the library is empty', async () => {
    const wrapper = await mountLibrary()
    expect(wrapper.find('[data-card-empty]').text()).toContain('No character cards yet.')
  })

  it('shows every card, the newest first', async () => {
    keep('Bram', { added: 1 })
    keep('Maren', { added: 2 })
    const wrapper = await mountLibrary()
    expect(titles(wrapper)).toEqual(['Maren', 'Bram'])
  })

  it('narrows the grid to the cards the search finds', async () => {
    keep('Bram', { tags: ['Horror'] })
    keep('Maren', { tags: ['Fantasy'] })
    const wrapper = await mountLibrary()

    await wrapper.find('input[data-card-search]').setValue('fant')
    expect(titles(wrapper)).toEqual(['Maren'])

    await wrapper.find('input[data-card-search]').setValue('nobody')
    expect(wrapper.find('[data-card-empty]').text()).toBe('No cards match.')
  })

  it("filters by the library's tags, and lets one go again", async () => {
    keep('Bram', { tags: ['Horror'], added: 1 })
    keep('Maren', { tags: ['Fantasy', 'Horror'], added: 2 })
    keep('Cass', { tags: ['Fantasy'], added: 3 })
    const wrapper = await mountLibrary()

    const chip = tag => wrapper.find(`[data-card-tags] [data-tag="${tag}"]`)
    await chip('Fantasy').trigger('click')
    expect(titles(wrapper)).toEqual(['Cass', 'Maren'])
    await chip('Horror').trigger('click')
    expect(titles(wrapper)).toEqual(['Maren'])

    await chip('Fantasy').trigger('click')
    expect(titles(wrapper)).toEqual(['Maren', 'Bram'])
  })

  it('shows a card in full when clicked, and goes back to the grid', async () => {
    used.length = 0
    const id = keep('Maren', { tags: ['Fantasy'] })
    const wrapper = await mountLibrary(offer('Add to Thief'))

    await wrapper.find(`[data-card="${id}"]`).trigger('click')
    await flushPromises()

    const detail = wrapper.find(`[data-card-detail="${id}"]`)
    expect(detail.text()).toContain('Made for testing.')
    expect(detail.text()).toContain('Maren keeps the tollhouse ledger.')
    expect(detail.text()).toContain('You made it.')
    expect(detail.text()).toContain('The ledger')
    expect(detail.find('[data-action="use-card"]').text()).toBe('Add to Thief')

    await detail.find('[data-action="use-card"]').trigger('click')
    expect(used).toEqual([['Add to Thief', id]])

    await detail.find('[data-action="back"]').trigger('click')
    expect(titles(wrapper)).toEqual(['Maren'])
  })

  it('offers the first thing to do with a card, and the rest beside it', async () => {
    used.length = 0
    const id = keep('Maren')
    const wrapper = await mountLibrary(offer('New project', 'Add to Thief'))
    await wrapper.find(`[data-card="${id}"]`).trigger('click')
    await flushPromises()

    const split = wrapper.findComponent({ name: 'SplitButton' })
    expect(split.props('label')).toBe('New project')
    expect(split.props('model').map(item => item.label)).toEqual(['Add to Thief'])
    split.vm.$emit('click')
    split.props('model')[0].command()
    expect(used).toEqual([
      ['New project', id],
      ['Add to Thief', id],
    ])
  })

  it('lists the projects a card is in, each opening its project', async () => {
    const id = keep('Maren')
    const wrapper = await mountLibrary({
      placesOf: () => [
        { storyId: 'story_wren', name: 'The Ferrywoman' },
        { storyId: 'story_open', name: 'Thief' },
      ],
    })
    await wrapper.find(`[data-card="${id}"]`).trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-card-places]').text()).toMatch(/^In/)
    expect(wrapper.findAll('[data-place]').map(place => place.text())).toEqual([
      'The Ferrywoman',
      'Thief',
    ])
    await wrapper.find('[data-place="story_open"]').trigger('click')
    expect(wrapper.emitted('open-project')).toEqual([['story_open']])
  })

  it('offers nothing to do with a card when there is nothing to offer', async () => {
    const id = keep('Maren')
    const wrapper = await mountLibrary()
    await wrapper.find(`[data-card="${id}"]`).trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-action="use-card"]').exists()).toBe(false)
  })

  it("goes back to the grid with a card's tag chosen when the tag is clicked", async () => {
    const id = keep('Maren', { tags: ['Fantasy'] })
    keep('Bram', { tags: ['Horror'] })
    const wrapper = await mountLibrary()

    await wrapper.find(`[data-card="${id}"]`).trigger('click')
    await flushPromises()
    await wrapper.find('[data-card-detail] [data-tag="Fantasy"]').trigger('click')

    expect(titles(wrapper)).toEqual(['Maren'])
    expect(wrapper.find('[data-card-tags] [data-tag="Fantasy"]').attributes('aria-pressed')).toBe(
      'true'
    )
  })

  describe('NSFW pictures', () => {
    const PNG = new Blob(['png'], { type: 'image/png' })

    /** A card with a picture, tagged as given. */
    const pictured = (title, tags) => {
      const id = keep(title, { tags })
      tables.cardFiles.set(id, { ...tables.cardFiles.get(id), image: PNG })
      return id
    }

    const blurredIn = wrapper =>
      wrapper.findAll('[data-card]').filter(tile => tile.find('img[data-blurred]').exists())

    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => 'blob:picture')
      URL.revokeObjectURL = vi.fn()
    })

    it('blurs the pictures of cards tagged NSFW or NSFL in the grid', async () => {
      pictured('Maren', ['NSFW'])
      pictured('Iska', ['nsfl'])
      pictured('Bram', ['sfw'])
      const wrapper = await mountLibrary()
      await flushPromises()

      expect(
        blurredIn(wrapper)
          .map(tile => tile.attributes('aria-label'))
          .sort()
      ).toEqual(['Iska', 'Maren'])
    })

    it('blurs none with the setting off', async () => {
      useApplicationState().setBlurNsfw(false)
      pictured('Maren', ['NSFW'])
      const wrapper = await mountLibrary()
      await flushPromises()
      expect(blurredIn(wrapper)).toEqual([])
    })

    it('switches the blurring from its button, and keeps it switched', async () => {
      pictured('Maren', ['NSFW'])
      const wrapper = await mountLibrary()
      await flushPromises()
      const button = () => wrapper.find('[data-action="blur-nsfw"]')
      expect(button().attributes('aria-pressed')).toBe('true')
      expect(button().find('i').classes()).toContain('pi-eye-slash')

      await button().trigger('click')
      expect(blurredIn(wrapper)).toEqual([])
      expect(button().attributes('aria-pressed')).toBe('false')
      expect(button().find('i').classes()).toContain('pi-eye')
      expect(useApplicationState().blurNsfw.value).toBe(false)

      await button().trigger('click')
      expect(blurredIn(wrapper).map(tile => tile.attributes('aria-label'))).toEqual(['Maren'])
    })

    it("shows a card's picture in its detail once clicked, until another card opens", async () => {
      const maren = pictured('Maren', ['NSFW'])
      const iska = pictured('Iska', ['nsfw'])
      const wrapper = await mountLibrary()
      await wrapper.find(`[data-card="${maren}"]`).trigger('click')
      await flushPromises()

      const detail = () => wrapper.find('[data-card-detail]')
      expect(detail().find('img[data-blurred]').exists()).toBe(true)
      await detail().find('[data-action="show-picture"]').trigger('click')
      expect(detail().find('img[data-blurred]').exists()).toBe(false)
      expect(detail().find('img').exists()).toBe(true)

      await detail().find('[data-action="back"]').trigger('click')
      await wrapper.find(`[data-card="${iska}"]`).trigger('click')
      await flushPromises()
      expect(detail().find('img[data-blurred]').exists()).toBe(true)
    })
  })

  describe("a card's menu", () => {
    /** The menu's items, after a right-click on the card. */
    const openMenu = async (wrapper, id) => {
      await wrapper.find(`[data-card="${id}"]`).trigger('contextmenu')
      return wrapper.findComponent({ name: 'ContextMenu' }).props('model')
    }
    const labels = items => items.filter(item => !item.separator).map(item => item.label)

    beforeEach(() => {
      downloadBlob.mockClear()
      require.mockClear()
    })

    it('offers what can be done with the card, downloads it, or deletes it', async () => {
      used.length = 0
      const id = keep('Maren')
      const wrapper = await mountLibrary(offer('New project', 'Add to Thief'))
      const items = await openMenu(wrapper, id)
      expect(labels(items)).toEqual(['New project', 'Add to Thief', 'Download', 'Delete'])

      items.find(item => item.label === 'Add to Thief').command()
      expect(used).toEqual([['Add to Thief', id]])

      items.find(item => item.label === 'Delete').command()
      expect(require).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Delete Maren from the library? Projects it went into keep their copy.',
        })
      )
      await require.mock.calls[0][0].accept()
      await flushPromises()
      expect(titles(wrapper)).toEqual([])
    })

    it('has only a file and deleting when nothing else is offered', async () => {
      const id = keep('Maren')
      const wrapper = await mountLibrary()
      expect(labels(await openMenu(wrapper, id))).toEqual(['Download', 'Delete'])
    })

    it('opens on a long press, without opening the card', async () => {
      vi.useFakeTimers()
      try {
        const id = keep('Maren')
        const wrapper = await mountLibrary(offer('New project'))
        const tile = wrapper.find(`[data-card="${id}"]`)
        await tile.trigger('touchstart', { touches: [{ clientX: 40, clientY: 60 }] })
        vi.advanceTimersByTime(600)
        await tile.trigger('touchend', { touches: [] })

        const menu = wrapper.findComponent({ name: 'ContextMenu' })
        expect(labels(menu.props('model'))).toContain('Download')
        expect(wrapper.find('[data-card-detail]').exists()).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('opens from the menu key', async () => {
      const id = keep('Maren')
      const wrapper = await mountLibrary()
      await wrapper.find(`[data-card="${id}"]`).trigger('keydown', { key: 'ContextMenu' })
      expect(labels(wrapper.findComponent({ name: 'ContextMenu' }).props('model'))).toEqual([
        'Download',
        'Delete',
      ])
    })

    it('downloads the PNG the card came in', async () => {
      const id = keep('Maren')
      const image = new Blob(['png'], { type: 'image/png' })
      tables.cardFiles.set(id, { ...tables.cardFiles.get(id), image })
      const wrapper = await mountLibrary()
      const items = await openMenu(wrapper, id)

      await items.find(item => item.label === 'Download').command()
      await flushPromises()
      expect(downloadBlob).toHaveBeenCalledWith(image, 'Maren.png')
    })
  })

  it('downloads a card from its detail, as JSON when it came without a picture', async () => {
    const id = keep('Maren')
    const wrapper = await mountLibrary()
    await wrapper.find(`[data-card="${id}"]`).trigger('click')
    await flushPromises()

    await wrapper.find('[data-action="download-card"]').trigger('click')
    await flushPromises()
    const [blob, filename] = downloadBlob.mock.calls.at(-1)
    expect(filename).toBe('Maren.json')
    expect(JSON.parse(await blob.text()).data.name).toBe('Maren')
  })

  it('opens the link dialog from its button', async () => {
    const wrapper = await mountLibrary()
    expect(wrapper.findComponent({ name: 'CardLinkDialog' }).props('visible')).toBe(false)
    await wrapper.find('[data-action="add-link"]').trigger('click')
    expect(wrapper.findComponent({ name: 'CardLinkDialog' }).props('visible')).toBe(true)
  })

  it('adds the card a link dropped on it leads to', async () => {
    const wrapper = await mountLibrary()
    const addLink = vi.spyOn(useCardLibraryStore(), 'addLink').mockResolvedValue({
      added: [],
      duplicates: [],
      skipped: [],
    })
    const dataTransfer = {
      types: ['text/uri-list', 'text/plain'],
      files: [],
      getData: type =>
        type === 'text/uri-list' ? '# a comment\nhttps://botbooru.com/character/7\n' : '',
    }
    await wrapper.find('[data-card-library]').trigger('drop', { dataTransfer })
    await flushPromises()
    expect(addLink).toHaveBeenCalledWith('https://botbooru.com/character/7')
  })
})
