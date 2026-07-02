#!/usr/bin/env bash
#
# install.sh — history-trimmer plugin for OpenCode
#
# Usage:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/aetox-skills/history-trimmer/main/install.sh)"
#
set -euo pipefail

PLUGIN_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins"
PLUGIN_FILE="$PLUGIN_DIR/history-trimmer.ts"
RAW_URL="https://raw.githubusercontent.com/aetox-skills/history-trimmer/main/history-trimmer.ts"

# Create plugins directory if missing
mkdir -p "$PLUGIN_DIR"

# Download plugin file
echo "⬇️  Downloading history-trimmer..."
if command -v curl &>/dev/null; then
  curl -fsSL -o "$PLUGIN_FILE" "$RAW_URL"
elif command -v wget &>/dev/null; then
  wget -q -O "$PLUGIN_FILE" "$RAW_URL"
else
  echo "❌ Neither curl nor wget found. Install one of them and try again."
  exit 1
fi

echo "✅ Installed to $PLUGIN_FILE"
echo "🔄 Restart OpenCode to activate the plugin."
