# Desktop App

inksprite as a Tauri v2 app: the same build in a native window, with requests
that leave the page. This takes over step 4 of `markdown_library_design.md`
and ships before that design's step 3. The shell comes first, over the
IndexedDB the web app already uses, and the library on disk follows as an
update.

Decided 6 Oct 2026, after steps 1 and 2 of the library design were built.

## Why the shell comes first

The library design put the shell last because the on-disk layout waited on the
content format. Step 1 settled the format, and since then the shell has become
worth having without a library:

- **MCP servers that refuse a page.** A server has to allow the app's origin
  and expose `Mcp-Session-Id` to it, and many hosted ones (Sentry, Asana,
  Vercel, Supabase, Stripe) do neither. A request made from the native side
  has no origin to refuse.
- **Model servers on the local network.** The hosted app is https, and mixed
  content blocks `http://192.168.x.x`. Only `localhost` is exempt.
- **stdio MCP servers**, later. A page cannot start a program.

Step 3a grew while it waited: the `files`, `jobs`, `skills` and `mcpServers`
tables, hard deletes, chats in the tens of megabytes. Shipping the shell first
keeps the engine risk apart from the largest step.

## Decisions

- **Tauri v2.** Small downloads, a first-party updater and signing, and
  permissions scoped per plugin. Electron stays the fallback if the engine
  checks below fail. stdio does not argue for Electron: the MCP client runs in
  the page, so Electron would need a bridge to it as well.
- **Identifier `io.inksprite.inksprite`.** It fixes where the app keeps its
  data, IndexedDB included, so it does not change once anyone else has
  installed a build. Not `io.inksprite.app`: an identifier ending in `.app`
  clashes with the bundle extension on macOS.
- **macOS first.** Development and the first builds happen on a Mac. Linux and
  Windows get a test pass on real machines before v1.
- **Updates from GitHub Releases** through `tauri-plugin-updater`. No store
  and no itch for now.
- **stdio after v1.**
- **Data stays in the webview's IndexedDB** until the library on disk. A
  backup from the web app restores into the desktop app; nothing else
  migrates. MCP sign-ins live in `localStorage` (`mcp/auth.js`) and are not
  in a backup, so each server is signed in to again.

---

# Milestone 1: a signed build from GitHub

A build to install on another Mac and run against hosted MCP servers that
refuse a page, most of them behind OAuth. It needs the scaffold, the fetch seam, OAuth
outside the page, and a signed release on GitHub (below). It does not need the
updater, file dialogs, Linux, Windows, or stdio.

**Another Mac only installs a release.** Nothing is built on it or copied to
it: it downloads a signed, notarized build from the public repository's GitHub
Releases, as it would any other app. Every try on it costs a release, so
everything is tried on the development Mac first: a local MCP server that
refuses a page (`npm run mcp-server -- --no-cors`), and a hosted one with
OAuth.

## Scaffold and the dev loop

`app/src-tauri/` holds the Rust crate, `tauri.conf.json`, and `capabilities/`.

The checkout lives on the Mac and is mounted into the dev container, where
`node_modules` are Linux builds. So each half runs where it already works:

- **Vite stays in the container**, as the test server on :8002.
  `devUrl: http://127.0.0.1:8002`, and no `beforeDevCommand`. The address,
  not `localhost`, because the test server binds IPv4 and `localhost` on a
  Mac can try IPv6 first.
- **`cargo tauri dev` runs on the Mac**, from `app/src-tauri`. It needs Rust
  and the Xcode command line tools, and nothing from npm. A frontend edit
  hot-reloads in the window as it does in the browser.
- **A build** is `npm run build` in the container, then `cargo tauri build`
  on the Mac against `frontendDist: ../dist`.

`src-tauri/target/` is large and gitignored. Vite (`server.watch.ignored`),
ESLint and Prettier ignore `src-tauri/`, or every Rust build is a storm of
file events through the mount.

In dev the window loads `http://127.0.0.1:8002`, with a store of its own.
The app tells the window from a browser at runtime, by the
`__TAURI_INTERNALS__` global Tauri gives the page (`isDesktop()` in
`src/platform/fetch.js`), not with a build flag: in dev the browser and the
window load the same bundle.

## The fetch seam

`src/platform/fetch.js` exports one `fetch`: the page's own on the web, and
`@tauri-apps/plugin-http`'s in the app, loaded with a dynamic import only when
`isDesktop()`. Everything that reaches a server takes it:

