import csv
import os
import subprocess
import sys

import osmium

HERE = os.path.dirname(__file__)
FIXTURE = os.path.join(HERE, "fixtures", "syros-sample.osm")
SCRIPT = os.path.join(HERE, "add_names.py")


def run_add_names(fixture, tmp_path):
    out = str(tmp_path / "out.osm.pbf")
    csv_path = str(tmp_path / "names-added.csv")
    subprocess.run([sys.executable, SCRIPT, fixture, out, csv_path], check=True)
    return out, csv_path


class _Collect(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.tags = {}

    def node(self, n):
        self.tags[("node", n.id)] = {t.k: t.v for t in n.tags}

    def way(self, w):
        self.tags[("way", w.id)] = {t.k: t.v for t in w.tags}

    def relation(self, r):
        self.tags[("relation", r.id)] = {t.k: t.v for t in r.tags}


def read_tags(path):
    h = _Collect()
    h.apply_file(path)
    return h.tags


def rows(csv_path):
    with open(csv_path, newline="", encoding="utf-8") as f:
        r = csv.reader(f)
        assert next(r) == ["osm_type", "osm_id", "kind", "name", "name_en_added"]
        return [tuple(x) for x in r]


def test_adds_name_en_only_when_missing(tmp_path):
    out, csv_path = run_add_names(FIXTURE, tmp_path)
    tags = read_tags(out)
    assert tags[("way", 101)]["name:en"] == "Odos Ermou"
    assert tags[("node", 1)]["name:en"] == "Ermoupoli"
    assert "name:en" not in tags[("way", 102)]
    assert tags[("way", 103)]["name:en"] == "Main Street"
    assert rows(csv_path) == [("way", "101", "highway", "Οδός Ερμού", "Odos Ermou")]


def test_other_tags_untouched(tmp_path):
    out, _ = run_add_names(FIXTURE, tmp_path)
    tags = read_tags(out)
    assert tags[("way", 101)] == {"highway": "residential", "name": "Οδός Ερμού", "name:en": "Odos Ermou"}
    assert tags[("way", 102)] == {"highway": "service"}
