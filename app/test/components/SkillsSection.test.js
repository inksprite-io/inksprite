/* global File */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { computed, ref } from 'vue'
import PrimeVue from 'primevue/config'
import SkillsSection from '@/components/writer/settings/SkillsSection.vue'
import SkillEditor from '@/components/writer/settings/SkillEditor.vue'
import SkillImportDialog from '@/components/writer/settings/SkillImportDialog.vue'
import BuiltInSkillEditor from '@/components/writer/settings/BuiltInSkillEditor.vue'
import { COMPACT_PROMPT } from '@/ai/skills/index.js'
import { parseSkill, splitSkill } from '@/ai/skills/format.js'

const library = vi.hoisted(() => ({
  rows: null,
  createSkill: null,
  writeSkill: null,
  saveSkill: null,
  deleteSkill: null,
  importSkills: null,
  wordings: null,
  setWording: null,
  profiles: null,
}))
const confirmed = vi.hoisted(() => ({ last: null }))

vi.mock('@/composables/useSkills', () => ({
  useSkills: () => ({
    ready: async () => {},
    skills: computed(() => library.rows.value),
    getSkill: id => library.rows.value.find(row => row.id === id) || null,
    // The first thing wrong with the file, as the real one says it.
    problemOf: row => {
      const read = parseSkill(row.text)
      return 'errors' in read ? read.errors[0] : ''
    },
    createSkill: (...args) => library.createSkill(...args),
    writeSkill: (...args) => library.writeSkill(...args),
    nameProblem: (name, exceptId) =>
      library.rows.value.some(row => row.name === name && row.id !== exceptId)
        ? `You already have a skill called ${name}.`
        : '',
    saveSkill: (...args) => library.saveSkill(...args),
    deleteSkill: (...args) => library.deleteSkill(...args),
    // Enough of the real plan for the screen: a name read off the file, and a
    // built-in's name refused.
    planImport: found =>
      found.map(one => {
        const name = /name: (\S+)/.exec(one.text)?.[1] || ''
        return {
          ...one,
          ignored: [],
          errors: name ? [] : ['It needs a `name`.'],
          name,
          replaces: null,
          problem: name === 'director' ? 'director is a built-in skill.' : '',
        }
      }),
    importSkills: (...args) => library.importSkills(...args),
    wordingOf: name => library.wordings.value[name] ?? null,
    setWording: (...args) => library.setWording(...args),
  }),
}))

// The profile's wording of the built-ins, held as the library's used to be.
vi.mock('@/composables/useChatSettings', async () => {
  const { BUILT_IN_SKILLS } = await import('@/ai/skills/index.js')
  const shipped = name => BUILT_IN_SKILLS.find(one => one.name === name)?.body ?? ''
  return {
    useChatSettings: () => ({
      selectedProfileId: computed(() => 'builtin_profile_chat'),
      skillPromptOf: name => library.wordings.value[name] ?? shipped(name),
      isSkillReworded: name => name in library.wordings.value,
      setSkillPrompt: (name, text) => {
        library.wordings.value = { ...library.wordings.value, [name]: text }
        library.setWording(name, text)
      },
      resetSkill: name => {
        const { [name]: _gone, ...rest } = library.wordings.value
        library.wordings.value = rest
        library.setWording(name, shipped(name))
      },
    }),
  }
})

vi.mock('@/composables/useProfiles', () => ({
  useProfiles: () => ({ profiles: computed(() => library.profiles.value) }),
}))

const opened = vi.hoisted(() => ({ open: null, show: null, close: null }))
vi.mock('@/composables/useDocuments', () => ({
  useDocuments: () => ({ open: (...args) => opened.open(...args) }),
}))
vi.mock('@/composables/useEditorRequest.js', () => ({
  useEditorRequest: () => ({ show: () => opened.show() }),
}))
vi.mock('@/composables/useSettingsPanel.js', () => ({
  useSettingsPanel: () => ({ close: () => opened.close() }),
}))

vi.mock('primevue/useconfirm', () => ({
  useConfirm: () => ({ require: options => (confirmed.last = options) }),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}))

/** A SKILL.md. */
const file = (front, body = 'Do it.') => `---\n${front}\n---\n\n${body}\n`

