/**
 * @module components/common/sectionHeading
 * @description Where a section of a `SectionLayout` puts buttons of its own,
 * beside its heading: Settings › Skills' plus and import. A section shown
 * anywhere else has none to put them in, and keeps them where it is.
 */

import { inject } from 'vue'

/** The selector of the place beside the open section's heading. */
export const SECTION_HEADING = Symbol('section heading')

/**
 * The place beside the heading of the section this is in, for a `Teleport`
 * to; null outside a `SectionLayout`.
 * @returns {string|null}
 */
export function useSectionHeading() {
  return inject(SECTION_HEADING, null)
}
