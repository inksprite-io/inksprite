// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pageFile } from '../../electron/src/page.js'

/** A build's folder: an index.html, and an asset under assets/. */
let root

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'page-'))
  await mkdir(path.join(root, 'assets'))
  await writeFile(path.join(root, 'index.html'), '<!doctype html>')
  await writeFile(path.join(root, 'assets', 'index-abc.js'), '')
})

afterAll(() => rm(root, { recursive: true }))

describe('pageFile', () => {
  it("answers with the build's file", async () => {
    expect(await pageFile(root, '/assets/index-abc.js')).toBe(
      path.join(root, 'assets', 'index-abc.js')
    )
  })

  it("answers the router's own paths, and the root, with index.html", async () => {
    const index = path.join(root, 'index.html')
    expect(await pageFile(root, '/')).toBe(index)
    expect(await pageFile(root, '/connect/google')).toBe(index)
    expect(await pageFile(root, '/assets')).toBe(index)
  })

  it('answers nothing outside the build', async () => {
    expect(await pageFile(root, '/../../etc/passwd')).toBeNull()
    expect(await pageFile(root, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull()
    expect(await pageFile(root, '/assets%2f..%2f..%2fsecret')).toBeNull()
    expect(await pageFile(root, '/%E0%A4%A')).toBeNull()
  })
})