const tighten = {
  id: 'skill_tighten',
  name: 'tighten',
  text: file(
    '# kept as written\nname: tighten\ndescription: Cut a passage.\ndisable-model-invocation: true'
  ),
  files: [{ path: 'references/voice.md', content: 'Terse.' }],
}

/** The dialog as its contents, where the test can see them. */
const Dialog = { template: '<div><slot /><slot name="footer" /></div>' }

const mountSection = () =>
  mount(SkillsSection, {
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })

const mountEditor = (skillId = '', props = {}) =>
  mount(SkillEditor, {
    props: { skillId, ...props },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })

/** A skill that can be used, as the library keeps it. */
const critique = {
  id: 'skill_critique',
  name: 'critique',
  text: file('name: critique\ndescription: Notes on a scene.', 'Give notes.'),
  files: [],
}

/** The frontmatter of a file. */
const frontOf = text => {
  const split = splitSkill(text)
  return 'front' in split ? split.front : null
}

beforeEach(() => {
  library.rows = ref([])
  library.saveSkill = vi.fn(async () => ({ skill: {} }))
  library.createSkill = vi.fn(text => {
    const made = { id: 'skill_new', name: 'new-skill', text, files: [] }
    library.rows.value = [...library.rows.value, made]
    return made
  })
  library.writeSkill = vi.fn(async (id, text) => {
    library.rows.value = library.rows.value.map(row => (row.id === id ? { ...row, text } : row))
    return library.rows.value.find(row => row.id === id) || null
  })
  opened.open = vi.fn()
  opened.show = vi.fn()
  opened.close = vi.fn()
  library.deleteSkill = vi.fn(() => true)
  library.importSkills = vi.fn(async rows => ({ imported: rows.length, failed: [] }))
  library.wordings = ref({})
  library.setWording = vi.fn(() => true)
  library.profiles = ref([{ id: 'chat', name: 'Default', settings: {} }])
  confirmed.last = null
})

describe('importing skills', () => {
  const found = [
    { path: 'trim/SKILL.md', text: file('name: trim\ndescription: Trim.'), files: [], dropped: [] },
    {
      path: 'director/SKILL.md',
      text: file('name: director\ndescription: Mine.'),
      files: [],
      dropped: ['scripts/run.py: scripts can’t run here'],
    },
  ]

  const mountDialog = () =>
    mount(SkillImportDialog, {
      props: { visible: true, found, stray: ['README.md'] },
      global: { plugins: [PrimeVue], directives: { tooltip: {} }, stubs: { Dialog } },
    })

  const importButton = wrapper => wrapper.find('[data-action="import"]')

  it('shows each skill found, and brings in only the ones that can come in', () => {
    const wrapper = mountDialog()

    expect(wrapper.find('[data-import="director"] [data-problem]').text()).toContain('built-in')
    expect(wrapper.text()).toContain('Left out: scripts/run.py')
    expect(wrapper.find('[data-stray]').text()).toContain('One other file')
    expect(importButton(wrapper).text()).toBe('Import 1 skill')
  })

  it('brings one in under another name once it has one', async () => {
    const wrapper = mountDialog()
    const rename = wrapper.find('[data-import="director"] [data-rename]')
    await rename.setValue('my-director')
    await rename.trigger('change')

    expect(importButton(wrapper).text()).toBe('Import 2 skills')
  })

  it('leaves out one the writer switches off, and imports the rest', async () => {
    const wrapper = mountDialog()
    await wrapper
      .findComponent('[data-import="trim"] [data-choose]')
      .vm.$emit('update:modelValue', false)
    expect(importButton(wrapper).attributes('disabled')).toBeDefined()

    await wrapper
      .findComponent('[data-import="trim"] [data-choose]')
      .vm.$emit('update:modelValue', true)
    await importButton(wrapper).trigger('click')
    await flushPromises()

    expect(library.importSkills.mock.calls[0][0].map(row => row.name)).toEqual(['trim'])
    expect(wrapper.emitted('update:visible')).toEqual([[false]])
  })

  it('reads the files chosen, and shows what skills are in them', async () => {
    const wrapper = mountSection()
    const input = wrapper.find('[data-pick="files"]')
    const chosen = new File([file('name: trim\ndescription: Trim.')], 'SKILL.md')
    Object.defineProperty(input.element, 'files', { value: [chosen], configurable: true })
    await input.trigger('change')
    await flushPromises()

    expect(wrapper.findComponent(SkillImportDialog).props('found')).toHaveLength(1)
  })
})

