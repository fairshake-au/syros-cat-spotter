import hashlib
import json
import subprocess
import sys
from pathlib import Path

from manifest import build_manifest

HERE = Path(__file__).parent
TOOLS = {"osmium": "1.0"}


def make_tree(root: Path):
    (root / "fonts" / "Noto Sans Regular").mkdir(parents=True)
    (root / "syros.pmtiles").write_bytes(b"tiles-bytes")
    (root / "fonts" / "Noto Sans Regular" / "0-255.pbf").write_bytes(b"glyphs")
    (root / "names-added.csv").write_text("osm_type,osm_id\nway,1\nway,2\n")


def test_manifest_lists_every_file_with_sha256(tmp_path):
    make_tree(tmp_path)
    m = build_manifest(tmp_path, 7, "2026-10-20", TOOLS, 2, built_at="2026-10-24T00:00:00Z")
    assert isinstance(m["version"], int) and m["version"] == 7
    assert set(m["files"]) == {
        "syros.pmtiles",
        "fonts/Noto Sans Regular/0-255.pbf",
        "names-added.csv",
    }
    for rel, info in m["files"].items():
        data = (tmp_path / rel).read_bytes()
        assert info["bytes"] == len(data)
        assert info["sha256"] == hashlib.sha256(data).hexdigest()
    assert m["osm_extract_date"] == "2026-10-20"
    assert m["tools"] == TOOLS
    assert m["names_added"] == 2
    assert m["built_at"] == "2026-10-24T00:00:00Z"


def test_manifest_excludes_itself(tmp_path):
    make_tree(tmp_path)
    (tmp_path / "manifest.json").write_text("{}")
    m = build_manifest(tmp_path, 1, "2026-10-20", TOOLS, 0)
    assert "manifest.json" not in m["files"]


def test_cli_writes_manifest_json(tmp_path):
    make_tree(tmp_path)
    tools = tmp_path.parent / (tmp_path.name + "-tools.json")
    tools.write_text(json.dumps(TOOLS))
    subprocess.run(
        [sys.executable, str(HERE / "manifest.py"), str(tmp_path), "3", "2026-10-20", str(tools)],
        check=True,
    )
    m = json.loads((tmp_path / "manifest.json").read_text())
    assert m["version"] == 3
    assert m["names_added"] == 2  # data rows in names-added.csv
    assert "manifest.json" not in m["files"]
