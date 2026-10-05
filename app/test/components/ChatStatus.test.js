import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatStatus from '../../src/components/writer/chats/ChatStatus.vue'

const call = (name, args) => ({ name, arguments: JSON.stringify(args) })

const winter = call('read_document', { path: 'Logs/Keeper log, winter' })

describe('ChatStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
  })
  afterEach(() => vi.useRealTimers())

  const show = activity =>
    mount(ChatStatus, { props: { activity: { messageId: 'm1', since: Date.now(), ...activity } } })
  const line = wrapper => wrapper.find('[data-chat-status-line]')
  /** Everything the status says, the time included, as the gap between them reads. */
  const said = wrapper =>
    wrapper
      .findAll('[data-chat-status] > span')
      .map(part => part.text())
      .join(' ')

  it('says what the tools are doing while they run', () => {
    expect(line(show({ phase: 'running', calls: [winter] })).text()).toBe(
      'Reading Keeper log, winter…'
    )
  })

  it('says what a call is while the model is still writing it', () => {
    const partial = { name: 'search_documents', arguments: '{"query": "nig' }
    expect(line(show({ phase: 'calling', calls: [partial] })).text()).toBe('Searching for “nig”…')
  })

  it('says what came back while the model takes it in', () => {
    expect(line(show({ phase: 'waiting', calls: [winter] })).text()).toBe(
      'Read Keeper log, winter · waiting for the model'
    )
  })

  it('says how long the wait has been once it is long enough to matter', async () => {
    const wrapper = show({ phase: 'waiting', calls: [winter] })

    await vi.advanceTimersByTimeAsync(2000)
    expect(said(wrapper)).not.toMatch(/\ds/)

    await vi.advanceTimersByTimeAsync(12_000)
    expect(said(wrapper)).toBe('Read Keeper log, winter · waiting for the model · 14s')

    await vi.advanceTimersByTimeAsync(60_000)
    expect(said(wrapper)).toMatch(/· 1m 14s$/)
  })

  it('keeps up with a wait that began before the line appeared', async () => {
    const wrapper = show({ phase: 'waiting', calls: [winter], since: Date.now() - 2500 })

    await vi.advanceTimersByTimeAsync(600)

    expect(said(wrapper)).toMatch(/· 3s$/)
  })

  it('keeps the time apart from the description, which is the part cut short', async () => {
    const wrapper = show({ phase: 'waiting', calls: [winter] })
    await vi.advanceTimersByTimeAsync(5000)

    expect(line(wrapper).classes()).toContain('truncate')
    expect(line(wrapper).text()).not.toContain('5s')
    expect(wrapper.find('[data-chat-status-time]').classes()).toContain('flex-none')
  })

  it('says nothing but the spinner at the start of a turn, until it has a time to show', async () => {
    const wrapper = show({ phase: 'waiting' })
    expect(line(wrapper).exists()).toBe(false)
    expect(wrapper.find('.pi-spinner').exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(5000)
    expect(said(wrapper)).toBe('Waiting for the model · 5s')
  })

  it('stops its clock when it goes', () => {
    const wrapper = show({ phase: 'waiting' })
    wrapper.unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