| Site | Requests |
| --- | --- |
| `ai/complete.js:66` | chat completions |
| `composables/useAIService.js` (six) | models, providers, endpoints, keys, streaming |
| `tts/client.js:98`, `:125` | speech, voices |
| `mcp/client.js:104`, `:115` | both transports, through their `fetch` option |
| `mcp/auth.js` | discovery, registration, tokens, through the SDK's `fetchFn` |

`plugin-http`'s scope allows any `http` and `https` URL, because the servers
are the writer's to choose. That makes the window a browser without CORS for
the page's own code, which is the point. The page renders model output, so
the markdown renderer's rule that no HTML gets through (`utils/markdown.js`)
is part of that boundary, as it already is on the web.

Streaming and stopping through the plugin are what has to be proved.
`useAIService` reads `response.body.getReader()`, and work stops by its own
signal (the AbortSignal convention): a stop partway through a stream has to
cancel the request in Rust, not only stop reading it.

## OAuth outside the page

Both sign-ins open a tab and wait to hear back in the page. OpenRouter's
callback page posts to `window.opener` (`utils/oauth.js:121`,
`OpenRouterCallback.vue`); MCP's uses a `BroadcastChannel`
(`useMcpServers.js:127`). Neither reaches from the system browser into the
window.

On desktop a sign-in opens the system browser at the provider, and the
window waits for the browser to come back (`platform/signIn.js`,
`src-tauri/src/sign_in.rs`):

- **`sign_in_in_browser`** (Rust) listens on `localhost:41721`, IPv4 and IPv6,
  then opens the address with the opener plugin, from Rust, so the page holds
  no "open any URL" permission. The first request to the expected path gets a
  page saying to go back to inksprite, its query goes to the page on a
  channel, and the window comes to the front. Anything else gets a 404. It
  waits ten minutes at most; a new sign-in takes the place of one still
  waiting, and `stop_sign_in` ends one early.
- **The port is fixed,** not picked fresh. A server registers the app with the
  address it will send the writer back to, and some hold it to exactly that
  address. `localhost` rather than `127.0.0.1`, because the MCP spec asks for
  localhost redirects and OpenRouter accepts localhost on any port.
- **The page finishes the sign-in itself.** MCP: `useMcpServers.signIn` calls
  `finishSignIn` with the query, as `McpCallback.vue` does in a browser.
  OpenRouter: `useOpenRouterSignIn.start` calls `finish`, the same code
  `OpenRouterCallback.vue` runs, then posts the `oauth-success` message to its
  own window, so whoever listens for it hears it as they would from a tab.
- **MCP's client ID document** (`inksprite.io/oauth/mcp-client.json`) is only
  used on the web origin. The desktop app registers with each server
  dynamically, under the localhost address. Adding that address to the
  document would let servers that only take the document accept the desktop
  app too.

Pasting an OpenRouter key works regardless.

## Routing

The router uses `createWebHistory` (`router/index.js:67`). Under
`tauri://localhost`, a reload of `/write/:id` may 404, depending on whether
the asset server falls back to `index.html`. This is checked in a built app,
since dev serves from Vite. If it 404s: `createWebHashHistory` when
`isDesktop()`.

## Checks before going further

On the Mac, in WKWebView:

1. Write in the editor for an hour, with an input method and dictation.
2. Stream a generation and stop it partway, through `plugin-http`.
3. Open a long PDF and an epub in their viewers.
4. Load the 72MB chat and watch memory. The heap work was tuned on V8; this
   is JavaScriptCore.
5. Connect to a hosted MCP server that refuses a page, sign in, and call a
   tool.
6. Export a backup, and see whether a download from a blob URL lands
   anywhere.

If the editor or memory fails here, Electron is the fallback and the rest of
this design holds.

Checks 1, 3 and 4 can run early in Playwright's WebKit against the dev
server, with no Tauri at all. Its engine is close to Safari's, and newer than
the WebKitGTK that Linux distributions ship.

## A signed release

