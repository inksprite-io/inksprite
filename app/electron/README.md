# The desktop app

inksprite in a window of its own, built with Electron. The page is the same
build the web app serves; this folder is the native side around it. The
design is `.llm/desktop_design.md`.

- `src/main.js` opens the window and keeps it on the page.
- `src/page.js` serves the build to it at `app://inksprite/`.
- `src/preload.cjs` and `src/bridge.js` are what the page may ask of the
  native side: requests to servers, sign-ins in the system browser, links
  opened outside, updates, and the library (`src/platform/` in the page asks).
- `src/library.js` is the library: the folder the projects are kept in, and
  the files in it, held to it.
- `src/exporting.js` writes a project or a folder exported to a folder the
  writer chooses, in place of one there of that name.
- `src/closing.js` has the window wait for the page to save before it
  closes or the app quits.
- `src/gone.js` logs why a window's page died, in `inksprite.log` in the app's
  logs folder (`~/Library/Logs/inksprite` on a Mac; `src/log.js`), and offers
  to reload it.
- `src/sandbox.js` and `sandbox/` are Python for the model: Pyodide in a
  page of its own, fenced from the app's data and the network, a session
  for each chat, with the chat's project read-only at `/project`, its
  files read from the library a piece at a time, and one still only on the
  sync server fetched by the page when it is read. Its packages are fetched
  into `python/` by
  `scripts/fetch-python.mjs`, and `scripts/check-sandbox.js` checks the
  fence in a real Electron. The design is `.llm/code_sandbox_design.md`.
- `electron-builder.yml` is how it is packaged for each system.

Its tests run with the page's (`app/test/electron/`), and `npm run typecheck`
here checks its types.

## Running it on a Mac

npm runs in the container, never on the Mac. Once, and again when this
folder's `package-lock.json` changes, in the container:

```sh
cd app/electron && npm ci && node scripts/fetch-python.mjs
```

What the app runs on in `node_modules` is plain JavaScript, but for node-pty,
which a terminal's shell runs on: it comes with its binaries built for every
system, a Mac's among them, and nothing is compiled when it is installed. So
the container's install serves the Mac too. Then, on the Mac, with the dev
server answering on `http://127.0.0.1:8002` (the test server from
`docker compose`):

```sh
app/electron/start-on-mac.sh
```

The first time, it fetches Electron for the Mac into `~/Library/Caches/
inksprite/`, checked against the hash in `node_modules/electron/
checksums.json`. The window loads the page from the dev server, so an edit to
the app reloads in the window as it does in a browser; an edit here needs the
script again. `INKSPRITE_PAGE_URL` loads the page from elsewhere, and
`app://inksprite/` from the build in `app/dist`. In the container, `npm start`
runs it on Linux (under Xvfb).

The window keeps its own data, apart from any browser's, and a run from here
keeps its data apart from the installed app's. To bring projects over, export
a backup in the browser and restore it in the window (Settings → System). MCP
sign-ins do not come with a backup; sign in again in the window.

## Dev's build as the installed app

To run dev as the installed app, on the installed app's data, on the Mac:

```sh
app/electron/install-on-mac.sh
```

It runs `build-for-mac.sh` in the dev container through docker, which builds
the app for this Mac into `dist/for-mac`, unsigned, since npm runs only in the
container and a Mac app is signed only on a Mac. Then it signs it with the
Developer ID in the Mac's keychain, quits inksprite, puts it in place of
`/Applications/inksprite.app`, and opens it again. `--no-build` installs what
was built last. It is not notarized: macOS asks that only of an app downloaded
from the internet.

Its version is the newest release in `CHANGELOG.md` with the commit count
after it, `0.1.0-dev.18.1759`, so the updater never offers it an older
release, and takes the next one from GitHub. Don't install an older release by
hand after a build of dev: it may not open a database dev has moved on.

The first time, macOS asks to let `codesign` use the key (Always Allow) and
the terminal control inksprite, and may keep the terminal from replacing the
app until it is allowed under Privacy & Security › App Management.

## The library

The projects are kept in a folder, a folder of markdown files each (the
layout is step 3 of `.llm/markdown_library_design.md`): `Projects` in the
app's data folder, `~/Library/Application Support/inksprite/Projects` on a
Mac, and `inksprite-dev/Projects` for a run from here. It isn't asked for,
and Settings → System → Data shows it in Finder.

The first time the app opens with it, the app writes the projects it kept
in IndexedDB until then into the folder, with a toast that says how far it
is, and opens again on them. The app's own copy is left as it was, but a
project the folder holds already is written over only when the app's copy
was changed later, and the folder's copy goes to the trash, as does a
project only the folder holds. The settings and the rest of the app's own
tables stay in the app.

`library.json` beside the folder says, as `"moved"`, whether the app's
projects have been written into it. Until they have, the app opens on its
own projects and writes them in.

## A settings file left by a script

A script that installs the app for a team can leave a settings file (Settings
› System › Export, then Settings) as `inksprite-settings.json` in the app's data
folder: `~/Library/Application Support/inksprite/` on a Mac, `inksprite-dev/`
for a run from here. `src/settingsFile.js` reads it when the page asks, as it
opens, and leaves it there; the page imports what changed since it last did,
without asking (`src/composables/useSettingsFile.js` in the page). The design
is `.llm/settings_import_design.md`.

## Connected apps

Other apps on the computer, a coding agent first, reach the projects the writer
ticked for each over MCP (`.llm/mcp_server_design.md`).

