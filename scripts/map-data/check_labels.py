"""Check that the labels in a built syros.pmtiles sit on the right side of the shore (SYC-764).

Usage: python check_labels.py syros.pmtiles [--list]

Reads every tile, takes the land shape from the `earth` layer at LAND_ZOOM, and checks
each named label point:
  * a `water` label (sea, bay, lake, ...) must not be on land;
  * a town or village label (`places`, kind locality or neighbourhood) must be on land.
  * no `water` label of kind sea or ocean at all: this one-island map has no sea big
    enough to place one (the bbox extract cuts the Aegean Sea to the box and its label
    lands in the middle of the island).
A point counts as on land when it is more than SHORE_M metres inside the land shape, and
as in the sea when it is more than SHORE_M metres outside it, so labels on the shore pass.

--list prints every label (layer, kind, min_zoom, lat, lon, name, name:en, on_land) as TSV.
Exit 1 and one line per problem when any check fails.
"""
import gzip
import math
import sys

import mapbox_vector_tile
import numpy as np
import shapely
from pmtiles.reader import MmapSource, Reader, all_tiles
from shapely.geometry import Point, shape

LAND_ZOOM = 13
SHORE_M = 40
# Local flat metres around Syros (equirectangular at 37.445 N): plenty exact for 40 m.
M_PER_DEG_LON = 111_320 * math.cos(math.radians(37.445))
M_PER_DEG_LAT = 110_540
LAND_PLACE_KINDS = {"locality", "neighbourhood"}
NO_LABEL_WATER_KINDS = {"sea", "ocean"}


def tile_to_lonlat(z, x, y, extent):
    """A function from an (N, 2) array of tile pixels to an (N, 2) array of lon, lat."""
    n = 2 ** z

    def f(px):
        px = np.asarray(px, dtype=float)
        lon = (x + px[:, 0] / extent) / n * 360 - 180
        lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y + px[:, 1] / extent) / n))))
        return np.column_stack([lon, lat])

    return f


def decode(data):
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    return mapbox_vector_tile.decode(data, default_options={"y_coord_down": True})


def read(path):
    """(land polygon in local metres, {(layer, kind, name): label dict})."""
    land_parts = []
    labels = {}
    with open(path, "rb") as fh:
        reader = Reader(MmapSource(fh))
        for (z, x, y), data in all_tiles(reader.get_bytes):
            tile = decode(data)
            for layer_name, layer in tile.items():
                to_ll = tile_to_lonlat(z, x, y, layer.get("extent", 4096))
                for feat in layer["features"]:
                    geom = feat["geometry"]
                    props = feat["properties"]
                    if layer_name == "earth" and z == LAND_ZOOM and geom["type"] in ("Polygon", "MultiPolygon"):
                        land_parts.append(shapely.transform(shape(geom), to_ll).buffer(0))
                    if geom["type"] != "Point" or not props.get("name"):
                        continue
                    if layer_name not in ("water", "places", "pois", "earth"):
                        continue
                    lon, lat = to_ll([geom["coordinates"]])[0]
                    key = (layer_name, props.get("kind"), props.get("name"))
                    # The same label repeats in every tile and zoom; keep the deepest (most exact) copy.
                    if key not in labels or z > labels[key]["z"]:
                        labels[key] = {
                            "layer": layer_name, "kind": props.get("kind"), "name": props.get("name"),
                            "name_en": props.get("name:en", ""), "min_zoom": props.get("min_zoom"),
                            "lon": lon, "lat": lat, "z": z,
                        }
    land = shapely.transform(shapely.union_all(land_parts), to_metres)
    return land, list(labels.values())


def to_metres(ll):
    return np.asarray(ll, dtype=float) * [M_PER_DEG_LON, M_PER_DEG_LAT]


def metres_inside(land, lon, lat):
    """Positive: metres inside the land shape (in metres, from read); negative: metres out to sea."""
    p = Point(*to_metres([[lon, lat]])[0])
    d = land.boundary.distance(p)
    return d if land.contains(p) else -d


def problems(land, labels):
    out = []
    for lab in labels:
        where = f"{lab['layer']}/{lab['kind']} {lab['name']!r} at {lab['lat']:.4f} N, {lab['lon']:.4f} E"
        inside = metres_inside(land, lab["lon"], lab["lat"])
        if lab["layer"] == "water" and lab["kind"] in NO_LABEL_WATER_KINDS:
            out.append(f"{where}: sea and ocean labels are not wanted on this map")
        elif lab["layer"] == "water" and inside > SHORE_M:
            out.append(f"{where}: water label is {inside:.0f} m inland")
        elif lab["layer"] == "places" and lab["kind"] in LAND_PLACE_KINDS and inside < -SHORE_M:
            out.append(f"{where}: place label is {-inside:.0f} m out to sea")
    return sorted(out)


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    land, labels = read(argv[1])
    if land.is_empty:
        print(f"FAIL: no land in the earth layer at zoom {LAND_ZOOM}", file=sys.stderr)
        return 1
    if "--list" in argv:
        print("layer\tkind\tmin_zoom\tlat\tlon\tname\tname_en\tmetres_inland")
        for lab in sorted(labels, key=lambda l: (l["layer"], str(l["kind"]), l["name"])):
            inside = metres_inside(land, lab["lon"], lab["lat"])
            print(f"{lab['layer']}\t{lab['kind']}\t{lab['min_zoom']}\t{lab['lat']:.5f}\t{lab['lon']:.5f}"
                  f"\t{lab['name']}\t{lab['name_en']}\t{inside:.0f}")
    found = problems(land, labels)
    for p in found:
        print(f"FAIL: {p}", file=sys.stderr)
    print(f"{len(labels)} labels checked, {len(found)} problems", file=sys.stderr)
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
