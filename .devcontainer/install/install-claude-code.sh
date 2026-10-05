#!/bin/bash

# Install Claude Code using nvm to manage Node.js

set -e

# Install Claude Code globally
echo "Installing Claude Code..."
npm install -g @anthropic-ai/claude-code

# Verify installation
echo "Verifying installation..."
claude --version

echo "Claude Code installation complete!"