describe('SkillsSection', () => {
  it('lists the built-ins, with the commands you can type for them', () => {
    const wrapper = mountSection()
    const builtIn = wrapper.find('[data-list="built-in"]')

    expect(builtIn.find('[data-skill="compact"]').text()).toContain('/compact')
    expect(builtIn.find('[data-skill="interpret"]').exists()).toBe(false)
    // Set aside for now.
    expect(wrapper.find('[data-skill="director"]').exists()).toBe(false)
  })

  it('says which built-ins you have reworded', () => {
    library.wordings.value = { compact: 'Sum up darkly.' }
    const wrapper = mountSection()

    expect(wrapper.find('[data-skill="compact"] [data-reworded]').exists()).toBe(true)
  })

  it('opens a built-in on its wording, and no more', async () => {
    const wrapper = mountSection()
    await wrapper.find('[data-skill="compact"] [data-card-toggle]').trigger('click')

    const editor = wrapper.find('[data-skill="compact"] [data-built-in]')
    expect(editor.find('[data-field="body"]').exists()).toBe(true)
    expect(editor.find('[data-field="name"]').exists()).toBe(false)
    expect(editor.find('[data-action="delete"]').exists()).toBe(false)
  })

  it('offers a new skill and an import, and no export of them all', () => {
    const wrapper = mountSection()

    expect(wrapper.find('[data-action="new-skill"]').exists()).toBe(true)
    expect(wrapper.find('[data-action="import"]').exists()).toBe(true)
    expect(wrapper.find('[data-action="export-all"]').exists()).toBe(false)
  })

  it('heads the built-ins whether or not you have skills of your own', () => {
    const wrapper = mountSection()

    expect(wrapper.find('[data-list="built-in"]').text()).toContain('Built-in')
    expect(wrapper.find('[data-list="yours"]').exists()).toBe(false)
  })

  it('shows what a skill is called, what it does and its command', () => {
    library.rows.value = [
      critique,
      {
        id: 'skill_editor',
        name: 'short-story-editor',
        text: file(
          'name: short-story-editor\ndescription: Critiques stories.\nmetadata:\n  inksprite-title: Short Story Editor'
        ),
        files: [],
      },
    ]
    const wrapper = mountSection()

    const named = wrapper.find('[data-skill="critique"]').text()
    expect(named).toContain('Critique')
    expect(named).toContain('Notes on a scene.')
    expect(named).toContain('/critique')
    const titled = wrapper.find('[data-skill="short-story-editor"]').text()
    expect(titled).toContain('Short Story Editor')
    expect(titled).toContain('/short-story-editor')
  })

  it('keeps a skill that can’t be used on its description, without a command or an error', () => {
    library.rows.value = [{ ...critique, text: file('name: critique\ndescription: Notes.', '') }]
    const wrapper = mountSection()

    const row = wrapper.find('[data-skill="critique"]').text()
    expect(row).toContain('Notes.')
    expect(row).not.toContain('/critique')
    expect(row).not.toContain('It needs instructions.')
  })

  it('opens a card to write a new skill in, which is nothing if cancelled', async () => {
    const wrapper = mountSection()
    await wrapper.find('[data-action="new-skill"]').trigger('click')

    const draft = wrapper.find('[data-skill-draft]')
    expect(draft.text()).toContain('New skill')
    expect(draft.find('[data-field="name"]').element.value).toBe('')

    await draft.find('[data-action="cancel"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-skill-draft]').exists()).toBe(false)
    expect(library.createSkill).not.toHaveBeenCalled()
  })

  it('makes the new skill one of the list’s once it is saved, and shuts it', async () => {
    const wrapper = mountSection()
    await wrapper.find('[data-action="new-skill"]').trigger('click')
    const draft = wrapper.find('[data-skill-draft]')
    await draft.find('[data-field="name"]').setValue('Scene Notes')
    await draft.find('[data-field="description"]').setValue('Notes on a scene.')
    await draft.find('[data-field="body"]').setValue('Give notes.')
    await draft.find('[data-action="save"]').trigger('click')
    await flushPromises()

    expect(library.createSkill).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-skill-draft]').exists()).toBe(false)
    expect(wrapper.find('[data-list="yours"]').text()).toContain('Scene Notes')
    expect(wrapper.find('[data-skill-editor]').exists()).toBe(false)
  })

  it('leaves a new skill open on what is wrong with it', async () => {
    const wrapper = mountSection()
    await wrapper.find('[data-action="new-skill"]').trigger('click')
    await wrapper.find('[data-skill-draft] [data-field="name"]').setValue('Scene Notes')
    await wrapper.find('[data-skill-draft] [data-action="save"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-skill-draft]').exists()).toBe(false)
    expect(wrapper.find('[data-skill-editor] [data-problem]').text()).toBe(
      'It needs a description.'
    )
  })
})

