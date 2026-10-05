import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { computed } from 'vue'
import PrimeVue from 'primevue/config'
import SaveToolResultDialog from '@/components/writer/chats/SaveToolResultDialog.vue'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

const root = rootIdFor('story_1')

/** A project with a folder in a folder, as the stubbed documents hold it. */
const tree = {
  [root]: [
    { id: 'f_refs', type: 'folder', title: 'References' },
    { id: 'd_plan', type: 'text', title: 'Plan' },
  ],
  f_refs: [{ id: 'f_jira', type: 'folder', title: 'Jira' }],
  f_jira: [],
}

const documents = vi.hoisted(() => ({
  createTextDocument: vi.fn((parentId, title, content) => ({
    id: 'd_new',
    parentId,
    title,
    content,
  })),
  uniqueTitle: vi.fn((parentId, title) => title),
}))

vi.mock('@/composables/useDocuments.js', () => ({
  useDocuments: () => ({
    root: computed(() => ({ title: 'Design docs' })),
    childrenOf: id => tree[id] || [],
    createTextDocument: documents.createTextDocument,
    uniqueTitle: documents.uniqueTitle,
  }),
}))

/** The dialog as its contents, where the test can see them. */
const Dialog = { template: '<div><slot /><slot name="footer" /></div>' }

const mountDialog = async (props = {}) => {
  const wrapper = mount(SaveToolResultDialog, {
    props: {
      visible: true,
      storyId: 'story_1',
      server: 'Linear',
      tool: 'get_issue',
      args: { id: 'ENG-123' },
      result: 'ENG-123: Auth rework\n\nMove sessions to tokens.',
      ...props,
    },
    global: { plugins: [PrimeVue], stubs: { Dialog } },
  })
  await flushPromises()
  return wrapper
}

describe('SaveToolResultDialog', () => {
  beforeEach(() => {
    documents.createTextDocument.mockClear()
    window.localStorage.clear()
  })

  it('offers a title from the answer, and every folder in the project by path', async () => {
    const wrapper = await mountDialog()

    expect(wrapper.find('[data-field="title"]').element.value).toBe('ENG-123: Auth rework')
    const select = wrapper.findComponent({ name: 'Select' })
    expect(select.props('options').map(option => option.label)).toEqual([
      'Design docs',
      'References',
      'References / Jira',
    ])
    expect(select.props('modelValue')).toBe(root)
  })

  it('saves it as a document in the folder chosen, saying where it came from', async () => {
    const wrapper = await mountDialog()
    await wrapper.findComponent({ name: 'Select' }).vm.$emit('update:modelValue', 'f_jira')
    await wrapper.find('[data-field="title"]').setValue('Auth rework')

    await wrapper.find('[data-action="save-result"]').trigger('click')

    const [parentId, title, content] = documents.createTextDocument.mock.calls[0]
    expect(parentId).toBe('f_jira')
    expect(title).toBe('Auth rework')
    expect(content).toMatch(/^\*From Linear: get_issue \(id: "ENG-123"\), saved /)
    expect(content).toContain('Move sessions to tokens.')
    expect(wrapper.emitted('saved')[0][0]).toMatchObject({ id: 'd_new' })
    expect(wrapper.emitted('update:visible').at(-1)).toEqual([false])
  })

  it('offers the folder it saved to last time', async () => {
    const first = await mountDialog()
    await first.findComponent({ name: 'Select' }).vm.$emit('update:modelValue', 'f_refs')
    await first.find('[data-action="save-result"]').trigger('click')

    const second = await mountDialog()

    expect(second.findComponent({ name: 'Select' }).props('modelValue')).toBe('f_refs')
  })
})
