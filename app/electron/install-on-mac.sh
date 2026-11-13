#!/bin/sh
# Builds this checkout's app in its dev container (build-for-mac.sh, run there
# through docker, since npm runs only in the container), signs it with the
# Developer ID in this Mac's keychain, and puts it in place of
# /Applications/inksprite.app: quits inksprite, which saves as it quits, swaps
# the app, and opens it again. It is the installed app, on the installed app's
# data. Plain shell, as npm never runs on the Mac.
#
#   app/electron/install-on-mac.sh [--no-build]
#
# --no-build installs what was built last, as it is.
#
# The container is the running one VS Code's Dev Containers made for this
# folder (its devcontainer.local_folder label); INKSPRITE_CONTAINER names
# another. INKSPRITE_SIGN_IDENTITY names the identity to sign with, when the
# keychain has more than one Developer ID Application.
#
# It is never notarized: macOS asks that only of an app downloaded from the
# internet.

set -eu

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd -P)
build="$here/dist/for-mac"
installed=/Applications/inksprite.app
bundle_id=io.inksprite.inksprite

fail() {
  echo "install-on-mac: $*" >&2
  exit 1
}

no_build=
case "${1-}" in
  --no-build) no_build=1 ;;
  "") ;;
  *) fail "usage: install-on-mac.sh [--no-build]" ;;
esac

[ "$(uname -s)" = Darwin ] || fail "this is for a Mac; build-for-mac.sh builds for one in the container"
case "$(uname -m)" in
  arm64) arch=arm64 built="$build/mac-arm64/inksprite.app" ;;
  x86_64) arch=x64 built="$build/mac/inksprite.app" ;;
  *) fail "there is no build for $(uname -m)" ;;
esac

if [ -z "$no_build" ]; then
  command -v docker >/dev/null || fail "docker isn't here to build in the container with"
  container=${INKSPRITE_CONTAINER:-$(docker ps -q --filter "label=devcontainer.local_folder=$root" | head -n 1)}
  [ -n "$container" ] || fail "no dev container is running for $root: open it, or name one in INKSPRITE_CONTAINER"
  # Where the container has this folder, which Dev Containers puts under
  # /workspaces.
  workspace=$(docker inspect -f '{{range .Mounts}}{{if eq .Source "'"$root"'"}}{{.Destination}}{{end}}{{end}}' "$container")
  workspace=${workspace:-/workspaces/$(basename "$root")}
  docker exec -u node -w "$workspace" "$container" app/electron/build-for-mac.sh "$arch" ||
    fail "the build failed in the container"
fi
[ -d "$built" ] || fail "nothing is built for this Mac"
version=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$built/Contents/Info.plist")

identity=${INKSPRITE_SIGN_IDENTITY:-$(security find-identity -v -p codesigning |
  sed -n 's/^ *[0-9]*) \([0-9A-F]*\) "Developer ID Application: .*/\1/p' | head -n 1)}
[ -n "$identity" ] || fail "the keychain has no Developer ID Application to sign with"

# The team an app is signed by, if any.
team() {
  codesign -dv "$1" 2>&1 | sed -n 's/^TeamIdentifier=//p'
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
app="$work/inksprite.app"
# Off the shared folder, and without the attributes codesign refuses.
ditto --norsrc --noextattr --noqtn --noacl "$built" "$app"

echo "Signing inksprite $version..."
# What is inside a bundle before the bundle, since a bundle's signature seals
# what it holds: the deepest first. Each binary and bundle is signed as
# electron-builder signs a release, with the hardened runtime and the same
# entitlements.
sign() {
  codesign --sign "$identity" --force --timestamp=none --options runtime \
    --entitlements "$build/entitlements.mac.plist" "$1"
}
find "$app/Contents" \( -type f -o -type d \( -name '*.app' -o -name '*.framework' \) \) |
  awk -F/ '{ print NF "\t" $0 }' | sort -rn -k 1,1 | cut -f 2- |
  while IFS= read -r item; do
    if [ -d "$item" ] || file -b "$item" | grep -q '^Mach-O'; then sign "$item"; fi
  done
sign "$app"
codesign --verify --deep --strict "$app"

# A release updates the app only if it is signed by the same team.
if [ -d "$installed" ]; then
  was=$(team "$installed")
  now=$(team "$app")
  [ -z "$was" ] || [ "$was" = "not set" ] || [ "$was" = "$now" ] ||
    fail "this is signed by team $now, and the installed app by $was: releases would no longer update it"
fi

if pgrep -xq inksprite; then
  echo "Quitting inksprite..."
  osascript -e "tell application id \"$bundle_id\" to quit"
  waited=0
  while pgrep -xq inksprite; do
    [ "$waited" -lt 60 ] || fail "inksprite hasn't quit"
    sleep 1
    waited=$((waited + 1))
  done
fi

if [ -d "$installed" ]; then
  mv "$installed" "$work/installed.app" ||
    fail "macOS kept the app from being replaced: allow the terminal under System Settings › Privacy & Security › App Management"
fi
if ! mv "$app" "$installed"; then
  [ ! -d "$work/installed.app" ] || mv "$work/installed.app" "$installed"
  fail "the app couldn't be put in $installed"
fi

open "$installed"
echo "inksprite $version is installed."
