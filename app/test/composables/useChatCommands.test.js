/* global AbortController */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useChatCommands } from '@/composables/useChatCommands'
import { setLibrarySkills } from '@/ai/skills/index.js'

vi.mock('@/composables/useChats', () => ({ useChats: vi.fn() }))

describe('useChatCommands', () => {
  const storyId = 'story_1'
  const chatId = 'chat_1'
  let chatsApi
  let commands

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    chatsApi = {
      addMessage: vi.fn().mockReturnValue({ id: 'msg_1', role: 'user', content: '' }),
      updateMessage: vi.fn().mockReturnValue({ id: 'msg_1' }),
      streamMessageContent: vi.fn(),
      getMessageById: vi.fn().mockReturnValue({ value: null }),
      writeSegment: vi.fn(),
      writeTurn: vi.fn(),
      deleteMessage: vi.fn(),
      moveMessage: vi.fn(),
      getMessagesForChat: vi.fn().mockReturnValue({ value: [] }),
    }

    const { useChats } = await import('@/composables/useChats')
    useChats.mockReturnValue(chatsApi)

    commands = useChatCommands(storyId, chatId)
  })

  it('sends an ordinary message through untouched', async () => {
    const { spoken } = await commands.submit('I push open the inn door.')

    expect(spoken).toBe('I push open the inn door.')
    expect(chatsApi.addMessage).toHaveBeenCalledWith(
      chatId,
      'user',
      'I push open the inn door.',
      null,
      [{ type: 'text', content: 'I push open the inn door.' }]
    )
    expect(chatsApi.updateMessage).not.toHaveBeenCalled()
  })

  it("writes an answer in as the writer's own turn", async () => {
    // Their turn because they chose to ask, and because it is established
    // fact by the time the model reads it.
    await commands.submit('/oracle(likely) Is the door locked?')

    const [, role, content, , segments] = chatsApi.addMessage.mock.calls[0]
    expect(role).toBe('user')
    // The content is the turn assembled: what the model reads, tags and all.
    expect(content).toMatch(
      /^<oracle likelihood="likely">\nIs the door locked\?\n(yes|no|exceptional (yes|no))\n<\/oracle>$/
    )

    expect(segments).toHaveLength(1)
    expect(segments[0].command).toMatchObject({
      name: 'oracle',
      input: 'Is the door locked?',
      param: 'likely',
    })
  })

  it('writes a character line as the writer saying it, because they did', async () => {
    await commands.submit('@cody I quickly hide in the closet.')

    const [, role, content, , segments] = chatsApi.addMessage.mock.calls[0]
    expect(role).toBe('user')
    expect(content).toBe('<cody>\nI quickly hide in the closet.\n</cody>')
    expect(segments[0].command).toMatchObject({
      name: 'cody',
      result: 'I quickly hide in the closet.',
    })
  })

  it('lets a scene be typed as the several people in it', async () => {
    const { spoken } = await commands.submit(
      '@cody I quickly hide in the closet.\n@emily "Ugh! I was having a nap!"'
    )

    // One turn, two people in it.
    expect(chatsApi.addMessage).toHaveBeenCalledTimes(1)
    expect(chatsApi.addMessage.mock.calls[0][2]).toBe(
      '<cody>\nI quickly hide in the closet.\n</cody>\n\n<emily>\n"Ugh! I was having a nap!"\n</emily>'
    )
    // Somebody acted, so the turn has been taken and the table is waiting.
    expect(spoken).toBe('I quickly hide in the closet.\n\n"Ugh! I was having a nap!"')
  })

  it('asks for no turn when there is nothing but tools', async () => {
    // The point of asking three questions is asking them before there is
    // anything to narrate.
    const { spoken } = await commands.submit(
      '/oracle(likely) Is the door locked?\n/oracle(fifty_fifty) Can they pick it?'
    )

    expect(spoken).toBe('')
    // Two questions, one turn.
    expect(chatsApi.addMessage).toHaveBeenCalledTimes(1)
    expect(chatsApi.addMessage.mock.calls[0][4]).toHaveLength(2)
  })

  describe('a saved prompt', () => {
    afterEach(() => setLibrarySkills([]))

    beforeEach(() => {
      setLibrarySkills([
        {
          id: 'skill_tighten',
          text: '---\nname: tighten\ndescription: Cut it.\ndisable-model-invocation: true\n---\n\nTighten $ARGUMENTS by a third.\n',
        },
      ])
    })

    it('asks for a turn, being the writer asking for something', async () => {
      const { spoken } = await commands.submit('/tighten the fight')

      expect(spoken).toBe('Tighten the fight by a third.')
      expect(chatsApi.addMessage.mock.calls[0][2]).toBe(
        '<tighten>\nTighten the fight by a third.\n</tighten>'
      )
    })

    it('is filled in with the profile’s wording of its skill', async () => {
      const promptFor = vi.fn().mockReturnValue('Halve $ARGUMENTS.')
      const { spoken } = await commands.submit('/tighten the fight', { promptFor })

      expect(promptFor).toHaveBeenCalledWith('tighten')
      expect(spoken).toBe('Halve the fight.')
    })
  })

  it('writes a command after the sentence it follows', async () => {
    // The whole reason lines are judged one at a time. A direction belongs
    // after the turn it is about, and a leading-slash test on the whole
    // message can only ever put commands first.
    const { spoken } = await commands.submit(
      'I eat my food in silence.\n\n/director Wrap this scene up'
    )

    expect(spoken).toBe('I eat my food in silence.')
    expect(chatsApi.addMessage.mock.calls[0][2]).toBe(
      'I eat my food in silence.\n\n<director>\nWrap this scene up\n</director>'
    )
    expect(chatsApi.addMessage.mock.calls[0][4].map(segment => segment.type)).toEqual([
      'text',
      'command',
    ])
  })

  it('writes nothing at all when one command in the batch cannot run', async () => {
    // They all run before anything is recorded, so a typo in the second leaves
    // the chat as it was rather than half a turn in it.
    await expect(
      commands.submit('I try the handle.\n/oracle(likely) Is it locked?\n/oracle')
    ).rejects.toThrow(/ask a question/i)

    expect(chatsApi.addMessage).not.toHaveBeenCalled()
  })

  it('names the failure as a command error, so the text can be handed back', async () => {
    await expect(commands.submit('/oracle')).rejects.toMatchObject({ name: 'CommandError' })
  })

  it('writes a consulting command before it has an answer, then fills it in', async () => {
    // Holding the write until a model answers would leave the writer looking
    // at an empty box for the length of an inference.
    let answer
    const consult = vi.fn().mockReturnValue(new Promise(resolve => (answer = resolve)))
    chatsApi.addMessage.mockReturnValue({ id: 'msg_i', role: 'user' })
    chatsApi.getMessageById.mockReturnValue({
      value: { id: 'msg_i', segments: [{ type: 'command', command: { name: 'interpret' } }] },
    })

    const running = commands.submit('/interpret What is he afraid of?', { consult })
    await Promise.resolve()

    const [, , opened] = chatsApi.addMessage.mock.calls[0][4][0].command
      ? [null, null, chatsApi.addMessage.mock.calls[0][4][0].command]
      : []
    expect(opened).toMatchObject({ name: 'interpret', pending: true, result: '' })

    answer('He is waiting for someone.')
    await running

    const closed = chatsApi.writeSegment.mock.calls.at(-1)[2]
    expect(closed.pending).toBeUndefined()
    expect(closed.result).toBe('He is waiting for someone.')
  })

  it('says a command was stopped, not that it failed', async () => {
    const stopped = new AbortController()
    const consult = vi.fn(async () => {
      stopped.abort()
      throw stopped.signal.reason
    })
    chatsApi.addMessage.mockReturnValue({ id: 'msg_i', role: 'user' })
    chatsApi.getMessageById.mockReturnValue({
      value: { id: 'msg_i', segments: [{ type: 'command', command: { name: 'interpret' } }] },
    })

    await commands.submit('/interpret What is he afraid of?', { consult, signal: stopped.signal })

    const closed = chatsApi.writeSegment.mock.calls.at(-1)[2]
    expect(closed.pending).toBeUndefined()
    expect(closed.error).toBe('Stopped.')
  })

  describe('a summary that falls short', () => {
    /** A consult that writes `said` and then fails, or is stopped. */
    const fallsShort = (said, { stop } = {}) =>
      vi.fn(async (prompt, tools, options) => {
        if (said) options.onContent(said)
        if (stop) {
          stop.abort()
          throw stop.signal.reason
        }
        throw new Error('Connection reset')
      })

    beforeEach(() => {
      chatsApi.addMessage.mockReturnValue({ id: 'msg_c', role: 'assistant' })
      chatsApi.getMessageById.mockReturnValue({ value: { id: 'msg_c' } })
    })

    /** What the summary's message was last written with. */
    const written = () =>
      chatsApi.updateMessage.mock.calls.filter(call => 'content' in call[1]).at(-1)[1]

    it('keeps what it had written when its request fails, and says it was cut short', async () => {
      await expect(
        commands.submit('/compact(4)', { consult: fallsShort('They crossed the') })
      ).rejects.toThrow('Compacted summary was cut short: Connection reset')

      expect(written().content).toBe('They crossed the')
      expect(written().metadata.command).toMatchObject({
        name: 'compact',
        result: 'They crossed the',
      })
      expect(written().metadata.command.error).toBeUndefined()
      expect(written().metadata.command.pending).toBeUndefined()
    })

    it('stays, empty, when it failed before writing anything', async () => {
      await expect(commands.submit('/compact(4)', { consult: fallsShort('') })).rejects.toThrow(
        'Compacted summary was cut short: Connection reset'
      )

      expect(written().content).toBe('')
      expect(written().metadata.command.error).toBeUndefined()
    })

    it('keeps what it had written when stopped, and says nothing', async () => {
      const stop = new AbortController()

      await commands.submit('/compact(4)', {
        consult: fallsShort('They crossed the', { stop }),
        signal: stop.signal,
      })

      expect(written().content).toBe('They crossed the')
      expect(written().metadata.command.error).toBeUndefined()
    })

    it('stays, empty, when stopped before writing anything', async () => {
      const stop = new AbortController()

      await commands.submit('/compact(4)', {
        consult: fallsShort('', { stop }),
        signal: stop.signal,
      })

      expect(written().content).toBe('')
      expect(written().metadata.command).toMatchObject({ name: 'compact', result: '' })
      expect(written().metadata.command.error).toBeUndefined()
    })

    it('says it was cut short when asked again, too', async () => {
      chatsApi.getMessageById.mockReturnValue({
        value: { id: 'msg_c', metadata: { command: { name: 'compact', input: '', keep: 0 } } },
      })

      await expect(commands.rerun('msg_c', null, { consult: fallsShort('They') })).rejects.toThrow(
        'Compacted summary was cut short: Connection reset'
      )
      expect(written().content).toBe('They')
    })
  })

  it('leaves a stopped command alone once its message is gone', async () => {
    const stopped = new AbortController()
    const consult = vi.fn(async () => {
      stopped.abort()
      throw stopped.signal.reason
    })
    chatsApi.addMessage.mockReturnValue({ id: 'msg_i', role: 'user' })

    await commands.submit('/interpret What is he afraid of?', { consult, signal: stopped.signal })

    expect(chatsApi.writeSegment).not.toHaveBeenCalled()
    expect(chatsApi.updateMessage).not.toHaveBeenCalled()
  })

  it('answers into the turn that asked, not into the slot the narrator writes in', async () => {
    // A voice that is not the Game Master's, in the slot the Game Master
    // narrates from, is the one thing a model reliably copies. What the writer
    // asked for is theirs to bring to the turn.
    const consult = vi.fn().mockResolvedValue('He is waiting for someone.')
    chatsApi.addMessage.mockReturnValue({ id: 'msg_i', role: 'user' })
    chatsApi.getMessageById.mockReturnValue({
      value: { id: 'msg_i', segments: [{ type: 'command', command: { name: 'interpret' } }] },
    })

    await commands.submit('@emily I check the fridge\n/interpret How does she react?', { consult })

    // One message, in the writer's voice, holding both.
    expect(chatsApi.addMessage).toHaveBeenCalledTimes(1)
    const [, role, , , segments] = chatsApi.addMessage.mock.calls[0]
    expect(role).toBe('user')
    expect(segments.map(segment => segment.command.name)).toEqual(['emily', 'interpret'])
  })

  it('refuses to write past a command that answers on a turn of its own', async () => {
    // The writer's words cannot be on both sides of a turn that is not theirs.
    const consult = vi.fn()

    await expect(
      commands.submit('/compact(4) keep the heist\nI nod slowly.', { consult })
    ).rejects.toThrow(/nothing can follow it/i)

    expect(chatsApi.addMessage).not.toHaveBeenCalled()
    expect(consult).not.toHaveBeenCalled()
  })

  it('leaves a summary in the slot of its own, because it is not a turn at all', async () => {
    const consult = vi.fn().mockResolvedValue('They crossed the pass.')
    chatsApi.addMessage.mockReturnValue({ id: 'msg_c', role: 'assistant' })

    await commands.submit('/compact(4)', { consult })

    const [, role, content] = chatsApi.addMessage.mock.calls[0]
    expect(role).toBe('assistant')
    expect(content).toBe('')
  })

  describe('where a summary goes', () => {
    /** A chat of ordinary turns, with the new summary added at the end of it. */
    const chatOf = (...before) => {
      const rows = [...before, { id: 'msg_c', role: 'assistant' }]
      chatsApi.getMessagesForChat.mockReturnValue({ value: rows })
      chatsApi.addMessage.mockReturnValue({ id: 'msg_c', role: 'assistant' })
    }
    const turn = id => ({ id, role: 'user', content: id })
    const earlier = id => ({
      id,
      role: 'assistant',
      metadata: { command: { name: 'compact', input: '', keep: 1, result: 'They crossed.' } },
    })
    const consult = () => vi.fn().mockResolvedValue('They crossed the pass.')

    it('is above the turns it keeps, which is where it is read', async () => {
      chatOf(turn('a'), turn('b'), turn('c'), turn('d'), turn('e'))
      const asked = consult()

      await commands.submit('/compact(3)', { consult: asked })

      // Before it is asked, so the writer watches it arrive where it will stay.
      expect(chatsApi.moveMessage).toHaveBeenCalledWith('msg_c', 3)
      expect(chatsApi.moveMessage.mock.invocationCallOrder[0]).toBeLessThan(
        asked.mock.invocationCallOrder[0]
      )
    })

    it('reads no further past itself than the turns it kept', async () => {
      chatOf(turn('a'), turn('b'), turn('c'), turn('d'), turn('e'))
      const asked = consult()

      await commands.submit('/compact(3)', { consult: asked })

      expect(asked.mock.calls[0][2]).toMatchObject({ before: 'msg_c', past: 3 })
    })

    it('stays at the end when it keeps nothing', async () => {
      chatOf(turn('a'), turn('b'), turn('c'))

      await commands.submit('/compact(0)', { consult: consult() })

      expect(chatsApi.moveMessage).not.toHaveBeenCalled()
    })

    it('never goes above how the conversation opened', async () => {
      chatOf(turn('a'), turn('b'), turn('c'))
      const asked = consult()

      await commands.submit('/compact(8)', { consult: asked })

      // Two turns under the opening, so two is what it keeps — and says it
      // keeps, since that is how far past itself it reads when asked again.
      expect(chatsApi.moveMessage).toHaveBeenCalledWith('msg_c', 2)
      expect(asked.mock.calls[0][2].past).toBe(2)
      const record = chatsApi.updateMessage.mock.calls[0][1].metadata.command
      expect(record).toMatchObject({ keep: 2, param: '2' })
    })

    it('never goes above the summary before it', async () => {
      // Asked for two turns after the last one, keeping four. Above it, the
      // end of the story would be told before the middle.
      chatOf(turn('a'), turn('b'), earlier('s1'), turn('c'), turn('d'))
      const asked = consult()

      await commands.submit('/compact(4)', { consult: asked })

      expect(chatsApi.moveMessage).toHaveBeenCalledWith('msg_c', 2)
      expect(asked.mock.calls[0][2].past).toBe(2)
    })

    it('stays put right after another summary, with nothing to keep', async () => {
      chatOf(turn('a'), turn('b'), earlier('s1'))

      await commands.submit('/compact', { consult: consult() })

      expect(chatsApi.moveMessage).not.toHaveBeenCalled()
      expect(chatsApi.updateMessage.mock.calls[0][1].metadata.command.keep).toBe(0)
    })
  })

  it('streams the answer into the piece of the turn it belongs to', async () => {
    // The whole reason it is written before it can answer: the text arrives
    // where it will stay.
    const consult = vi.fn(async (prompt, tools, options) => {
      options.onContent('He is')
      options.onContent('He is waiting')
      return 'He is waiting.'
    })
    chatsApi.addMessage.mockReturnValue({ id: 'msg_i', role: 'user' })
    chatsApi.getMessageById.mockReturnValue({
      value: { id: 'msg_i', segments: [{ type: 'command', command: { name: 'interpret' } }] },
    })

    await commands.submit('/interpret What is he afraid of?', { consult })

    const said = chatsApi.writeSegment.mock.calls.map(call => call[2].result)
    expect(said).toContain('He is')
    expect(said).toContain('He is waiting')
    // At the index it was written to, with the turn assembled around it.
    expect(chatsApi.writeSegment.mock.calls.at(-1)[1]).toBe(0)
  })

  it('keeps the thinking with the answer it belongs to', async () => {
    const consult = vi.fn(async (prompt, tools, options) => {
      options.onReasoning('The player has been safe for three scenes.')
      options.onContent('He is waiting.')
      return 'He is waiting.'
    })
    chatsApi.addMessage.mockReturnValue({ id: 'msg_i', role: 'user' })
    chatsApi.getMessageById.mockReturnValue({
      value: { id: 'msg_i', segments: [{ type: 'command', command: { name: 'interpret' } }] },
    })

    await commands.submit('/interpret What is he afraid of?', { consult })

    const finished = chatsApi.writeSegment.mock.calls.at(-1)[2]
    expect(finished.reasoning).toBe('The player has been safe for three scenes.')
    // How long it thought, measured to the first word rather than the last.
    expect(finished.thought).toBeGreaterThanOrEqual(0)
    expect(finished.result).toBe('He is waiting.')
  })

  it('records a failed consultation in the turn rather than throwing it away', async () => {
    // The turn exists and the writer is looking at it. Taking it away to
    // report the failure would lose the question, which is the part worth
    // keeping — they can ask again from where it sits.
    const consult = vi.fn().mockRejectedValue(new Error('the endpoint is down'))
    chatsApi.addMessage.mockReturnValue({ id: 'msg_i', role: 'user' })
    chatsApi.getMessageById.mockReturnValue({
      value: { id: 'msg_i', segments: [{ type: 'command', command: { name: 'interpret' } }] },
    })

    await commands.submit('/interpret What is he afraid of?', { consult })

    const closed = chatsApi.writeSegment.mock.calls.at(-1)[2]
    expect(closed.pending).toBeUndefined()
    expect(closed.error).toMatch(/endpoint is down/)
    expect(closed.input).toBe('What is he afraid of?')
  })

  it('reads the conversation as it stood where the message sits', async () => {
    // Never itself, and never — asked again later — a conversation that has
    // moved on without it. An interpretation made at turn ten is about the
    // story at turn ten however many times it is asked for.
    const consult = vi.fn().mockResolvedValue('He is waiting for someone.')
    chatsApi.addMessage.mockReturnValue({ id: 'msg_i', role: 'user' })

    await commands.submit('/interpret What is he afraid of?', { consult })

    expect(consult.mock.calls[0][2].before).toBe('msg_i')
  })

  it('anchors a rerun to the same place, not to wherever the end is now', async () => {
    const consult = vi.fn().mockResolvedValue('He is waiting for someone else.')
    chatsApi.getMessageById.mockReturnValue({
      value: {
        id: 'msg_i',
        metadata: {
          command: { name: 'interpret', input: 'What is he afraid of?', result: 'x' },
        },
      },
    })

    await commands.rerun('msg_i', null, { consult })

    expect(consult.mock.calls[0][2].before).toBe('msg_i')
  })

  it('starts the clock when the question is asked, and stops it on the answer', async () => {
    // A message that is nothing but the command keeps its clock where every
    // other message with a model behind it keeps one.
    const consult = vi.fn().mockResolvedValue('They crossed the pass.')
    chatsApi.addMessage.mockReturnValue({ id: 'msg_c', role: 'assistant' })
    chatsApi.getMessageById.mockReturnValue({ value: { id: 'msg_c' } })

    await commands.submit('/compact(4)', { consult })

    const opened = chatsApi.updateMessage.mock.calls.find(call => call[1].streamingStartTime)
    expect(opened).toBeDefined()
    expect(chatsApi.updateMessage.mock.calls.at(-1)[1].thinkingFinishTime).toBeGreaterThan(0)
  })

  it('leaves an instant command out of all that', async () => {
    // Nothing thought, so nothing to show and no clock to run — and nothing to
    // fill in afterwards either, since it answered before it was written.
    await commands.submit('/oracle(likely) Is the door locked?')

    expect(chatsApi.streamMessageContent).not.toHaveBeenCalled()
    expect(chatsApi.updateMessage).not.toHaveBeenCalled()
  })

  it('refuses a consulting command with no question before writing anything', async () => {
    await expect(commands.submit('/interpret')).rejects.toMatchObject({ name: 'CommandError' })
    expect(chatsApi.addMessage).not.toHaveBeenCalled()
  })

  it('asks for no turn when the only thing submitted was an interpretation', async () => {
    const consult = vi.fn().mockResolvedValue('He is waiting for someone.')
    chatsApi.addMessage.mockReturnValue({ id: 'msg_i', role: 'user' })

    const { spoken } = await commands.submit('/interpret What is he afraid of?', { consult })

    expect(spoken).toBe('')
  })

  it('asks the same question again on a reroll, and replaces the answer', async () => {
    chatsApi.getMessageById.mockReturnValue({
      value: {
        segments: [
          {
            type: 'command',
            command: { name: 'oracle', input: 'Is the door locked?', param: 'nearly_certain' },
          },
        ],
      },
    })

    await commands.rerun('msg_1', 0)

    const [messageId, at, command, content] = chatsApi.writeSegment.mock.calls[0]
    expect(messageId).toBe('msg_1')
    expect(at).toBe(0)
    expect(command).toMatchObject({ input: 'Is the door locked?', param: 'nearly_certain' })
    // Replaced, not appended: one answer stands, not an argument between two.
    expect(content).toMatch(/^<oracle likelihood="nearly_certain">\nIs the door locked\?\n/)
    expect(chatsApi.addMessage).not.toHaveBeenCalled()
  })

  it('asks a consulting command again through a model, and shows it asking', async () => {
    // The bug this pins: rerun used to run without the context, so /interpret
    // came back "not available" instead of a second reading.
    const consult = vi.fn().mockResolvedValue('He is hiding from the pass.')
    chatsApi.getMessageById.mockReturnValue({
      value: {
        id: 'msg_i',
        segments: [
          {
            type: 'command',
            command: {
              name: 'interpret',
              input: 'What is he afraid of?',
              result: 'Something else',
            },
          },
        ],
      },
    })

    await commands.rerun('msg_i', 0, { consult })

    expect(consult).toHaveBeenCalledTimes(1)
    // Pending first, so a stale answer does not sit there looking current.
    expect(chatsApi.writeSegment.mock.calls[0][2].pending).toBe(true)
    expect(chatsApi.writeSegment.mock.calls.at(-1)[2].result).toBe('He is hiding from the pass.')
  })

  it('clears the old answer while a consultation is asked again', async () => {
    // A stale paragraph sitting there while a new one is being written says
    // the new one has not started.
    const consult = vi.fn().mockResolvedValue('He is hiding from the pass.')
    chatsApi.getMessageById.mockReturnValue({
      value: {
        metadata: {
          command: { name: 'interpret', input: 'What is he afraid of?', result: 'Something else' },
        },
      },
    })

    await commands.rerun('msg_i', null, { consult })

    expect(chatsApi.updateMessage.mock.calls[0][1].content).toBe('')
  })

  it('refuses to reroll something that is not a command', async () => {
    chatsApi.getMessageById.mockReturnValue({
      value: { content: 'I push open the door.', segments: [{ type: 'text', content: 'x' }] },
    })

    await expect(commands.rerun('msg_1')).rejects.toThrow(/not a command/i)
    await expect(commands.rerun('msg_1', 0)).rejects.toThrow(/not a command/i)
  })

  it('takes a whole segment back out, and the turn with it when it was the last', () => {
    chatsApi.getMessageById.mockReturnValue({
      value: {
        segments: [
          { type: 'text', content: 'I try the handle.' },
          { type: 'command', command: { name: 'oracle', input: 'Locked?', result: 'no' } },
        ],
      },
    })

    commands.remove('msg_1', 1)

    const [, updates] = chatsApi.updateMessage.mock.calls[0]
    expect(updates.segments).toHaveLength(1)
    expect(updates.content).toBe('I try the handle.')

    chatsApi.getMessageById.mockReturnValue({
      value: { segments: [{ type: 'text', content: 'I try the handle.' }] },
    })
    commands.remove('msg_1', 0)
    expect(chatsApi.deleteMessage).toHaveBeenCalledWith('msg_1')
  })

  describe('one message per turn', () => {
    const piece = content => ({ type: 'text', content })
    const standing = (...messages) => {
      chatsApi.getMessagesForChat.mockReturnValue({ value: messages })
    }

    it('writes into the turn the writer is already taking', async () => {
      // A turn pushed in without a reply and more written under it is one
      // turn — it reaches the model as one — so it stays one message.
      standing(
        { id: 'msg_a', role: 'assistant', content: 'It gives.' },
        { id: 'msg_u', role: 'user', segments: [piece('I try the door.')] }
      )

      await commands.submit('I step through.')

      expect(chatsApi.addMessage).not.toHaveBeenCalled()
      expect(chatsApi.writeTurn).toHaveBeenCalledWith(
        'msg_u',
        [piece('I try the door.'), piece('I step through.')],
        'I try the door.\n\nI step through.'
      )
    })

    it('starts a message of its own after somebody else spoke', async () => {
      standing({ id: 'msg_a', role: 'assistant', content: 'It gives.' })

      await commands.submit('I step through.')

      expect(chatsApi.writeTurn).not.toHaveBeenCalled()
      expect(chatsApi.addMessage).toHaveBeenCalledTimes(1)
    })

    it('fills a consultation in where it landed in the turn it joined', async () => {
      const consult = vi.fn().mockResolvedValue('He is waiting for someone.')
      const open = { id: 'msg_u', role: 'user', segments: [piece('I try the door.')] }
      standing(open)
      // As the store does it: the message's segments are replaced on the
      // message itself, so the turn read before the write has grown after it.
      chatsApi.writeTurn.mockImplementation((id, segments) => {
        open.segments = segments
      })
      chatsApi.getMessageById.mockReturnValue({
        value: {
          id: 'msg_u',
          segments: [piece('I try the door.'), { type: 'command', command: { name: 'interpret' } }],
        },
      })

      await commands.submit('/interpret What is he afraid of?', { consult })

      const [id, index, answered] = chatsApi.writeSegment.mock.calls.at(-1)
      expect(id).toBe('msg_u')
      expect(index).toBe(1)
      expect(answered.result).toBe('He is waiting for someone.')
    })

    it('fills in a consultation the summary after it closed the turn on', async () => {
      // /interpret answers into the writer's turn and /compact takes one of
      // its own, so the turn is closed before the submission ends. The answer
      // still has to land in it — and before the summary is asked, since the
      // summary reads the conversation as it stood.
      const consult = vi.fn().mockResolvedValue('He is waiting.')
      chatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_u', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_c', role: 'assistant' })
      chatsApi.getMessageById.mockImplementation(id => ({
        value:
          id === 'msg_u'
            ? { id, segments: [{ type: 'command', command: { name: 'interpret' } }] }
            : { id, metadata: { command: { name: 'compact' } } },
      }))

      await commands.submit('/interpret What is he afraid of?\n/compact(4)', { consult })

      const [id, index, answered] = chatsApi.writeSegment.mock.calls.at(-1)
      expect([id, index, answered.result]).toEqual(['msg_u', 0, 'He is waiting.'])
      expect(chatsApi.updateMessage.mock.calls.at(-1)[0]).toBe('msg_c')
    })

    it('folds the writer’s messages back together when what stood between them goes', () => {
      standing(
        { id: 'msg_u1', role: 'user', segments: [piece('I try the door.')] },
        { id: 'msg_u2', role: 'user', segments: [piece('I step through.')] }
      )

      commands.remove('msg_r', null)

      expect(chatsApi.deleteMessage).toHaveBeenCalledWith('msg_r')
      expect(chatsApi.writeTurn).toHaveBeenCalledWith(
        'msg_u1',
        [piece('I try the door.'), piece('I step through.')],
        'I try the door.\n\nI step through.'
      )
      expect(chatsApi.deleteMessage).toHaveBeenCalledWith('msg_u2')
      expect(chatsApi.updateMessage).not.toHaveBeenCalled()
    })

    it('remembers that a folded turn had been edited', () => {
      standing(
        { id: 'msg_u1', role: 'user', segments: [piece('I try the door.')] },
        { id: 'msg_u2', role: 'user', segments: [piece('I step through.')], edited: true }
      )

      commands.remove('msg_r', null)

      expect(chatsApi.writeTurn).not.toHaveBeenCalled()
      expect(chatsApi.updateMessage).toHaveBeenCalledWith('msg_u1', {
        segments: [piece('I try the door.'), piece('I step through.')],
        content: 'I try the door.\n\nI step through.',
      })
    })

    const summary = id => ({
      id,
      role: 'assistant',
      metadata: { command: { name: 'compact', input: '', keep: 1, result: 'They crossed.' } },
    })

    it('never folds the opening a summary kept into what it stands for', () => {
      // Two messages from the writer, touching, and not one turn: the first
      // is still read and the second is what the summary replaced.
      standing(
        { id: 'msg_u1', role: 'user', segments: [piece('Once upon a time.')] },
        { id: 'msg_u2', role: 'user', segments: [piece('I step through.')] },
        summary('msg_s')
      )

      commands.remove('msg_r', null)

      expect(chatsApi.writeTurn).not.toHaveBeenCalled()
      expect(chatsApi.deleteMessage).toHaveBeenCalledTimes(1)
    })

    it('leaves a summary alone whatever is taken from around it', () => {
      // Where it sits is what says what it stands for, so there is no count
      // to bring down when a message above or below it goes.
      standing(
        { id: 'msg_u1', role: 'user', segments: [piece('Once upon a time.')] },
        { id: 'msg_a1', role: 'assistant', content: 'Long ago.' },
        summary('msg_s'),
        { id: 'msg_u2', role: 'user', segments: [piece('I step through.')] },
        { id: 'msg_a2', role: 'assistant', content: 'It gives.' }
      )

      commands.remove('msg_a1', null)
      commands.remove('msg_a2', null)

      expect(chatsApi.updateMessage).not.toHaveBeenCalled()
      expect(chatsApi.deleteMessage).toHaveBeenCalledTimes(2)
    })
  })

  describe('revise', () => {
    /** A turn sitting in the chat, ready to be edited as text. */
    const standing = (...segments) => {
      chatsApi.getMessageById.mockReturnValue({ value: { id: 'msg_1', segments } })
    }

    const ran = command => ({ type: 'command', command })

    it('keeps the record of a line that came through unchanged', async () => {
      // Down to the working, which the text cannot carry: a roll's dice are
      // not recoverable from "14".
      standing(
        ran({ name: 'roll', input: '3d6+2', label: '3d6+2', detail: '4 + 4 + 4 + 2', result: '14' })
      )

      await commands.revise('msg_1', null, '/roll 3d6+2\n> 14')

      const [, updates] = chatsApi.updateMessage.mock.calls[0]
      expect(updates.segments[0].command.detail).toBe('4 + 4 + 4 + 2')
    })

    it('takes an answer the writer wrote instead of asking again', async () => {
      // Fudging a roll is allowed. It is their table.
      standing(
        ran({ name: 'oracle', input: 'Is it locked?', label: 'Is it locked?', result: 'no' })
      )

      await commands.revise('msg_1', null, '/oracle Is it locked?\n> yes')

      const [, updates] = chatsApi.updateMessage.mock.calls[0]
      expect(updates.segments[0].command.result).toBe('yes')
      expect(updates.content).toBe('<oracle>\nIs it locked?\nyes\n</oracle>')
    })

    it('asks again when the answer is cleared', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
      standing(ran({ name: 'roll', input: '2d6', label: '2d6', result: '99' }))

      await commands.revise('msg_1', null, '/roll 2d6')

      expect(chatsApi.updateMessage.mock.calls[0][1].segments[0].command.result).toBe('8')
    })

    it('takes the turn apart and puts back what was written', async () => {
      standing({ type: 'text', content: 'I try the handle.' })

      await commands.revise('msg_1', null, 'I try the handle.\n/director Wrap this up')

      const [, updates] = chatsApi.updateMessage.mock.calls[0]
      expect(updates.segments.map(segment => segment.type)).toEqual(['text', 'command'])
      expect(updates.content).toBe('I try the handle.\n\n<director>\nWrap this up\n</director>')
    })

    it('rewrites one piece and leaves the rest of the turn alone', async () => {
      standing(
        { type: 'text', content: 'I try the handle.' },
        ran({ name: 'oracle', input: 'Locked?', label: 'Locked?', result: 'no' })
      )

      await commands.revise('msg_1', 0, 'I try the handle again.')

      const [, updates] = chatsApi.updateMessage.mock.calls[0]
      expect(updates.segments).toHaveLength(2)
      expect(updates.segments[0]).toEqual({ type: 'text', content: 'I try the handle again.' })
      expect(updates.segments[1].command.result).toBe('no')
    })

    it('tells two identical questions apart by what they answered', async () => {
      // The reason the answers are written down rather than matched up
      // afterwards. Nothing else could say which "no" was which.
      standing(
        ran({ name: 'oracle', input: 'Is it locked?', label: 'Is it locked?', result: 'no' }),
        ran({ name: 'oracle', input: 'Is it locked?', label: 'Is it locked?', result: 'yes' })
      )

      await commands.revise(
        'msg_1',
        null,
        '/oracle Is it locked?\n> no\n/oracle Is it locked?\n> yes'
      )

      const [, updates] = chatsApi.updateMessage.mock.calls[0]
      expect(updates.segments.map(segment => segment.command.result)).toEqual(['no', 'yes'])
    })

    it('refuses an empty turn rather than leaving nothing behind', async () => {
      standing({ type: 'text', content: 'I try the handle.' })

      await expect(commands.revise('msg_1', null, '   ')).rejects.toThrow(/nothing there/i)
      expect(chatsApi.updateMessage).not.toHaveBeenCalled()
    })

    it('refuses what the command itself would refuse', async () => {
      standing(ran({ name: 'oracle', input: 'Is it?', result: 'yes' }))

      await expect(commands.revise('msg_1', null, '/oracle(probably) Is it?')).rejects.toThrow(
        /probably/
      )
      expect(chatsApi.updateMessage).not.toHaveBeenCalled()
    })

    it('refuses a new question for the model when there is none to ask', async () => {
      // What it is given while a reply is being written. The edit waits for
      // that; everything else about the turn would not have.
      standing({ type: 'text', content: 'I try the handle.' })

      await expect(
        commands.revise('msg_1', null, 'I try the handle.\n/interpret Is he lying?')
      ).rejects.toThrow(/busy/i)
      expect(chatsApi.updateMessage).not.toHaveBeenCalled()
    })

    it('keeps what answers alone out of a turn, and the other way round', async () => {
      standing(ran({ name: 'oracle', input: 'Is it?', result: 'yes' }))

      await expect(commands.revise('msg_1', null, '/compact(4)')).rejects.toThrow(
        /turn of its own/i
      )

      chatsApi.getMessageById.mockReturnValue({
        value: { id: 'msg_c', metadata: { command: { name: 'compact', input: '', keep: 4 } } },
      })
      await expect(commands.revise('msg_c', null, '/oracle Is it?')).rejects.toThrow(/stays a/i)
    })

    /** A summary that kept four, in a chat with plenty of room either side of it. */
    const summarised = () => {
      const summary = {
        id: 'msg_c',
        role: 'assistant',
        metadata: {
          command: { name: 'compact', input: '', param: '4', keep: 4, result: 'They crossed.' },
        },
      }
      const turns = n => Array.from({ length: n }, (_, i) => ({ id: `t${n}_${i}`, role: 'user' }))
      chatsApi.getMessageById.mockReturnValue({ value: summary })
      chatsApi.getMessagesForChat.mockReturnValue({ value: [...turns(12), summary, ...turns(6)] })
    }

    it('moves the summary without summarising again, when the count changes', async () => {
      const consult = vi.fn()
      summarised()

      await commands.revise('msg_c', null, '/compact(12) favour the mystery\n> They crossed.', {
        consult,
      })

      expect(consult).not.toHaveBeenCalled()
      expect(chatsApi.updateMessage.mock.calls[0][1].metadata.command).toMatchObject({
        keep: 12,
        result: 'They crossed.',
      })
      // It kept four and now keeps twelve: eight places further up. It read
      // those turns either way, and says what it said.
      expect(chatsApi.moveMessage).toHaveBeenCalledWith('msg_c', 8)
    })

    it('moves it only as far as there is room, and says how far that was', async () => {
      summarised()

      await commands.revise('msg_c', null, '/compact(40)\n> They crossed.', {})

      // Eleven turns between it and the opening, so fifteen is what it keeps.
      expect(chatsApi.moveMessage).toHaveBeenCalledWith('msg_c', 11)
      expect(chatsApi.updateMessage.mock.calls[0][1].metadata.command).toMatchObject({
        keep: 15,
        param: '15',
        result: 'They crossed.',
      })
    })

    it('moves it back down when the writer keeps fewer', async () => {
      summarised()

      await commands.revise('msg_c', null, '/compact(1)\n> They crossed.', {})

      expect(chatsApi.moveMessage).toHaveBeenCalledWith('msg_c', -3)
    })

    it('takes a pasted summary as written, without quotes', async () => {
      const consult = vi.fn()
      summarised()

      await commands.revise('msg_c', null, '/compact(4)\n\nThey crossed.\n\n/tarot came up.', {
        consult,
      })

      expect(consult).not.toHaveBeenCalled()
      expect(chatsApi.updateMessage.mock.calls[0][1]).toMatchObject({
        content: 'They crossed.\n\n/tarot came up.',
        metadata: { command: { name: 'compact', result: 'They crossed.\n\n/tarot came up.' } },
      })
    })

    it('leaves it where it is when only the instructions changed', async () => {
      summarised()

      await commands.revise('msg_c', null, '/compact(4) favour the mystery\n> They crossed.', {})

      expect(chatsApi.moveMessage).not.toHaveBeenCalled()
    })
  })
})