`cargo tauri dev`, and a build run on the Mac that made it, need no signing.
Any other Mac needs a build signed with a Developer ID certificate and
notarized, or Gatekeeper stops it; a managed Mac may not offer the way around.
That takes the Apple Developer Program (individual enrollment, under the
developer's own name).

The build is made by GitHub Actions, not on a personal machine: `tauri-action`
on a macOS runner, a universal binary (Apple silicon and Intel), signed and
notarized with secrets kept in the repository, published as a pre-release.
It runs on a tag or by hand, never on a pull request, so a fork's code never
sees the signing secrets. It lives in the public repository, because the work
Mac downloads without signing in to GitHub, and a release on a private
repository cannot be downloaded that way.

Built as `.github/workflows/release.yml` (6 Oct 2026): the Tauri CLI from
`cargo install`, pinned to the version the app is built on; notarization by
App Store Connect API key, not an Apple ID password; `spctl` and `stapler`
checking the app before the DMG goes out; and the job skipped in a private
repository, where it would cost macOS minutes for a release nobody outside
could download. The secrets, and signing a build by hand on the Mac, are in
`app/src-tauri/README.md`. The DMG keeps the version in `tauri.conf.json`,
so every pre-release is `inksprite_0.1.0_universal.dmg` until v1 sets
versions from tags.

---

# v1

- **Linux and Windows**, tested on real machines. WebKitGTK is the likeliest
  to fail, on the editor and the PDF view.
- **`tauri-action`** builds Linux and Windows too, beside the macOS build
  milestone 1 set up.
- **`tauri-plugin-updater`** reading `latest.json` from GitHub Releases,
  signed with the updater's own key.
- **Backup export and import** through `plugin-dialog` and `plugin-fs`, if
  check 6 fails.
- **Distribution.** macOS signed and notarized; Linux AppImage and `.deb`;
  Windows unsigned (SmartScreen warns) until signing is worth paying for.
- **Analytics stays out.** The desktop build does not set
  `VITE_VERCEL_ANALYTICS`.

# After v1: stdio MCP servers

A Rust module, `mcp_stdio`, and an MCP SDK `Transport` over it in the page.

- **Commands:** `spawn(serverId)`, `write(id, line)`, `kill(id)`, and a
  channel that streams output lines back to the page.
- **`spawn` takes a server id, not a command line.** Rust reads the command
  from the writer's saved servers, and asks in a native dialog the first time
  a command runs or after it changes. A page that renders model output never
  holds "run this program".
- **Processes belong to Rust**, so a page reload does not orphan them. Each
  runs under `process-wrap` (a process group on macOS and Linux, a Job Object
  on Windows), so stopping a server stops what `npx` started under it. All of
  them stop when the app quits.
- **The environment.** An app launched from Finder has no login shell's
  `PATH`, so `npx` from nvm or Homebrew is not found: `fix-path-env` at
  startup. On Windows, launchers are `.cmd` shims, found with `which` and
  started with no console window.
- **The page** offers the stdio transport only when the command exists
  (`#[cfg(desktop)]`), so the web build never sees it. On desktop, a pasted
  entry with a `command` no longer shows as needing a bridge.

# Then: the library on disk

Step 3 of `markdown_library_design.md`, shipped as an update. The adapter seam
goes in on the web first. On desktop, moving to a folder reads through the
Dexie adapter and writes through the filesystem one, so the writer's data in
IndexedDB comes along without a backup round trip. Watching (3b) follows.

# Mobile

Not planned. Noted so nothing here forecloses it. Tauri v2 builds iOS and
Android from the same project. stdio is desktop-only. OAuth needs a deep
link, because iOS suspends an app while the browser is in front.
Local-network servers need a permission prompt and a cleartext exception.
Mobile would stay on IndexedDB. The built-in Roleplay (NSFW) profile is the
likely App Store review problem, though it is offered only once switched on
in the settings.

# Known issues

To move to GitHub issues on the public repository once it is set up.

- **Spelling in the window** (found 6 Oct 2026, first `cargo tauri dev` on
  the Mac). Some misspelled words are corrected as they are typed, and none
  are underlined. The editor sets no `spellcheck` or `autocorrect` attribute,
  so the window gets WKWebView's defaults. A likely cause, not checked: a
  WKWebView leaves "check spelling while typing" off unless the app turns it
  on (Safari does, from its Edit menu), while correcting as you type follows
  the macOS keyboard setting. The direction the writer wants is a spelling
  library of our own, the same in every engine, rather than whatever each
  webview does.

# Open questions

- **Keys.** Provider keys and MCP sign-ins stay where the web keeps them, in
  the webview's storage, for v1. The OS keychain later.
- **Does `plugin-http` cancel a stream mid-body on abort?** Check 2.
- **`plugin-http` sends the page's `Origin`:** `http://127.0.0.1:8002` in
  dev, `tauri://localhost` in a build (seen 6 Oct 2026). A server that leaves
  CORS to the browser takes the request; one that checks `Origin` itself
  still refuses. If a server does, the plugin's `unsafe-headers` feature
  is the place to look for dropping the header.
