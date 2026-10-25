#!/usr/bin/env bash
# Daily check that the self-hosted Syros map is still being served (SYC-705).
#
# Usage:  scripts/map-data/check_live.sh [BASE_URL]
#   BASE_URL  default https://tiles.catspotters.com
#
# Checks, in order; the first failure stops the run with exit 1:
#   1. current.json returns 200 and {"version": N} with N a positive integer
#   2. v{N}/syros.pmtiles answers a ranged GET (bytes 0-126) with 206 and
#      starts with the PMTiles v3 magic ("PMTiles" then byte 0x03); the same
#      request sends Origin: https://catspotters.com and must come back with an
#      access-control-allow-origin header (a broken CORS rule blanks the website)
#   3. one font range per font stack returns 200, a non-empty body, and a glyph
#      range's first byte (0x0a, protobuf field 1)
# Exit 0 when everything passes. The workflow (.github/workflows/map-data-check.yml)
# runs this daily; a failure fails that job (who GitHub notifies: see the workflow's comment).
set -euo pipefail

BASE="${1:-https://tiles.catspotters.com}"
BASE="${BASE%/}"
FONT_STACKS=("Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic")
FONT_RANGE="0-255.pbf"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# get URL OUTFILE [extra curl args...]: prints the HTTP status code.
# Network errors (no status at all) print 000 and the run fails on the code check.
get() {
  local url="$1" out="$2"
  shift 2
  curl -fsS --retry 2 --max-time 30 -o "$out" -w '%{http_code}' "$@" "$url" 2>"$out.err" || true
}

# ---- 1. current.json ----------------------------------------------------------
CURRENT_URL="$BASE/current.json"
code="$(get "$CURRENT_URL" "$TMP/current.json")"
[ "$code" = "200" ] || fail "$CURRENT_URL returned HTTP $code (expected 200)"
VERSION="$(python3 -I -c '
import json, sys
v = json.load(open(sys.argv[1]))["version"]
if isinstance(v, bool) or not isinstance(v, int) or v < 1:
    raise SystemExit(1)
print(v)
' "$TMP/current.json" 2>/dev/null)" || fail "$CURRENT_URL body is not {\"version\": N} with N a positive integer"
echo "ok: current.json points at version $VERSION"

# ---- 2. syros.pmtiles header --------------------------------------------------
PMTILES_URL="$BASE/v$VERSION/syros.pmtiles"
code="$(get "$PMTILES_URL" "$TMP/header.bin" -r 0-126 -H 'Origin: https://catspotters.com' -D "$TMP/header.txt")"
[ "$code" = "206" ] || fail "$PMTILES_URL ranged GET returned HTTP $code (expected 206)"
magic="$(head -c 7 "$TMP/header.bin")"
[ "$magic" = "PMTiles" ] || fail "$PMTILES_URL does not start with the PMTiles magic"
ver_byte="$(od -An -tu1 -j7 -N1 "$TMP/header.bin" | tr -d ' ')"
[ "$ver_byte" = "3" ] || fail "$PMTILES_URL has PMTiles version byte '$ver_byte' (expected 3)"
echo "ok: syros.pmtiles serves a PMTiles v3 header (206)"
grep -qi '^access-control-allow-origin:' "$TMP/header.txt" \
  || fail "$PMTILES_URL sent no access-control-allow-origin header for Origin https://catspotters.com (CORS rule broken?)"
echo "ok: CORS header present for https://catspotters.com"

# ---- 3. one font range per stack ----------------------------------------------
for stack in "${FONT_STACKS[@]}"; do
  encoded="${stack// /%20}"
  font_url="$BASE/v$VERSION/fonts/$encoded/$FONT_RANGE"
  font_file="$TMP/font-${stack// /_}.pbf"
  rm -f "$font_file"
  code="$(get "$font_url" "$font_file")"
  [ "$code" = "200" ] || fail "$font_url returned HTTP $code (expected 200)"
  [ -s "$font_file" ] || fail "$font_url returned an empty body"
  # A glyph range is a protobuf whose first field is the stack name (field 1, wire type 2 = 0x0a).
  first_byte="$(od -An -tu1 -N1 "$font_file" | tr -d ' ')"
  [ "$first_byte" = "10" ] || fail "$font_url is not a glyph range (first byte '$first_byte', expected 10)"
  echo "ok: font '$stack' range $FONT_RANGE (200)"
done

echo "PASS: map at $BASE is being served (version $VERSION)"
