"""Write manifest.json for an out/v{N} directory.

Usage: python manifest.py OUT_DIR VERSION OSM_EXTRACT_DATE TOOLS.json

Lists every file under OUT_DIR (except manifest.json itself) with its size and
sha256, plus the pinned tool versions and the number of names added (data rows
in names-added.csv).
"""
import csv
import datetime
import hashlib
import json
import sys
from pathlib import Path


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_manifest(out_dir, version, osm_extract_date, tools, names_added, built_at=None):
    out_dir = Path(out_dir)
    files = {}
    for p in sorted(out_dir.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(out_dir).as_posix()
        if rel == "manifest.json":
            continue
        files[rel] = {"bytes": p.stat().st_size, "sha256": sha256_of(p)}
    return {
        "version": int(version),
        "built_at": built_at
        or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "osm_extract_date": osm_extract_date,
        "tools": tools,
        "files": files,
        "names_added": int(names_added),
    }


def count_csv_rows(path: Path) -> int:
    if not path.exists():
        return 0
    with path.open(encoding="utf-8", newline="") as f:
        return max(sum(1 for _ in csv.reader(f)) - 1, 0)


def main(argv):
    out_dir, version, extract_date, tools_path = argv[1:5]
    tools = json.loads(Path(tools_path).read_text())
    names = count_csv_rows(Path(out_dir) / "names-added.csv")
    m = build_manifest(out_dir, int(version), extract_date, tools, names)
    (Path(out_dir) / "manifest.json").write_text(json.dumps(m, indent=2) + "\n")


if __name__ == "__main__":
    main(sys.argv)
