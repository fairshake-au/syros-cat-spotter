"""Add a Latin-letter `name:en` to features in an OSM extract.

Usage: python add_names.py IN.osm.pbf OUT.osm.pbf names-added.csv

Rules:
  * Only features that have `name` and no `name:en` are touched.
  * A `name` containing any Greek letter gets `name:en` = ELOT 743 transliteration.
  * A `name` with no Greek letters (already Latin) is copied to `name:en` as-is.
  * No other tag is ever changed; features without `name` are passed through.

The CSV (osm_type,osm_id,kind,name,name_en_added) lists ONLY the transliterated
additions (so a human can review them); copied Latin names are not listed.
Rows are sorted by osm_type then numeric osm_id.
"""
import csv
import re
import sys

import osmium

from elot743 import transliterate

GREEK = re.compile(r"[Ͱ-Ͽἀ-῿]")
KIND_KEYS = ("highway", "place", "natural", "amenity", "leisure",
             "tourism", "shop", "historic", "building", "landuse")


def kind_of(tags):
    for key in KIND_KEYS:
        if key in tags:
            return key
    return "other"


class NameAdder:
    def __init__(self, writer):
        self.writer = writer
        self.added = []

    def _process(self, obj, kind_label, add):
        tags = {t.k: t.v for t in obj.tags}
        name = tags.get("name")
        if name and "name:en" not in tags:
            if GREEK.search(name):
                en = transliterate(name)
                self.added.append((kind_label, obj.id, kind_of(tags), name, en))
            else:
                en = name
            new_tags = dict(tags)
            new_tags["name:en"] = en
            add(obj.replace(tags=new_tags))
        else:
            add(obj)

    def node(self, n):
        self._process(n, "node", self.writer.add_node)

    def way(self, w):
        self._process(w, "way", self.writer.add_way)

    def relation(self, r):
        self._process(r, "relation", self.writer.add_relation)


def main(argv):
    if len(argv) != 4:
        sys.exit("usage: add_names.py IN.osm.pbf OUT.osm.pbf names-added.csv")
    src, dst, csv_path = argv[1:]
    writer = osmium.SimpleWriter(dst)
    handler = NameAdder(writer)
    osmium.apply(src, handler)
    writer.close()
    order = {"node": 0, "way": 1, "relation": 2}
    handler.added.sort(key=lambda r: (order[r[0]], r[1]))
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["osm_type", "osm_id", "kind", "name", "name_en_added"])
        w.writerows(handler.added)


if __name__ == "__main__":
    main(sys.argv)
