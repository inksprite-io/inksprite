import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { parseMarkdown, serializeMarkdown } from '@/editor/markdown.js'
import { spellingPlugin } from '@/editor/spelling.js'

const touch = vi.hoisted(() => ({ on: false }))
vi.mock('@/utils/touch.js', () => ({ hasTouchKeyboard: () => touch.on }))

const toastError = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ error: toastError }) }))

import EditorMenu from '@/components/writer/editor/EditorMenu.vue'

/** @typedef {import('@/spelling/engine.js').LintInfo} LintInfo */

/** @type {LintInfo[]} */
const LINTS = [
  {
    from: 4,
    to: 9,
    kind: 'Spelling',
    text: 'walkd',
    message: 'Did you mean to spell “walkd” this way?',
    suggestions: ['walk', 'walked'],
  },
  {
    from: 15,
    to: 17,
    kind: 'Agreement',
    text: 'go',
    message: 'The verb must agree with its subject.',
    suggestions: ['goes'],
    hash: '42',
  },
]

const TEXT = 'She walkd. He go home.'

/**
 * A view of the text, with a checker that finds these lints in any paragraph.
 *
 * @param {string} [text]
 * @param {LintInfo[]} [lints]
 */
const viewOf = (text = TEXT, lints = LINTS) => {
  const checker = {
    status: ref('ready'),
    active: () => true,
    cached: () => lints,
    lint: async () => {},
    shows: () => true,
    subscribe: () => () => {},
  }
  const state = EditorState.create({
    doc: parseMarkdown(text),
    plugins: [spellingPlugin(/** @type {any} */ (checker))],
  })
  const view = new EditorView(document.createElement('div'), { state })
  views.push(view)
  return view
}

/** @type {EditorView[]} */
const views = []

/** The menu, with PrimeVue's ContextMenu stood in for: what it is given to show is its model. */
const mountMenu = () => {
  const show = vi.fn()
  const wrapper = mount(EditorMenu, {
    global: {
      stubs: {
        ContextMenu: {
          name: 'ContextMenu',
          props: ['model'],
          template: '<div />',
          methods: { show },
        },
      },
    },
  })
  return { wrapper, show }
}

/** A right-click, or with `button: 0`, the menu key. */
const click = (/** @type {Partial<MouseEvent>} */ event = {}) =>
  /** @type {MouseEvent} */ ({
    button: 2,
    clientX: 0,
    clientY: 0,
    shiftKey: false,
    ctrlKey: false,
    preventDefault: () => {},
    stopPropagation: () => {},
    ...event,
  })

/**
 * Open the menu as if the pointer were at a position in the text.
 *
 * @param {ReturnType<typeof mountMenu>['wrapper']} wrapper
 * @param {EditorView} view
 * @param {number} pos
 * @param {Partial<MouseEvent>} [event]
 */
const openAt = async (wrapper, view, pos, event) => {
  view.posAtCoords = () => ({ pos, inside: -1 })
  const opened = /** @type {any} */ (wrapper.vm).open(view, click(event))
  await nextTick()
  return opened
}

/** @param {ReturnType<typeof mountMenu>['wrapper']} wrapper */
const model = wrapper =>
  /** @type {any[]} */ (wrapper.findComponent({ name: 'ContextMenu' }).props('model'))

/** What the menu shows, a separator as a dash. */
const labels = (/** @type {any[]} */ items) =>
  items.map(item => (item.separator ? '—' : item.label))

/** The item with this label. */
const item = (
  /** @type {ReturnType<typeof mountMenu>['wrapper']} */ wrapper,
  /** @type {string} */ label
) => {
  const found = model(wrapper).find(one => one.label === label)
  if (!found) throw new Error(`No ${label}`)
  return found
}

/** Let the plugin's view check, which it does on a timer, and draw the lints. */
const draw = async (/** @type {EditorView} */ view) => {
  await vi.waitFor(() => {
    if (!view.dom.querySelector('.spelling-error, .grammar-error')) throw new Error('Not drawn yet')
  })
  return view
}

/** Select from one position to another. */
const select = (
  /** @type {EditorView} */ view,
  /** @type {number} */ from,
  /** @type {number} */ to
) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))

const CLIPBOARD = [
  'Cut',
  'Copy',
  'Copy as Markdown',
  'Paste',
  'Paste without formatting',
  'Paste from Markdown',
]

/** @type {{ read: import('vitest').Mock, writeText: import('vitest').Mock }} */
let clipboard

beforeEach(() => {
  touch.on = false
  toastError.mockClear()
  clipboard = { read: vi.fn(), writeText: vi.fn(async () => {}) }
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
  document.execCommand = vi.fn(() => true)
})

afterEach(() => views.splice(0).forEach(view => view.destroy()))

