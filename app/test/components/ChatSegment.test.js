import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ChatSegment from '../../src/components/writer/chats/ChatSegment.vue'

/** Mount a segment with the bits PrimeVue needs and nothing else. */
const show = segment =>
  mount(ChatSegment, {
    props: { segment },
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
    },
  })

const ran = command => ({ type: 'command', command })

describe('ChatSegment', () => {
  it('marks a record a model answered with a sparkle, and any other with a bolt', () => {
    // The sparkle means a model did it everywhere else in the app, the command
    // menu included; a roll was not that.
    const icon = segment => show(segment).find('[data-icon]')

    const interpreted = icon(
      ran({ name: 'interpret', input: 'What is she afraid of?', result: 'Being found out.' })
    )
    expect(interpreted.attributes('data-icon')).toBe('model')
    expect(interpreted.classes()).toContain('pi-sparkles')

    for (const record of [
      { name: 'roll', input: '3d6', label: '3d6', result: '11' },
      { name: 'oracle', input: 'Is it locked?', label: 'Is it locked?', result: 'yes' },
      { name: 'director', input: 'Wrap this scene up', result: 'Wrap this scene up' },
    ]) {
      const shown = icon(ran(record))
      expect(shown.attributes('data-icon'), record.name).toBe('instant')
      expect(shown.classes(), record.name).toContain('pi-bolt')
    }
  })

  it('shows a saved prompt as what was typed, with its instructions folded under it', async () => {
    const wrapper = show(
      ran({
        name: 'tighten',
        input: 'the fight',
        prompt: true,
        detail: 'the fight',
        result: 'Tighten the fight by a third.',
      })
    )

    const instructions = () => wrapper.find('[data-instructions]')

    expect(wrapper.text()).toContain('tighten')
    expect(wrapper.text()).toContain('the fight')
    expect(instructions().attributes('style')).toContain('display: none')

    await wrapper.find('[data-instructions-toggle]').trigger('click')

    expect(instructions().attributes('style') || '').not.toContain('display: none')
    expect(instructions().text()).toBe('Tighten the fight by a third.')
  })

  it('shows what was asked beside what came back', () => {
    // An answer on its own is half a record: "no" is not worth reading
    // without the question it answers.
    const text = show(
      ran({
        name: 'oracle',
        input: 'Is the door locked?',
        param: 'likely',
        label: 'Is the door locked?',
        result: 'no',
      })
    ).text()

    expect(text).toContain('Is the door locked?')
    expect(text).toContain('no')
    // And the odds it was asked at, written the way they would be said.
    expect(text).toContain('Likely')
  })

  it('shows a roll’s notation by its name, and its dice by kind above the total', () => {
    const roll = { roll: '3d6+2', dice: { d6: [4, 2, 5] }, modifier: 2, total: 13 }
    const wrapper = show(
      ran({
        name: 'roll',
        input: '3d6+2 for strength',
        label: '3d6+2 for strength',
        roll,
        result: '13',
      })
    )

    const lines = wrapper.findAll('[data-dice] span').map(line => line.text())
    expect(lines).toEqual(['d6: 4, 2, 5'])
    expect(wrapper.text()).toContain('roll3d6+2')
    expect(wrapper.text()).toContain('for strength')
    expect(wrapper.text()).not.toContain('3d6+2 for strength')
    expect(wrapper.text()).toContain('13')
  })

  it('shows no dice under a total the writer changed', () => {
    const roll = { roll: '3d6+2', dice: { d6: [4, 2, 5] }, modifier: 2, total: 13 }
    const wrapper = show(ran({ name: 'roll', input: '3d6+2', label: '3d6+2', roll, result: '18' }))

    expect(wrapper.find('[data-dice]').exists()).toBe(false)
  })

  it('shows a roll from before as its notation and its total', () => {
    const text = show(
      ran({ name: 'roll', input: '3d6+2', label: '3d6+2', detail: '4 + 4 + 4 + 2', result: '14' })
    ).text()

    expect(text).toContain('3d6+2')
    expect(text).toContain('14')
    expect(text).toContain('4 + 4 + 4 + 2')
  })

  it('gives a character a name and prose, and none of a tool record', () => {
    const text = show(
      ran({
        name: 'emily',
        character: true,
        input: '"Ugh! I was having a nap!"',
        result: '"Ugh! I was having a nap!"',
      })
    ).text()

    expect(text).toContain('Emily')
    expect(text).toContain('Ugh! I was having a nap!')
    // No tool shape: nothing repeats the name in the mono label.
    expect(text).not.toContain('emily')
  })

  it('reads an interpretation as prose, under the question it answers', () => {
    const text = show(
      ran({
        name: 'interpret',
        input: 'How does she react?',
        label: 'How does she react?',
        result: 'She looks away, and does not answer.',
      })
    ).text()

    expect(text).toContain('How does she react?')
    expect(text).toContain('She looks away, and does not answer.')
  })

  it('shows the thinking beside an answer that had a model behind it', () => {
    const text = show(
      ran({
        name: 'interpret',
        input: 'How does she react?',
        label: 'How does she react?',
        reasoning: 'The player has been safe for three scenes.',
        thought: 4000,
        result: 'She looks away.',
      })
    ).text()

    expect(text).toContain('Thought for')
  })

  it('says it is thinking while there is nothing to read yet', () => {
    const text = show(
      ran({
        name: 'interpret',
        input: 'How does she react?',
        label: 'How does she react?',
        reasoning: 'Still reading the scene.',
        pending: true,
        result: '',
      })
    ).text()

    expect(text).toContain('Thinking')
    expect(text).not.toContain('Thought for')
  })

  it('is prose and nothing else when the writer simply wrote', () => {
    const text = show({ type: 'text', content: 'I push open the inn door.' }).text()

    expect(text).toContain('I push open the inn door.')
  })

  it('keeps its buttons off the words', () => {
    const wrapper = show({
      type: 'text',
      content: 'A line of prose the buttons would otherwise sit on.',
    })

    // The strip floats in the corner; the first line wraps around a float
    // the size of it rather than running underneath.
    expect(wrapper.findAll('button').length).toBeGreaterThan(0)
    expect(wrapper.find('[data-actions-room]').exists()).toBe(true)
  })

  it('shows no buttons of its own when it is the whole of its turn', () => {
    const wrapper = mount(ChatSegment, {
      props: { segment: { type: 'text', content: 'Just this.' }, alone: true },
      global: { plugins: [PrimeVue], directives: { tooltip: {} } },
    })

    // The turn's header asks its questions for it, and nothing floats over the words.
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.find('[data-actions-room]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Just this.')
  })

  it('keeps the buttons on a command’s box when it is the whole of its turn', async () => {
    // Asked again and edited from its box wherever it is, as one beside words is.
    const wrapper = mount(ChatSegment, {
      props: {
        segment: ran({ name: 'roll', input: '2d6', label: '2d6', result: '7' }),
        alone: true,
      },
      global: { plugins: [PrimeVue], directives: { tooltip: {} } },
    })
    const labels = wrapper.findAll('button').map(each => each.attributes('aria-label'))
    expect(labels).toEqual(['Ask again', 'Edit command', 'Delete command'])

    await wrapper.find('[aria-label="Ask again"]').trigger('click')
    expect(wrapper.emitted('regenerate')).toHaveLength(1)
  })

  it('holds asking again and editing while the answer is on its way', () => {
    const wrapper = show(ran({ name: 'interpret', input: 'Why?', pending: true }))

    expect(wrapper.find('[aria-label="Ask again"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[aria-label="Edit command"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[aria-label="Delete command"]').attributes('disabled')).toBeUndefined()
  })

  it('holds asking a command again while an answer is being written', () => {
    const wrapper = mount(ChatSegment, {
      props: {
        segment: ran({ name: 'roll', input: '2d6', label: '2d6', result: '7' }),
        busy: true,
      },
      global: { plugins: [PrimeVue], directives: { tooltip: {} } },
    })

    expect(wrapper.find('[aria-label="Ask again"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[aria-label="Edit command"]').attributes('disabled')).toBeUndefined()
  })

  it('says how far one that does not stream has got, while it runs', () => {
    const running = show(
      ran({ name: 'interpret', input: 'Why?', pending: true, progress: '3 of 7 requests' })
    )
    expect(running.find('[data-progress]').text()).toBe('3 of 7 requests')
    expect(
      show(ran({ name: 'interpret', input: 'Why?', pending: true }))
        .find('[data-progress]')
        .exists()
    ).toBe(false)
  })
})
