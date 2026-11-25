#!/bin/sh
# Builds the desktop app for a Mac from this checkout, unsigned, for
# install-on-mac.sh to sign and put in place of the installed app. Runs in the
# container, where npm does; a Mac app can be built here but signed only on a
# Mac. install-on-mac.sh runs it here through docker before it signs.
#
#   app/electron/build-for-mac.sh [arm64|x64]
#
# For Apple silicon unless x64 is named. The build is in dist/for-mac, with
# the entitlements electron-builder would sign it with beside it.
#
# Its version comes after the newest release in CHANGELOG.md and before the
# next, with the checkout's commit count in it: 0.1.0-dev.18.1759 after
# 0.1.0-dev.18, and 0.2.1-dev.1759 after 0.2.0. So the updater never offers a
# release older than the build, and takes the next one from GitHub as an
# installed release would.

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
count=$(git -C "$root" rev-list --count HEAD)
case "$release" in
  # A release with a suffix: the count goes after it.
  *-*) version="$release.$count" ;;
  # A plain release: the next patch's dev build, since 0.2.0.1759 isn't a
  # version the updater can read.
  *)
    patch=${release##*.}
    version="${release%.*}.$((patch + 1))-dev.$count"
    ;;
esac

echo "Building the page for inksprite $version..."
(cd "$root/app" && VITE_APP_VERSION=$version npm run build)

echo "Fetching the Python packages..."
(cd "$here" && node scripts/fetch-python.mjs)

# The zip target, though the zip is of no use unsigned, because only a build
# for the updater has the updater's address written into it.
echo "Building the app..."
rm -rf "$out"
(cd "$here" && npx electron-builder --mac zip "--$arch" --publish never \
  -c.directories.output="$out" -c.extraMetadata.version="$version")
rm -f "$out"/*.zip "$out"/*.blockmap "$out"/*.yml
cp "$here/node_modules/app-builder-lib/templates/entitlements.mac.plist" "$out/"

echo "Built inksprite $version."
