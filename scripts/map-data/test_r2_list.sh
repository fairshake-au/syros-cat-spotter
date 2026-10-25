#!/usr/bin/env bash
# Tiny test of r2_list's exit-code handling with a fake `aws`. Run: bash scripts/map-data/test_r2_list.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/r2_list.sh"
fail=0
check() { if [ "$2" != "$3" ]; then echo "FAIL $1: got '$2' want '$3'"; fail=1; else echo "ok   $1"; fi; }

aws() { printf '2026-01-01 00:00:00 5 a.json\n'; return 0; }
out=$(r2_list s3://b/v1/); rc=$?
check "exit 0 with lines: rc" "$rc" 0
check "exit 0 with lines: output" "$out" "2026-01-01 00:00:00 5 a.json"

aws() { return 1; }
out=$(r2_list s3://b/v1/); rc=$?
check "exit 1 (empty prefix): rc" "$rc" 0
check "exit 1 (empty prefix): output" "$out" ""

aws() { echo "boom" >&2; return 255; }
out=$(r2_list s3://b/v1/ 2>/dev/null); rc=$?
check "exit 255 (error): rc" "$rc" 255

# Under bash -e (the Actions default), a failing listing must stop the script.
bash -e -c "source '$HERE/r2_list.sh'; aws() { return 255; }; X=\$(r2_list s3://b/ 2>/dev/null); echo SHOULD-NOT-REACH" | grep -q SHOULD-NOT-REACH && { echo "FAIL set -e did not stop"; fail=1; } || echo "ok   set -e stops on error"
exit $fail
