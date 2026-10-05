import { describe, it, expect } from 'vitest'
import { obfuscateBackup, scrambleText } from '@/utils/obfuscate.js'

/** Letters that are never the ones they replace, so a change is certain. */
const shifted = () => {
  let n = 0
  return () => ((n += 7) % 26) / 26
}

describe('scrambleText', () => {
  it('replaces every letter with one of the same case and leaves the rest', () => {
    const text = 'Elara rode North: 3 days, 2 nights — *fast*.\n> said so'
    const out = scrambleText(text, shifted())

    expect(out).toHaveLength(text.length)
    expect(out).not.toBe(text)
    expect(out.replace(/[A-Za-z]/g, 'x')).toBe(text.replace(/[A-Za-z]/g, 'x'))
    for (let i = 0; i < text.length; i++) {
      if (/[A-Z]/.test(text[i])) expect(out[i]).toMatch(/[A-Z]/)
      if (/[a-z]/.test(text[i])) expect(out[i]).toMatch(/[a-z]/)
    }
  })

  it('gives an accented or caseless letter a plain one', () => {
    expect(scrambleText('Élan 東京', () => 0)).toBe('Aaaa aa')
  })
})

describe('obfuscateBackup', () => {
  const consults = command => command.name === 'interpret'
  const assemble = segments =>
    segments
      .map(s =>
        s.type === 'command'
          ? `<${s.command.name}>${s.command.input}|${s.command.result}</${s.command.name}>`
          : s.content
      )
      .join('\n\n')
  const random = shifted()

  const backup = {
    dbVersion: 14,
    scope: 'chat',
    tables: {
      chats: [
        {
          id: 'chat_1',
          storyId: 'story_1',
          title: 'The Road North',
          rules: 'Keep it grim',
          pinnedIds: ['doc_a'],
          created: 5,
        },
      ],
      messages: [
        {
          id: 'msg_1',
          chatId: 'chat_1',
          role: 'user',
          content: 'stale',
          segments: [
            { type: 'text', content: 'I try the handle.' },
            {
              type: 'command',
              command: {
                name: 'oracle',
                param: 'likely',
                input: 'Is the door locked?',
                label: 'Is the door locked?',
                result: 'yes',
                detail: 'rolled 4',
              },
            },
            {
              type: 'command',
              command: { name: 'name', param: 'female, 1', input: '', result: 'Elara Vance' },
            },
            {
              type: 'command',
              command: {
                name: 'interpret',
                input: 'How does she react?',
                result: 'She flinches.',
                reasoning: 'Fear.',
              },
            },
            {
              type: 'command',
              command: {
                name: 'Emily',
                character: true,
                input: 'I check the fridge',
                result: 'I check the fridge',
              },
            },
          ],
          created: 1,
        },
        {
          id: 'msg_2',
          chatId: 'chat_1',
          role: 'assistant',
          content: 'The door holds.',
          reasoningContent: 'Consider the hinge.',
          metadata: {
            model: 'gpt-x',
            provider: 'Local',
            apiTrajectory: [
              {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'read_document', arguments: '{"path":"notes/Elara"}' },
                  },
                ],
              },
              {
                role: 'tool',
                tool_call_id: 'call_1',
                content: '{"id":"doc_a","path":"notes/Elara","type":"text","content":"A knight."}',
                _document: 'doc_a',
              },
              { role: 'assistant', content: 'The door holds.' },
              {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_2',
                    type: 'function',
                    function: { name: 'director', arguments: '{}' },
                  },
                ],
              },
              {
                role: 'tool',
                tool_call_id: 'call_2',
                content: '{"direction":"Let it hold."}',
                _consultation: {
                  thinking: 'Weigh the hinge.',
                  calls: [
                    {
                      name: 'oracle',
                      arguments: '{"question":"Does it hold?"}',
                      result: '{"answer":"Yes"}',
                    },
                  ],
                },
              },
            ],
            documentEdits: [
              {
                id: 'e1',
                documentId: 'doc_a',
                path: 'notes/Elara',
                tool: 'edit_document',
                old: 'A knight.',
                new: 'A tired knight.',
                status: 'accepted',
              },
            ],
          },
          alternates: [{ content: 'The door gives.', metadata: null }],
          created: 2,
        },
        {
          id: 'msg_3',
          chatId: 'chat_1',
          role: 'assistant',
          content: 'They crossed the river.',
          metadata: {
            command: { name: 'compact', input: '', param: '4', result: 'They crossed the river.' },
          },
          created: 3,
        },
      ],
      aiPrompts: [{ id: 'prompt_1', name: 'Grim', prompt: 'Be grim.' }],
    },
  }

  const out = obfuscateBackup(backup, {
    consults: c => consults(c) || c.name === 'compact',
    assemble,
    random,
  })
  const [m1, m2, m3] = out.tables.messages

  it('leaves the envelope, ids, roles and timestamps alone', () => {
    expect(out.dbVersion).toBe(14)
    expect(out.scope).toBe('chat')
    expect(out.tables.chats[0]).toMatchObject({
      id: 'chat_1',
      storyId: 'story_1',
      pinnedIds: ['doc_a'],
      created: 5,
    })
    expect(m2).toMatchObject({ id: 'msg_2', chatId: 'chat_1', role: 'assistant', created: 2 })
    expect(m2.metadata).toMatchObject({ model: 'gpt-x', provider: 'Local' })
  })

  it('scrambles what a chat says about itself', () => {
    expect(out.tables.chats[0].title).not.toBe('The Road North')
    expect(out.tables.chats[0].title).toHaveLength('The Road North'.length)
    expect(out.tables.chats[0].rules).not.toBe('Keep it grim')
  })

  it('keeps a command’s name and parameter and scrambles what was asked', () => {
    const [text, oracle, name, interpret, character] = m1.segments
    expect(text.content).not.toBe('I try the handle.')
    expect(oracle.command).toMatchObject({ name: 'oracle', param: 'likely' })
    expect(oracle.command.input).not.toBe('Is the door locked?')
    expect(oracle.command.input).toHaveLength('Is the door locked?'.length)
    expect(oracle.command.label).not.toBe('Is the door locked?')
    expect(name.command).toMatchObject({ name: 'name', param: 'female, 1', input: '' })
    expect(interpret.command.name).toBe('interpret')
    expect(character.command.character).toBe(true)
    expect(character.command.name).not.toBe('Emily')
  })

  it('keeps an answer given by rule and scrambles one given in prose', () => {
    const [, oracle, name, interpret, character] = m1.segments
    expect(oracle.command.result).toBe('yes')
    expect(name.command.result).toBe('Elara Vance')
    expect(interpret.command.result).not.toBe('She flinches.')
    expect(interpret.command.reasoning).not.toBe('Fear.')
    expect(character.command.result).not.toBe('I check the fridge')
    // A message that is nothing but a summary loses the summary with it.
    expect(m3.metadata.command).toMatchObject({ name: 'compact', param: '4' })
    expect(m3.content).not.toBe('They crossed the river.')
    expect(m3.metadata.command.result).toBe(m3.content)
  })

  it('puts a turn back together from its scrambled segments', () => {
    expect(m1.content).toBe(assemble(m1.segments))
    expect(m1.content).not.toContain('handle')
    expect(m1.content).toContain('<oracle>')
  })

  it('scrambles inside the JSON of a call’s arguments and a tool’s answer, keys kept', () => {
    const [call, result, said] = m2.metadata.apiTrajectory
    expect(call.tool_calls[0]).toMatchObject({ id: 'call_1', type: 'function' })
    expect(call.tool_calls[0].function.name).toBe('read_document')
    const args = JSON.parse(call.tool_calls[0].function.arguments)
    expect(Object.keys(args)).toEqual(['path'])
    expect(args.path).not.toBe('notes/Elara')
    expect(args.path).toMatch(/^[a-z]{5}\/[A-Z][a-z]{4}$/)
    const answer = JSON.parse(result.content)
    expect(answer).toMatchObject({ id: 'doc_a', type: 'text' })
    expect(answer.content).not.toBe('A knight.')
    expect(result.tool_call_id).toBe('call_1')
    expect(result._document).toBe('doc_a')
    expect(said.content).not.toBe('The door holds.')
  })

  it('scrambles what a skill did, keeping the tools it called by name', () => {
    const consultation = m2.metadata.apiTrajectory[4]._consultation
    expect(consultation.thinking).not.toBe('Weigh the hinge.')
    const [inner] = consultation.calls
    expect(inner.name).toBe('oracle')
    expect(Object.keys(JSON.parse(inner.arguments))).toEqual(['question'])
    expect(JSON.parse(inner.arguments).question).not.toBe('Does it hold?')
    expect(Object.keys(JSON.parse(inner.result))).toEqual(['answer'])
  })

  it('scrambles what changed in a document but not where or how', () => {
    const [edit] = m2.metadata.documentEdits
    expect(edit).toMatchObject({
      id: 'e1',
      documentId: 'doc_a',
      tool: 'edit_document',
      status: 'accepted',
    })
    expect(edit.old).not.toBe('A knight.')
    expect(edit.new).not.toBe('A tired knight.')
    expect(edit.path).not.toBe('notes/Elara')
  })

  it('reaches the reasoning, the alternates and the prompt that travels with the chat', () => {
    expect(m2.reasoningContent).not.toBe('Consider the hinge.')
    expect(m2.alternates[0].content).not.toBe('The door gives.')
    expect(out.tables.aiPrompts[0].id).toBe('prompt_1')
    expect(out.tables.aiPrompts[0].prompt).not.toBe('Be grim.')
  })

  it('scrambles an answer that is the writer’s own words given back', () => {
    // A direction is recorded as its own answer. Nothing about the command
    // says so; what says so is that an answer the app drew is never the same
    // words as the question.
    const direction = 'Sam does not answer back until the next day'
    const echoed = obfuscateBackup(
      {
        tables: {
          messages: [
            {
              id: 'msg_d',
              role: 'user',
              content: `<director>\n${direction}\n</director>`,
              segments: [
                {
                  type: 'command',
                  command: { name: 'director', input: direction, result: direction },
                },
              ],
            },
            {
              id: 'msg_o',
              role: 'user',
              content: '',
              segments: [
                {
                  type: 'command',
                  command: { name: 'oracle', input: 'Locked?', label: 'Locked?', result: 'yes' },
                },
                {
                  type: 'command',
                  command: { name: 'echo', input: 'Say it', label: 'Say it', result: 'Say it' },
                },
              ],
            },
          ],
        },
      },
      { consults: () => false, assemble, random }
    )
    const [d, o] = echoed.tables.messages
    expect(d.segments[0].command.name).toBe('director')
    expect(d.segments[0].command.result).not.toBe(direction)
    expect(d.segments[0].command.result).toHaveLength(direction.length)
    expect(d.content).not.toContain('Sam')
    expect(d.content).toBe(assemble(d.segments))
    expect(o.segments[0].command.result).toBe('yes')
    expect(o.segments[1].command.result).not.toBe('Say it')
  })

  it('scrambles a field it was not told about, so nothing leaks by omission', () => {
    const leaky = obfuscateBackup(
      {
        tables: {
          messages: [
            {
              id: 'msg_9',
              role: 'user',
              content: 'said',
              afterthought: 'Not a field anyone planned for.',
              metadata: {
                director: {
                  direction: '<director>\ncontinue the story.\n</director>',
                  reasoning: 'Hm.',
                },
                note: 'plain',
                apiTrajectory: [
                  { role: 'user', content: [{ type: 'text', text: 'As parts, not a string.' }] },
                  { role: 'assistant', content: 'Said.', refusal: 'No.' },
                ],
              },
              pendingToolCalls: [
                { id: 'p1', name: 'read_document', arguments: '{"path":"notes/Elara"}' },
              ],
            },
          ],
        },
      },
      { random }
    )
    const [m] = leaky.tables.messages
    expect(m.afterthought).not.toBe('Not a field anyone planned for.')
    expect(m.metadata.director.direction).not.toContain('continue the story')
    expect(m.metadata.director.direction).toHaveLength(
      '<director>\ncontinue the story.\n</director>'.length
    )
    expect(m.metadata.note).not.toBe('plain')
    const [parts, said] = m.metadata.apiTrajectory
    expect(parts.content[0].type).toBe('text')
    expect(parts.content[0].text).not.toBe('As parts, not a string.')
    expect(said.refusal).not.toBe('No.')
    expect(m.pendingToolCalls[0]).toMatchObject({ id: 'p1', name: 'read_document' })
    expect(JSON.parse(m.pendingToolCalls[0].arguments).path).not.toBe('notes/Elara')
  })

  it('does not change what it was given', () => {
    expect(backup.tables.messages[0].segments[0].content).toBe('I try the handle.')
    expect(backup.tables.chats[0].title).toBe('The Road North')
  })
})
