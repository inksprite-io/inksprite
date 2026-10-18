#!/bin/sh
# Builds the desktop app for a Mac from this checkout, unsigned, for
# install-on-mac.sh to sign and put in place of the installed app. Runs in the
# container, where npm does; a Mac app can be built here but signed only on a
# Mac.
#
#   app/electron/build-for-mac.sh [arm64|x64]
#
# For Apple silicon unless x64 is named. The build is in dist/for-mac, with
# the entitlements electron-builder would sign it with beside it.
#
# Its version is the newest release in CHANGELOG.md with the checkout's commit
# count after it: 0.1.0-dev.18.1759. That is after the release, so the updater
# never offers a release older than the build, and before the next one, which
# it takes from GitHub as an installed release would.

set -eu

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
out="$here/dist/for-mac"

fail() {
  echo "build-for-mac: $*" >&2
  exit 1
}

[ "$(uname -s)" != Darwin ] || fail "npm runs in the container: run this there"
arch=${1:-arm64}
case "$arch" in
  arm64 | x64) ;;
  *) fail "a Mac is arm64 or x64, not $arch" ;;
esac
[ -d "$here/node_modules/electron-builder" ] || fail "no node_modules here: run npm ci in app/electron"

release=$(sed -n 's/^## v\([0-9][^ ]*\).*/\1/p' "$root/CHANGELOG.md" | head -n 1)
[ -n "$release" ] || fail "CHANGELOG.md has no release"
version="$release.$(git -C "$root" rev-list --count HEAD)"

echo "Building the page for inksprite $version..."
(cd "$root/app" && VITE_APP_VERSION=$version npm run build)

# The zip target, though the zip is of no use unsigned, because only a build
# for the updater has the updater's address written into it.
echo "Building the app..."
rm -rf "$out"
(cd "$here" && npx electron-builder --mac zip "--$arch" --publish never \
  -c.directories.output="$out" -c.extraMetadata.version="$version")
rm -f "$out"/*.zip "$out"/*.blockmap "$out"/*.yml
cp "$here/node_modules/app-builder-lib/templates/entitlements.mac.plist" "$out/"

echo "Built inksprite $version. On the Mac: app/electron/install-on-mac.sh"
