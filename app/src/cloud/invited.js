/**
 * @module cloud/invited
 * @description Whether the page was opened from an invitation to sync,
 * taken as the app starts.
 */

import { takeInviteFromAddress } from './invite.js'

export const invited = takeInviteFromAddress()
