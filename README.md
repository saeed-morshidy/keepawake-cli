<div align="center">

# keepawake

**Keep your Linux laptop awake — for a while, on AC, on battery, or both.**
**Change the timer while it runs. Watch the countdown in the top bar.**

[![CI](https://github.com/saeed-morshidy/keepawake-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/saeed-morshidy/keepawake-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Ubuntu 26.04](https://img.shields.io/badge/Ubuntu-26.04%20LTS-E95420?logo=ubuntu&logoColor=white)
![GNOME 45–51](https://img.shields.io/badge/GNOME-45%E2%80%9351-4A86CF?logo=gnome&logoColor=white)

[العربية](README.ar.md) · [Install](#install) · [Usage](#usage) · [Top bar](#top-bar) · [How it works](#how-it-works)

</div>

```text
$ keepawake 2h
✓ keepawake on
  mode    AC + battery (now on ac)
  time    1h 59m left · until 02:47

$ keepawake +30m
✓ extended by 30m 00s
  mode    AC + battery (now on ac)
  time    2h 29m left · until 03:17
```

## Install

```bash
git clone https://github.com/saeed-morshidy/keepawake-cli.git
cd keepawake-cli
./install.sh            # CLI + bash completion + GNOME top-bar icon
```

No `sudo`. Everything goes in your home folder (`~/.local/...`).
On Wayland, log out and back in once so GNOME loads the new icon.
`./install.sh --no-extension` skips the icon; `./install.sh --uninstall` removes it all.

**Needs:** systemd (user session), `systemd-inhibit`, Bash 4.4+. UPower is used
when present to read the power source.

## Usage

```text
keepawake [TIME] [MODE]        start, or change the running timer/mode
keepawake stop                 back to normal power settings
keepawake status [--json|--short]
keepawake watch                live status
keepawake toggle               on ↔ off
```

| You type | Not running | Running |
|---|---|---|
| `keepawake` | start, no timer | show status |
| `keepawake 2h` · `90` · `1h30m` | start for that long | **restart the countdown** at that length |
| `keepawake +30m` | start for 30m | add 30m |
| `keepawake -15m` | — | take 15m off (stops if it hits zero) |
| `keepawake 23:30` · `until "tomorrow 8am"` | run until then | move the end to then |
| `keepawake forever` | start, no timer | drop the timer |
| `keepawake ac` · `battery` · `both` | start in that mode | switch mode, keep the timer |

A bare number is minutes. A clock time that already passed today means tomorrow.

**Modes:** `both` (default) keeps it awake on any power. `ac` only while
plugged in — unplug and normal power settings apply until you plug back in;
`battery` is the reverse. Waiting for the right power source is shown as
*standby*.

**Scripting**

```bash
keepawake status --json   # {"running":true,"protected":true,"mode":"both","power":"ac","started":…,"deadline":…,"remaining":7140}
keepawake status --short  # 1h59m · ∞ · off  — for your prompt or tmux
keepawake -q 1h           # no output; exit code tells you how it went
```

Exit codes: `0` ok · `1` failure · `2` bad arguments · `3` `status` while off
(`status --short` prints `off` and exits `1`).

## Top bar

- **In the bar:** an empty cup when off. When on, a cup with steam and the time
  left next to it — `1:24:05`, `12:30`, or `∞` with no limit. Dimmed while on
  *standby* (waiting for the right power source).
- **Header** — click the row to turn it on (no limit) or off. The line under
  the title says what is happening right now.
- **Countdown** — large time left and when it ends, with **+15m · +30m · +1h**.
- **Keep awake for / Change timer** — **15m · 30m · 1h · 2h · 4h** starts a timer,
  or restarts the running one at that length.
- **Power** — **Any power · AC · Battery**, applied at once if running.

The menu stays open while you click, so you see each change land.

The icon only runs the `keepawake` command, so the terminal and the bar always
show the same thing.

`make ui-test` starts a throwaway headless GNOME Shell, clicks every control
with real pointer events and checks the result (`tests/ui/`).

## How it works

`keepawake` starts a transient **systemd user service** (`keepawake.service`).
The service checks the power source every second and, when it matches the mode,
holds a `systemd-inhibit --what=sleep:idle:handle-lid-switch` lock — the
screen won't blank into suspend and closing the lid won't sleep.

The timer is not a systemd property: it lives in
`$XDG_RUNTIME_DIR/keepawake/config` (`MODE`, `DEADLINE`, `STARTED`), which the
CLI rewrites atomically. The service re-reads it each second, so a new time
takes effect at once without dropping the lock. The service reports back in
`runtime` (`PID`, `PROTECTED`, `POWER`); the top-bar extension watches both
files instead of polling. When the deadline passes the service exits, the lock
goes away, and you get a notification.

Check what is being held: `systemd-inhibit --list` · logs:
`journalctl --user -u keepawake`.

## License

[MIT](LICENSE) © Saeed Morshidy
