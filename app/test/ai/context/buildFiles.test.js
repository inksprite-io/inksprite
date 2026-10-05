import { describe, it, expect } from 'vitest'
import { buildContext } from '@/ai/context/build.js'
import { textHash } from '@/ai/context/reads.js'

const paper = {
  id: 'd_paper',
  parentId: 'papers',
  type: 'file',
  title: 'RAG survey',
  content: '[p.1]\nRetrieval helps generation.',
  mime: 'application/pdf',
  pages: 1,
  summary: '',
  order: 0,
  deleted: false,
}

const project = { project: 'Research', size: { documents: 1, folders: 1 } }

function makeStores({ documents = [], chat = null, messages = [] } = {}) {
  const byId = new Map(documents.map(d => [d.id, d]))
  return {
    documentsStore: { getDocument: id => byId.get(id) || null },
    chatsStore: { getChatById: id => (chat && chat.id === id ? chat : null) },
    messagesStore: { getMessagesForChat: id => (chat && chat.id === id ? messages : []) },
  }
}

/** The project block, parsed back out of the last user message. */
const blockOf = messages => {
  const last = messages[messages.length - 1]
  const json = /<project>\n```json\n([\s\S]*?)\n```\n<\/project>/.exec(last.content)
  return json ? JSON.parse(json[1]) : null
}

describe('buildContext, with files', () => {
  it('carries a pinned file’s text in the block', async () => {
    const stores = makeStores({
      documents: [paper],
      chat: { id: 'c1' },
      messages: [{ role: 'user', content: 'What does the survey say?' }],
    })

    const { messages } = await buildContext('chat', stores, {
      storyId: 's1',
      chatId: 'c1',
      systemPrompt: 'sys',
      project,
      pinned: [{ id: 'd_paper', path: 'Papers/RAG survey', type: 'file', words: 4, pages: 1 }],
    })

    expect(blockOf(messages).pinned[0]).toEqual({
      path: 'Papers/RAG survey',
      type: 'file',
      words: 4,
      pages: 1,
      content: '[p.1]\nRetrieval helps generation.',
    })
  })

  it('keeps a file the model read in the conversation, not in the block', async () => {
    const stores = makeStores({
      documents: [paper],
      chat: { id: 'c1' },
      messages: [
        { role: 'user', content: 'Read the survey.' },
        {
          role: 'assistant',
          content: 'Read.',
          metadata: {
            documentCallsKept: true,
            apiTrajectory: [
              {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'read_document', arguments: '{"path":"Papers/RAG survey"}' },
                  },
                ],
              },
              {
                role: 'tool',
                tool_call_id: 'call_1',
                content: '{"content":"[p.1]"}',
                _document: 'd_paper',
                _path: 'Papers/RAG survey',
                _hash: textHash(paper.content),
              },
            ],
          },
        },
        { role: 'user', content: 'And?' },
      ],
    })

    const { messages } = await buildContext('chat', stores, {
      storyId: 's1',
      chatId: 'c1',
      systemPrompt: 'sys',
      project,
      keeps: name => name === 'read_document',
      locate: () => ({ path: 'Papers/RAG survey', text: paper.content }),
    })

    expect(messages.find(m => m.role === 'tool')).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: '{"content":"[p.1]"}',
    })
    expect(blockOf(messages)).toEqual(project)
  })
})
