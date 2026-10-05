import { describe, it, expect } from 'vitest'
import { buildContext, renderAuthorsNote } from '@/ai/context/build.js'
import { AI_DEFAULTS } from '@/ai/defaults.js'
import { textHash } from '@/ai/context/reads.js'

/**
 * @param {string} id
 * @param {string} parentId
 */
const doc = (id, parentId, extra = {}) => ({
  id,
  parentId,
  type: 'text',
  title: id,
  content: '',
  summary: '',
  order: 0,
  deleted: false,
  ...extra,
})

function makeStores({ documents = [], chat = null, messages = [] } = {}) {
  const byId = new Map(documents.map(d => [d.id, d]))
  return {
    documentsStore: {
      getDocument: id => byId.get(id) || null,
    },
    chatsStore: {
      getChatById: id => (chat && chat.id === id ? chat : null),
    },
    messagesStore: {
      getMessagesForChat: id => (chat && chat.id === id ? messages : []),
    },
  }
}

describe('buildContext', () => {
  describe('chat mode', () => {
    it('carries the system prompt and the history, and nothing else', async () => {
      const stores = makeStores({
        documents: [doc('sc1', 'manuscript_s1', { content: 'Once upon a time.' })],
        chat: { id: 'c1' },
        messages: [
          { role: 'user', content: 'first question' },
          { role: 'assistant', content: 'first answer' },
          { role: 'user', content: 'follow up' },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        documentId: 'sc1',
        chatId: 'c1',
        systemPrompt: 'You are an assistant.',
      })

      // With no project to describe there is no state block, so this is the
      // conversation and nothing else.
      expect(messages[0]).toEqual({ role: 'system', content: 'You are an assistant.' })
      expect(messages).toHaveLength(4)

      // Every user message stays exactly as the writer typed it. The current
      // document used to ride the last one.
      expect(messages[1]).toEqual({ role: 'user', content: 'first question' })
      expect(messages[2]).toEqual({ role: 'assistant', content: 'first answer' })
      expect(messages[3]).toEqual({ role: 'user', content: 'follow up' })
    })

    it('omits the system message when the prompt is empty', async () => {
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [{ role: 'user', content: 'follow up' }],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: '',
      })

      // Nothing to say beats an empty system message.
      expect(messages.every(m => m.role !== 'system')).toBe(true)
      expect(messages).toHaveLength(1)
    })

    describe('project state', () => {
      const project = {
        project: 'My Story',
        summary: 'A knight rides north.',
        size: { documents: 1, folders: 1 },
      }

      /** Build a chat with `overview` in front of it. */
      const build = async (overview, messages) =>
        (
          await buildContext('chat', makeStores({ chat: { id: 'c1' }, messages }), {
            storyId: 's1',
            chatId: 'c1',
            systemPrompt: 'You are an assistant.',
            project: overview,
          })
        ).messages

      /** The block the model is handed, parsed back out of the message. */
      const projectFrom = messages => {
        const match = messages.at(-1).content.match(/```json\n([\s\S]*?)\n```/)
        return JSON.parse(match[1])
      }

      it('puts the project in front of the writer`s latest message', async () => {
        const messages = await build(project, [{ role: 'user', content: 'who is Elara?' }])

        // One turn, not two: a second user message in a row renders wrong under
        // the chat templates local backends apply.
        expect(messages).toHaveLength(2)
        expect(messages[1].role).toBe('user')
        expect(messages[1].content).toMatch(/^<project>\n```json/)
        expect(messages[1].content.endsWith('who is Elara?')).toBe(true)
      })

      it('names the block rather than leaving the prompt to say where it sits', async () => {
        // A prompt that locates the block by position goes stale the moment
        // the turn appends anything else to the same message. Named, it can be
        // pointed at instead.
        const messages = await build(project, [{ role: 'user', content: 'who is Elara?' }])

        expect(messages[1].content).toMatch(/<\/project>\n\n---\n\nwho is Elara\?$/)
      })

      it('says the project’s name, overview and size, and lists none of it', async () => {
        const messages = await build(project, [{ role: 'user', content: 'hi' }])

        // Not the tree: the block is paid in full on every request.
        expect(projectFrom(messages)).toEqual(project)
      })

      it('says nothing about what the block is', async () => {
        // That belongs in the system prompt, which is cached. Every word here
        // is re-sent on every turn.
        const messages = await build(project, [{ role: 'user', content: 'hi' }])

        expect(messages[1].content).not.toMatch(/rebuilt|current|read_document/)
      })

      it('leaves everything before it byte for byte', async () => {
        // The whole point of the tail: the prefix is what the last request
        // sent, so a project that changed does not cost a cached turn.
        const history = [
          { role: 'user', content: 'first question' },
          { role: 'assistant', content: 'first answer' },
          { role: 'user', content: 'follow up' },
        ]
        const messages = await build(project, history)

        expect(messages.slice(0, 3)).toEqual([
          { role: 'system', content: 'You are an assistant.' },
          { role: 'user', content: 'first question' },
          { role: 'assistant', content: 'first answer' },
        ])
      })

      it('still names a project that holds nothing yet', async () => {
        // An empty project is a fact worth having. Saying nothing invites a
        // search for documents that do not exist.
        const empty = { project: 'My Story', size: { documents: 0, folders: 0 } }
        const messages = await build(empty, [{ role: 'user', content: 'hi' }])

        expect(projectFrom(messages)).toEqual(empty)
      })

      it('says nothing at all when there is no project', async () => {
        const messages = await build(null, [{ role: 'user', content: 'hi' }])

        expect(messages[1]).toEqual({ role: 'user', content: 'hi' })
      })

      it('stands on its own when the conversation does not end on the writer', async () => {
        const messages = await build(project, [{ role: 'assistant', content: 'go on' }])

        expect(messages.at(-1).role).toBe('user')
        expect(messages.at(-1).content).toMatch(/^<project>\n```json/)
      })
    })

    describe('documents the writer pinned', () => {
      const project = { project: 'My Story', size: { documents: 2, folders: 1 } }

      /** One turn from before document calls stayed, that read `documentId`. */
      const readTurn = (callId, documentId, body) => ({
        role: 'assistant',
        content: 'Read it.',
        metadata: {
          apiTrajectory: [
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: callId,
                  type: 'function',
                  function: { name: 'read_document', arguments: '{"path":"notes/Elara"}' },
                },
              ],
            },
            { role: 'tool', tool_call_id: callId, content: body, _document: documentId },
            { role: 'assistant', content: 'Read it.' },
          ],
        },
      })

      const pin = (id, path, extra = {}) => ({ id, path, type: 'text', words: 3, ...extra })

      /** Build a chat with these pins, and hand back the pieces. */
      const build = async ({ documents = [], history, pinned }) => {
        const stores = makeStores({ documents, chat: { id: 'c1' }, messages: history })
        const { messages } = await buildContext('chat', stores, {
          storyId: 's1',
          chatId: 'c1',
          systemPrompt: 'sys',
          project,
          pinned,
          keeps: name => name === 'read_document',
        })
        const match = messages.at(-1).content.match(/```json\n([\s\S]*?)\n```/)
        return { messages, block: JSON.parse(match[1]) }
      }

      const elara = doc('d_elara', 'notes', { content: 'Elara rides north.' })

      it('carries a pinned document without anyone having read it', async () => {
        const { block, messages } = await build({
          documents: [elara],
          history: [{ role: 'user', content: 'begin' }],
          pinned: [pin('d_elara', 'notes/Elara')],
        })

        // The whole point: a character's description has to be there on the
        // first turn, and a model that has to call a tool before it knows who
        // it is playing has already spent a turn not playing them. The id is
        // how the entry finds its text; it is not an address, and stays out.
        expect(block.pinned).toEqual([
          { path: 'notes/Elara', type: 'text', words: 3, content: 'Elara rides north.' },
        ])
        expect(messages.some(m => m.role === 'tool' || m.tool_calls)).toBe(false)
      })

      it('carries a document the writer pinned whole, however long it is', async () => {
        const thesis = doc('d_thesis', 'notes', { content: 'word '.repeat(12000) })
        const { block } = await build({
          documents: [thesis],
          history: [{ role: 'user', content: 'begin' }],
          pinned: [pin('d_thesis', 'notes/Thesis', { words: 12000 })],
        })

        expect(block.pinned[0].content).toBe('word '.repeat(12000))
        expect(block.pinned[0]).not.toHaveProperty('note')
      })

      it('says what a pinned document says now, not when it was pinned', async () => {
        const { block } = await build({
          documents: [doc('d_elara', 'notes', { content: 'Elara turned back.' })],
          history: [{ role: 'user', content: 'begin' }],
          pinned: [pin('d_elara', 'notes/Elara')],
        })

        expect(block.pinned[0].content).toBe('Elara turned back.')
      })

      it('ignores a pin on a folder, or on a document that is gone', async () => {
        // Folders are expanded before they get here, and a deleted document is
        // a pin the writer already answered. Neither is an error worth raising
        // at a turn that is trying to be taken.
        const { block } = await build({
          documents: [doc('d_notes', '/', { type: 'folder' })],
          history: [{ role: 'user', content: 'begin' }],
          pinned: [pin('d_notes', 'notes', { type: 'folder' }), pin('d_deleted', 'notes/Gone')],
        })

        expect(block).not.toHaveProperty('pinned')
      })

      it('states a pinned document once, and as it is now, however often it was read', async () => {
        const { block } = await build({
          documents: [elara],
          history: [
            { role: 'user', content: 'who is Elara?' },
            readTurn('T1', 'd_elara', '{"content":"rides south"}'),
            { role: 'user', content: 'again?' },
            readTurn('T2', 'd_elara', '{"content":"second copy"}'),
            { role: 'user', content: 'and now?' },
          ],
          pinned: [pin('d_elara', 'notes/Elara')],
        })

        expect(block.pinned).toHaveLength(1)
        expect(block.pinned[0].content).toBe('Elara rides north.')
      })

      it('sends nothing of a read made before document calls stayed', async () => {
        const { messages } = await build({
          documents: [elara],
          history: [
            { role: 'user', content: 'who is Elara?' },
            readTurn('T1', 'd_elara', '{"path":"notes/Elara","content":"Elara rides south."}'),
            { role: 'user', content: 'and now?' },
          ],
        })

        // An old turn goes back as it did: what it said, and nothing of the read,
        // so an old chat does not grow by every read it ever made.
        expect(messages[2]).toEqual({ role: 'assistant', content: 'Read it.' })
        expect(messages.some(m => m.role === 'tool' || m.tool_calls)).toBe(false)
        expect(JSON.stringify(messages)).not.toContain('_document')
        expect(JSON.stringify(messages)).not.toContain('rides south')
      })

      it('leaves a consultation’s reads to the consultation', async () => {
        // Not the model's turn: what a skill looked up on the way to its answer
        // is its own, kept turn or not.
        const consulted = readTurn('T1', 'd_elara', '{"content":"rides south"}')
        consulted.metadata.documentCallsKept = true
        consulted.metadata.command = { name: 'interpret', input: 'How does she react?' }
        const { messages } = await build({
          documents: [elara],
          history: [
            { role: 'user', content: 'who is Elara?' },
            consulted,
            { role: 'user', content: 'and now?' },
          ],
        })

        expect(messages.some(m => m.role === 'tool' || m.tool_calls)).toBe(false)
        expect(JSON.stringify(messages)).not.toContain('rides south')
      })
    })

    describe('document calls a turn keeps', () => {
      const project = { project: 'My Story', size: { documents: 1, folders: 0 } }
      const docs = name => name === 'read_document' || name === 'search_documents'

      /** A turn that read Elara, as she read then, and then said `content`. */
      const readTurn = (callId, text, { kept = true } = {}) => ({
        role: 'assistant',
        content: 'Read it.',
        metadata: {
          ...(kept ? { documentCallsKept: true } : {}),
          apiTrajectory: [
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: callId,
                  type: 'function',
                  function: { name: 'read_document', arguments: '{"path":"notes/Elara"}' },
                },
              ],
            },
            {
              role: 'tool',
              tool_call_id: callId,
              content: `{"content":"${text}"}`,
              _document: 'd_elara',
              _path: 'notes/Elara',
              _hash: textHash(text),
            },
            { role: 'assistant', content: 'Read it.' },
          ],
        },
      })

      const build = async (history, opts = {}) =>
        (
          await buildContext('chat', makeStores({ chat: { id: 'c1' }, messages: history }), {
            storyId: 's1',
            chatId: 'c1',
            systemPrompt: 'sys',
            project,
            keeps: docs,
            ...opts,
          })
        ).messages

      const projectFrom = messages =>
        JSON.parse(messages.at(-1).content.match(/```json\n([\s\S]*?)\n```/)[1])

      it('sends a kept turn’s reads back where they were made, however old', async () => {
        const messages = await build([
          { role: 'user', content: 'Who is Elara?' },
          readTurn('r1', 'A knight.'),
          { role: 'user', content: 'two' },
          { role: 'assistant', content: 'Second.' },
          { role: 'user', content: 'three' },
          { role: 'assistant', content: 'Third.' },
          { role: 'user', content: 'four' },
        ])

        const at = messages.findIndex(m => m.role === 'tool')
        expect(messages[at - 1].tool_calls[0].function.name).toBe('read_document')
        expect(messages[at]).toEqual({
          role: 'tool',
          tool_call_id: 'r1',
          content: '{"content":"A knight."}',
        })
        // Where it was made: right after the question it answered.
        expect(messages[at - 2].content).toBe('Who is Elara?')
      })

      it('sends nothing back for a turn from before calls were kept', async () => {
        const messages = await build([
          { role: 'user', content: 'Who is Elara?' },
          readTurn('r1', 'A knight.', { kept: false }),
          { role: 'user', content: 'go on' },
        ])

        expect(messages.some(m => m.role === 'tool')).toBe(false)
      })

      it('says in the block which reads have changed since', async () => {
        const history = [
          { role: 'user', content: 'Who is Elara?' },
          readTurn('r1', 'A knight.'),
          { role: 'user', content: 'go on' },
        ]

        const edited = await build(history, {
          locate: () => ({ path: 'notes/Elara', text: 'A queen.' }),
        })
        expect(projectFrom(edited).changed).toEqual([{ path: 'notes/Elara', since: 'edited' }])

        const same = await build(history, {
          locate: () => ({ path: 'notes/Elara', text: 'A knight.' }),
        })
        expect(projectFrom(same).changed).toBeUndefined()
      })

      it('tells a reader of the transcript nothing of reads it cannot see', async () => {
        const messages = await build(
          [{ role: 'user', content: 'Who is Elara?' }, readTurn('r1', 'A knight.')],
          { transcript: { user: 'writer', assistant: 'assistant' }, locate: () => null }
        )

        expect(messages.at(-1).content).not.toContain('changed')
      })
    })

    describe('tool calls of recent turns', () => {
      /** A call to `name` and its answer, as one iteration of a turn stores them. */
      const called = (id, name, args, answer, extra = {}) => [
        {
          role: 'assistant',
          content: 'Let me see.',
          tool_calls: [{ id, type: 'function', function: { name, arguments: args } }],
          reasoning_details: [{ type: 'reasoning.text', text: 'hm', index: 0 }],
        },
        { role: 'tool', tool_call_id: id, content: answer, ...extra },
      ]

      /** A turn that made the given calls and then said `content`. */
      const turn = (content, ...calls) => ({
        role: 'assistant',
        content,
        metadata: { apiTrajectory: [...calls.flat(), { role: 'assistant', content }] },
      })

      const oracle = (id, answer = '"yes"') =>
        called(id, 'oracle', '{"question":"Is it locked?","likelihood":"likely"}', answer)

      const dice = name => name === 'oracle' || name === 'roll_dice'

      const build = async (messages, opts = {}) => {
        const stores = makeStores({ chat: { id: 'c1' }, messages })
        return (
          await buildContext('chat', stores, {
            storyId: 's1',
            chatId: 'c1',
            systemPrompt: 'sys',
            replays: dice,
            ...opts,
          })
        ).messages
      }

      it('sends the calls back without their words, and the words as they read now', async () => {
        const messages = await build([
          { role: 'user', content: 'I try the door.' },
          turn('Let me see.It is locked.', oracle('T1')),
          { role: 'user', content: 'I kick it.' },
        ])

        expect(messages.slice(1)).toEqual([
          { role: 'user', content: 'I try the door.' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'T1',
                type: 'function',
                function: {
                  name: 'oracle',
                  arguments: '{"question":"Is it locked?","likelihood":"likely"}',
                },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'T1', content: '"yes"' },
          { role: 'assistant', content: 'Let me see.It is locked.' },
          { role: 'user', content: 'I kick it.' },
        ])
      })

      it('sends an edited turn as edited, calls and all', async () => {
        const messages = await build([
          { role: 'user', content: 'I try the door.' },
          {
            ...turn('It is locked.', oracle('T1')),
            content: 'It is stuck, not locked.',
            edited: true,
          },
        ])

        expect(messages.at(-1)).toEqual({ role: 'assistant', content: 'It is stuck, not locked.' })
        expect(messages.some(m => m.tool_calls)).toBe(true)
        expect(JSON.stringify(messages)).not.toContain('It is locked.')
      })

      it('leaves out the calls not worth replaying, result and all', async () => {
        const read = called(
          'T2',
          'read_document',
          '{"path":"notes/Elara"}',
          '{"content":"Elara rides south."}',
          { _document: 'd_elara' }
        )
        const messages = await build([
          { role: 'user', content: 'go' },
          turn('Said.', oracle('T1'), read),
        ])

        const calls = messages.filter(m => m.tool_calls).flatMap(m => m.tool_calls)
        expect(calls.map(call => call.function.name)).toEqual(['oracle'])
        expect(messages.filter(m => m.role === 'tool').map(m => m.tool_call_id)).toEqual(['T1'])
        expect(JSON.stringify(messages)).not.toContain('rides south')
        expect(JSON.stringify(messages)).not.toContain('_document')
        expect(JSON.stringify(messages)).not.toContain('reasoning')
      })

      it('keeps only the calls worth replaying out of a mixed entry', async () => {
        // One iteration can call several tools at once. The entry stays, with
        // the ones asked for; the others go with their results.
        const messages = await build([
          { role: 'user', content: 'go' },
          turn('Said.', [
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'T1',
                  type: 'function',
                  function: { name: 'read_document', arguments: '{}' },
                },
                { id: 'T2', type: 'function', function: { name: 'oracle', arguments: '{}' } },
              ],
            },
            { role: 'tool', tool_call_id: 'T1', content: '{"content":"..."}' },
            { role: 'tool', tool_call_id: 'T2', content: '"no"' },
          ]),
        ])

        const calling = messages.find(m => m.tool_calls)
        expect(calling.tool_calls.map(call => call.id)).toEqual(['T2'])
        expect(messages.filter(m => m.role === 'tool').map(m => m.tool_call_id)).toEqual(['T2'])
      })

      it('replays only the latest turns, and every turn when told 0', async () => {
        const history = [
          { role: 'user', content: 'one' },
          turn('First.', oracle('T1')),
          { role: 'user', content: 'two' },
          turn('Second.', oracle('T2')),
          { role: 'user', content: 'three' },
          turn('Third.', oracle('T3')),
        ]

        const replayedIn = messages =>
          messages.filter(m => m.role === 'tool').map(m => m.tool_call_id)

        expect(replayedIn(await build(history, { replayTurns: 2 }))).toEqual(['T2', 'T3'])
        expect(replayedIn(await build(history, { replayTurns: 0 }))).toEqual(['T1', 'T2', 'T3'])
        // The older turn still says what it said.
        expect((await build(history, { replayTurns: 1 })).map(m => m.content)).toContain('First.')
      })

      it('has a default reach when nothing has said', async () => {
        const history = []
        for (let i = 1; i <= AI_DEFAULTS.replayTurns + 2; i++) {
          history.push({ role: 'user', content: `${i}` }, turn(`Turn ${i}.`, oracle(`T${i}`)))
        }

        const replayed = (await build(history)).filter(m => m.role === 'tool')
        expect(replayed).toHaveLength(AI_DEFAULTS.replayTurns)
        expect(replayed[0].tool_call_id).toBe('T3')
      })

      it('does not count a consulting command as a turn the assistant took', async () => {
        const messages = await build(
          [
            { role: 'user', content: 'one' },
            turn('First.', oracle('T1')),
            {
              role: 'assistant',
              content: 'A reading.',
              metadata: { command: { name: 'interpret', input: 'why?', result: 'A reading.' } },
            },
          ],
          { replayTurns: 1 }
        )

        expect(messages.filter(m => m.role === 'tool').map(m => m.tool_call_id)).toEqual(['T1'])
      })

      it('replays nothing when nothing is worth it', async () => {
        const messages = await build(
          [{ role: 'user', content: 'go' }, turn('Said.', oracle('T1'))],
          { replays: undefined }
        )

        expect(messages.some(m => m.tool_calls || m.role === 'tool')).toBe(false)
        expect(messages.at(-1)).toEqual({ role: 'assistant', content: 'Said.' })
      })

      it('never folds a pushed turn into one carrying calls', async () => {
        // The result after the calling entry answers it by id, and the entry
        // has no words for a fold to join — it would be "pushed\n\nnull".
        const messages = await build([
          { role: 'user', content: 'go' },
          { role: 'assistant', content: 'pushed' },
          turn('one', oracle('T1')),
        ])

        expect(messages.filter(m => m.role === 'assistant')).toEqual([
          { role: 'assistant', content: 'pushed' },
          expect.objectContaining({ content: null }),
          { role: 'assistant', content: 'one' },
        ])
      })
    })

    it('throws when storyId missing', async () => {
      const stores = makeStores()
      await expect(
        buildContext('chat', stores, { systemPrompt: '', chatId: 'c1', storyId: '' })
      ).rejects.toThrow('storyId is required')
    })

    it('sends an assistant turn as what it said, whatever it called on the way', async () => {
      const trajectory = [
        {
          role: 'assistant',
          content: 'Let me look that up.',
          tool_calls: [
            {
              id: 'T1',
              type: 'function',
              function: { name: 'read_document', arguments: '{"path":"notes/Sarah"}' },
            },
          ],
          reasoning_details: [{ type: 'reasoning.text', text: 'thinking...', index: 0 }],
        },
        {
          role: 'tool',
          tool_call_id: 'T1',
          content: '{"name":"Sarah","content":"The protagonist."}',
        },
        { role: 'assistant', content: 'Sarah is the protagonist.' },
      ]
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [
          { role: 'user', content: 'Tell me about Sarah' },
          {
            role: 'assistant',
            content: 'Let me look that up.Sarah is the protagonist.',
            metadata: { apiTrajectory: trajectory },
          },
          { role: 'user', content: 'thanks' },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
      })

      // system + user + assistant + user. The call, its result and the
      // reasoning are the turn's record, not the next request's.
      expect(messages).toHaveLength(4)
      expect(messages[1]).toEqual({ role: 'user', content: 'Tell me about Sarah' })
      expect(messages[2]).toEqual({
        role: 'assistant',
        content: 'Let me look that up.Sarah is the protagonist.',
      })
      expect(messages[3]).toEqual({ role: 'user', content: 'thanks' })
    })

    it('sends an edited assistant turn as it reads now, not as it was first written', async () => {
      // An edit lands in content and nowhere else. Replayed from its
      // trajectory, the turn went back as the model first wrote it, and the
      // writer's correction was shown to them and to nobody else.
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [
          { role: 'user', content: 'Tell me about Sarah' },
          {
            role: 'assistant',
            content: 'Sarah is the antagonist.',
            edited: true,
            metadata: {
              apiTrajectory: [{ role: 'assistant', content: 'Sarah is the protagonist.' }],
            },
          },
          { role: 'user', content: 'thanks' },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
      })

      expect(messages[2]).toEqual({ role: 'assistant', content: 'Sarah is the antagonist.' })
      expect(JSON.stringify(messages)).not.toContain('protagonist')
    })

    it('hands a reader with no part in it a transcript, not a conversation', async () => {
      // Asked for the next assistant turn after a history of assistant turns,
      // a skill writes the next one — in the voice it was told not to use. A
      // transcript leaves the assistant slot empty and nothing to continue.
      // The calls in it are the Game Master's, so they do not go in either.
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [
          { role: 'user', content: 'Tell me about Sarah' },
          {
            role: 'assistant',
            content: 'Let me look that up.Sarah is the protagonist.',
            metadata: {
              apiTrajectory: [
                {
                  role: 'assistant',
                  content: 'Let me look that up.',
                  tool_calls: [{ id: 'T1', type: 'function', function: { name: 'read_document' } }],
                },
                { role: 'tool', tool_call_id: 'T1', content: '{}' },
                { role: 'assistant', content: 'Sarah is the protagonist.' },
              ],
            },
          },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
        transcript: { user: 'player', assistant: 'game_master' },
      })

      expect(messages).toHaveLength(2)
      expect(messages[1].role).toBe('user')
      expect(messages[1].content).toBe(
        '<transcript>\n' +
          '<player>\nTell me about Sarah\n</player>\n' +
          '<game_master>\nLet me look that up.Sarah is the protagonist.\n</game_master>\n' +
          '</transcript>'
      )
      expect(messages.some(m => m.role === 'assistant')).toBe(false)
      expect(messages.some(m => m.role === 'tool')).toBe(false)
      expect(messages[1].content).not.toContain('read_document')
    })

    it('sends a turn as the one message it was written as', async () => {
      // The pieces are the writer's side of it. What the model reads was
      // assembled when the turn was written; see assembleTurn.
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [
          {
            role: 'user',
            content: '<cody>\nI hide.\n</cody>\n\nThe closet smells of cedar.',
            segments: [
              {
                type: 'command',
                command: { name: 'cody', input: 'I hide.', result: 'I hide.', character: true },
              },
              { type: 'text', content: 'The closet smells of cedar.' },
            ],
          },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
      })

      expect(messages[1]).toEqual({
        role: 'user',
        content: '<cody>\nI hide.\n</cody>\n\nThe closet smells of cedar.',
      })
    })

    it('tags a command on the way out, in whichever voice it answered', async () => {
      // The message holds the answer alone, which is what lets a consultation
      // stream into it. The tag naming what answered goes on here.
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [
          {
            role: 'user',
            content: 'no',
            metadata: {
              command: { name: 'oracle', input: '', label: 'Is the door locked?', result: 'no' },
            },
          },
          {
            role: 'assistant',
            content: 'He is waiting for someone.',
            metadata: {
              command: {
                name: 'interpret',
                input: '',
                label: 'What is he afraid of?',
                result: 'He is waiting for someone.',
              },
            },
          },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
      })

      expect(messages[1]).toEqual({
        role: 'user',
        content: '<oracle>\nIs the door locked?\nno\n</oracle>',
      })
      expect(messages[2]).toEqual({
        role: 'assistant',
        content: '<interpret>\nWhat is he afraid of?\nHe is waiting for someone.\n</interpret>',
      })
    })

    it('sends nothing for a command that never answered anything', async () => {
      // Neither a question nor an answer is nothing to say, and an empty pair
      // of tags is worse than silence.
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [
          { role: 'user', content: 'I open the door.' },
          {
            role: 'user',
            content: '',
            metadata: { command: { name: 'director', input: '', result: '', error: 'no model' } },
          },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
      })

      expect(messages).toHaveLength(2)
      expect(messages[1]).toEqual({ role: 'user', content: 'I open the door.' })
    })

    it('leaves a turn of nothing but tools under their tags, not the writer’s name', async () => {
      // Three tools and nothing said is nobody speaking. A turn with words in
      // it as well is the writer's, tools and all.
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [
          {
            role: 'user',
            content: '<oracle>\nLocked?\nno\n</oracle>',
            segments: [
              {
                type: 'command',
                command: { name: 'oracle', input: 'Locked?', label: 'Locked?', result: 'no' },
              },
            ],
          },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
        transcript: { user: 'player', assistant: 'game_master' },
      })

      expect(messages[1].content).toContain('<oracle>\nLocked?\nno\n</oracle>')
      expect(messages[1].content).not.toContain('<player>')
    })

    it("leaves a command under its own tag rather than the writer's name", async () => {
      // It is not the writer speaking — it is what the dice said when they
      // asked. Wrapping it in their name would claim otherwise.
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [
          { role: 'user', content: 'I try the door.' },
          {
            role: 'user',
            // The message holds the answer; the tag goes on here.
            content: 'yes',
            metadata: {
              command: { name: 'oracle', input: '', label: 'Is the door locked?', result: 'yes' },
            },
          },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
        transcript: { user: 'player', assistant: 'game_master' },
      })

      expect(messages[1].content).toContain('<player>\nI try the door.\n</player>')
      expect(messages[1].content).toContain('<oracle>\nIs the door locked?\nyes\n</oracle>')
      expect(messages[1].content).not.toContain('<player>\n<oracle>')
    })

    it('puts the project after the transcript, where a growing record leaves it', async () => {
      // Before it, the block would sit in front of every cached token and
      // break the whole prefix on a turn that changed nothing else.
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [{ role: 'user', content: 'hi' }],
        documents: [{ id: 'd1', path: 'notes', type: 'text', title: 'notes' }],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
        project: { project: 'My Story', size: { documents: 0, folders: 0 } },
        transcript: { user: 'player', assistant: 'game_master' },
      })

      expect(messages[1].content).toMatch(/^<transcript>/)
      expect(messages[1].content).toMatch(/<\/transcript>\n\n---\n\n<project>/)
    })

    it('says nothing about a read when there is no project block either', async () => {
      // A chat with the project switched off is a plain conversation. What the
      // model read is in no block and in no request: it is whatever the turn
      // made of it, and nothing else.
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [
          { role: 'user', content: 'What does chapter one say?' },
          {
            role: 'assistant',
            content: 'It opens on the pass.',
            metadata: {
              apiTrajectory: [
                {
                  role: 'assistant',
                  content: null,
                  tool_calls: [{ id: 'T1', type: 'function', function: { name: 'read_document' } }],
                },
                {
                  role: 'tool',
                  tool_call_id: 'T1',
                  content: '{"text":"Snow, and the road under it."}',
                  _document: 'd1',
                },
                { role: 'assistant', content: 'It opens on the pass.' },
              ],
            },
          },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
      })

      expect(messages.at(-1)).toEqual({ role: 'assistant', content: 'It opens on the pass.' })
      expect(messages.some(m => (m.content || '').includes('<project>'))).toBe(false)
      expect(JSON.stringify(messages)).not.toContain('Snow')
    })

    it('folds a run of writer turns into the one turn they are', async () => {
      // Three oracles before saying anything is three messages, so each can be
      // shown, rerolled and deleted on its own. Sent as three user turns in a
      // row, the chat templates local backends apply render them wrong.
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [
          { role: 'user', content: '<oracle>\nIs the door locked?\nyes\n</oracle>' },
          { role: 'user', content: '<oracle>\nCan they pick it?\nexceptional no\n</oracle>' },
          { role: 'user', content: 'I try the handle anyway.' },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
      })

      expect(messages).toHaveLength(2)
      expect(messages[1]).toEqual({
        role: 'user',
        content:
          '<oracle>\nIs the door locked?\nyes\n</oracle>\n\n' +
          '<oracle>\nCan they pick it?\nexceptional no\n</oracle>\n\n' +
          'I try the handle anyway.',
      })
    })

    it('folds a run of pushed turns in the assistant voice', async () => {
      // The other way a run happens: the writer writes the opening themselves,
      // a paragraph at a time, so each can be reworked on its own. The same
      // templates render two assistant turns in a row just as wrong.
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: 'Snow on the road.' },
          { role: 'assistant', content: 'The inn is dark.' },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
      })

      expect(messages).toHaveLength(3)
      expect(messages[2]).toEqual({
        role: 'assistant',
        content: 'Snow on the road.\n\nThe inn is dark.',
      })
    })

    it('folds a pushed turn into the next when nothing of it is replayed', async () => {
      // A call is answered by id by the result after it, and a turn folded
      // into another used to leave a call nothing answered. Nothing is called
      // on the wire now, so what was said folds the same whoever said it.
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: 'pushed' },
          {
            role: 'assistant',
            content: 'one',
            metadata: {
              apiTrajectory: [
                {
                  role: 'assistant',
                  content: null,
                  tool_calls: [{ id: 'T1', type: 'function', function: { name: 'oracle' } }],
                },
                { role: 'tool', tool_call_id: 'T1', content: '"yes"' },
                { role: 'assistant', content: 'one' },
              ],
            },
          },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
      })

      expect(messages.filter(m => m.role === 'assistant')).toEqual([
        { role: 'assistant', content: 'pushed\n\none' },
      ])
    })

    it('reads the summary in place of the turns it stands in for', async () => {
      // Every reader of a conversation agrees on what the conversation is: the
      // turn, a skill consulted inside it, and the next compaction alike.
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [
          { id: 'm1', role: 'assistant', content: 'the greeting' },
          { id: 'm2', role: 'user', content: 'we set out' },
          { id: 'm3', role: 'assistant', content: 'the road climbs' },
          {
            id: 's1',
            role: 'assistant',
            content: 'They crossed the pass.',
            metadata: {
              command: { name: 'compact', input: '', result: 'They crossed the pass.', keep: 2 },
            },
          },
          { id: 'm4', role: 'user', content: 'we make camp' },
          { id: 'm5', role: 'assistant', content: 'snow, all night' },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
      })

      // How it opened, then the summary where it sits, then the turns it was
      // put above. What it stands for is gone; nothing of it is quoted.
      const sent = messages.map(message => message.content).join('\n---\n')
      expect(sent).not.toContain('we set out')
      expect(sent).not.toContain('the road climbs')
      expect(sent.indexOf('the greeting')).toBeLessThan(sent.indexOf('They crossed the pass.'))
      expect(sent.indexOf('They crossed the pass.')).toBeLessThan(sent.indexOf('we make camp'))
      expect(sent).toContain('snow, all night')
    })

    it('reads the conversation as it stood before a message that is asking about it', async () => {
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [
          { id: 'm1', role: 'user', content: 'we set out' },
          { id: 'm2', role: 'assistant', content: 'the road climbs' },
          { id: 'q1', role: 'user', content: '<interpret>\nWhat is out there?\n</interpret>' },
          { id: 'm3', role: 'user', content: 'written after' },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
        transcript: { user: 'player', assistant: 'game_master' },
        before: 'q1',
      })

      expect(messages[1].content).toContain('we set out')
      expect(messages[1].content).not.toContain('What is out there?')
      expect(messages[1].content).not.toContain('written after')
    })

    it('narrows nothing when the message it was told to stop at is gone', async () => {
      // Reading none of the conversation is worse than reading all of it.
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [{ id: 'm1', role: 'user', content: 'we set out' }],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
        transcript: { user: 'player', assistant: 'game_master' },
        before: 'deleted',
      })

      expect(messages[1].content).toContain('we set out')
    })

    it('reads a little past a summary that is asking, and no further', async () => {
      // A summary sits above the turns it kept and read them too. Asked again
      // once the conversation has moved on, it reads what it read the first
      // time: itself left out, the turns it kept, and nothing since.
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [
          { id: 'm1', role: 'assistant', content: 'the greeting' },
          { id: 'm2', role: 'user', content: 'we set out' },
          {
            id: 's1',
            role: 'assistant',
            content: '',
            metadata: {
              command: { name: 'compact', input: '', keep: 2, result: '', pending: true },
            },
          },
          { id: 'm3', role: 'assistant', content: 'the road climbs' },
          { id: 'm4', role: 'user', content: 'still walking' },
          { id: 'm5', role: 'assistant', content: 'written since' },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
        transcript: { user: 'player', assistant: 'game_master' },
        before: 's1',
        past: 2,
      })

      expect(messages[1].content).toContain('the greeting')
      expect(messages[1].content).toContain('we set out')
      expect(messages[1].content).toContain('the road climbs')
      expect(messages[1].content).toContain('still walking')
      expect(messages[1].content).not.toContain('written since')
    })

    it('shows the next summary what the chat is sent: the opening, the last summary, the rest', async () => {
      // The last summary, so that it can be carried forward; and only the last,
      // since the one before it was carried into it already.
      const summaryOf = (id, result, extra = {}) => ({
        id,
        role: 'assistant',
        content: result,
        metadata: { command: { name: 'compact', input: '', keep: 1, result, ...extra } },
      })
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [
          { id: 'm1', role: 'assistant', content: 'the greeting' },
          { id: 'm2', role: 'user', content: 'we set out' },
          summaryOf('s0', 'They left the village.'),
          { id: 'm3', role: 'assistant', content: 'the road climbs' },
          summaryOf('s1', 'They left the village and crossed the pass.'),
          { id: 'm4', role: 'user', content: 'we make camp' },
          summaryOf('s2', '', { pending: true }),
          { id: 'm5', role: 'assistant', content: 'snow, all night' },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
        transcript: { user: 'player', assistant: 'game_master' },
        before: 's2',
        past: 1,
      })

      const read = messages[1].content
      expect(read).toContain('the greeting')
      expect(read).toContain('They left the village and crossed the pass.')
      expect(read).not.toContain('<summary>\nThey left the village.\n')
      expect(read).not.toContain('we set out')
      expect(read).not.toContain('the road climbs')
      expect(read).toContain('we make camp')
      expect(read).toContain('snow, all night')
    })

    it('sends a plain assistant turn as its content', async () => {
      const stores = makeStores({
        chat: { id: 'c1' },
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
      })

      const { messages } = await buildContext('chat', stores, {
        storyId: 's1',
        chatId: 'c1',
        systemPrompt: 'sys',
      })

      expect(messages).toHaveLength(3)
      expect(messages[2]).toEqual({ role: 'assistant', content: 'hello' })
    })

    describe('skills a turn loaded', () => {
      /** A turn that loaded `name` with `use_skill`, and then said `content`. */
      const loaded = (id, name, content = 'Noted.', extra = {}) => ({
        id: `m_${id}`,
        role: 'assistant',
        content,
        metadata: {
          apiTrajectory: [
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id,
                  type: 'function',
                  function: { name: 'use_skill', arguments: JSON.stringify({ name }) },
                },
              ],
            },
            {
              role: 'tool',
              tool_call_id: id,
              content: JSON.stringify({ name, instructions: `Follow ${name}.` }),
              ...extra,
            },
            { role: 'assistant', content },
          ],
        },
      })

      /** The writer's turn that loaded `name` by typing it. */
      const typed = (id, name, extra = {}) => ({
        id: `m_${id}`,
        role: 'user',
        content: `<${name}>\nFollow ${name}.\n</${name}>`,
        segments: [
          {
            type: 'command',
            command: {
              name,
              input: '',
              prompt: true,
              load: true,
              result: `Follow ${name}.`,
              ...extra,
            },
          },
        ],
      })

      const summary = {
        id: 'm_summary',
        role: 'assistant',
        content: '',
        metadata: { command: { name: 'compact', input: '', result: 'They met.', keep: 0 } },
      }

      const build = async (messages, opts = {}) => {
        const stores = makeStores({ chat: { id: 'c1' }, messages })
        return (
          await buildContext('chat', stores, {
            storyId: 's1',
            chatId: 'c1',
            systemPrompt: 'sys',
            replays: name => name === 'oracle',
            replayTurns: 1,
            ...opts,
          })
        ).messages
      }

      const results = messages => messages.filter(m => m.role === 'tool').map(m => m.tool_call_id)

      it('sends a load back where it was made, however many turns ago', async () => {
        const messages = await build([
          { role: 'user', content: 'Use the house style.' },
          loaded('L1', 'house-style'),
          { role: 'user', content: 'two' },
          { role: 'assistant', content: 'Second.' },
          { role: 'user', content: 'three' },
          { role: 'assistant', content: 'Third.' },
        ])

        // Outside the one-turn window the dice are held to.
        expect(results(messages)).toEqual(['L1'])
        expect(messages.findIndex(m => m.role === 'tool')).toBe(3)
      })

      it('sends a load back even when nothing else is replayed', async () => {
        const messages = await build(
          [{ role: 'user', content: 'go' }, loaded('L1', 'house-style')],
          { replays: undefined }
        )

        expect(results(messages)).toEqual(['L1'])
      })

      it('sends a dropped load back where it was made, as it was', async () => {
        const messages = await build([
          { role: 'user', content: 'go' },
          loaded('L1', 'house-style', 'Noted.', { _dropped: true }),
        ])

        // Nothing above the next summary changes, so the cached prefix holds.
        expect(results(messages)).toEqual(['L1'])
        expect(messages.at(-1)).toEqual({ role: 'assistant', content: 'Noted.' })
      })

      it('carries a load a summary stands in for to just under it', async () => {
        const messages = await build([
          { role: 'user', content: 'opening' },
          { role: 'assistant', content: 'Hello.' },
          { role: 'user', content: 'Use the house style.' },
          loaded('L1', 'house-style'),
          summary,
          { role: 'user', content: 'Go on.' },
        ])

        const at = messages.findIndex(m => m.content === '<summary>\nThey met.\n</summary>')
        expect(at).toBeGreaterThan(0)
        expect(messages[at + 1]).toEqual({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'L1',
              type: 'function',
              function: { name: 'use_skill', arguments: '{"name":"house-style"}' },
            },
          ],
        })
        expect(messages[at + 2]).toMatchObject({ role: 'tool', tool_call_id: 'L1' })
        expect(JSON.stringify(messages)).not.toContain('Use the house style.')
      })

      it('carries the writer’s loads under it as what they typed', async () => {
        const messages = await build([
          { role: 'user', content: 'opening' },
          { role: 'assistant', content: 'Hello.' },
          typed('W1', 'tighten'),
          { role: 'assistant', content: 'Tight.' },
          summary,
          { role: 'user', content: 'Go on.' },
        ])

        const at = messages.findIndex(m => m.content === '<summary>\nThey met.\n</summary>')
        // Joined to the writer's next turn, as two user messages in a row are.
        expect(messages[at + 1].role).toBe('user')
        expect(messages[at + 1].content).toContain('<tighten>\nFollow tighten.\n</tighten>')
        expect(messages[at + 1].content).toContain('Go on.')
      })

      it('carries nothing that is loaded again under the summary, or was dropped', async () => {
        const messages = await build([
          { role: 'user', content: 'opening' },
          { role: 'assistant', content: 'Hello.' },
          loaded('L1', 'house-style'),
          loaded('L2', 'notes-voice', 'Ok.', { _dropped: true }),
          summary,
          { role: 'user', content: 'again' },
          loaded('L3', 'house-style'),
        ])

        expect(results(messages)).toEqual(['L3'])
      })

      describe('for a skill reading the conversation as a transcript', () => {
        const transcript = { user: 'writer', assistant: 'assistant' }

        /** A turn that read one of a skill's files with `use_skill`. */
        const readFile = (id, name, path, content) => ({
          id: `m_${id}`,
          role: 'assistant',
          content: 'Read it.',
          metadata: {
            apiTrajectory: [
              {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id,
                    type: 'function',
                    function: {
                      name: 'use_skill',
                      arguments: JSON.stringify({ name, file: path }),
                    },
                  },
                ],
              },
              {
                role: 'tool',
                tool_call_id: id,
                content: JSON.stringify({ name, file: path, content }),
              },
            ],
          },
        })

        const read = async messages => (await build(messages, { transcript }))[1].content

        it('hands it what the model loaded, and the files of it the model read', async () => {
          const text = await read([
            { role: 'user', content: 'Use the house style.' },
            loaded('L1', 'house-style'),
            readFile('F1', 'house-style', 'references/voice.md', 'No dashes.'),
          ])

          expect(text).toContain('The conversation has loaded these skills')
          expect(text).toContain(
            '<skill name="house-style">\nFollow house-style.\n<file path="references/voice.md">\nNo dashes.\n</file>\n</skill>'
          )
        })

        it('hands it what was dropped until a summary lets it go', async () => {
          const dropped = loaded('L1', 'house-style', 'Noted.', { _dropped: true })

          expect(await read([{ role: 'user', content: 'go' }, dropped])).toContain(
            '<skill name="house-style">'
          )
          expect(
            await read([
              { role: 'user', content: 'opening' },
              { role: 'assistant', content: 'Hello.' },
              dropped,
              summary,
              { role: 'user', content: 'Go on.' },
            ])
          ).not.toContain('loaded these skills')
        })

        it('does not repeat the writer’s load, which is in their turn already', async () => {
          const text = await read([
            typed('W1', 'tighten'),
            { role: 'assistant', content: 'Tight.' },
          ])

          expect(text.match(/Follow tighten\./g)).toHaveLength(1)
          expect(text).not.toContain('loaded these skills')
        })

        it('hands it a writer’s load a summary took out of the transcript', async () => {
          const text = await read([
            { role: 'user', content: 'opening' },
            { role: 'assistant', content: 'Hello.' },
            typed('W1', 'tighten'),
            { role: 'assistant', content: 'Tight.' },
            summary,
            { role: 'user', content: 'Go on.' },
          ])

          expect(text).toContain('<skill name="tighten">\nFollow tighten.\n</skill>')
        })
      })
    })
  })

  describe('summarize mode', () => {
    it('produces system + user with the scene content embedded', async () => {
      const stores = makeStores({
        documents: [doc('sc1', 'manuscript_s1', { title: 'Chapter 1', content: 'A scene.' })],
      })

      const { messages } = await buildContext('summarize', stores, {
        storyId: 's1',
        documentId: 'sc1',
        systemPrompt: 'Summarize.',
        userPrompt: 'Summarize the following chapter:',
      })

      expect(messages).toHaveLength(2)
      expect(messages[0]).toEqual({ role: 'system', content: 'Summarize.' })
      expect(messages[1].role).toBe('user')
      expect(messages[1].content).toContain('Summarize the following chapter:')
      expect(messages[1].content).toContain('# Chapter 1')
      expect(messages[1].content).toContain('A scene.')
    })
  })

  it('throws on unknown mode', async () => {
    await expect(
      buildContext('nope', makeStores(), { storyId: 's1', systemPrompt: '' })
    ).rejects.toThrow('Unknown context mode: nope')
  })
})

