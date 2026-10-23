import { describe, it, expect, beforeEach, vi } from 'vitest'

const explore = vi.hoisted(() => ({ exploreFor: vi.fn() }))
vi.mock('@/ai/tools/explore.js', async importOriginal => ({
  ...(await importOriginal()),
  ...explore,
}))
const dialog = vi.hoisted(() => ({ confirmExploring: vi.fn() }))
vi.mock('@/composables/useExplore.js', async importOriginal => ({
  ...(await importOriginal()),
  ...dialog,
}))

const load = () => import('@/ai/commands.js')

describe('/explore', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is a command', async () => {
    expect((await load()).listCommands().map(entry => entry.name)).toContain('explore')
  })

  it('is answered by a model, written in as it runs, and can be asked again', async () => {
    const { commandConsults, commandRepeatable, askedCommand } = await load()
    expect(commandConsults({ name: 'explore' })).toBe(true)
    expect(commandRepeatable({ name: 'explore' })).toBe(true)
    expect(askedCommand({ name: 'explore', input: '' }).label).toBe('The whole project')
    expect(askedCommand({ name: 'explore', input: 'Notes' }).label).toBe('Notes')
  })

  it('writes what it found into the turn, asking first in a dialog', async () => {
    const { runCommand } = await load()
    explore.exploreFor.mockResolvedValue({
      path: 'Notes/',
      name: 'Notes/',
      about: 'The cast, one entry each.',
      listing: 'Notes/Elara — 5 words',
    })

    const ran = await runCommand({ name: 'explore', input: 'notes' }, { storyId: 's1' })

    expect(explore.exploreFor).toHaveBeenCalledWith(
      'notes',
      expect.objectContaining({ storyId: 's1', approve: dialog.confirmExploring })
    )
    expect(ran).toMatchObject({
      label: 'Notes/',
      result: 'The cast, one entry each.\n\n```\nNotes/Elara — 5 words\n```',
    })

    explore.exploreFor.mockResolvedValue({ path: '/', name: 'the project', about: 'A novel.' })
    expect(await runCommand({ name: 'explore', input: '' }, { storyId: 's1' })).toMatchObject({
      label: 'The whole project',
      result: 'A novel.',
    })
  })

  it('says when the writer said no, or what went wrong', async () => {
    const { runCommand } = await load()
    explore.exploreFor.mockResolvedValueOnce({ declined: true })
    expect(await runCommand({ name: 'explore', input: '' }, { storyId: 's1' })).toEqual({
      error: 'Not explored.',
    })

    explore.exploreFor.mockResolvedValueOnce({ error: 'There is nothing at "Nowhere".' })
    expect(await runCommand({ name: 'explore', input: 'Nowhere' }, { storyId: 's1' })).toEqual({
      error: 'There is nothing at "Nowhere".\n/explore [path]',
    })
  })
})
