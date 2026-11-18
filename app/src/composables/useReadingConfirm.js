/**
 * @module composables/useReadingConfirm
 * @description The question put before reading stops asking: for pages on
 * the web, and for pages on the writer's own computer and network. Either
 * takes a guard away, so it is confirmed once, with the guide's account of
 * what the guard is for.
 */

import { useConfirm } from 'primevue/useconfirm'
import { GUIDE_ORIGIN } from '@/config/site.js'

/** Where the guide says what asking before a read guards against. */
export const READING_GUIDE = `${GUIDE_ORIGIN}/web-search/#reading-without-asking`

/** What is asked, by what stops asking. */
export const READING_QUESTIONS = {
  web: {
    header: 'Always allow reading pages?',
    message: 'Allowing access to any web page is a potential privacy risk.',
  },
  local: {
    header: 'Always allow reading pages on your network?',
    message: 'Allowing access to your local network is a potential privacy risk.',
  },
}

/**
 * @returns {{confirmUnasked: (kind: 'web'|'local') => Promise<boolean>}}
 */
export function useReadingConfirm() {
  const confirm = useConfirm()
  return {
    /** Ask whether reading may stop asking; true when the writer says so. */
    confirmUnasked: kind =>
      new Promise(resolve => {
        confirm.require({
          ...READING_QUESTIONS[kind],
          // Drawn after the message by the app's dialog (App.vue).
          .../** @type {object} */ ({ guide: READING_GUIDE }),
          rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
          acceptProps: { label: 'Always allow' },
          accept: () => resolve(true),
          reject: () => resolve(false),
          onHide: () => resolve(false),
        })
      }),
  }
}
