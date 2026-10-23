import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, computed } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'

const trash = vi.hoisted(() => ({
  restore: vi.fn(async () => {}),
  deleteNow: vi.fn(async () => {}),
  restoreProject: vi.fn(async () => {}),
  deleteProject: vi.fn(async () => {}),
  empty: vi.fn(async () => {}),
}))
const items = ref(/** @type {any[]} */ ([]))
const projects = ref(/** @type {any[]} */ ([]))
vi.mock('@/composables/useTrash.js', () => ({
  useTrash: () => ({
    ...trash,
    items,
    trashedProjects: projects,
    count: computed(() => items.value.length + projects.value.length),
  }),
}))

/** What was asked, answered yes at once. */
const confirmRequire = vi.fn(options => options.accept())
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require: confirmRequire }) }))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}))

import TrashDialog from '@/components/writer/projects/TrashDialog.vue'

const mountDialog = () =>
  mount(TrashDialog, {
    props: { visible: true, storyId: 'story_1' },
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      stubs: {
        Dialog: {
          props: ['visible'],
          template: '<div v-if="visible"><slot /><slot name="footer" /></div>',
        },
      },
    },
  })

beforeEach(() => {
  vi.clearAllMocks()
  items.value = [
    {
      kind: 'document',
      id: 'act',
      title: 'Act 1',
      icon: 'pi pi-folder',
      where: 'Manuscript',
      inside: 3,
      trashed: Date.now(),
    },
    {
      kind: 'chat',
      id: 'chat_1',
      title: 'Plot',
      icon: 'pi pi-comments',
      where: '',
      inside: 0,
      trashed: Date.now(),
    },
  ]
  projects.value = [{ id: 'story_2', title: 'Heist', trashed: Date.now() }]
})

describe('TrashDialog', () => {
  it('lists what the project’s trash holds, where each was, and the projects', () => {
    const wrapper = mountDialog()

    const act = wrapper.find('[data-trash-item="act"]').text()
    expect(act).toContain('Act 1')
    expect(act).toContain('Manuscript · 3 inside')
    expect(wrapper.find('[data-trash-item="chat_1"]').text()).toContain('Chat')
    expect(wrapper.find('[data-trash-project="story_2"]').text()).toContain('Heist')
    expect(wrapper.text()).toContain('Kept for 30 days.')
  })

  it('restores without asking', async () => {
    const wrapper = mountDialog()

    await wrapper.find('[data-trash-item="act"] [data-action="restore"]').trigger('click')
    await wrapper.find('[data-trash-project="story_2"] [data-action="restore"]').trigger('click')
    await flushPromises()

    expect(confirmRequire).not.toHaveBeenCalled()
    expect(trash.restore).toHaveBeenCalledWith(items.value[0])
    expect(trash.restoreProject).toHaveBeenCalledWith('story_2')
  })

  it('asks before deleting for good', async () => {
    const wrapper = mountDialog()

    await wrapper.find('[data-trash-item="chat_1"] [data-action="delete-now"]').trigger('click')
    await wrapper.find('[data-trash-project="story_2"] [data-action="delete-now"]').trigger('click')
    await wrapper.find('[data-action="empty-trash"]').trigger('click')
    await flushPromises()

    expect(confirmRequire).toHaveBeenCalledTimes(3)
    expect(trash.deleteNow).toHaveBeenCalledWith(items.value[1])
    expect(trash.deleteProject).toHaveBeenCalledWith('story_2')
    expect(trash.empty).toHaveBeenCalled()
  })

  it('says when the trash is empty, and offers nothing to empty', () => {
    items.value = []
    projects.value = []
    const wrapper = mountDialog()

    expect(wrapper.find('[data-trash-empty]').exists()).toBe(true)
    expect(wrapper.find('[data-action="empty-trash"]').attributes('disabled')).toBeDefined()
  })
})
