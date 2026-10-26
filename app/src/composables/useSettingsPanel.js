/**
 * @module composables/useSettingsPanel
 * @description Where the settings are opened from anywhere in the writer.
 *
 * The settings sit over the writer on the desktop and in a tab on a phone,
 * so the thing that shows them lives in the writer's frame. Anything deeper
 * — a chat that finds no provider to send to, the outline's Share… — asks
 * here, and can name the section it wants looked at, and a part of it to
 * open.
 *
 * One state for the app: every caller shares the same `visible` flag.
 */

import { ref } from 'vue'

/** @typedef {'system'|'sync'|'project'|'ai'|'workflows'|'skills'|'connections'|'extensions'} SettingsSection */

/** @typedef {'sharing'} SettingsPart */

const visible = ref(false)

/**
 * The section the last caller asked for, until the settings have shown it.
 * @type {import('vue').Ref<SettingsSection|null>}
 */
const requestedSection = ref(null)

/**
 * The part of it asked for, until the section has opened it.
 * @type {import('vue').Ref<SettingsPart|null>}
 */
const requestedPart = ref(null)

/**
 * @returns {{
 *   visible: import('vue').Ref<boolean>,
 *   requestedSection: import('vue').Ref<SettingsSection|null>,
 *   requestedPart: import('vue').Ref<SettingsPart|null>,
 *   open: (section?: SettingsSection, part?: SettingsPart) => void,
 *   close: () => void,
 *   takeSection: () => SettingsSection|null,
 *   takePart: () => SettingsPart|null,
 * }}
 */
export function useSettingsPanel() {
  /**
   * Show the settings, on a section when one is named, with a part of it
   * open.
   * @param {SettingsSection} [section]
   * @param {SettingsPart} [part]
   */
  const open = (section, part) => {
    if (section) requestedSection.value = section
    if (part) requestedPart.value = part
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

  /**
   * The part asked for, handed over once, as the section is.
   * @returns {SettingsPart|null}
   */
  const takePart = () => {
    const part = requestedPart.value
    requestedPart.value = null
    return part
  }

  return { visible, requestedSection, requestedPart, open, close, takeSection, takePart }
}
