import { describe, it, expect, beforeEach } from 'vitest'
import { useProfileNotice } from '@/composables/useProfileNotice.js'
import {
  getBuiltInProfile,
  ROLEPLAY_NSFW_PROFILE_ID,
  ROLEPLAY_PROFILE_ID,
} from '@/ai/profiles/index.js'

describe('useProfileNotice', () => {
  const notice = useProfileNotice()

  beforeEach(() => {
    window.localStorage.clear()
    notice.dismiss()
  })

  it('shows a profile’s notice the first time it is picked', () => {
    notice.noticeFor(ROLEPLAY_NSFW_PROFILE_ID)

    expect(notice.pending.value).toEqual(getBuiltInProfile(ROLEPLAY_NSFW_PROFILE_ID).notice)
  })

  it('does not show it again once it has been shown', () => {
    notice.noticeFor(ROLEPLAY_NSFW_PROFILE_ID)
    notice.dismiss()
    notice.noticeFor(ROLEPLAY_NSFW_PROFILE_ID)

    expect(notice.pending.value).toBeNull()
  })

  it('remembers it across a reload, not only in this page', () => {
    notice.noticeFor(ROLEPLAY_NSFW_PROFILE_ID)
    notice.dismiss()

    // Another copy reads the same flag, as the page would after a reload.
    useProfileNotice().noticeFor(ROLEPLAY_NSFW_PROFILE_ID)
    expect(notice.pending.value).toBeNull()
  })

  it('shows nothing for a profile with nothing to say', () => {
    notice.noticeFor(ROLEPLAY_PROFILE_ID)
    notice.noticeFor('chatprofile_mine')
    notice.noticeFor(undefined)

    expect(notice.pending.value).toBeNull()
  })

  it('is one notice for the whole app, whoever raised it', () => {
    useProfileNotice().noticeFor(ROLEPLAY_NSFW_PROFILE_ID)

    expect(notice.pending.value).not.toBeNull()
  })
})
