/**
 * @module source
 * @description A codebase in a project: a repository the writer can look
 * through and the model can search and read by line, for writing about the
 * code. Not for editing it.
 *
 * A repository is a folder with `kind: 'repository'` and a `source` saying
 * where it came from. Each of its files is a file document titled with its
 * filename, extension and all, whose `content` is its text; no bytes are kept
 * beside it, since the text is the file. A refresh reads the source again
 * and settles the tree against it by path, keeping each file's id, so a chat
 * that read a file is told when it changed.
 *
 * - **rules** - What comes in: never version control, packages or secrets;
 *   not by default build output, lock files or minified code; and the
 *   codebase's own `.gitignore` files
 * - **language** - A file's language and media type, by its name
 * - **text** - Whether bytes are text, and how many lines a text has
 * - **gather** - Entries listed, sorted by the rules, read, and capped
 * - **github** - A repository downloaded as one archive, in the desktop app
 * - **write** - The tree written, and settled again on a refresh
 * - **tree** - Which repository a document is in
 *
 * `composables/useRepositoryImport.js` puts the steps in order for a folder,
 * for GitHub, and for a refresh. The editor panel shows a file of text in
 * `CodeView.vue`, with CodeMirror.
 *
 * Design: `.llm/source_code_design.md`.
 *
 * @example
 * import { useRepositoryImport } from '@/composables/useRepositoryImport.js'
 *
 * const repositories = useRepositoryImport(storyId)
 * await repositories.importGitHub('https://github.com/owner/repo', { parentId })
 */

export { createRules, NEVER, NOT_BY_DEFAULT } from './rules.js'
export { languageOf, isBinaryName } from './language.js'
export { textOf, lineCount } from './text.js'
export { gatherSource, sortEntries, entriesOfFolder, SourceTooLargeError } from './gather.js'
export { parseGitHubUrl, downloadArchive, readArchive, GitHubError } from './github.js'
export { writeRepository, refreshRepository, contentsOf } from './write.js'
export {
  isRepository,
  repositoryOf,
  inRepository,
  isSourceFile,
  describeRepository,
} from './tree.js'
