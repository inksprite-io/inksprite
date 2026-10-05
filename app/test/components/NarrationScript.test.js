import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import NarrationScript from '@/components/writer/narration/NarrationScript.vue'
import { blocksOf } from '@/tts/script.js'

// The menu, laid flat: every item a button, so a pick is a click.
const Menu = {
  props: ['model', 'popup'],
  template:
    '<div data-menu><button v-for="item in model" :key="item.label" :data-menu-item="item.label" @click="item.command()">{{ item.label }}</button></div>',
  methods: { toggle() {} },
}

const voices = [
  { id: 'narrator', name: 'Narrator', voice: 'af_heart' },
  { id: 'riley', name: 'Riley', voice: 'af_nicole', color: '#3b82f6' },
  { id: 'cody', name: 'Cody', voice: 'am_michael' },
]

const blocks = blocksOf(
  'Riley looked up.\n\n"Hello," she said.\n\nThe kettle clicked off.\n\n"You pick," said Cody.'
)

const mountScript = props =>
  mount(NarrationScript, {
    props: {
      blocks,
      speakers: [null, 'riley', null, 'cody'],
      states: ['ready', 'ready', 'missing', 'missing'],
      voices,
      defaultVoiceId: 'narrator',
      ...props,
    },
    global: { plugins: [PrimeVue], stubs: { Menu } },
  })

const row = (wrapper, index) => wrapper.find(`[data-block="${index}"]`)
const action = (wrapper, index, name) => row(wrapper, index).find(`[data-action="${name}"]`)

