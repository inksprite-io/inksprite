import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import SkillTextView from '@/components/writer/editor/SkillTextView.vue'

const library = vi.hoisted(() => ({ skill: null, writeSkill: null }))
vi.mock('@/composables/useSkills.js', () => ({
  useSkills: () => ({
    getSkill: id => (library.skill?.id === id ? library.skill : null),
    writeSkill: (...args) => library.writeSkill(...args),
  }),
}))

const PlainText = {
  props: ['text', 'filename'],
  emits: ['input'],
  template: '<div data-plain :data-filename="filename">{{ text }}</div>',
  setup(props, { expose }) {
    expose({ openFind: () => true })
  },
}

const mountView = () =>
  mount(SkillTextView, {
    props: { skillId: 'skill_1' },
    global: { stubs: { PlainText } },
  })

beforeEach(() => {
  library.skill = { id: 'skill_1', name: 'critique', text: '---\nname: critique\n---\n' }
  library.writeSkill = vi.fn()
})

describe('SkillTextView', () => {
  it('shows the skill’s file whole, as a SKILL.md', () => {
    const plain = mountView().find('[data-plain]')

    expect(plain.text()).toBe(library.skill.text.trim())
    expect(plain.attributes('data-filename')).toBe('SKILL.md')
  })

  it('keeps the file as it is typed', () => {
    const wrapper = mountView()
    wrapper.findComponent(PlainText).vm.$emit('input', 'typed')

    expect(library.writeSkill).toHaveBeenCalledWith('skill_1', 'typed')
  })

  it('shows nothing for a skill the library does not have, and opens the text’s find', () => {
    expect(mountView().vm.openFind()).toBe(true)
    library.skill = null

    expect(mountView().find('[data-plain]').exists()).toBe(false)
  })
})
