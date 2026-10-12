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
- `electron-builder.yml` is how it is packaged for each system.

Its tests run with the page's (`app/test/electron/`), and `npm run typecheck`
here checks its types.

## Running it on a Mac

npm runs in the container, never on the Mac. Once, and again when this
folder's `package-lock.json` changes, in the container:

```sh
cd app/electron && npm ci
```

What the app runs on in `node_modules` is plain JavaScript, so the
container's install serves the Mac too. Then, on the Mac, with the dev server
answering on `http://127.0.0.1:8002` (the test server from `docker compose`):

```sh
app/electron/start-on-mac.sh
```

The first time, it fetches Electron for the Mac into `~/Library/Caches/
inksprite/`, checked against the hash in `node_modules/electron/
checksums.json`. The window loads the page from the dev server, so an edit to
the app reloads in the window as it does in a browser; an edit here needs the
script again. `INKSPRITE_PAGE_URL` loads the page from elsewhere, and
`app://inksprite/` from the build in `app/dist`. In the container, `npm start`
runs it on Linux (under Xvfb, with `--no-sandbox`).

The window keeps its own data, apart from any browser's, and a run from here
keeps its data apart from the installed app's. To bring projects over, export
a backup in the browser and restore it in the window (Settings → System). MCP
sign-ins do not come with a backup; sign in again in the window.

## The library

The projects can be kept in a folder, a folder of markdown files each (the
layout is step 3 of `.llm/markdown_library_design.md`): `Projects` in the
app's data folder, `~/Library/Application Support/inksprite/Projects` on a
Mac, and `inksprite-dev/Projects` for a run from here. It isn't asked for.
Settings → System → Data → Keep projects in a folder switches it on and off,
and shows the folder while it is on. It is off in a release until it has
been tried more widely, and on for a run from here.

Switched on, the app writes the projects it kept until then into the
folder, with a toast that says how far it is, and opens again on them. The
app's own copy is left as it was, but a project the folder holds already is
written over only when the app's copy was changed later, and the folder's
copy goes to the trash. Switched off, the folder's
projects are copied back over the app's, and the folder's files stay where
they are. The settings and the rest of the app's own tables stay in the app
either way.

The switch is kept in `library.json` beside the folder: `"enabled"`, unset
meaning the default above, and `"moved"`, whether the app's projects have
been written into the folder. With `"moved": false` and the switch on, the
app opens on its own projects and writes them in.

The Web Inspector is in the View menu, and a right-click → Inspect Element
opens it, in a release build as well: its console is where a failure the app
doesn't show is logged, a chat title the provider refused among them.

## A build

`npm run build` writes the page to `app/dist`, and `npm run dist` here wraps
it for the system it runs on. In the container that is Linux: an AppImage and
a `.deb` in `dist/`. A Mac app is built only on a Mac, where electron-builder
needs Node, so Mac builds come from the release workflow.

## A release

`.github/workflows/release.yml` builds the app for macOS (Apple silicon and
Intel Macs, each signed and notarized), Windows (an installer, unsigned) and
Linux (an AppImage and a `.deb`), and publishes them as the latest release,
with the updates for the apps already installed. It runs when a tag such as
`v0.1.0-dev.4` is pushed, or by hand with one, and only in a public
repository. The app is built as the tag's version, `0.1.0-dev.4`. Its
secrets live in the repository's `release` environment; only the Mac build
uses the Apple ones:

| Secret                              | What it is                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `VITE_GOOGLE_DESKTOP_CLIENT_ID`     | The desktop Google client's ID, for imports from Drive (a variable, not a secret)                                  |
| `VITE_GOOGLE_DESKTOP_CLIENT_SECRET` | The desktop Google client's secret                                                                                 |
| `APPLE_CERTIFICATE`                 | The Developer ID Application certificate and its private key, exported from Keychain Access as a `.p12`, in base64 |
| `APPLE_CERTIFICATE_PASSWORD`        | The password the `.p12` was exported with                                                                          |
| `APPLE_API_ISSUER`                  | The App Store Connect API key's issuer ID                                                                          |
| `APPLE_API_KEY`                     | The key's ID                                                                                                       |
| `APPLE_API_KEY_P8`                  | The contents of the key's `.p8` file                                                                               |

## Updates

The app looks for an update as it opens and every hour after, in the
`latest*.yml` of the public repository's latest release (`src/updates.js`),
and downloads one in the background; then a toast offers to restart into it.
Nothing is installed unasked, not even on quitting, and a run from the
checkout never looks.

Each update is checked against the hash its `latest*.yml` gives, which comes
from the same release. A Mac also checks that the new app is signed by the
same developer as the one it replaces; the Windows and Linux builds are not
signed, so there the release itself is what an update is trusted on.
