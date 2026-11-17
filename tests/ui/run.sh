#!/usr/bin/env bash
# Run the top-bar extension in a throwaway headless GNOME Shell, drive it with
# real pointer events and save screenshots. Uses (and stops) the real
# keepawake user service, so don't run it while you rely on keepawake.
#
#   tests/ui/run.sh [STEPS.json] [OUTDIR]     (default: tests/ui/smoke.json)
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
STEPS=$(cat "${1:-$(dirname "$0")/smoke.json}")
OUT=${2:-$(mktemp -d /tmp/keepawake-ui.XXXXXX)}
UUID=keepawake@saeed-morshidy.github.io
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
REAL_BUS=${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}

T=$(mktemp -d /tmp/keepawake-shell.XXXXXX)
cleanup() {
    # The shell runs in its own process group (setsid): take all of it down.
    if [[ -n "${pid:-}" ]]; then
        kill -- "-$pid" 2>/dev/null
        sleep 1
        kill -9 -- "-$pid" 2>/dev/null
    fi
    rm -rf "$T"
}
trap cleanup EXIT
mkdir -p "$T/data/gnome-shell/extensions" "$T/config/glib-2.0/settings" "$T/bin" "$OUT"
rm -f "$OUT"/*.png "$OUT/log.txt"
cp -r "$ROOT/gnome-extension/$UUID" "$ROOT/tests/ui/katest@local" "$T/data/gnome-shell/extensions/"
cat > "$T/config/glib-2.0/settings/keyfile" <<EOF
[org/gnome/shell]
enabled-extensions=['$UUID', 'katest@local']
disable-user-extensions=false
welcome-dialog-last-shown-version='999'

[org/gnome/desktop/interface]
color-scheme='prefer-dark'
EOF
# The nested shell has its own session bus; the CLI must reach the real one.
printf '#!/bin/sh\nexec env DBUS_SESSION_BUS_ADDRESS=%s %s "$@"\n' "$REAL_BUS" "$ROOT/bin/keepawake" > "$T/bin/keepawake"
chmod +x "$T/bin/keepawake"

setsid dbus-run-session -- env XDG_DATA_HOME="$T/data" XDG_CONFIG_HOME="$T/config" \
    GSETTINGS_BACKEND=keyfile PATH="$T/bin:$PATH" KA_TEST_OUT="$OUT" KA_TEST_STEPS="$STEPS" \
    gnome-shell --headless --wayland --no-x11 --wayland-display=keepawake-test \
    --virtual-monitor 1280x800 > "$OUT/shell.log" 2>&1 &
pid=$!

for _ in $(seq 1 120); do
    grep -q '^DONE' "$OUT/log.txt" 2>/dev/null && break
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
done
cat "$OUT/log.txt" 2>/dev/null || { echo "no log; shell output:"; tail -30 "$OUT/shell.log"; }
grep -E 'JS ERROR|keepawake|katest' "$OUT/shell.log" | grep -v '^$' | head -20 || true
echo "OUT=$OUT"
grep -q '^DONE' "$OUT/log.txt" 2>/dev/null || { echo "driver did not finish"; exit 1; }
if grep -q '^FAIL' "$OUT/log.txt"; then echo "UI test: FAILED"; exit 1; fi
echo "UI test: passed ($(grep -c '^PASS' "$OUT/log.txt") checks)"
