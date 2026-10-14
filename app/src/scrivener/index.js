/**
 * @module scrivener
 * @description A Scrivener 3 project brought into a project: the binder as the
 * tree, each text as markdown, and the files in Research as file documents.
 *
 * The project comes in as a `.scriv` chosen under Projects › Import project…,
 * which the browser hands over zipped, or a zip of one, and makes a new
 * project; or dropped or chosen in a folder of the tree, where it lands as a
 * folder named after it. Either way it
 * is opened and checked before anything is written. What markdown cannot hold
 * is left behind: fonts and the rest of the formatting, labels, keywords,
 * snapshots, compile settings. Comments, footnotes, links and pictures in the
 * text are not read yet, for want of a project that has them to test against.
 *
 * - **package** - A project's files by their path inside it, from a folder or
 *   a zip
 * - **binder** - The binder read from the `.scrivx`, without the Trash, and
 *   the styles' names
 * - **rtf** - A text's RTF read into paragraphs and tables, with Scrivener's
 *   style markers taken out
 * - **markdown** - Those written as markdown, through the editor's schema and
 *   serializer
 * - **project** - A project opened, then written into the tree
 *
 * `npm run scrivener` runs the reading over a project on disk and prints what
 * would come in. Design: `.llm/scrivener_import_design.md`.
 *
 * @example
 * import { packageOfZip } from '@/scrivener/package.js'
 * import { openProject, writeProject } from '@/scrivener/project.js'
 *
 * const pack = await packageOfZip(file)
 * if (pack) await writeProject(storyId, await openProject(pack), { asFolder: true })
 */

export { packageOfFolder, packageOfZip, isZip, mayHoldProject } from './package.js'
export { readBinder, readStyles, FOLDER_TYPES } from './binder.js'
export { readRtf } from './rtf.js'
export { markdownOfBlocks, markdownOfText, kindOf } from './markdown.js'
export { openProject, writeProject } from './project.js'
