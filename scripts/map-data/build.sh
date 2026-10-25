#!/usr/bin/env bash
# Build our own Syros map: out/v{N}/ holds syros.pmtiles, fonts, sprites, styles,
# names-added.csv and manifest.json; out/current.json points at N.
#
# Usage:  scripts/map-data/build.sh [OUT_DIR] [WORK_DIR]
#   OUT_DIR   default <repo>/out
#   WORK_DIR  default <repo>/.map-work (gitignored); downloads and Java output live here
# Env:
#   VERSION   N for out/v{N}; default = current version in OUT_DIR/current.json + 1 (or 1)
#   DRY_RUN=1 skip the upload (the upload itself is done by the GitHub Action)
#   PYTHON    python with pyosmium + pytest (default python3)
#   OSM_URL   override the Geofabrik URL (e.g. a dated greece-YYMMDD.osm.pbf for a repeat build)
#   JAVA_HOME a Java 21 install (auto-detected from Homebrew openjdk@21 if unset)
#
# Needs: java 21, mvn, osmium (osmium-tool), curl, node + pnpm, python3 with pyosmium.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$(mkdir -p "${1:-$REPO/out}" && cd "${1:-$REPO/out}" && pwd)"
WORK_DIR="$(mkdir -p "${2:-$REPO/.map-work}" && cd "${2:-$REPO/.map-work}" && pwd)"
PYTHON="${PYTHON:-python3}"

# ---- Pinned versions (all recorded in manifest.json) -------------------------
OSM_URL="${OSM_URL:-https://download.geofabrik.de/europe/greece-latest.osm.pbf}"
BBOX="24.82,37.33,25.04,37.56"                       # SYROS_RECT +- 0.03 degrees
BASEMAPS_COMMIT="ca93fc06efbaff1c5f069d06edbe5de18839c1c8"   # protomaps/basemaps, tiles/ project ("Protomaps Basemap v4.15.2")
ASSETS_COMMIT="028c18f713baecad011301ff7a69acc39bcc2ae7"     # protomaps/basemaps-assets (fonts, sprites v4)
SPRITE_SET="v4/light"
FONT_STACKS=("Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic" "Noto Sans Devanagari Regular v1")
APP_FONT_STACKS=("Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic")
# The six glyph ranges the app bundles (Task 0.1): Latin, Latin ext, Greek, Greek ext, punctuation, box/shapes
APP_RANGES=("0-255" "256-511" "768-1023" "7936-8191" "8192-8447" "9472-9727")
HOST="https://tiles.catspotters.com"

if [[ -z "${JAVA_HOME:-}" && -d /opt/homebrew/opt/openjdk@21 ]]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@21
fi
JAVA="${JAVA_HOME:+$JAVA_HOME/bin/}java"

