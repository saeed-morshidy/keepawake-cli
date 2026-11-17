# Changelog

## 2.1.0 — 2026-11-17

Top-bar extension, rebuilt after testing on GNOME 50:

- **Fix: controls fought each other.** On GNOME 50 a switch fires its
  "toggled" signal when its state is *set*, so every refresh re-ran start/stop:
  timers turned into "no limit" and stops were undone. The UI now only shows
  state; actions come from clicks only.
- **Fix: errors on every pointer event** (a removed GNOME 50 virtual function).
- Time always shown in the bar while on: `1:24:05`, `12:30` or `∞`.
- Cup icon redrawn at full size, as fills (the shell's symbolic renderer drops
  strokes) — matches the icons next to it.
- Tidy menu: header row with switch, large countdown, equal-width buttons in
  one style, power as a three-way choice; the menu stays open while you click.
- `tests/ui/`: headless GNOME Shell test that clicks every control with real
  pointer events (`make ui-test`).

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
