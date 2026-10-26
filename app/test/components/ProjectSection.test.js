import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reactive, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ProjectSection from '@/components/writer/settings/ProjectSection.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'

const { root, story, updateDocument, updateStory, profiles, getProfile, account } = vi.hoisted(
  () => {
    const profiles = [
      { id: 'builtin_profile_chat', name: 'Default', readOnly: true },
      { id: 'builtin_profile_roleplay', name: 'Roleplay', readOnly: true },
      { id: 'chatprofile_editor', name: 'Editor', readOnly: false },
    ]
    // As with NSFW profiles switched off: the NSFW one is not offered, and
    // reads as its general counterpart.
    const standIns = { builtin_profile_roleplay_nsfw: 'builtin_profile_roleplay' }
    return {
      root: { value: { id: 'root_story_1', title: 'My Novel', summary: 'A knight rides north.' } },
      story: { value: { id: 'story_1', options: {} } },
      updateDocument: vi.fn(),
      updateStory: vi.fn(async () => {}),
      profiles,
      getProfile: id => profiles.find(profile => profile.id === (standIns[id] || id)) || null,
      account: { value: null },
    }
  }
)

vi.mock('@/stores/documentsStore', () => ({
  useDocumentsStore: () => ({
    getRoot: () => root.value,
    updateDocument: (id, changes) => {
      updateDocument(id, changes)
      Object.assign(root.value, changes)
    },
  }),
}))
vi.mock('@/stores/storiesStore', () => ({
  useStoriesStore: () => ({
    getStory: () => story.value,
    updateStory,
    loadNames: async () => {},
    // Another project goes by "Thief".
    freeName: title => (title === 'Thief' ? 'Thief (2)' : title),
  }),
}))
vi.mock('@/composables/useProfiles', () => ({
  useProfiles: () => ({
    profiles: ref(profiles),
    getProfile,
    chatDefaultId: () => 'builtin_profile_chat',
  }),
}))
vi.mock('@/composables/useCloudSync.js', () => ({
  useCloudSync: () => ({ account }),
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ error: vi.fn() }) }))

const Select = {
  props: ['modelValue', 'options'],
  emits: ['update:modelValue'],
  template:
    '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="o.id" :value="o.id">{{ o.name }}</option></select>',
}

const mountSection = async () => {
  const wrapper = mount(ProjectSection, {
    props: { storyId: 'story_1' },
    global: {
      plugins: [PrimeVue],
      stubs: { Select, ProjectSharing: { template: '<div data-project-sharing />' } },
    },
  })
  await flushPromises()
  return wrapper
}

describe('ProjectSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
    useApplicationState().resetState()
    root.value = reactive({
      id: 'root_story_1',
      title: 'My Novel',
      summary: 'A knight rides north.',
    })
    story.value = { id: 'story_1', options: {} }
    account.value = null
  })

  it('shows the project’s title and summary', async () => {
    const wrapper = await mountSection()
    expect(wrapper.find('[data-field="project-title"]').element.value).toBe('My Novel')
    expect(wrapper.find('[data-field="project-summary"]').element.value).toBe(
      'A knight rides north.'
    )
  })

  it('keeps a title once the writer leaves the field, numbered when another project has it', async () => {
    const wrapper = await mountSection()
    const title = wrapper.find('[data-field="project-title"]')
    await title.setValue('Thief')
    expect(updateDocument).not.toHaveBeenCalled()

    await title.trigger('blur')
    expect(updateDocument).toHaveBeenCalledWith('root_story_1', { title: 'Thief (2)' })
    expect(title.element.value).toBe('Thief (2)')
  })

  it('puts a title cleared back, and keeps one unchanged as it is', async () => {
    const wrapper = await mountSection()
    const title = wrapper.find('[data-field="project-title"]')
    await title.setValue('  ')
    await title.trigger('blur')
    expect(title.element.value).toBe('My Novel')

    await title.trigger('keydown', { key: 'Enter' })
    expect(updateDocument).not.toHaveBeenCalled()
  })

  it('keeps a summary once the writer leaves it, and what was typed when the settings close', async () => {
    const wrapper = await mountSection()
    const summary = wrapper.find('[data-field="project-summary"]')
    await summary.setValue('A thief steals a crown. ')
    await summary.trigger('blur')
    expect(updateDocument).toHaveBeenCalledWith('root_story_1', {
      summary: 'A thief steals a crown.',
    })

    await summary.setValue('And gives it back.')
    wrapper.unmount()
    expect(updateDocument).toHaveBeenLastCalledWith('root_story_1', {
      summary: 'And gives it back.',
    })
  })

  it('follows a rename made elsewhere, but not while the writer is typing', async () => {
    const wrapper = await mountSection()
    root.value.title = 'Renamed'
    await flushPromises()
    const title = wrapper.find('[data-field="project-title"]')
    expect(title.element.value).toBe('Renamed')

    await title.setValue('Mine')
    root.value.title = 'Theirs'
    await flushPromises()
    expect(title.element.value).toBe('Mine')
  })

  it('shows the built-in chat profile as the default when the project has none', async () => {
    const wrapper = await mountSection()
    expect(wrapper.find('select').element.value).toBe('builtin_profile_chat')
    expect(wrapper.findAll('option').map(o => o.text())).toEqual(['Default', 'Roleplay', 'Editor'])
  })

  it("shows the project's own default, or its general counterpart while NSFW ones are off", async () => {
    story.value = { id: 'story_1', options: { profileId: 'builtin_profile_roleplay' } }
    expect((await mountSection()).find('select').element.value).toBe('builtin_profile_roleplay')

    story.value = { id: 'story_1', options: { profileId: 'builtin_profile_roleplay_nsfw' } }
    expect((await mountSection()).find('select').element.value).toBe('builtin_profile_roleplay')
  })

  it('shows Default when the project names a profile that is gone', async () => {
    story.value = { id: 'story_1', options: { profileId: 'builtin_profile_retired' } }
    const wrapper = await mountSection()
    expect(wrapper.find('select').element.value).toBe('builtin_profile_chat')
  })

  it('writes a default picked onto the project, keeping its other options', async () => {
    story.value = { id: 'story_1', options: { other: true } }
    const wrapper = await mountSection()

    await wrapper.find('select').setValue('chatprofile_editor')
    await flushPromises()

    expect(updateStory).toHaveBeenCalledWith('story_1', {
      options: { other: true, profileId: 'chatprofile_editor' },
    })
  })

  it('has no default profile with the AI switched off', async () => {
    useApplicationState().setAiEnabled(false)
    const wrapper = await mountSection()
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Default chat profile')
  })

  it('shares the project only once signed in to sync, and not one kept on this device', async () => {
    expect((await mountSection()).text()).not.toContain('Sharing')

    account.value = { server: 'https://sync.inksprite.io', name: 'writer' }
    expect((await mountSection()).text()).toContain('Sharing')

    story.value = { id: 'story_1', options: {}, syncOff: 1 }
    expect((await mountSection()).text()).not.toContain('Sharing')
  })

  it('opens on the sharing when the outline’s Share… asks for it', async () => {
    account.value = { server: 'https://sync.inksprite.io', name: 'writer' }
    useSettingsPanel().open('project', 'sharing')
    const wrapper = await mountSection()
    const fold = wrapper
      .findAll('button[aria-expanded]')
      .find(button => button.text() === 'Sharing')
    expect(fold?.attributes('aria-expanded')).toBe('true')
    expect(useSettingsPanel().takePart()).toBeNull()
  })
})