# ---- Version number ------------------------------------------------------------
if [[ -z "${VERSION:-}" ]]; then
  if [[ -f "$OUT_DIR/current.json" ]]; then
    VERSION=$(( $("$PYTHON" -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$OUT_DIR/current.json") + 1 ))
  else
    VERSION=1
  fi
fi
V_DIR="$OUT_DIR/v$VERSION"
echo "== Building map v$VERSION into $V_DIR (work: $WORK_DIR)"
rm -rf "$V_DIR"; mkdir -p "$V_DIR"

# ---- 1. Download Greece from Geofabrik ----------------------------------------
GREECE="$WORK_DIR/greece.osm.pbf"
if [[ ! -s "$GREECE" || "${REFRESH:-0}" == "1" ]]; then
  echo "== 1. Downloading $OSM_URL"
  curl -fsSL --retry 3 -o "$GREECE.part" "$OSM_URL"
  mv "$GREECE.part" "$GREECE"
fi
GREECE_SHA=$(shasum -a 256 "$GREECE" | cut -d' ' -f1)

# ---- 2. Cut Syros out -------------------------------------------------------------
echo "== 2. osmium extract --bbox $BBOX"
osmium extract --bbox "$BBOX" --overwrite -o "$WORK_DIR/syros.osm.pbf" "$GREECE"
OSM_EXTRACT_DATE=$(osmium fileinfo -g header.option.osmosis_replication_timestamp "$WORK_DIR/syros.osm.pbf" || true)
[[ -n "$OSM_EXTRACT_DATE" ]] || OSM_EXTRACT_DATE=$(osmium fileinfo -g header.option.timestamp "$WORK_DIR/syros.osm.pbf" || true)
[[ -n "$OSM_EXTRACT_DATE" ]] || OSM_EXTRACT_DATE="unknown"
echo "   OSM data date: $OSM_EXTRACT_DATE"

# ---- 3. Add Latin-letter names ------------------------------------------------------
echo "== 3. add_names.py"
"$PYTHON" "$REPO/scripts/map-data/add_names.py" "$WORK_DIR/syros.osm.pbf" "$WORK_DIR/syros-named.osm.pbf" "$V_DIR/names-added.csv"

# ---- 4. Protomaps basemap tiles -------------------------------------------------------
# The basemaps project publishes no release jars, so build the tiles/ project at a pinned commit.
JAR="$WORK_DIR/protomaps-basemap-$BASEMAPS_COMMIT.jar"
if [[ ! -s "$JAR" ]]; then
  echo "== 4a. Building protomaps/basemaps tiles/ at $BASEMAPS_COMMIT"
  SRC="$WORK_DIR/basemaps-src"; rm -rf "$SRC"; mkdir -p "$SRC"
  curl -fsSL --retry 3 "https://github.com/protomaps/basemaps/archive/$BASEMAPS_COMMIT.tar.gz" | tar xz -C "$SRC" --strip-components=1
  (cd "$SRC/tiles" && mvn -q -B clean package -DskipTests)
  cp "$SRC/tiles/target/protomaps-basemap-HEAD-with-deps.jar" "$JAR"
  grep -m1 "planetiler.version" "$SRC/tiles/pom.xml" | sed 's/[^0-9.]//g' > "$WORK_DIR/planetiler.version"
fi
PLANETILER_VERSION=$(cat "$WORK_DIR/planetiler.version" 2>/dev/null || echo unknown)

# Flags from the tiles/ README and `--help` at this commit:
#   --osm-path=<file>   use this OSM extract instead of downloading --area
#   --bounds=<w,s,e,n>  Planetiler common option: only render this box
#   --output=<file>     output .pmtiles
#   --download          fetch Natural Earth, water/land polygons, landcover, qrank into data/sources
#   --force             overwrite existing output
# Planetiler writes under ./data relative to the working directory, so run it from the work dir.
echo "== 4b. Generating syros.pmtiles"
mkdir -p "$WORK_DIR/planetiler"
(
  cd "$WORK_DIR/planetiler"
  "$JAVA" -Xmx4g -jar "$JAR" \
    --osm-path="$WORK_DIR/syros-named.osm.pbf" \
    --bounds="$BBOX" \
    --output="$V_DIR/syros.pmtiles" \
    --download --force
)

# ---- 5. Fonts and sprites from the pinned basemaps-assets commit -------------------------
ASSETS="$WORK_DIR/basemaps-assets-$ASSETS_COMMIT"
if [[ ! -d "$ASSETS" ]]; then
  echo "== 5. Fetching basemaps-assets at $ASSETS_COMMIT"
  mkdir -p "$ASSETS"
  curl -fsSL --retry 3 "https://github.com/protomaps/basemaps-assets/archive/$ASSETS_COMMIT.tar.gz" | tar xz -C "$ASSETS" --strip-components=1
fi
mkdir -p "$V_DIR/fonts" "$V_DIR/fonts-app" "$V_DIR/sprites"
for stack in "${FONT_STACKS[@]}"; do cp -R "$ASSETS/fonts/$stack" "$V_DIR/fonts/"; done
for stack in "${APP_FONT_STACKS[@]}"; do
  mkdir -p "$V_DIR/fonts-app/$stack"
  for r in "${APP_RANGES[@]}"; do cp "$ASSETS/fonts/$stack/$r.pbf" "$V_DIR/fonts-app/$stack/"; done
done
for f in light.json light.png "light@2x.json" "light@2x.png"; do cp "$ASSETS/sprites/$SPRITE_SET/$f" "$V_DIR/sprites/"; done
cp "$ASSETS/fonts/OFL.txt" "$V_DIR/fonts/OFL.txt"

# ---- 6. Shared styles -------------------------------------------------------------------------
echo "== 6. Exporting styles"
(cd "$REPO" && pnpm --filter @workspace/map-style export)
for lang in en el; do
  sed -e "s#{PMTILES_URL}#pmtiles://$HOST/v$VERSION/syros.pmtiles#g" \
      -e "s#{GLYPHS_URL}#$HOST/v$VERSION/fonts/{fontstack}/{range}.pbf#g" \
      -e "s#{SPRITE_URL}#$HOST/v$VERSION/sprites/light#g" \
      "$REPO/lib/map-style/dist/style-$lang.json" > "$V_DIR/style-$lang.json"
done

# ---- 7. Manifest ---------------------------------------------------------------------------------
echo "== 7. manifest.json"
src_sha() { [[ -f "$1" ]] && shasum -a 256 "$1" | cut -d' ' -f1 || echo "n/a"; }
SRCS="$WORK_DIR/planetiler/data/sources"
"$PYTHON" - "$WORK_DIR/tools.json" <<PYEOF
import json, subprocess, sys, osmium
def run(*a): return subprocess.run(a, capture_output=True, text=True).stdout.strip().splitlines()[0]
tools = {
    "geofabrik_url": "$OSM_URL",
    "geofabrik_file_sha256": "$GREECE_SHA",
    "bbox": "$BBOX",
    "osmium_tool": run("osmium", "--version"),
    "pyosmium": getattr(osmium, "__version__", "unknown"),
    "java": subprocess.run(["$JAVA", "-version"], capture_output=True, text=True).stderr.splitlines()[0],
    "protomaps_basemaps_commit": "$BASEMAPS_COMMIT",
    "protomaps_basemaps_jar": "protomaps-basemap built from tiles/ at that commit (Protomaps Basemap v4.15.2)",
    "planetiler": "$PLANETILER_VERSION",
    "natural_earth": "natural_earth_vector.gpkg.zip (naciscdn.org, unversioned) sha256 $(src_sha "$SRCS/natural_earth_vector.gpkg.zip")",
    "water_polygons": "water-polygons-split-3857.zip (osmdata.openstreetmap.de, unversioned) sha256 $(src_sha "$SRCS/water-polygons-split-3857.zip")",
    "land_polygons": "land-polygons-split-3857.zip (osmdata.openstreetmap.de, unversioned) sha256 $(src_sha "$SRCS/land-polygons-split-3857.zip")",
    "basemaps_assets_commit": "$ASSETS_COMMIT",
    "protomaps_basemaps_npm": json.load(open("$REPO/lib/map-style/package.json"))["dependencies"]["@protomaps/basemaps"],
}
json.dump(tools, open(sys.argv[1], "w"), indent=2)
PYEOF
"$PYTHON" "$REPO/scripts/map-data/manifest.py" "$V_DIR" "$VERSION" "$OSM_EXTRACT_DATE" "$WORK_DIR/tools.json"
printf '{"version": %s}\n' "$VERSION" > "$OUT_DIR/current.json"

echo "== Built v$VERSION:"
(cd "$OUT_DIR" && find "v$VERSION" -type f | sort | head -40; echo "..."; du -sh "v$VERSION" "v$VERSION/fonts" "v$VERSION/fonts-app" "v$VERSION/syros.pmtiles")
if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "DRY_RUN=1: not uploading. The GitHub Action uploads v$VERSION, then current.json last."
fi
