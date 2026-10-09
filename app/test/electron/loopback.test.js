// @vitest-environment node
import { describe, it, expect } from 'vitest'
import http from 'node:http'
import { listen } from '../../electron/src/loopback.js'

/**
 * What a browser gets for `path` on the port.
 *
 * @returns {Promise<{status: number, body: string}>}
 */
const visit = (port, path) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, response => {
        let body = ''
        response.on('data', chunk => (body += chunk))
        response.on('end', () => resolve({ status: response.statusCode, body }))
      })
      .on('error', reject)
  })

describe('listen', () => {
  it('hands back the query, and tells the browser to go back to the app', async () => {
    const listening = await listen(0, '/connect/mcp')

    expect((await visit(listening.port, '/favicon.ico')).status).toBe(404)
    const page = await visit(listening.port, '/connect/mcp?code=abc&state=xyz')

    expect(await listening.back).toBe('code=abc&state=xyz')
    expect(page.status).toBe(200)
    expect(page.body).toContain('go back to inksprite')
  })

  it('stops when told, and lets go of the port', async () => {
    const listening = await listen(0, '/connect/mcp')
    listening.stop()

    expect(await listening.back).toBeNull()
    const again = await listen(listening.port, '/connect/mcp')
    again.stop()
  })

  it('gives up when the time runs out', async () => {
    const listening = await listen(0, '/connect/mcp', 50)
    expect(await listening.back).toBeNull()
  })

  it('waits a moment for a sign-in just stopped to let go of the port', async () => {
    const first = await listen(0, '/connect/mcp')
    setTimeout(first.stop, 200)

    const second = await listen(first.port, '/connect/mcp')
    expect(second.port).toBe(first.port)
    second.stop()
  })

  it('says so when something else keeps the port', async () => {
    const other = http.createServer()
    await new Promise(resolve => other.listen(0, '127.0.0.1', resolve))
    const { port } = other.address()

    await expect(listen(port, '/connect/mcp')).rejects.toThrow(`Port ${port} is in use`)
    other.close()
  })
})