describe('SkillEditor', () => {
  const field = (wrapper, name) => wrapper.find(`[data-field="${name}"]`)
  const save = async wrapper => {
    await wrapper.find('[data-action="save"]').trigger('click')
    await flushPromises()
  }

  it('opens on the three fields, read from the file', () => {
    library.rows.value = [critique]
    const wrapper = mountEditor('skill_critique')

    expect(field(wrapper, 'name').element.value).toBe('critique')
    expect(field(wrapper, 'description').element.value).toBe('Notes on a scene.')
    expect(field(wrapper, 'body').element.value).toBe('Give notes.')
    expect(wrapper.find('[data-problem]').exists()).toBe(false)
  })

  it('keeps nothing until it is saved, then shuts on a skill that can be used', async () => {
    library.rows.value = [critique]
    const wrapper = mountEditor('skill_critique')
    await field(wrapper, 'body').setValue('Give kind notes.')

    expect(library.writeSkill).not.toHaveBeenCalled()
    await save(wrapper)

    expect(library.writeSkill).toHaveBeenCalledWith(
      'skill_critique',
      critique.text.replace('Give notes.', 'Give kind notes.')
    )
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('makes the name a skill is called by from the name as it is written', async () => {
    library.rows.value = [critique]
    const wrapper = mountEditor('skill_critique')
    await field(wrapper, 'name').setValue('Scene Critique')
    await save(wrapper)

    expect(frontOf(library.writeSkill.mock.calls[0][1])).toEqual({
      name: 'scene-critique',
      description: 'Notes on a scene.',
      metadata: { 'inksprite-title': 'Scene Critique' },
    })
  })

  it('says what is wrong only once it is saved, and stays open', async () => {
    library.rows.value = [critique]
    const wrapper = mountEditor('skill_critique')
    await field(wrapper, 'name').setValue('')

    expect(wrapper.find('[data-problem]').exists()).toBe(false)
    await save(wrapper)

    expect(wrapper.find('[data-problem]').text()).toBe('It needs a name.')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('says what is wrong with a skill as it opens, and leaves that while it is put right', async () => {
    library.rows.value = [{ ...critique, text: file('name: critique\ndescription: Notes.', '') }]
    const wrapper = mountEditor('skill_critique')

    expect(wrapper.find('[data-problem]').text()).toBe('It needs instructions.')
    await field(wrapper, 'body').setValue('Give notes.')
    expect(wrapper.find('[data-problem]').text()).toBe('It needs instructions.')
  })

  it('puts the fields back and shuts on Cancel, keeping nothing', async () => {
    library.rows.value = [critique]
    const wrapper = mountEditor('skill_critique')
    await field(wrapper, 'body').setValue('Give kind notes.')
    await wrapper.find('[data-action="cancel"]').trigger('click')
    const closed = wrapper.emitted('close')
    wrapper.unmount()

    expect(closed).toHaveLength(1)
    expect(library.writeSkill).not.toHaveBeenCalled()
  })

  it('keeps what was typed when it is shut some other way', async () => {
    library.rows.value = [critique]
    const wrapper = mountEditor('skill_critique')
    await field(wrapper, 'body').setValue('Give kind notes.')
    wrapper.unmount()

    expect(library.writeSkill).toHaveBeenCalledTimes(1)
  })

  it('does not keep a new skill with nothing written, and asks for its name', async () => {
    const wrapper = mountEditor()
    await save(wrapper)

    expect(wrapper.find('[data-problem]').text()).toBe('It needs a name.')
    expect(wrapper.find('[data-action="delete"]').exists()).toBe(false)
    wrapper.unmount()
    expect(library.createSkill).not.toHaveBeenCalled()
  })

  it('shows one line in place of the fields for a file that can’t be read', () => {
    library.rows.value = [{ ...critique, text: 'Just instructions.' }]
    const wrapper = mountEditor('skill_critique', { storyId: 'story_1' })

    expect(wrapper.find('[data-problem]').text()).toBe(
      'A skill starts with its frontmatter, between two lines of three dashes.'
    )
    expect(field(wrapper, 'name').exists()).toBe(false)
    expect(wrapper.find('[data-action="save"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="open"]').exists()).toBe(true)
  })

  it('opens the file in the editor with what was typed kept, and closes the settings', async () => {
    library.rows.value = [critique]
    const wrapper = mountEditor('skill_critique', { storyId: 'story_1' })
    await field(wrapper, 'body').setValue('Give kind notes.')
    await wrapper.find('[data-action="open"]').trigger('click')
    await flushPromises()

    expect(library.writeSkill).toHaveBeenCalledTimes(1)
    expect(opened.open).toHaveBeenCalledWith('skill:skill_critique')
    expect(opened.show).toHaveBeenCalled()
    expect(opened.close).toHaveBeenCalled()
  })

  it('has no way to the editor with no project open', () => {
    library.rows.value = [critique]

    expect(mountEditor('skill_critique').find('[data-action="open"]').exists()).toBe(false)
  })

  it('asks before deleting, and deletes when told to', async () => {
    library.rows.value = [tighten]
    const wrapper = mountEditor('skill_tighten')
    await wrapper.find('[data-action="delete"]').trigger('click')

    expect(confirmed.last.header).toBe('Delete tighten?')
    expect(library.deleteSkill).not.toHaveBeenCalled()
    confirmed.last.accept()
    expect(library.deleteSkill).toHaveBeenCalledWith('skill_tighten')
  })

  it('says which other files came with it', () => {
    library.rows.value = [tighten]

    expect(mountEditor('skill_tighten').text()).toContain('references/voice.md')
  })
})

describe('BuiltInSkillEditor', () => {
  const mountBuiltIn = (name = 'compact') =>
    mount(BuiltInSkillEditor, {
      props: { name },
      global: { plugins: [PrimeVue], directives: { tooltip: {} } },
    })

  const field = wrapper => wrapper.find('[data-field="body"]')
  const resetButton = wrapper => wrapper.find('button[aria-label="Reset Instructions"]')

  it('opens on the wording it ships with, with nothing to reset', () => {
    const wrapper = mountBuiltIn()

    expect(field(wrapper).element.value).toBe(COMPACT_PROMPT)
    expect(resetButton(wrapper).exists()).toBe(false)
  })

  it('opens on your wording when you have one', () => {
    library.wordings.value = { compact: 'Sum up darkly.' }

    expect(field(mountBuiltIn()).element.value).toBe('Sum up darkly.')
  })

  it('saves the wording as it is typed', async () => {
    const wrapper = mountBuiltIn()

    await field(wrapper).setValue('Sum up darkly.')

    expect(library.setWording).toHaveBeenLastCalledWith('compact', 'Sum up darkly.')
  })

  it('puts the wording it ships with back', async () => {
    library.wordings.value = { compact: 'Sum up darkly.' }
    const wrapper = mountBuiltIn()

    await resetButton(wrapper).trigger('click')

    expect(field(wrapper).element.value).toBe(COMPACT_PROMPT)
    expect(library.setWording).toHaveBeenLastCalledWith('compact', COMPACT_PROMPT)
  })

  it('says nothing of where it reaches when every chat uses it', () => {
    expect(mountBuiltIn().find('[data-scope]').exists()).toBe(false)
  })
})
