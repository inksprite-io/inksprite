#!/bin/sh
# Rebuild the docker test server on :8002. Run it after a change to the app's
# dependencies, or a merge that touches package.json, package-lock.json,
# vite.config.js or index.html.
#
# Those four are mounted into the container one file at a time, and git
# replaces a file rather than editing it, so a running container can be left
# pointing at the old one. So no `npm install` inside the container: this
# builds a fresh image (`npm ci` from the lock file), starts a fresh container
# on the current files, and gives it a fresh node_modules volume, without
# which the old one would hide the new packages.
set -e
cd "$(dirname "$0")"
docker compose up -d --build --renew-anon-volumes app
