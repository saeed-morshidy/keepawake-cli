# Changelog

## 2.0.0 — 2026-11-15

- **Live re-timing.** While running, `keepawake 2h` restarts the countdown,
  `+30m` / `-10m` extend or shorten it, `23:30` / `until "tomorrow 8am"` run to
  a clock time, `forever` drops the timer — no restart, no lost inhibitor.
- **Switch mode while running:** `keepawake ac`, `keepawake mode battery`.
- **GNOME top-bar indicator:** icon + remaining time, one-click presets,
  extend buttons, power-mode menu, middle-click to toggle.
- Status as `--json` (scripts) and `--short` (prompts), `watch` for a live view.
- Durations: `90` (minutes), `1h30m`, `1d`; clear errors with exit code 2.
- Desktop notification when the timer ends.
- `toggle`, `--quiet`, `NO_COLOR`, bash completion, installer, tests, CI.

## 1.0.0

- First version: systemd user service + `systemd-inhibit`, AC/battery/both
  modes, fixed duration via `RuntimeMaxSec`.
