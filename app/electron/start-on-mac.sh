#!/bin/sh
# Runs the desktop app on a Mac from this checkout, with nothing from npm on
# the Mac: npm runs in the container. The container installs node_modules
# here (`npm ci` in app/electron), and what the app runs on there is plain
# JavaScript. This fetches Electron for the Mac, once per version, checks it
# against the hash Electron's package gives for it, and starts it on this
# folder.
#
#   app/electron/start-on-mac.sh
#
# The page comes from the test server on :8002. INKSPRITE_PAGE_URL names
# another; app://inksprite/ is the build in app/dist.

set -eu

here=$(cd "$(dirname "$0")" && pwd)
package="$here/node_modules/electron"

fail() {
  echo "start-on-mac: $*" >&2
  exit 1
}

[ "$(uname -s)" = Darwin ] || fail "this is for a Mac; elsewhere, npm start"
[ -f "$package/checksums.json" ] ||
  fail "no node_modules here: run npm ci in app/electron, in the container"

version=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$package/package.json" | head -n 1)
case "$(uname -m)" in
  arm64) arch=arm64 ;;
  x86_64) arch=x64 ;;
  *) fail "Electron has no build for $(uname -m)" ;;
esac
zip="electron-v$version-darwin-$arch.zip"
app="$HOME/Library/Caches/inksprite/electron-v$version-darwin-$arch/Electron.app"

if [ ! -d "$app" ]; then
  expected=$(sed -n "s/^ *\"$zip\": *\"\([0-9a-f]*\)\".*/\1/p" "$package/checksums.json")
  [ -n "$expected" ] || fail "Electron's package has no checksum for $zip"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  echo "Fetching Electron $version for this Mac, once..."
  curl -fL --progress-bar -o "$tmp/$zip" \
    "https://github.com/electron/electron/releases/download/v$version/$zip"
  [ "$(shasum -a 256 "$tmp/$zip" | cut -d ' ' -f 1)" = "$expected" ] ||
    fail "$zip doesn't match its checksum"
  # ditto, not unzip: it keeps the app's symlinks and its signature whole.
  ditto -x -k "$tmp/$zip" "$tmp"
  mkdir -p "$(dirname "$app")"
  mv "$tmp/Electron.app" "$app"
  rm -rf "$tmp"
  trap - EXIT
fi

exec "$app/Contents/MacOS/Electron" "$here" "$@"