describe('NarrationScript', () => {
  it('shows each block with who speaks it', () => {
    const wrapper = mountScript()
    expect(wrapper.findAll('[data-block]')).toHaveLength(4)
    expect(action(wrapper, 1, 'select').text()).toBe('"Hello," she said.')
    expect(action(wrapper, 1, 'speaker').text()).toBe('Riley')
    expect(action(wrapper, 3, 'speaker').text()).toBe('Cody')
    expect(action(wrapper, 3, 'speaker').attributes('aria-label')).toBe('Speaker for block 4: Cody')
  })

  it('leaves the room to the words where the default voice reads', () => {
    const wrapper = mountScript()
    const speaker = action(wrapper, 0, 'speaker')
    expect(speaker.text()).toBe('')
    expect(speaker.attributes('aria-label')).toBe('Speaker for block 1: Narrator, the default')
  })

  it('colours a block for the speaker it was given, and leaves the rest plain', () => {
    const wrapper = mountScript()
    expect(row(wrapper, 1).attributes('style')).toContain('border-left-color: #3b82f6')
    expect(action(wrapper, 1, 'speaker').attributes('style')).toContain('background-color')
    // The default voice's, and a voice with no colour.
    expect(row(wrapper, 0).attributes('style')).toContain('transparent')
    expect(action(wrapper, 3, 'speaker').attributes('style')).toBeUndefined()
  })

  it('names the default voice for a speaker no longer among the voices', () => {
    const wrapper = mountScript({ speakers: ['gone', null, null, null] })
    expect(action(wrapper, 0, 'speaker').attributes('aria-label')).toBe(
      'Speaker for block 1: Narrator, the default'
    )
  })

  it('offers the voices for a block, the default first', async () => {
    const wrapper = mountScript()
    await action(wrapper, 0, 'speaker').trigger('click')

    const items = wrapper.findAll('[data-menu-item]').map(item => item.text())
    expect(items).toEqual(['Narrator (default)', 'Riley', 'Cody'])

    await wrapper.find('[data-menu-item="Cody"]').trigger('click')
    expect(wrapper.emitted('assign')).toEqual([[[0], 'cody']])
  })

  it('gives the speaker to the block whose menu is open, whenever the items were made', async () => {
    // One menu serves every block with the same items: which block they act
    // on is read when the pick is made, not when they were made.
    const wrapper = mountScript()
    const made = wrapper.findComponent(Menu).props('model')

    await action(wrapper, 2, 'speaker').trigger('click')
    made[1].command()
    expect(wrapper.emitted('assign')).toEqual([[[2], 'riley']])
  })

  it('gives nobody a speaker before a menu has been opened', () => {
    const wrapper = mountScript()
    wrapper.findComponent(Menu).props('model')[1].command()
    expect(wrapper.emitted('assign')).toBeUndefined()
  })

  it('gives a block back to the default voice as no speaker', async () => {
    const wrapper = mountScript()
    await action(wrapper, 3, 'speaker').trigger('click')
    await wrapper.find('[data-menu-item="Narrator (default)"]').trigger('click')
    expect(wrapper.emitted('assign')).toEqual([[[3], null]])
  })

  it('says where each block stands in the reading', () => {
    const wrapper = mountScript({ states: ['ready', 'running', 'failed', 'missing'] })
    expect(row(wrapper, 0).attributes('data-state')).toBe('ready')
    expect(action(wrapper, 0, 'play').attributes('aria-label')).toBe('Play from block 1')
    expect(action(wrapper, 1, 'play').attributes('aria-label')).toBe('Block 2 is being read')
    expect(action(wrapper, 2, 'play').attributes('aria-label')).toBe('Block 3 could not be read')
    expect(action(wrapper, 3, 'play').attributes('aria-label')).toBe('Block 4 has not been read')
  })

  it('plays from a block that has been read, once there is a track to play', async () => {
    const without = mountScript()
    expect(action(without, 0, 'play').attributes('disabled')).toBeDefined()

    const wrapper = mountScript({ playable: true })
    await action(wrapper, 1, 'play').trigger('click')
    expect(wrapper.emitted('play')).toEqual([[1]])
    // Not read: nothing to play from.
    expect(action(wrapper, 2, 'play').attributes('disabled')).toBeDefined()
  })

  it('reads one block on its own, again if it has been read', async () => {
    const wrapper = mountScript()
    expect(action(wrapper, 0, 'generate').attributes('aria-label')).toBe('Read block 1 again')
    expect(action(wrapper, 2, 'generate').attributes('aria-label')).toBe('Read block 3')

    await action(wrapper, 2, 'generate').trigger('click')
    expect(wrapper.emitted('generate')).toEqual([[2]])
  })

  it('starts no run while one is under way', () => {
    const wrapper = mountScript({ busy: true })
    expect(action(wrapper, 0, 'generate').attributes('disabled')).toBeDefined()
  })

  it('selects a block, and lets it go when clicked again', async () => {
    const wrapper = mountScript()
    await action(wrapper, 2, 'select').trigger('click')
    expect(wrapper.emitted('update:selection')).toEqual([[[2]]])

    await wrapper.setProps({ selection: [2] })
    expect(action(wrapper, 2, 'select').attributes('aria-pressed')).toBe('true')
    await action(wrapper, 2, 'select').trigger('click')
    expect(wrapper.emitted('update:selection')[1]).toEqual([[]])
  })

  it('selects a run of blocks with Shift, in either direction', async () => {
    const wrapper = mountScript()
    await action(wrapper, 3, 'select').trigger('click')
    await wrapper.setProps({ selection: [3] })
    await action(wrapper, 1, 'select').trigger('click', { shiftKey: true })
    expect(wrapper.emitted('update:selection')[1]).toEqual([[1, 2, 3]])

    await action(wrapper, 0, 'select').trigger('click')
    await action(wrapper, 2, 'select').trigger('click', { shiftKey: true })
    expect(wrapper.emitted('update:selection')[3]).toEqual([[0, 1, 2]])
  })

  it('adds a block to the selection, or takes it out, with Cmd or Ctrl', async () => {
    const wrapper = mountScript()
    await action(wrapper, 3, 'select').trigger('click')
    await wrapper.setProps({ selection: [3] })

    await action(wrapper, 1, 'select').trigger('click', { metaKey: true })
    expect(wrapper.emitted('update:selection')[1]).toEqual([[1, 3]])
    await wrapper.setProps({ selection: [1, 3] })

    await action(wrapper, 3, 'select').trigger('click', { ctrlKey: true })
    expect(wrapper.emitted('update:selection')[2]).toEqual([[1]])
  })

  it('runs a Shift selection from the last block added with Cmd', async () => {
    const wrapper = mountScript()
    await action(wrapper, 1, 'select').trigger('click', { metaKey: true })
    await wrapper.setProps({ selection: [1] })
    await action(wrapper, 3, 'select').trigger('click', { shiftKey: true })
    expect(wrapper.emitted('update:selection')[1]).toEqual([[1, 2, 3]])
  })

  it('gives every selected block the speaker picked on one of them', async () => {
    // Every paragraph one character speaks, given to their voice at once.
    const wrapper = mountScript({ selection: [1, 3] })
    await action(wrapper, 3, 'speaker').trigger('click')

    // The menu says it is for both.
    const menu = wrapper.findComponent(Menu).props('model')
    expect(menu).toHaveLength(1)
    expect(menu[0].label).toBe('Speaker for 2 blocks')
    expect(menu[0].items.map(item => item.label)).toEqual(['Narrator (default)', 'Riley', 'Cody'])

    menu[0].items[2].command()
    menu[0].items[0].command()
    expect(wrapper.emitted('assign')).toEqual([
      [[1, 3], 'cody'],
      [[1, 3], null],
    ])
  })

  it('gives only the block picked on its speaker when it is not one of the selection', async () => {
    const wrapper = mountScript({ selection: [1, 3] })
    await action(wrapper, 0, 'speaker').trigger('click')
    await wrapper.find('[data-menu-item="Riley"]').trigger('click')
    expect(wrapper.emitted('assign')).toEqual([[[0], 'riley']])
  })

  it('marks the block the track is at', () => {
    const wrapper = mountScript({ playing: 2 })
    expect(row(wrapper, 2).classes()).toContain('bg-primary-100')
    expect(row(wrapper, 1).classes()).not.toContain('bg-primary-100')
    expect(row(wrapper, 0).classes()).not.toContain('bg-primary-100')
  })
})
