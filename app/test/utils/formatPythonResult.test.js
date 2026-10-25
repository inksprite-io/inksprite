import { describe, it, expect } from 'vitest'
import { formatPythonResult } from '@/utils/formatters'

describe('formatPythonResult', () => {
  it('shows a run as it came: printed, then the value, then the traceback', () => {
    const content = JSON.stringify({
      stdout: '+0  0.5000\n+1  0.7500\n',
      value: '[0.5, 0.75]',
      error: 'Traceback (most recent call last):\nZeroDivisionError: division by zero\n',
    })
    expect(formatPythonResult(content)).toBe(
      '+0  0.5000\n+1  0.7500\n[0.5, 0.75]\nTraceback (most recent call last):\nZeroDivisionError: division by zero'
    )
  })

  it('says when Python started again', () => {
    const content = JSON.stringify({ error: 'Stopped after 30 seconds.', restarted: 'Gone.' })
    expect(formatPythonResult(content)).toBe('Stopped after 30 seconds.\nGone.')
  })

  it('cuts a long one short', () => {
    const shown = formatPythonResult(JSON.stringify({ stdout: 'x'.repeat(5000) }))
    expect(shown.startsWith('x'.repeat(4000))).toBe(true)
    expect(shown.endsWith('(1000 more chars)')).toBe(true)
  })

  it('shows anything else as any tool’s result is shown', () => {
    expect(formatPythonResult('not json')).toBe('not json')
  })
})
