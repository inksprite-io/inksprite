import { describe, it, expect } from 'vitest'
import { bytesOfDataUrl, decodeDataPayload } from '@/utils/dataUrl.js'

describe('bytesOfDataUrl', () => {
  it('reads a base64 picture back to its bytes and type', () => {
    const held = bytesOfDataUrl('data:image/gif;base64,R0lGODlh')
    expect(held?.mime).toBe('image/gif')
    expect(Array.from(held?.bytes || []).slice(0, 3)).toEqual([0x47, 0x49, 0x46])
  })

  it('reads a percent-encoded payload as its text', () => {
    const held = bytesOfDataUrl('data:image/svg+xml,%3Csvg%2F%3E')
    expect(new TextDecoder().decode(held?.bytes)).toBe('<svg/>')
  })

  it('has nothing for another address, or one that holds nothing', () => {
    expect(bytesOfDataUrl('https://example.com/a.png')).toBe(null)
    expect(bytesOfDataUrl('data:image/png;base64,')).toBe(null)
    expect(bytesOfDataUrl('data:image/png;base64,***')).toBe(null)
  })
})

describe('decodeDataPayload', () => {
  it('is empty for a payload it cannot read', () => {
    expect(decodeDataPayload(';base64', '%%%').length).toBe(0)
  })
})