`src/apps.js` keeps the connections in `apps.json` in the app's data folder:
each one's name, its token, its projects and whether it only reads, with the
port (4657 unless changed) and whether the server is on. `src/appServer.js` is
the door: it listens on the loopback, only while there is a connection, the
server is on and a page of this run has said it answers, which only a page
with the feature does. `POST /mcp` with a connection's token is handed whole to
a window's page (`src/appCalls.js`), where the tools are (`src/apps/` in the
page), and `GET /export/<id>` serves, once, a file a tool made ready
(`src/appExports.js`, held in memory for five minutes). What each connection
last had of each document is in `app-reads/` beside `apps.json`
(`src/appReads.js`), for telling it what changed since, and goes with the
document, the project's tick or the connection.

`scripts/check-apps.js` checks a request's way from the door to a page and back
in a real Electron, as `scripts/check-sandbox.js` checks Python.

## The menu

`src/menu.js` is the menu bar. Its File and Window menus have the keys a
browser keeps for its own tabs, which the app has to itself in a window of its
own: New Document, New Chat, Close Tab, Reopen Closed Tab, the tabs stepped
through and gone to by number, Projects… and Settings…. Close Window is on
Shift-Command-W, beside New Window's key, since a tab has Command-W. Each item
sends the page of the window in front a `menu:command`, and the page does it
(`src/platform/menu.js` and `src/composables/useMenuCommands.js` in the page),
since only the page knows which panel the writer is in. Windows and Linux hide
the bar until Alt is pressed, and the keys work all the same.

The Web Inspector is in the View menu, and a right-click → Inspect Element
opens it, in a release build as well: its console is where a failure the app
doesn't show is logged, a chat title the provider refused among them.

## The terminal

The Terminal extension's shells are kept by `src/terminals.js`: each a process
(node-pty) and a copy of its screen (`@xterm/headless`), in the project it was
made in, running on while no window shows it. The page makes one, lists them
and ends one, and never types. The emulator is a page of the shell's own,
`terminal/`, served at `terminal://frame/` and set into the app's page as a
frame, and it alone is handed the port its shell is typed through. The preload
runs in every frame for that, and gives each only what is its own. node-pty's
binaries come built in its package, so nothing is compiled, and are unpacked
beside the archive, where its helper has to be a file. The design is
`.llm/terminal_design.md`.

## A build

`npm run build` writes the page to `app/dist`, and `npm run dist` here wraps
it for the system it runs on. In the container that is Linux: an AppImage and
a `.deb` in `dist/`. A Mac app is built only on a Mac, where electron-builder
needs Node, so Mac builds come from the release workflow.

## A release

`.github/workflows/release.yml` builds the app for macOS (Apple silicon and
Intel Macs, each signed and notarized), Windows (an installer for Intel and
AMD and one for ARM, each signed through Microsoft's Artifact Signing) and
Linux (an AppImage and a `.deb`), and publishes them as the latest release,
with the updates for the apps already installed. It runs when a tag such as
`v0.1.0-dev.4` is pushed, or by hand with one, and only in a public
repository. The app is built as the tag's version, `0.1.0-dev.4`. Its
secrets live in the repository's `release` environment; only the Mac build
uses the Apple ones, and only the Windows build the Azure ones:

| Secret                              | What it is                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `VITE_GOOGLE_DESKTOP_CLIENT_ID`     | The desktop Google client's ID, for imports from Drive (a variable, not a secret)                                  |
| `VITE_GOOGLE_DESKTOP_CLIENT_SECRET` | The desktop Google client's secret                                                                                 |
| `APPLE_CERTIFICATE`                 | The Developer ID Application certificate and its private key, exported from Keychain Access as a `.p12`, in base64 |
| `APPLE_CERTIFICATE_PASSWORD`        | The password the `.p12` was exported with                                                                          |
| `APPLE_API_ISSUER`                  | The App Store Connect API key's issuer ID                                                                          |
| `APPLE_API_KEY`                     | The key's ID                                                                                                       |
| `APPLE_API_KEY_P8`                  | The contents of the key's `.p8` file                                                                               |
| `AZURE_TENANT_ID`                   | The ID of the Microsoft Entra directory that holds the app registration the build signs as                         |
| `AZURE_CLIENT_ID`                   | That app registration's ID; it has the Artifact Signing Certificate Profile Signer role on the certificate profile |
| `AZURE_CLIENT_SECRET`               | Its client secret, which expires on the date chosen when it was made                                               |

## Updates

The app looks for an update as it opens and every hour after, in the
`latest*.yml` of the public repository's latest release (`src/updates.js`),
and downloads one in the background; then a toast offers to restart into it.
Nothing is installed unasked, not even on quitting, and a run from the
checkout never looks.

Each update is checked against the hash its `latest*.yml` gives, which comes
from the same release. A Mac also checks that the new app is signed by the
same developer as the one it replaces. On Windows, from v0.1.0-dev.33, the
updater checks that the new installer is signed under the name the app was
built with (`publisherName` under `azureSignOptions` in
`electron-builder.yml`, which the release workflow checks against the
certificate). The Linux builds carry no signature the system checks, nor did
Windows's before, so a release signs each update with a key
of our own, and the app checks an update against the keys built into it
(`src/updateKeys.js`). For now a failed check is only written to the app's
log (`inksprite.log`), and the update is offered all the same
(`UPDATE_CHECK` is `warn`).
