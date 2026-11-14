#!/usr/bin/env bash
# Unit tests for the pure parts of keepawake (no systemd needed).
set -u
# shellcheck source=SCRIPTDIR/../bin/keepawake
source "$(dirname "$0")/../bin/keepawake"

pass=0 fail=0
eq() { # name expected actual
    if [[ "$2" == "$3" ]]; then (( pass++ )); else (( fail++ )); printf 'FAIL %s: want [%s] got [%s]\n' "$1" "$2" "$3"; fi
}
bad() { # name, command...
    local n=$1; shift
    if "$@" >/dev/null 2>&1; then (( fail++ )); printf 'FAIL %s: should be rejected\n' "$n"; else (( pass++ )); fi
}

eq "bare minutes"  5400  "$(parse_duration 90)"
eq "seconds"       45    "$(parse_duration 45s)"
eq "minutes"       1800  "$(parse_duration 30m)"
eq "hours"         7200  "$(parse_duration 2h)"
eq "days"          86400 "$(parse_duration 1d)"
eq "compound"      5400  "$(parse_duration 1h30m)"
eq "compound 3"    8130  "$(parse_duration 2h15m30s)"
eq "upper case"    3600  "$(parse_duration 1H)"
eq "leading zero"  480   "$(parse_duration 08m)"
bad "zero"         parse_duration 0
bad "0m"           parse_duration 0m
bad "garbage"      parse_duration abc
bad "decimal"      parse_duration 1.5h
bad "unit only"    parse_duration h

eq "fmt days"   "1d 01h" "$(fmt_dur 90061)"
eq "fmt hours"  "1h 02m" "$(fmt_dur 3725)"
eq "fmt mins"   "2m 05s" "$(fmt_dur 125)"
eq "fmt secs"   "42s"    "$(fmt_dur 42)"
eq "fmt neg"    "0s"     "$(fmt_dur -5)"
eq "short h"    "1h05m"  "$(fmt_short 3900)"
eq "short m"    "25m"    "$(fmt_short 1450)"
eq "short s"    "40s"    "$(fmt_short 40)"

now=$(date +%s)
t=$(parse_clock "$(date -d '+2 hours' +%H:%M)")
eq "clock later today/tomorrow" 1 "$(( t > now && t <= now + 86400 ))"
t=$(parse_clock "$(date -d '-1 hour' +%H:%M)")
eq "past clock → tomorrow" 1 "$(( t > now + 3600 * 22 ))"
bad "clock in the past" parse_clock "yesterday 10:00"
bad "clock nonsense"    parse_clock "25:99"

printf '%d passed, %d failed\n' "$pass" "$fail"
(( fail == 0 ))
