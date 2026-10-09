// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { openable, originOf, webAddress } from '../../electron/src/links.js'

describe('openable', () => {
  it('takes web and mail links', () => {
    expect(openable('https://example.com/page')).toBe(true)
    expect(openable('http://192.168.1.20:8080/')).toBe(true)
    expect(openable('mailto:someone@example.com')).toBe(true)
  })

  it('refuses anything else a page or a model could write', () => {
    expect(openable('javascript:alert(1)')).toBe(false)
    expect(openable('file:///etc/passwd')).toBe(false)
    expect(openable('smb://server/share')).toBe(false)
    expect(openable('not a link')).toBe(false)
  })
})

describe('webAddress', () => {
  it('takes web addresses only', () => {
    expect(webAddress('https://auth.example/authorize')).toBe(true)
    expect(webAddress('mailto:someone@example.com')).toBe(false)
    expect(webAddress('file:///etc/passwd')).toBe(false)
  })
})

describe('originOf', () => {
  it("gives the page's own scheme an origin, which URL does not", () => {
    expect(originOf('app://inksprite/connect/google')).toBe('app://inksprite')
    expect(originOf('http://127.0.0.1:8002/project/1')).toBe('http://127.0.0.1:8002')
    expect(originOf('nonsense')).toBeNull()
  })
})
