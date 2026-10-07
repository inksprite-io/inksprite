/**
 * @module composables/useProfileNotice
 * @description What a profile asks the writer to know the first time they pick
 * it — Roleplay (NSFW)'s opt-ins, and where to change them.
 *
 * Once per profile per browser, and only when the writer picks it, or switches
 * on the setting that puts it in place of another: a chat put back on a
 * default, or made from a project's, has not been chosen by anyone.
 *
 * The notice waiting to be shown is held here rather than by whoever picked
 * the profile, so a composable can raise it without a component around it, and
 * one host draws it for all of them. See components/common/ProfileNoticeHost.vue.
 */

import { ref } from 'vue'
import { getBuiltInProfile } from '@/ai/profiles/index.js'
import { localStorage } from '@/utils/localStorage'

/** @typedef {import('@/ai/profiles/index.js').ProfileNotice} ProfileNotice */

/** @type {import('vue').Ref<ProfileNotice|null>} */
const pending = ref(null)

/**
 * Where a profile's notice is remembered as shown.
 * @param {string} profileId
 * @returns {string}
 */
const seenKey = profileId => `ui.profile-notice.${profileId}`

export const useProfileNotice = () => {
  /**
   * Show a profile's notice, if it has one the writer has not seen.
   *
   * Remembered as seen as soon as it is shown: closing it is reading it, and a
   * notice that came back until it was dismissed some particular way would be
   * one nobody could get rid of.
   *
   * @param {string} profileId - The profile the writer just picked
   */
  const noticeFor = profileId => {
    const notice = getBuiltInProfile(profileId)?.notice
    if (!notice || localStorage.get(seenKey(profileId), false)) return
    localStorage.set(seenKey(profileId), true)
    pending.value = notice
  }

  /** Put the notice away. */
  const dismiss = () => {
    pending.value = null
  }

  return { pending, noticeFor, dismiss }
}
