/**
 * @module cloud/deviceName
 * @description What a device calls itself in the account's list of devices:
 * the desktop app or the browser, and what it runs on. A name to tell the
 * writer's devices apart by, given by the device itself and so no more to be
 * trusted than that.
 */

import { isDesktop } from '@/platform/desktop.js'

/**
 * @typedef {Object} Seen
 * @property {string} userAgent
 * @property {number} maxTouchPoints - An iPad says it is a Mac, but has a touch screen
 * @property {boolean} desktop - The desktop app
 */

/**
 * @param {Partial<Seen>} [seen] - What the device is, when not this one
 * @returns {string} `inksprite on macOS`, `Safari on iPhone`
 */
export function deviceName({
  userAgent = globalThis.navigator?.userAgent ?? '',
  maxTouchPoints = globalThis.navigator?.maxTouchPoints ?? 0,
  desktop = isDesktop(),
} = {}) {
  const system = /iPhone|iPod/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
      ? 'iPad'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Macintosh|Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Windows/.test(userAgent)
            ? 'Windows'
            : /CrOS/.test(userAgent)
              ? 'ChromeOS'
              : /Linux/.test(userAgent)
                ? 'Linux'
                : 'another system'
  if (desktop) return `inksprite on ${system}`
  const browser = /Edg(e|iOS|A)?\//.test(userAgent)
    ? 'Edge'
    : /Firefox\/|FxiOS\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\/|CriOS\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'A browser'
  return `${browser} on ${system}`
}
