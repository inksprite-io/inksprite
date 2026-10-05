import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useFileView, clearFileViews } from '@/composables/useFileView.js'

const documents = new Map()
vi.mock('@/composables/useDocuments', () => ({
  useDocuments: () => ({ get: id => documents.get(id) || null }),
}))

describe('useFileView', () => {
  beforeEach(() => {
    clearFileViews()
    window.sessionStorage.clear()
    documents.clear()
    documents.set('pdf_1', { id: 'pdf_1', type: 'file', mime: 'application/pdf' })
    documents.set('text_1', { id: 'text_1', type: 'text' })
  })

  it('shows a file as the file until told otherwise', () => {
    const view = useFileView('story_1')
    expect(view.showsText('pdf_1')).toBe(false)

    view.setShowsText('pdf_1', true)
    expect(view.showsText('pdf_1')).toBe(true)

    view.setShowsText('pdf_1', false)
    expect(view.showsText('pdf_1')).toBe(false)
  })

  it('remembers the choice for the session, and forgets it when told to', () => {
    useFileView('story_1').setShowsText('pdf_1', true)
    clearFileViews()

    // A fresh set of views reads the choice back from the session.
    expect(useFileView('story_1').showsText('pdf_1')).toBe(true)
  })

  it('offers the switch for a file only, worded for the way it would go', () => {
    const view = useFileView('story_1')
    expect(view.fileViewItem('text_1')).toBeNull()
    expect(view.fileViewItem('missing')).toBeNull()

    const item = view.fileViewItem('pdf_1')
    expect(item.label).toBe('Show as text')
    item.command()
    expect(view.showsText('pdf_1')).toBe(true)
    expect(view.fileViewItem('pdf_1').label).toBe('Show the file')
  })
})
