import { beforeEach, describe, expect, it } from 'vitest'
import { useSidebarTab } from '@/composables/useSidebarTab.js'

describe('useSidebarTab', () => {
  beforeEach(() => {
    useSidebarTab().take()
  })

  it('asks for a list, the sidebar opening for it unless told not to', () => {
    const sidebarTab = useSidebarTab()
    sidebarTab.show('narration')
    expect(sidebarTab.take()).toEqual({ tab: 'narration', open: true })

    sidebarTab.show('comments', { open: false })
    expect(sidebarTab.take()).toEqual({ tab: 'comments', open: false })
  })

  it('hands a request over once, to whichever caller takes it', () => {
    useSidebarTab().show('outline')
    expect(useSidebarTab().requested.value).toEqual({ tab: 'outline', open: true })
    expect(useSidebarTab().take()).toEqual({ tab: 'outline', open: true })
    expect(useSidebarTab().take()).toBe(null)
  })
})
