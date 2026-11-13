import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { streamAppends } from '@/ai/tools/streamedAppends.js'
import { appendTarget } from '@/ai/tools/documents.js'
import { clearEditor, useEditor } from '@/composables/useEditor.js'
import { previewsOf } from '@/editor/streaming.js'

vi.mock('@/ai/tools/documents.js', () => ({
  appendTarget: vi.fn(),
  appendedText: text => (typeof text === 'string' ? text : ''),
}))

const STORY = 'story_1'

/** A call to append_document as far as its arguments have come. */
const call = (args, name = 'append_document') => ({ id: 'call_1', name, arguments: args })

/** The ids of the previews the document shows. */
const shown = id => {
  const state = useEditor().stateOf(id)
  return state ? previewsOf(state).map(preview => preview.id) : []
}

/** Let the lookup of where an append goes come back. */
const looked = () => new Promise(resolve => setTimeout(resolve))

describe('streamAppends', () => {
  beforeEach(() => {
    clearEditor()
    vi.mocked(appendTarget).mockReset()
    vi.mocked(appendTarget).mockResolvedValue({ documentId: 'doc_1', suggested: false })
    useEditor().open('doc_1', 'Snow fell.')
  })

  afterEach(() => clearEditor())

  it('looks the document up once the whole path has come, and shows the text', async () => {
    const appends = streamAppends({ storyId: STORY, chatId: 'chat_1' })
    appends.update([call('{"path":"manuscript/Chap')])
    await looked()
    expect(appendTarget).not.toHaveBeenCalled()

    appends.update([call('{"path":"manuscript/Chapter 1","text":"The gate')])
    expect(appendTarget).toHaveBeenCalledWith(STORY, 'chat_1', 'manuscript/Chapter 1', false)
    await looked()
    expect(shown('doc_1')).toHaveLength(1)

    appends.update([call('{"path":"manuscript/Chapter 1","text":"The gate stood')])
    expect(appendTarget).toHaveBeenCalledTimes(1)
  })

  it('leaves alone calls to other tools, and documents the editor does not have open', async () => {
    const appends = streamAppends({ storyId: STORY })
    appends.update([call('{"path":"manuscript/Chapter 1","content":"x"}', 'update_document')])
    expect(appendTarget).not.toHaveBeenCalled()

    vi.mocked(appendTarget).mockResolvedValue({ documentId: 'doc_2', suggested: false })
    appends.update([call('{"path":"Other","text":"x')])
    await looked()
    expect(shown('doc_1')).toEqual([])
  })

  it('shows nothing where the call will not write', async () => {
    vi.mocked(appendTarget).mockResolvedValue(null)
    const appends = streamAppends({ storyId: STORY })
    appends.update([call('{"path":"Nobody","text":"x')])
    await looked()
    expect(shown('doc_1')).toEqual([])
  })

  it('starts showing a document opened partway', async () => {
    useEditor().close('doc_1')
    const appends = streamAppends({ storyId: STORY })
    appends.update([call('{"path":"Chapter 1","text":"The')])
    await looked()

    useEditor().open('doc_1', 'Snow fell.')
    appends.update([call('{"path":"Chapter 1","text":"The gate')])
    expect(shown('doc_1')).toHaveLength(1)
  })

  it('ends a call that ran, and leaves the rest until they have', async () => {
    const appends = streamAppends({ storyId: STORY })
    const first = call('{"path":"Chapter 1","text":"One."}')
    const second = { ...call('{"path":"Chapter 1","text":"Two."}'), id: 'call_2' }
    appends.update([first, second])
    await looked()
    expect(shown('doc_1')).toHaveLength(2)

    const whole = [{ id: 'call_1' }, { id: 'call_2' }]
    appends.settle(whole, whole)
    appends.ran(whole[0])
    expect(shown('doc_1')).toHaveLength(1)

    appends.ran(whole[1])
    expect(shown('doc_1')).toEqual([])
  })

  it('ends a call the round will not run as soon as that is known', async () => {
    const appends = streamAppends({ storyId: STORY })
    appends.update([call('{"path":"Chapter 1","text":"One."}')])
    await looked()

    appends.settle([{ id: 'call_1' }], [])
    expect(shown('doc_1')).toEqual([])
  })

  it('ends everything with the round, and a lookup that comes back after shows nothing', async () => {
    const appends = streamAppends({ storyId: STORY })
    appends.update([call('{"path":"Chapter 1","text":"One.')])
    appends.end()
    await looked()
    expect(shown('doc_1')).toEqual([])

    // The next round's calls count from the start again.
    appends.update([call('{"path":"Chapter 1","text":"Two.')])
    await looked()
    expect(shown('doc_1')).toHaveLength(1)
    appends.end()
    expect(shown('doc_1')).toEqual([])
  })

  it('does nothing outside a project', () => {
    const appends = streamAppends({ storyId: null })
    appends.update([call('{"path":"Chapter 1","text":"One.')])
    expect(appendTarget).not.toHaveBeenCalled()
  })
})
