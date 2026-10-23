import { describe, it, expect } from 'vitest'
import { fetchElsewhere, fetchProjectFiles, fileElsewhere, provideFiles } from '@/cloud/onDemand.js'

describe('files fetched when wanted', () => {
  it('finds nothing elsewhere while no account provides it', async () => {
    expect(await fileElsewhere('doc_1')).toBe(false)
    expect(await fetchElsewhere('doc_1')).toBeNull()
    await expect(fetchProjectFiles()).resolves.toBeUndefined()
  })

  it('says how many files a backup still lacks, when some could not be fetched', async () => {
    let left = 1
    const stop = provideFiles({
      has: async () => true,
      fetch: async () => null,
      fetchProjects: async () => left,
    })
    await expect(fetchProjectFiles(['story_1'])).rejects.toThrow("A file isn't on this device yet")
    left = 3
    await expect(fetchProjectFiles()).rejects.toThrow("3 files aren't on this device yet")
    left = 0
    await expect(fetchProjectFiles()).resolves.toBeUndefined()
    stop()
  })

  it('lets a later account go on providing once an earlier one stops', async () => {
    const first = provideFiles({
      has: async () => false,
      fetch: async () => null,
      fetchProjects: async () => 0,
    })
    const second = provideFiles({
      has: async () => true,
      fetch: async () => null,
      fetchProjects: async () => 0,
    })
    first()
    expect(await fileElsewhere('doc_1')).toBe(true)
    second()
    expect(await fileElsewhere('doc_1')).toBe(false)
  })
})