describe('the author’s note', () => {
  const stores = () =>
    makeStores({
      chat: { id: 'c1' },
      messages: [
        { id: 'm1', role: 'assistant', content: 'The door creaks.' },
        { id: 'm2', role: 'user', content: 'I push it open.' },
      ],
    })
  const build = extra =>
    buildContext('chat', stores(), { storyId: 's1', chatId: 'c1', systemPrompt: 'sys', ...extra })

  it('goes after the project and ahead of what the writer said', async () => {
    const { messages } = await build({
      project: { project: 'My Story', size: { documents: 0, folders: 0 } },
      note: 'Never write for the player.',
    })
    const last = messages.at(-1).content

    // Late enough to hold in a long chat; not last, so the answer is to what
    // the writer said.
    expect(last.indexOf('<project>')).toBeLessThan(last.indexOf('<authors_note>'))
    expect(last.indexOf('</authors_note>')).toBeLessThan(last.indexOf('I push it open.'))
    expect(last.trimEnd().endsWith('I push it open.')).toBe(true)
  })

  it('leads the writer’s message in a chat sending no project', async () => {
    const { messages } = await build({ note: 'Never write for the player.' })

    expect(messages.at(-1).content).toBe(
      '<authors_note>\nNever write for the player.\n</authors_note>\n\n---\n\nI push it open.'
    )
  })

  it('sends nothing for a note that says nothing', async () => {
    const { messages } = await build({ note: '   ' })

    expect(messages.at(-1).content).toBe('I push it open.')
  })

  it('is not read by a skill reading the conversation as a transcript', async () => {
    const { messages } = await build({
      note: 'Never write for the player.',
      transcript: { user: 'player', assistant: 'game_master' },
    })

    expect(messages.at(-1).content).not.toContain('authors_note')
  })

  it('names itself, and trims what it is given', () => {
    expect(renderAuthorsNote('  Stay in the scene.  ')).toBe(
      '<authors_note>\nStay in the scene.\n</authors_note>'
    )
    expect(renderAuthorsNote(undefined)).toBe('')
  })
})
