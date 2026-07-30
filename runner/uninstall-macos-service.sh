#!/usr/bin/env bash
#
# Stop and remove the Dispatch runner LaunchAgent installed by
# install-macos-service.sh.
#
set -euo pipefail

LABEL="com.dispatch.runner"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ -f "$PLIST" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ Removed '$LABEL'. The runner will no longer auto-start."
else
  echo "Nothing to remove — '$LABEL' is not installed."
fi
