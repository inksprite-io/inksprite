#!/bin/bash

# Runs inside the container once, after creation (and again after rebuilds).

set -e

# Fresh named volumes arrive root-owned; hand them to the dev user.
sudo chown node:node "$HOME/.claude" /commandhistory "$HOME/.cache" "$HOME/.cache/ms-playwright"

# Point zsh history at the /commandhistory volume so it survives rebuilds.
# oh-my-zsh only sets HISTFILE when unset, so this export wins. .zshrc is
# regenerated on rebuild, so this appends exactly once per container.
echo 'export HISTFILE=/commandhistory/.zsh_history' >>"$HOME/.zshrc"

bash "$(dirname "$0")/install/install-system-deps.sh"
bash "$(dirname "$0")/install/install-claude-code.sh"

# Browsers for the MCP servers in .mcp.json. The playwright version here MUST
# match @playwright/mcp's bundled playwright-core, or the browser revisions
# won't line up — update both together. Downloads land in the ms-playwright
# volume, so rebuilds only redo the apt deps.
npx -y playwright@1.63.0-alpha-2026-08-31 install --with-deps chromium webkit
# Stable path to Playwright's Chromium for chrome-devtools-mcp. The binary
# lives under an arch-suffixed dir (chrome-linux-arm64 on Apple Silicon), so
# locate it rather than assuming the layout.
CHROME_BIN="$(find "$HOME/.cache/ms-playwright" -maxdepth 3 -type f -name chrome -path "*/chromium-*" | sort | tail -1)"
[ -n "$CHROME_BIN" ]
sudo ln -sf "$CHROME_BIN" /usr/local/bin/chromium-playwright

cd "$(dirname "$0")/../app" && npm ci
