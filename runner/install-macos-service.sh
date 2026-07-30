#!/usr/bin/env bash
#
# Install the Dispatch runner as an always-on macOS LaunchAgent, so it starts
# at login and restarts automatically if it crashes or the machine reboots.
# It bakes in your CURRENT PATH and DISPATCH_* environment variables, so the
# background daemon sees the same `claude`, `gh`, `git` and settings you use
# interactively. Re-run this after changing any DISPATCH_* variable.
#
#   bash runner/install-macos-service.sh
#
set -euo pipefail

LABEL="com.dispatch.runner"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE="$(command -v node || true)"

if [ -z "$NODE" ]; then
  echo "✗ node not found on PATH. Install Node 18+ and try again." >&2
  exit 1
fi
if [ ! -f "$DIR/runner.js" ]; then
  echo "✗ runner.js not found next to this script ($DIR)." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.dispatch"

# Reproduce the tools/config the daemon needs: your interactive PATH plus every
# DISPATCH_* var (and RUNNER_NAME) currently exported in this shell.
ENV_XML="    <key>PATH</key><string>$PATH</string>"
while IFS='=' read -r name value; do
  case "$name" in
    DISPATCH_*|RUNNER_NAME)
      # XML-escape &, <, >
      esc=$(printf '%s' "$value" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')
      ENV_XML="$ENV_XML
    <key>$name</key><string>$esc</string>" ;;
  esac
done < <(env)

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/runner.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$HOME/.dispatch/runner.log</string>
  <key>StandardErrorPath</key><string>$HOME/.dispatch/runner.log</string>
  <key>EnvironmentVariables</key>
  <dict>
$ENV_XML
  </dict>
</dict>
</plist>
PLIST_EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "✓ Installed & started '$LABEL' (auto-starts at login, restarts on crash)."
echo "  Logs:      tail -f ~/.dispatch/runner.log"
echo "  Stop:      bash runner/uninstall-macos-service.sh"
if [ "${DISPATCH_STUB:-}" != "0" ]; then
  echo "  ⚠ DISPATCH_STUB is not 0 — the runner will run in STUB mode (no real PRs)."
  echo "    export DISPATCH_STUB=0 (and your other DISPATCH_* vars), then re-run this."
fi
