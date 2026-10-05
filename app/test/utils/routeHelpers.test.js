import { describe, it, expect, vi } from 'vitest'
import { pushProjectToRoute, replaceProjectInRoute, storyIdFromRoute } from '@/utils/routeHelpers'

const fakeRouter = () => ({ push: vi.fn(), replace: vi.fn() })

describe('storyIdFromRoute', () => {
  it('passes an id through untouched', () => {
    expect(storyIdFromRoute('story_abc123')).toBe('story_abc123')
  })

  it('takes the first value when the param repeats', () => {
    expect(storyIdFromRoute(['story_a', 'story_b'])).toBe('story_a')
  })

  it('returns empty for nothing', () => {
    expect(storyIdFromRoute('')).toBe('')
    expect(storyIdFromRoute(undefined)).toBe('')
    expect(storyIdFromRoute([])).toBe('')
  })
})

describe('pushProjectToRoute', () => {
  it('addresses a project by id alone', () => {
    const router = fakeRouter()
    pushProjectToRoute(router, 'story_abc')

    expect(router.push).toHaveBeenCalledWith('/project/story_abc')
  })

  it('round-trips the id', () => {
    const router = fakeRouter()
    pushProjectToRoute(router, 'story_abc')

    const param = router.push.mock.calls[0][0].replace('/project/', '')
    expect(storyIdFromRoute(param)).toBe('story_abc')
  })

  it('does nothing without a project', () => {
    const router = fakeRouter()
    pushProjectToRoute(router, '')

    expect(router.push).not.toHaveBeenCalled()
  })
})

describe('replaceProjectInRoute', () => {
  it('replaces rather than pushes, so a redirect leaves no history step', () => {
    const router = fakeRouter()
    replaceProjectInRoute(router, 'story_abc')

    expect(router.replace).toHaveBeenCalledWith('/project/story_abc')
    expect(router.push).not.toHaveBeenCalled()
  })

  it('does nothing without a project', () => {
    const router = fakeRouter()
    replaceProjectInRoute(router, undefined)

    expect(router.replace).not.toHaveBeenCalled()
  })
})
