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

`.github/workflows/release.yml` builds the app for Apple silicon and Intel
Macs at once, signs and notarizes it, and publishes it as a pre-release. It
runs when a tag starting with `v` is pushed, or by hand with one, and only in
a public repository. Its secrets live in the repository's `release`
environment:

| Secret                       | What it is                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `APPLE_CERTIFICATE`          | The Developer ID Application certificate and its private key, exported from Keychain Access as a `.p12`, in base64 |
| `APPLE_CERTIFICATE_PASSWORD` | The password the `.p12` was exported with                                                                          |
| `APPLE_SIGNING_IDENTITY`     | `Developer ID Application: Your Name (TEAMID)`                                                                     |
| `APPLE_API_ISSUER`           | The App Store Connect API key's issuer ID                                                                          |
| `APPLE_API_KEY`              | The key's ID                                                                                                       |
| `APPLE_API_KEY_P8`           | The contents of the key's `.p8` file                                                                               |
