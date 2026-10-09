/* global File */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { computed, ref } from 'vue'
import PrimeVue from 'primevue/config'
import SkillsSection from '@/components/writer/settings/SkillsSection.vue'
import SkillEditor from '@/components/writer/settings/SkillEditor.vue'
import SkillImportDialog from '@/components/writer/settings/SkillImportDialog.vue'
import BuiltInSkillEditor from '@/components/writer/settings/BuiltInSkillEditor.vue'
import { INTERPRET_PROMPT } from '@/ai/skills/index.js'

const library = vi.hoisted(() => ({
  rows: null,
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

vi.mock('@/composables/useProfiles', () => ({
  useProfiles: () => ({ profiles: computed(() => library.profiles.value) }),
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

const mountEditor = (skillId = null) =>
  mount(SkillEditor, {
    props: { skillId },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })

beforeEach(() => {
  library.rows = ref([])
  library.saveSkill = vi.fn(async () => ({ skill: {} }))
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

    expect(builtIn.find('[data-skill="director"]').text()).toContain('Called by the model')
    expect(builtIn.find('[data-skill="interpret"]').text()).toContain('/interpret')
  })

  it('says which built-ins you have reworded', () => {
    library.wordings.value = { interpret: 'Read darkly.' }
    const builtIn = mountSection().find('[data-list="built-in"]')

    expect(builtIn.find('[data-skill="interpret"] [data-reworded]').exists()).toBe(true)
    expect(builtIn.find('[data-skill="director"] [data-reworded]').exists()).toBe(false)
  })

  it('opens a built-in to reword, and comes back', async () => {
    const wrapper = mountSection()
    await wrapper.find('[data-list="built-in"] [data-skill="interpret"]').trigger('click')

    expect(wrapper.findComponent(BuiltInSkillEditor).props('name')).toBe('interpret')
    await wrapper.find('[data-action="back"]').trigger('click')
    expect(wrapper.find('[data-skill-editor]').exists()).toBe(false)
  })

  it('says when you have none yet', () => {
    expect(mountSection().find('[data-list="yours"]').text()).toContain('None yet.')
  })

  it('lists yours with what kind each is and what it is waiting on', () => {
    library.rows.value = [
      tighten,
      {
        id: 'skill_style',
        name: 'house-style',
        text: file('name: house-style\ndescription: The house style.'),
      },
      { id: 'skill_broken', name: 'broken', text: 'no frontmatter' },
    ]
    const yours = mountSection().find('[data-list="yours"]')

    expect(yours.find('[data-skill="tighten"]').text()).toContain('A saved prompt')
    // The model loads it, and the writer can call it too.
    expect(yours.find('[data-skill="house-style"]').text()).toContain(
      'Joins the conversation · Called by the model or you'
    )
    expect(yours.find('[data-skill="broken"]').text()).toMatch(/Does not read.*frontmatter/s)
  })

  it('opens the editor on a new skill, and comes back', async () => {
    const wrapper = mountSection()
    await wrapper.find('[data-action="new-skill"]').trigger('click')

    expect(wrapper.find('[data-skill-editor]').exists()).toBe(true)
    await wrapper.find('[data-action="back"]').trigger('click')
    expect(wrapper.find('[data-skill-editor]').exists()).toBe(false)
  })
})

describe('SkillEditor', () => {
  it('starts a new skill as a saved prompt with a name nothing has', () => {
    library.rows.value = [{ ...tighten, name: 'new-skill', id: 'x' }]
    const wrapper = mountEditor()

    expect(wrapper.find('[data-field="name"]').element.value).toBe('new-skill-2')
  })

  it('writes the file as the form changes, and saves the file', async () => {
    const wrapper = mountEditor()
    await wrapper.find('[data-field="name"]').setValue('trim')
    await wrapper.find('[data-action="save"]').trigger('click')
    await flushPromises()

    const [saved] = library.saveSkill.mock.calls[0]
    expect(saved.id).toBe(null)
    expect(saved.text).toMatch(/^---\nname: trim\n/)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('keeps a file only opened exactly as it was, comments and all', async () => {
    library.rows.value = [tighten]
    const wrapper = mountEditor('skill_tighten')
    await wrapper.find('[data-mode="file"]').trigger('click')

    expect(wrapper.find('[data-field="text"]').element.value).toBe(tighten.text)
  })

  it('saves an existing skill under its id, with the files that came with it', async () => {
    library.rows.value = [tighten]
    const wrapper = mountEditor('skill_tighten')
    await wrapper.find('[data-field="summary"]').setValue('Cut it down.')
    await wrapper.find('[data-action="save"]').trigger('click')
    await flushPromises()

    const [saved] = library.saveSkill.mock.calls[0]
    expect(saved.id).toBe('skill_tighten')
    expect(saved.files).toEqual(tighten.files)
    expect(saved.text).toContain('inksprite-summary: Cut it down.')
  })

  it('says what is wrong, and will not save until it is right', async () => {
    library.rows.value = [tighten]
    const wrapper = mountEditor()
    await wrapper.find('[data-field="name"]').setValue('tighten')

    expect(wrapper.find('[data-problems]').text()).toContain('already have a skill called tighten')
    expect(wrapper.find('[data-action="save"]').attributes('disabled')).toBeDefined()
  })

  it('reads a file edited by hand back into the form', async () => {
    const wrapper = mountEditor()
    await wrapper.find('[data-mode="file"]').trigger('click')
    await wrapper
      .find('[data-field="text"]')
      .setValue(file('name: critique\ndescription: Notes.\ncontext: fork'))
    await wrapper.find('[data-mode="form"]').trigger('click')

    expect(wrapper.find('[data-field="name"]').element.value).toBe('critique')
  })

  it('stays on the file when its frontmatter cannot be read, and says why', async () => {
    const wrapper = mountEditor()
    await wrapper.find('[data-mode="file"]').trigger('click')
    await wrapper.find('[data-field="text"]').setValue('no frontmatter')
    await wrapper.find('[data-mode="form"]').trigger('click')

    expect(wrapper.find('[data-field="text"]').exists()).toBe(true)
    expect(wrapper.find('[data-mode-error]').text()).toContain('frontmatter')
  })

  it('opens a skill whose file does not read on the file', () => {
    library.rows.value = [{ id: 'skill_broken', name: 'broken', text: 'no frontmatter' }]
    const wrapper = mountEditor('skill_broken')

    expect(wrapper.find('[data-field="text"]').exists()).toBe(true)
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
  const mountBuiltIn = (name = 'interpret') =>
    mount(BuiltInSkillEditor, {
      props: { name },
      global: { plugins: [PrimeVue], directives: { tooltip: {} } },
    })

  const field = wrapper => wrapper.find('[data-field="body"]')
  const resetButton = wrapper => wrapper.find('button[aria-label="Reset Instructions"]')

  it('opens on the wording it ships with, with nothing to reset', () => {
    const wrapper = mountBuiltIn()

    expect(field(wrapper).element.value).toBe(INTERPRET_PROMPT)
    expect(resetButton(wrapper).exists()).toBe(false)
  })

  it('opens on your wording when you have one', () => {
    library.wordings.value = { interpret: 'Read darkly.' }

    expect(field(mountBuiltIn()).element.value).toBe('Read darkly.')
  })

  it('saves the wording as it is typed', async () => {
    const wrapper = mountBuiltIn()

    await field(wrapper).setValue('Read darkly.')

    expect(library.setWording).toHaveBeenLastCalledWith('interpret', 'Read darkly.')
  })

  it('puts the wording it ships with back', async () => {
    library.wordings.value = { interpret: 'Read darkly.' }
    const wrapper = mountBuiltIn()

    await resetButton(wrapper).trigger('click')

    expect(field(wrapper).element.value).toBe(INTERPRET_PROMPT)
    expect(library.setWording).toHaveBeenLastCalledWith('interpret', INTERPRET_PROMPT)
  })

  it('says it reaches every chat', () => {
    expect(mountBuiltIn().find('[data-scope]').text()).toBe('Applies to every chat.')
  })

  it('names the profiles that word it their own way', () => {
    library.profiles.value = [
      { id: 'chat', name: 'Default', settings: {} },
      {
        id: 'roleplay',
        name: 'Roleplay',
        settings: { skills: { compact: { prompt: 'Scenes.' } } },
      },
      { id: 'mine', name: 'Mine', settings: { skills: { compact: { prompt: ' ' } } } },
    ]

    expect(mountBuiltIn('compact').find('[data-scope]').text()).toBe(
      'Applies to every chat but those on Roleplay, which has its own.'
    )
  })
})
