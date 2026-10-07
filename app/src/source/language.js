/**
 * @module source/language
 * @description What a source file is written in, by its name.
 *
 * Only for the media type a file is stored with and the word a listing uses.
 * Whether a file is text at all is decided by reading it (`source/text.js`),
 * so a file this table has never heard of still comes in, as plain text; and
 * the viewer picks its highlighting by filename itself
 * (`@codemirror/language-data`), so nothing here has to keep up with it.
 */

/**
 * By extension, lowercased: the language's name and the media type to store.
 * A registered type where there is one, `text/x-<language>` otherwise.
 *
 * @type {Record<string, [string, string]>}
 */
const BY_EXTENSION = {
  js: ['JavaScript', 'text/javascript'],
  mjs: ['JavaScript', 'text/javascript'],
  cjs: ['JavaScript', 'text/javascript'],
  jsx: ['JSX', 'text/jsx'],
  ts: ['TypeScript', 'text/x-typescript'],
  mts: ['TypeScript', 'text/x-typescript'],
  cts: ['TypeScript', 'text/x-typescript'],
  tsx: ['TSX', 'text/x-tsx'],
  vue: ['Vue', 'text/x-vue'],
  svelte: ['Svelte', 'text/x-svelte'],
  py: ['Python', 'text/x-python'],
  pyi: ['Python', 'text/x-python'],
  rb: ['Ruby', 'text/x-ruby'],
  go: ['Go', 'text/x-go'],
  rs: ['Rust', 'text/x-rust'],
  java: ['Java', 'text/x-java'],
  kt: ['Kotlin', 'text/x-kotlin'],
  kts: ['Kotlin', 'text/x-kotlin'],
  scala: ['Scala', 'text/x-scala'],
  groovy: ['Groovy', 'text/x-groovy'],
  gradle: ['Groovy', 'text/x-groovy'],
  c: ['C', 'text/x-c'],
  h: ['C', 'text/x-c'],
  cc: ['C++', 'text/x-c++'],
  cpp: ['C++', 'text/x-c++'],
  cxx: ['C++', 'text/x-c++'],
  hpp: ['C++', 'text/x-c++'],
  hh: ['C++', 'text/x-c++'],
  m: ['Objective-C', 'text/x-objectivec'],
  mm: ['Objective-C', 'text/x-objectivec'],
  cs: ['C#', 'text/x-csharp'],
  fs: ['F#', 'text/x-fsharp'],
  swift: ['Swift', 'text/x-swift'],
  dart: ['Dart', 'text/x-dart'],
  php: ['PHP', 'text/x-php'],
  pl: ['Perl', 'text/x-perl'],
  lua: ['Lua', 'text/x-lua'],
  r: ['R', 'text/x-r'],
  jl: ['Julia', 'text/x-julia'],
  ex: ['Elixir', 'text/x-elixir'],
  exs: ['Elixir', 'text/x-elixir'],
  erl: ['Erlang', 'text/x-erlang'],
  hs: ['Haskell', 'text/x-haskell'],
  clj: ['Clojure', 'text/x-clojure'],
  elm: ['Elm', 'text/x-elm'],
  zig: ['Zig', 'text/x-zig'],
  ml: ['OCaml', 'text/x-ocaml'],
  sh: ['Shell', 'text/x-sh'],
  bash: ['Shell', 'text/x-sh'],
  zsh: ['Shell', 'text/x-sh'],
  fish: ['Shell', 'text/x-sh'],
  ps1: ['PowerShell', 'text/x-powershell'],
  sql: ['SQL', 'text/x-sql'],
  graphql: ['GraphQL', 'text/x-graphql'],
  gql: ['GraphQL', 'text/x-graphql'],
  proto: ['Protocol Buffers', 'text/x-protobuf'],
  html: ['HTML', 'text/html'],
  htm: ['HTML', 'text/html'],
  css: ['CSS', 'text/css'],
  scss: ['SCSS', 'text/x-scss'],
  sass: ['Sass', 'text/x-sass'],
  less: ['Less', 'text/x-less'],
  json: ['JSON', 'application/json'],
  jsonc: ['JSON', 'application/json'],
  json5: ['JSON', 'application/json'],
  yaml: ['YAML', 'text/x-yaml'],
  yml: ['YAML', 'text/x-yaml'],
  toml: ['TOML', 'text/x-toml'],
  ini: ['INI', 'text/x-ini'],
  xml: ['XML', 'application/xml'],
  svg: ['SVG', 'image/svg+xml'],
  md: ['Markdown', 'text/markdown'],
  markdown: ['Markdown', 'text/markdown'],
  mdx: ['MDX', 'text/markdown'],
  rst: ['reStructuredText', 'text/x-rst'],
  tex: ['LaTeX', 'text/x-tex'],
  csv: ['CSV', 'text/csv'],
  tsv: ['TSV', 'text/tab-separated-values'],
  tf: ['Terraform', 'text/x-hcl'],
  hcl: ['HCL', 'text/x-hcl'],
  nix: ['Nix', 'text/x-nix'],
  cmake: ['CMake', 'text/x-cmake'],
}

/** Files known by their whole name, lowercased. */
const BY_NAME = {
  makefile: ['Makefile', 'text/x-makefile'],
  gnumakefile: ['Makefile', 'text/x-makefile'],
  dockerfile: ['Dockerfile', 'text/x-dockerfile'],
  containerfile: ['Dockerfile', 'text/x-dockerfile'],
  'cmakelists.txt': ['CMake', 'text/x-cmake'],
  gemfile: ['Ruby', 'text/x-ruby'],
  rakefile: ['Ruby', 'text/x-ruby'],
  justfile: ['Just', 'text/x-just'],
  procfile: ['Procfile', 'text/plain'],
}

/**
 * Extensions that are never text, skipped without being read: pictures,
 * fonts, archives, media, compiled things.
 */
export const BINARY_EXTENSIONS = new Set(
  (
    'png jpg jpeg gif webp ico bmp tif tiff avif heic psd ai sketch fig ' +
    'woff woff2 ttf otf eot ' +
    'zip gz tgz bz2 xz 7z rar tar jar war ear apk ipa dmg iso ' +
    'mp3 mp4 m4a wav ogg flac mov avi mkv webm ' +
    'pdf doc docx xls xlsx ppt pptx odt epub ' +
    'exe dll so dylib a o obj lib class pyc pyo wasm bin dat ' +
    'sqlite sqlite3 db pdb lockb'
  ).split(' ')
)

/** @param {string} name */
const extensionOf = name => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * The language a file is in and the media type to store it with, by its
 * name. Anything unrecognised is plain text.
 *
 * @param {string} filename - The file's name, without the folders above it
 * @returns {{language: string, mime: string}}
 */
export function languageOf(filename) {
  const lower = filename.toLowerCase()
  const found = BY_NAME[lower] || BY_EXTENSION[extensionOf(lower)]
  return found ? { language: found[0], mime: found[1] } : { language: 'Text', mime: 'text/plain' }
}

/**
 * Whether a file's name says it is not text, so it need not be read to find out.
 * @param {string} filename
 * @returns {boolean}
 */
export const isBinaryName = filename => BINARY_EXTENSIONS.has(extensionOf(filename))
