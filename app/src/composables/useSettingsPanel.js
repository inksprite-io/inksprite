/**
 * @module composables/useSettingsPanel
 * @description Where the settings are opened from anywhere in the writer.
 *
 * The settings are app-wide and sit over the writer on the desktop and in a
 * tab on a phone, so the thing that shows them lives in the writer's frame.
 * Anything deeper — a chat that finds no provider to send to — asks here,
 * and can name the section it wants looked at.
 *
 * One state for the app: every caller shares the same `visible` flag.
 */

import { ref } from 'vue'

/** @typedef {'system'|'data'|'ai'|'narration'|'workflows'|'skills'|'connections'|'debug'} SettingsSection */

const visible = ref(false)

/**
 * The section the last caller asked for, until the settings have shown it.
 * @type {import('vue').Ref<SettingsSection|null>}
 */
const requestedSection = ref(null)

/**
 * @returns {{
 *   visible: import('vue').Ref<boolean>,
 *   requestedSection: import('vue').Ref<SettingsSection|null>,
 *   open: (section?: SettingsSection) => void,
 *   close: () => void,
 *   takeSection: () => SettingsSection|null,
 * }}
 */
export function useSettingsPanel() {
  /**
   * Show the settings, on a section when one is named.
   * @param {SettingsSection} [section]
   */
  const open = section => {
    if (section) requestedSection.value = section
    visible.value = true
  }

  const close = () => {
    visible.value = false
  }

  /**
   * The section asked for, handed over once so the settings do not keep
   * jumping back to it.
   * @returns {SettingsSection|null}
   */
  const takeSection = () => {
    const section = requestedSection.value
    requestedSection.value = null
    return section
  }

  return { visible, requestedSection, open, close, takeSection }
}
