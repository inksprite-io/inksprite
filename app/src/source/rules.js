/**
 * @module source/rules
 * @description What of a codebase comes in, and what is left out.
 *
 * Two lists and the codebase's own `.gitignore` files. What is let in can
 * go to a model provider the first time a chat searches, so the first list
 * is the one nothing overrides: version control's own folder, installed
 * packages, and the files secrets live in, even when someone committed one.
 * The second is what is rarely worth reading — build output, lock files,
 * minified bundles — and a `.gitignore` can bring one back with `!`.
 *
 * Paths are relative to the codebase's top, with `/` between folders and no
 * leading slash, the way `ignore` takes them.
 */

import ignore from 'ignore'

/** Never let in. */
export const NEVER = [
  '.git/',
  '.hg/',
  '.svn/',
  'node_modules/',
  '.env',
  '.env.*',
  '.envrc',
  '.npmrc',
  '.yarnrc.yml',
  '.netrc',
  '.pypirc',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.keystore',
  'id_rsa*',
  'id_dsa*',
  'id_ecdsa*',
  'id_ed25519*',
  '.aws/',
  '.ssh/',
  '.gnupg/',
]

/** Left out unless a `.gitignore` says otherwise. */
export const NOT_BY_DEFAULT = [
  'dist/',
  'build/',
  'out/',
  'target/',
  '.next/',
  '.nuxt/',
  '.svelte-kit/',
  '.turbo/',
  '.cache/',
  '.parcel-cache/',
  '.gradle/',
  '.idea/',
  '__pycache__/',
  '.venv/',
  'venv/',
  '.tox/',
  '.mypy_cache/',
  '.pytest_cache/',
  'vendor/',
  'coverage/',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'poetry.lock',
  'Pipfile.lock',
  'composer.lock',
  'Gemfile.lock',
  'go.sum',
  '*.min.js',
  '*.min.css',
  '*.map',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
]

/** Why something was left out. @typedef {'never'|'ignored'} LeftOutBy */

/**
 * The rules for one codebase.
 *
 * @typedef {Object} Rules
 * @property {(path: string) => LeftOutBy|null} check - Why a file is left
 *   out, or null when it comes in
 * @property {(folder: string, text: string) => void} addGitignore - A
 *   `.gitignore` found in `folder` ('' for the top), applying below it
 */

/**
 * Rules starting from the two lists, ready to take `.gitignore` files.
 *
 * A file comes in unless the first list has it, or the last rule that
 * speaks of it — the defaults, then each `.gitignore` from the top down, a
 * nearer one later — leaves it out. That is git's own order: a nested
 * `.gitignore` can take back what the one above it said.
 *
 * @returns {Rules}
 */
export function createRules() {
  const never = ignore().add(NEVER)
  const defaults = ignore().add(NOT_BY_DEFAULT)
  /** @type {Map<string, ReturnType<typeof ignore>>} */
  const gitignores = new Map()

  return {
    check(path) {
      if (never.ignores(path)) return 'never'
      let left = defaults.ignores(path)
      // Shallowest first, so a nearer file has the last word.
      const folders = [...gitignores.keys()]
        .filter(folder => folder === '' || path.startsWith(`${folder}/`))
        .sort((a, b) => a.length - b.length)
      for (const folder of folders) {
        const matcher = /** @type {any} */ (gitignores.get(folder))
        const relative = folder ? path.slice(folder.length + 1) : path
        // The folders on the way down speak first, so `!dist/` brings back
        // what is in a folder the defaults left out.
        const parts = relative.split('/')
        const asked = [
          ...parts.slice(0, -1).map((_, at) => `${parts.slice(0, at + 1).join('/')}/`),
          relative,
        ]
        for (const candidate of asked) {
          const said = matcher.test(candidate)
          if (said.ignored) left = true
          else if (said.unignored) left = false
        }
      }
      return left ? 'ignored' : null
    },
    addGitignore(folder, text) {
      gitignores.set(folder, ignore().add(text))
    },
  }
}
