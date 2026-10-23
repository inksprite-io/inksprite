/* global Response, URLSearchParams */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { TOP, folderFor, placeDoc } from '@/drive/folders.js'

vi.mock('@/platform/fetch.js', () => ({ fetch: (...args) => fetch(...args) }))

const FILES = 'https://www.googleapis.com/drive/v3/files'
const FOLDER = 'application/vnd.google-apps.folder'

/**
 * Drive, standing in: files by id, each with its name, type, parents and
 * the app's properties. What the app lists is only what it made, as
 * `drive.file` has it, and never what is in the trash.
 */
function drive(files = {}) {
  const state = { files: { root: { name: 'My Drive', parents: [] }, ...files }, made: 0, calls: [] }
  const fetchMock = vi.fn(async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
    const [path, query = ''] = url.split('?')
    const params = new URLSearchParams(query)
    const method = init.method ?? 'GET'
    state.calls.push(`${method} ${path.slice(FILES.length) || '/'}`)
    const body = init.body ? JSON.parse(init.body) : null
    if (path === FILES && method === 'GET') {
      expect(params.get('q')).toContain("appProperties has { key='inksprite' and value='folder' }")
      const files = Object.entries(state.files)
        .filter(([, file]) => file.byApp && file.mimeType === FOLDER && !file.trashed)
        .map(([id, file]) => ({ id, ...file }))
      return new Response(JSON.stringify({ files }))
    }
    if (path === FILES && method === 'POST') {
      const id = `made-${++state.made}`
      state.files[id] = { ...body, parents: body.parents ?? ['root'], byApp: true }
      return new Response(JSON.stringify({ id }))
    }
    const id = decodeURIComponent(path.slice(FILES.length + 1))
    const file = state.files[id]
    if (!file) return new Response('{}', { status: 404 })
    if (method === 'GET')
      return new Response(JSON.stringify({ name: file.name, parents: file.parents }))
    if (method === 'PATCH') {
      if (body?.name) file.name = body.name
      const removed = (params.get('removeParents') ?? '').split(',').filter(Boolean)
      file.parents = file.parents.filter(each => !removed.includes(each))
      if (params.get('addParents')) file.parents.push(params.get('addParents'))
      return new Response(JSON.stringify({ id }))
    }
    return new Response('{}', { status: 400 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return state
}

/** A file's path in the stand-in Drive, by its folders' names. */
const pathOf = (state, id) => {
  const names = []
  let at = id
  while (at && at !== 'root') {
    names.unshift(state.files[at].name)
    at = state.files[at].parents[0]
  }
  return names.join('/')
}

const PLACE = {
  project: { id: 'story_1', title: 'Thief' },
  folders: [
    { id: 'doc_ms', title: 'Manuscript' },
    { id: 'doc_act', title: 'Act One' },
  ],
  title: 'Chapter 3',
}

describe('the Drive folders of the Docs inksprite makes', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('makes inksprite-sync, the project and its folders, once', async () => {
    const state = drive()
    const id = await folderFor(PLACE, 'tok')
    expect(pathOf(state, id)).toBe(`${TOP}/Thief/Manuscript/Act One`)
    expect(state.files[id].appProperties).toEqual({
      inksprite: 'folder',
      inkspriteKey: 'folder:doc_act',
    })

    // Found again, by what they are, not made twice.
    expect(await folderFor(PLACE, 'tok')).toBe(id)
    expect(state.made).toBe(4)
  })

  it('renames and moves them as the project has them, the top left as the writer left it', async () => {
    const state = drive()
    await folderFor(PLACE, 'tok')
    const top = Object.keys(state.files).find(id => state.files[id].name === TOP)
    // The writer put the top in a folder of their own and renamed it.
    state.files.mine = { name: 'Writing', parents: ['root'] }
    state.files[top].parents = ['mine']
    state.files[top].name = 'Synced'

    const id = await folderFor(
      {
        project: { id: 'story_1', title: 'The Thief' },
        folders: [{ id: 'doc_act', title: 'Act 1' }],
        title: 'Chapter 3',
      },
      'tok'
    )
    expect(pathOf(state, id)).toBe('Writing/Synced/The Thief/Act 1')
    expect(state.made).toBe(4)
  })

  it('makes them again where the writer put them in the trash', async () => {
    const state = drive()
    const first = await folderFor(PLACE, 'tok')
    for (const file of Object.values(state.files)) if (file.byApp) file.trashed = true
    const again = await folderFor(PLACE, 'tok')
    expect(again).not.toBe(first)
    expect(pathOf(state, again)).toBe(`${TOP}/Thief/Manuscript/Act One`)
  })

  it('puts a Doc where its document is, under its title, and leaves one already there', async () => {
    const state = drive({ 'doc-1': { name: 'Old name', parents: ['root'] } })
    await placeDoc('doc-1', PLACE, 'tok')
    expect(pathOf(state, 'doc-1')).toBe(`${TOP}/Thief/Manuscript/Act One/Chapter 3`)

    state.calls.length = 0
    await placeDoc('doc-1', PLACE, 'tok')
    expect(state.calls.filter(call => call.startsWith('PATCH') || call.startsWith('POST'))).toEqual(
      []
    )
  })

  it('takes a project of the same name for another, by its id', async () => {
    const state = drive()
    const one = await folderFor({ ...PLACE, folders: [] }, 'tok')
    const other = await folderFor(
      { ...PLACE, project: { id: 'story_2', title: 'Thief' }, folders: [] },
      'tok'
    )
    expect(other).not.toBe(one)
    expect([pathOf(state, one), pathOf(state, other)]).toEqual([`${TOP}/Thief`, `${TOP}/Thief`])
  })
})