describe('EditorMenu', () => {
  it('offers the clipboard, a link and a comment anywhere in the text', async () => {
    const view = viewOf('Nothing flagged here.', [])
    const { wrapper, show } = mountMenu()
    expect(await openAt(wrapper, view, 3)).toBe(true)
    expect(show).toHaveBeenCalled()
    expect(labels(model(wrapper))).toEqual([
      ...CLIPBOARD,
      '—',
      'Insert link…',
      'Comment…',
      '—',
      'Insert',
    ])
  })

  it('offers nothing to cut, copy or comment on without a selection', async () => {
    const view = viewOf('Nothing flagged here.', [])
    const { wrapper } = mountMenu()
    await openAt(wrapper, view, 3)
    const disabled = model(wrapper)
      .filter(one => one.disabled)
      .map(one => one.label)
    // A link without a selection asks for its text as well.
    expect(disabled).toEqual(['Cut', 'Copy', 'Copy as Markdown', 'Comment\u2026'])
  })

  it('keeps a selection the click is in, and moves the caret to a click outside it', async () => {
    const view = viewOf('Nothing flagged here.', [])
    const { wrapper } = mountMenu()
    select(view, 1, 8)
    await openAt(wrapper, view, 4)
    expect([view.state.selection.from, view.state.selection.to]).toEqual([1, 8])
    await openAt(wrapper, view, 15)
    expect([view.state.selection.from, view.state.selection.to]).toEqual([15, 15])
  })

  it('leaves Shift with the right button, and a touch screen, to the browser', async () => {
    const view = viewOf('Nothing flagged here.', [])
    const { wrapper, show } = mountMenu()
    expect(await openAt(wrapper, view, 3, { shiftKey: true })).toBe(false)
    touch.on = true
    expect(await openAt(wrapper, view, 3)).toBe(false)
    expect(show).not.toHaveBeenCalled()
  })

  it('opens at the caret for the menu key', async () => {
    const view = viewOf('Nothing flagged here.', [])
    view.coordsAtPos = () => ({ left: 40, right: 40, top: 10, bottom: 30 })
    const { wrapper, show } = mountMenu()
    expect(await openAt(wrapper, view, 3, { button: 0 })).toBe(true)
    expect(show.mock.calls[0][0]).toMatchObject({ pageX: 40, pageY: 30 })
  })

  describe('the clipboard', () => {
    it('cuts and copies as the keys do', async () => {
      const view = viewOf('Nothing flagged here.', [])
      const { wrapper } = mountMenu()
      select(view, 1, 8)
      await openAt(wrapper, view, 4)
      await item(wrapper, 'Copy').command()
      await item(wrapper, 'Cut').command()
      expect(vi.mocked(document.execCommand).mock.calls).toEqual([['copy'], ['cut']])
    })

    it('copies the selection as markdown', async () => {
      const view = viewOf('The **long** road.', [])
      const { wrapper } = mountMenu()
      select(view, 1, 14)
      await openAt(wrapper, view, 4)
      await item(wrapper, 'Copy as Markdown').command()
      expect(clipboard.writeText).toHaveBeenCalledWith('The **long** road')
    })

    /** A clipboard read that finds this. */
    const holding = (/** @type {Record<string, string>} */ data) =>
      clipboard.read.mockResolvedValue([
        {
          types: Object.keys(data),
          getType: async (/** @type {string} */ type) => ({ text: async () => data[type] }),
        },
      ])

    it('pastes formatting, or text, or markdown as what it stands for', async () => {
      holding({ 'text/html': '<p><strong>Bold</strong></p>', 'text/plain': '**Plain**' })
      const pasted = async (/** @type {string} */ label) => {
        const view = viewOf('End.', [])
        const { wrapper } = mountMenu()
        await openAt(wrapper, view, 1)
        await item(wrapper, label).command()
        return serializeMarkdown(view.state.doc)
      }
      expect(await pasted('Paste')).toBe('**Bold**End.')
      expect(await pasted('Paste without formatting')).toBe('\\*\\*Plain\\*\\*End.')
      expect(await pasted('Paste from Markdown')).toBe('**Plain**End.')
    })

    it('says to use the keys when the clipboard can’t be read', async () => {
      const view = viewOf('End.', [])
      const { wrapper } = mountMenu()
      clipboard.read.mockRejectedValue(new Error('NotAllowedError'))
      await openAt(wrapper, view, 2)
      await item(wrapper, 'Paste').command()
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining('Paste with'))
      expect(serializeMarkdown(view.state.doc)).toBe('End.')
    })
  })

  describe('links and comments', () => {
    it('asks for the link and comment fields for a selection', async () => {
      const view = viewOf('Nothing flagged here.', [])
      const { wrapper } = mountMenu()
      select(view, 1, 8)
      await openAt(wrapper, view, 4)
      await item(wrapper, 'Insert link…').command()
      await item(wrapper, 'Comment…').command()
      expect(wrapper.emitted('link')).toHaveLength(1)
      expect(wrapper.emitted('comment')).toHaveLength(1)
    })

    it('edits or removes the link the caret is in', async () => {
      const view = viewOf('See [the cast](https://example.com) first.', [])
      const { wrapper } = mountMenu()
      await openAt(wrapper, view, 7)
      expect(labels(model(wrapper)).slice(-5, -2)).toEqual([
        'Edit link…',
        'Remove link',
        'Comment…',
      ])
      await item(wrapper, 'Remove link').command()
      expect(wrapper.emitted('remove-link')).toHaveLength(1)
    })

    it('edits or resolves the comment the caret is in', async () => {
      const view = viewOf('It was a {==dark==}{>>c7k2m1: reword<<} night.', [])
      const { wrapper } = mountMenu()
      await openAt(wrapper, view, 11)
      expect(labels(model(wrapper)).slice(-4, -2)).toEqual(['Edit comment…', 'Resolve comment'])
      await item(wrapper, 'Edit comment…').command()
      await item(wrapper, 'Resolve comment').command()
      expect(wrapper.emitted('edit-comment')).toEqual([['c7k2m1']])
      expect(wrapper.emitted('resolve-comment')).toEqual([['c7k2m1']])
    })
  })

  it('inserts a table, a rule or a code block', async () => {
    const view = viewOf('Nothing flagged here.', [])
    const { wrapper } = mountMenu()
    await openAt(wrapper, view, 3)
    const insert = item(wrapper, 'Insert')
    expect(labels(insert.items)).toEqual(['Table', 'Horizontal rule', 'Code block'])
    await insert.items[0].command()
    expect(view.state.doc.child(1).type.name).toBe('table')
    expect(view.state.selection.$head.parent.type.name).toBe('table_cell')
  })

  it("puts a table's items in a submenu, in a table", async () => {
    const view = viewOf('| Name | Role |\n| --- | --- |\n| Tavrek | Pilot |', [])
    const { wrapper } = mountMenu()
    await openAt(wrapper, view, 5)
    const table = item(wrapper, 'Table')
    expect(labels(table.items)).toEqual([
      'Insert row above',
      'Insert row below',
      'Insert column left',
      'Insert column right',
      '—',
      'Align column',
      '—',
      'Delete row',
      'Delete column',
      'Delete table',
    ])
  })

  describe('spelling', () => {
    it('puts a misspelling first: its suggestions and the dictionaries', async () => {
      const view = await draw(viewOf())
      const { wrapper } = mountMenu()
      await openAt(wrapper, view, 1 + 6)
      expect(labels(model(wrapper)).slice(0, 5)).toEqual([
        'walk',
        'walked',
        'Add to dictionary',
        'Add to project',
        '—',
      ])
    })

    it('puts a suggestion in place of the word', async () => {
      const view = await draw(viewOf())
      const { wrapper } = mountMenu()
      await openAt(wrapper, view, 1 + 6)
      await item(wrapper, 'walked').command()
      expect(serializeMarkdown(view.state.doc)).toBe('She walked. He go home.')
    })

    it('hands the word to the dictionary it is added to', async () => {
      const view = await draw(viewOf())
      const { wrapper } = mountMenu()
      await openAt(wrapper, view, 1 + 6)
      await item(wrapper, 'Add to project').command()
      expect(wrapper.emitted('add-to-project')).toEqual([['walkd']])
    })

    it('adds the whole of a hyphenated word, and says which', async () => {
      const view = await draw(
        viewOf('The Wi-Fi was down.', [
          {
            from: 4,
            to: 6,
            kind: 'Spelling',
            text: 'Wi',
            word: 'Wi-Fi',
            message: '',
            suggestions: [],
          },
        ])
      )
      const { wrapper } = mountMenu()
      await openAt(wrapper, view, 1 + 5)
      expect(labels(model(wrapper)).slice(0, 2)).toEqual([
        'Add “Wi-Fi” to dictionary',
        'Add “Wi-Fi” to project',
      ])
      await item(wrapper, 'Add “Wi-Fi” to dictionary').command()
      expect(wrapper.emitted('add-word')).toEqual([['Wi-Fi']])
    })

    it('says what is wrong with grammar, and offers to ignore it', async () => {
      const view = await draw(viewOf())
      const { wrapper } = mountMenu()
      await openAt(wrapper, view, 1 + 16)
      const items = model(wrapper)
      expect(items[0]).toMatchObject({
        label: 'The verb must agree with its subject.',
        disabled: true,
      })
      expect(labels(items).slice(1, 4)).toEqual(['goes', 'Ignore', '—'])
      await item(wrapper, 'Ignore').command()
      expect(wrapper.emitted('ignore')).toEqual([['42']])
    })
  })
})
