#!/usr/bin/env bash
# Install keepawake for the current user: CLI, bash completion, GNOME top-bar
# extension. Nothing needs sudo.
#
#   ./install.sh                 everything
#   ./install.sh --no-extension  CLI + completion only
#   ./install.sh --uninstall     remove what this script installed
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

UUID="keepawake@saeed-morshidy.github.io"
BIN_DIR="$HOME/.local/bin"
COMP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/bash-completion/completions"
EXT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

if [[ -t 1 ]]; then G=$'\e[32m' Y=$'\e[33m' B=$'\e[1m' R=$'\e[0m'; else G='' Y='' B='' R=''; fi
step() { printf '%s✓%s %s\n' "$G" "$R" "$*"; }
note() { printf '%s!%s %s\n' "$Y" "$R" "$*"; }

with_ext=1 uninstall=0
for a in "$@"; do
    case $a in
        --no-extension) with_ext=0 ;;
        --uninstall)    uninstall=1 ;;
        -h|--help)      sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *)              echo "unknown option: $a" >&2; exit 2 ;;
    esac
done

enabled_list() { gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo '[]'; }

if (( uninstall )); then
    systemctl --user stop keepawake.service 2>/dev/null || true
    gnome-extensions disable "$UUID" 2>/dev/null || true
    rm -f "$BIN_DIR/keepawake" "$COMP_DIR/keepawake"
    rm -rf "$EXT_DIR"
    step "keepawake removed"
    exit 0
fi

# ── CLI ───────────────────────────────────────────────────────────────────
mkdir -p "$BIN_DIR" "$COMP_DIR"

# A session started by the old 1.x script has no state file; stop it so the
# new CLI starts clean.
if systemctl --user is-active --quiet keepawake.service &&
   [[ ! -e "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/keepawake/config" ]]; then
    systemctl --user stop keepawake.service
    note "stopped a session started by the old keepawake — start it again with the new one"
fi

if [[ -f "$BIN_DIR/keepawake" && ! -f "$BIN_DIR/.keepawake.v1.bak" ]] &&
   ! grep -q 'keepawake-cli' "$BIN_DIR/keepawake"; then
    cp -p "$BIN_DIR/keepawake" "$BIN_DIR/.keepawake.v1.bak"
    note "old script kept at $BIN_DIR/.keepawake.v1.bak"
fi

# Install through a temp file + rename: a running service keeps reading its
# own copy instead of a half-written one.
install -m 0755 bin/keepawake "$BIN_DIR/.keepawake.new"
mv -f "$BIN_DIR/.keepawake.new" "$BIN_DIR/keepawake"
step "CLI        → $BIN_DIR/keepawake ($("$BIN_DIR/keepawake" --version))"

"$BIN_DIR/keepawake" completion > "$COMP_DIR/keepawake"
step "completion → $COMP_DIR/keepawake"

case ":$PATH:" in *":$BIN_DIR:"*) ;; *) note "$BIN_DIR is not on your PATH" ;; esac

# ── GNOME extension ───────────────────────────────────────────────────────
if (( with_ext )); then
    if ! command -v gnome-shell >/dev/null 2>&1; then
        note "GNOME Shell not found — skipping the top-bar extension"
    else
        rm -rf "$EXT_DIR"
        mkdir -p "$EXT_DIR"
        cp -r "gnome-extension/$UUID/." "$EXT_DIR/"
        step "extension  → $EXT_DIR"

        if gnome-extensions enable "$UUID" 2>/dev/null; then
            step "extension enabled"
        else
            # The running shell doesn't know it yet (Wayland loads new
            # extensions at login). Mark it enabled for the next session.
            list=$(enabled_list)
            if [[ "$list" != *"'$UUID'"* ]]; then
                if [[ "$list" == "@as []" || "$list" == "[]" ]]; then
                    list="['$UUID']"
                else
                    list="${list%]}, '$UUID']"
                fi
                gsettings set org.gnome.shell enabled-extensions "$list"
            fi
            note "log out and back in once to see the icon in the top bar"
        fi
    fi
fi

printf '\n%sReady.%s Try: keepawake 1h   ·   keepawake status   ·   keepawake --help\n' "$B" "$R"
