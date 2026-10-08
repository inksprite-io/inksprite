# The desktop app

inksprite in a native window, built with Tauri 2. The page is the same build
the web app serves; this folder is the native side around it. The design is
`.llm/desktop_design.md`.

## Running it on a Mac

Once:

```sh
xcode-select --install    # not needed if Xcode is installed
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
. "$HOME/.cargo/env"      # or open a new terminal
cargo install tauri-cli --version "^2" --locked
```

Then, with the dev server answering on `http://127.0.0.1:8002` (the test
server from `docker compose`):

```sh
cd app/src-tauri
cargo tauri dev
```

The first build takes a few minutes; later ones are quick. The window loads
the page from the dev server, so an edit to the app reloads in the window as
it does in a browser. Nothing from npm runs on the Mac, because the
`node_modules` in the checkout are built for the container.

The window keeps its own data, apart from any browser's. To bring projects
over, export a backup in the browser and restore it in the window (Settings →
Data). MCP sign-ins do not come with a backup; sign in again in the window.

## A build

`npm run build` in the container writes `app/dist`; `cargo tauri build` on the
Mac wraps it into `inksprite.app`. Unsigned, it opens without a fuss only on
the Mac that built it.

To sign and notarize it, with the Developer ID Application certificate in the
login keychain and an App Store Connect API key saved as a file:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_API_ISSUER=…        # the issuer ID, above the keys in App Store Connect
export APPLE_API_KEY=…           # the key's ID
export APPLE_API_KEY_PATH=~/…/AuthKey_….p8
cargo tauri build
spctl --assess --type execute --verbose=2 target/release/bundle/macos/inksprite.app
```

`security find-identity -v -p codesigning` lists the identities the keychain
can sign with. `spctl` says `source=Notarized Developer ID` when it worked.

## A release

`.github/workflows/release.yml` builds the app for macOS (Apple silicon and
Intel Macs at once, signed and notarized), Windows (an installer, unsigned)
and Linux (an AppImage and a `.deb`), and publishes them as the latest
release, with the updates for the apps already installed. It runs when a tag
such as `v0.1.0-dev.4` is pushed, or by hand with one, and only in a public
repository. The app is built as the tag's version, `0.1.0-dev.4`. Its
secrets live in the repository's `release` environment; only the Mac build
uses the Apple ones:

| Secret                               | What it is                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `VITE_GOOGLE_DESKTOP_CLIENT_ID`      | The desktop Google client's ID, for imports from Drive (a variable, not a secret)                                  |
| `VITE_GOOGLE_DESKTOP_CLIENT_SECRET`  | The desktop Google client's secret                                                                                 |
| `APPLE_CERTIFICATE`                  | The Developer ID Application certificate and its private key, exported from Keychain Access as a `.p12`, in base64 |
| `APPLE_CERTIFICATE_PASSWORD`         | The password the `.p12` was exported with                                                                          |
| `APPLE_SIGNING_IDENTITY`             | `Developer ID Application: Your Name (TEAMID)`                                                                     |
| `APPLE_API_ISSUER`                   | The App Store Connect API key's issuer ID                                                                          |
| `APPLE_API_KEY`                      | The key's ID                                                                                                       |
| `APPLE_API_KEY_P8`                   | The contents of the key's `.p8` file                                                                               |
| `TAURI_SIGNING_PRIVATE_KEY`          | The updater's private key: the contents of the file `cargo tauri signer generate` wrote                            |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password it was made with                                                                                      |

## Updates

The app looks for an update as it opens and every hour after, in the
`latest.json` of the public repository's latest release (`src/update.rs`).
It downloads one in the background and checks its signature against
`plugins.updater.pubkey` in `tauri.conf.json`, then a toast offers to restart
into it. `cargo tauri dev` never looks, and a build made by hand has no
updates of its own: the workflow alone asks for them.

The key pair is made once, on the Mac:

```sh
cargo tauri signer generate -w ~/.tauri/inksprite-updater.key
```

The public key, in `~/.tauri/inksprite-updater.key.pub`, goes in
`tauri.conf.json`; the private key and its password go in the `release`
environment, and somewhere safe besides. An app takes updates signed with the
key it was built with, and no other, so without that key every installed app
has to be replaced by hand.
