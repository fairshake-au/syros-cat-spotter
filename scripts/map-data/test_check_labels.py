"""check_labels.py on a tiny hand-made map: one zoom-13 tile, land in its middle (SYC-764)."""
import gzip

import mapbox_vector_tile
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

import check_labels

# The zoom-13 tile over Ermoupoli. Extent 4096: land is the square 1000..3000 in pixels
# (about 2.4 km a side), so the tile's middle is ~1.2 km inland and its corner is open sea.
Z, X, Y = 13, 4663, 3176
LAND = "POLYGON ((1000 1000, 3000 1000, 3000 3000, 1000 3000, 1000 1000))"
INLAND = "POINT (2000 2000)"
AT_SEA = "POINT (200 200)"
ON_SHORE = "POINT (1005 2000)"   # ~6 m inside the shore: within SHORE_M either way


def write_map(path, layers):
    """layers: {layer name: [(wkt, properties)]} plus the land square in `earth`."""
    earth = [{"geometry": LAND, "properties": {"kind": "earth"}}]
    earth += [{"geometry": g, "properties": p} for g, p in layers.get("earth", [])]
    tile = [{"name": "earth", "features": earth}]
    for name, feats in layers.items():
        if name != "earth":
            tile.append({"name": name, "features": [{"geometry": g, "properties": p} for g, p in feats]})
    data = gzip.compress(mapbox_vector_tile.encode(tile, default_options={"y_coord_down": True}))
    with open(path, "wb") as fh:
        w = Writer(fh)
        w.write_tile(zxy_to_tileid(Z, X, Y), data)
        w.finalize({
            "tile_type": TileType.MVT, "tile_compression": Compression.GZIP,
            "min_zoom": Z, "max_zoom": Z,
            "min_lon_e7": 249000000, "min_lat_e7": 374000000,
            "max_lon_e7": 249500000, "max_lat_e7": 374500000,
            "center_zoom": Z, "center_lon_e7": 249300000, "center_lat_e7": 374400000,
        }, {})
    return str(path)


def run(tmp_path, layers):
    land, labels = check_labels.read(write_map(tmp_path / "t.pmtiles", layers))
    return labels, check_labels.problems(land, labels)


def test_a_clean_map_passes(tmp_path):
    labels, found = run(tmp_path, {
        "water": [(AT_SEA, {"kind": "bay", "name": "Όρμος"}), (ON_SHORE, {"kind": "bay", "name": "Ακτή"})],
        "places": [(INLAND, {"kind": "locality", "name": "Ερμούπολη"}),
                   (ON_SHORE, {"kind": "locality", "name": "Λιμάνι"})],
    })
    assert len(labels) == 4
    assert found == []


def test_the_aegean_sea_label_fails_wherever_it_is(tmp_path):
    _, found = run(tmp_path, {"water": [(INLAND, {"kind": "sea", "name": "Αιγαίον Πέλαγος"}),
                                        (AT_SEA, {"kind": "ocean", "name": "Ωκεανός"})]})
    assert len(found) == 2
    assert all("sea and ocean labels are not wanted" in p for p in found)


def test_a_water_label_on_land_fails(tmp_path):
    _, found = run(tmp_path, {"water": [(INLAND, {"kind": "bay", "name": "Όρμος"})]})
    assert len(found) == 1
    assert "m inland" in found[0]


def test_inland_water_like_lakes_and_pools_is_not_judged(tmp_path):
    # A named lake or hotel pool is inland by nature and must not stop a build.
    _, found = run(tmp_path, {"water": [(INLAND, {"kind": k, "name": k}) for k in
                                        ("lake", "reservoir", "basin", "pond", "swimming_pool", "river")]})
    assert found == []


def test_two_places_with_the_same_name_are_both_judged(tmp_path):
    # Greek village names repeat; one at sea must not hide behind one on land, in either order.
    for order in ((INLAND, AT_SEA), (AT_SEA, INLAND)):
        labels, found = run(tmp_path, {"places": [(g, {"kind": "locality", "name": "Αγία Μαρίνα"}) for g in order]})
        assert len(labels) == 2
        assert len(found) == 1 and "out to sea" in found[0]


def test_a_town_label_in_the_sea_fails(tmp_path):
    _, found = run(tmp_path, {"places": [(AT_SEA, {"kind": "locality", "name": "Ερμούπολη"})]})
    assert len(found) == 1
    assert "out to sea" in found[0]


def test_island_and_poi_labels_are_not_judged(tmp_path):
    # Island names sit anywhere on their island and pois at sea are real (wrecks, buoys).
    _, found = run(tmp_path, {"earth": [(AT_SEA, {"kind": "island", "name": "Νησί"})],
                              "pois": [(AT_SEA, {"kind": "wreck", "name": "Ναυάγιο"})]})
    assert found == []


def test_unnamed_points_are_skipped(tmp_path):
    labels, _ = run(tmp_path, {"water": [(INLAND, {"kind": "sea"})]})
    assert labels == []


def test_main_exits_1_on_a_problem_and_0_on_a_clean_map(tmp_path, capsys):
    bad = write_map(tmp_path / "bad.pmtiles", {"water": [(INLAND, {"kind": "sea", "name": "Αιγαίον Πέλαγος"})]})
    good = write_map(tmp_path / "good.pmtiles", {"places": [(INLAND, {"kind": "locality", "name": "Ερμούπολη"})]})
    assert check_labels.main(["check_labels.py", bad]) == 1
    assert "FAIL: water/sea" in capsys.readouterr().err
    assert check_labels.main(["check_labels.py", good]) == 0


def test_a_map_with_no_land_fails(tmp_path):
    path = tmp_path / "empty.pmtiles"
    data = gzip.compress(mapbox_vector_tile.encode(
        [{"name": "water", "features": [{"geometry": AT_SEA, "properties": {"kind": "bay", "name": "x"}}]}]))
    with open(path, "wb") as fh:
        w = Writer(fh)
        w.write_tile(zxy_to_tileid(Z, X, Y), data)
        w.finalize({"tile_type": TileType.MVT, "tile_compression": Compression.GZIP,
                    "min_zoom": Z, "max_zoom": Z, "min_lon_e7": 0, "min_lat_e7": 0,
                    "max_lon_e7": 0, "max_lat_e7": 0, "center_zoom": Z,
                    "center_lon_e7": 0, "center_lat_e7": 0}, {})
    assert check_labels.main(["check_labels.py", str(path)]) == 1
