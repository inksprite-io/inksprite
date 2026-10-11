import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ProjectDialog from '@/components/writer/tree/ProjectDialog.vue'

const { root, story, updateDocument, updateStory, profiles, getProfile } = vi.hoisted(() => {
  const profiles = [
    { id: 'builtin_profile_chat', name: 'Default', readOnly: true },
    { id: 'builtin_profile_roleplay', name: 'Roleplay', readOnly: true },
    { id: 'chatprofile_editor', name: 'Editor', readOnly: false },
  ]
  // As with NSFW profiles switched off: the NSFW one is not offered, and
  // reads as its general counterpart.
  const standIns = { builtin_profile_roleplay_nsfw: 'builtin_profile_roleplay' }
  return {
    root: { id: 'root_story_1', title: 'My Novel', summary: 'A knight rides north.' },
    story: { value: { id: 'story_1', options: {} } },
    updateDocument: vi.fn(),
    updateStory: vi.fn(async () => {}),
    profiles,
    getProfile: id => profiles.find(profile => profile.id === (standIns[id] || id)) || null,
  }
})

vi.mock('@/stores/documentsStore', () => ({
  useDocumentsStore: () => ({ getRoot: () => root, updateDocument, loadRoots: async () => {} }),
}))
vi.mock('@/stores/storiesStore', () => ({
  useStoriesStore: () => ({
    getStory: () => story.value,
    updateStory,
    loadNames: async () => {},
    // Another project goes by "Lighthouse".
    freeName: title => (title === 'Lighthouse' ? 'Lighthouse (2)' : title),
  }),
}))
vi.mock('@/composables/useProfiles', () => ({
  useProfiles: () => ({ profiles: ref(profiles), getProfile }),
}))
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: vi.fn() }) }))

const Dialog = { template: '<div><slot /><slot name="footer" /></div>' }
const Select = {
  props: ['modelValue', 'options'],
  emits: ['update:modelValue'],
  template:
    '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="o.id" :value="o.id">{{ o.name }}</option></select>',
}

const mountDialog = async () => {
  const wrapper = mount(ProjectDialog, {
    props: { storyId: 'story_1', visible: true },
    global: { plugins: [PrimeVue], stubs: { Dialog, Select } },
  })
  await flushPromises()
  return wrapper
}

const save = wrapper => wrapper.find('button[aria-label="Save"]').trigger('click')

describe('ProjectDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    story.value = { id: 'story_1', options: {} }
  })

  it('shows the built-in chat profile as the default when the project has none', async () => {
    const wrapper = await mountDialog()
    expect(wrapper.find('select').element.value).toBe('builtin_profile_chat')
    expect(wrapper.findAll('option').map(o => o.text())).toEqual(['Default', 'Roleplay', 'Editor'])
  })

  it("shows the project's own default when it has one", async () => {
    story.value = { id: 'story_1', options: { profileId: 'builtin_profile_roleplay' } }
    const wrapper = await mountDialog()
    expect(wrapper.find('select').element.value).toBe('builtin_profile_roleplay')
  })

  it('shows the general counterpart of an NSFW default while those are off', async () => {
    story.value = { id: 'story_1', options: { profileId: 'builtin_profile_roleplay_nsfw' } }
    const wrapper = await mountDialog()
    expect(wrapper.find('select').element.value).toBe('builtin_profile_roleplay')
  })

  it('shows Default when the project names a profile that is gone', async () => {
    story.value = { id: 'story_1', options: { profileId: 'builtin_profile_retired' } }
    const wrapper = await mountDialog()
    expect(wrapper.find('select').element.value).toBe('builtin_profile_chat')
  })

  it('writes a changed default onto the project, keeping its other options', async () => {
    story.value = { id: 'story_1', options: { other: true } }
    const wrapper = await mountDialog()

    await wrapper.find('select').setValue('chatprofile_editor')
    await save(wrapper)
    await flushPromises()

    expect(updateStory).toHaveBeenCalledWith('story_1', {
      options: { other: true, profileId: 'chatprofile_editor' },
    })
    expect(updateDocument).toHaveBeenCalledWith('root_story_1', {
      title: 'My Novel',
      summary: 'A knight rides north.',
    })
  })

  it('leaves the project alone when the default did not change', async () => {
    const wrapper = await mountDialog()
    await save(wrapper)
    await flushPromises()

    expect(updateStory).not.toHaveBeenCalled()
    expect(updateDocument).toHaveBeenCalled()
  })

  it('keeps an NSFW default through a save while those are off', async () => {
    story.value = { id: 'story_1', options: { profileId: 'builtin_profile_roleplay_nsfw' } }
    const wrapper = await mountDialog()
    await wrapper.find('input').setValue('Renamed')
    await save(wrapper)
    await flushPromises()

    expect(updateStory).not.toHaveBeenCalled()
    expect(updateDocument).toHaveBeenCalledWith(
      'root_story_1',
      expect.objectContaining({ title: 'Renamed' })
    )
  })

  it('numbers a name another project has', async () => {
    const wrapper = await mountDialog()
    await wrapper.find('input').setValue('Lighthouse')
    await save(wrapper)
    await flushPromises()

    expect(updateDocument).toHaveBeenCalledWith(
      'root_story_1',
      expect.objectContaining({ title: 'Lighthouse (2)' })
    )
  })
})
