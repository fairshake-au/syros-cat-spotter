"""Parse `aws s3api list-objects-v2 --output json` output from R2.

  python r2_ls.py next-version < listing.json   -> prints 1 + highest v<number>/ prefix (1 if none)
  python r2_ls.py count < listing.json          -> prints how many distinct objects were listed
  python r2_ls.py missing LOCAL.txt < listing.json -> prints local paths not in the bucket; exit 1 if any

Both exit non-zero on unparseable input. The aws call itself is made by the workflow,
and any non-zero exit from it fails the job; an empty prefix is a successful call.
"""
import json
import re
import sys
from urllib.parse import unquote


def _load(text):
    text = text.strip()
    if not text or text == "null":  # the CLI may print nothing for an empty listing
        return {}
    data = json.loads(text)
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ValueError("expected a JSON object")
    return data


def next_version(text):
    best = 0
    for p in _load(text).get("CommonPrefixes") or []:
        m = re.fullmatch(r"v(\d+)/", p.get("Prefix", ""))
        if m:
            best = max(best, int(m.group(1)))
    return best + 1


def _keys(text):
    # Contents is merged across pages by the CLI. R2 + the CLI's paging can list a key on
    # two pages (first upload, 26 Oct 2026: 1053 entries for 801 files), so keys are a set.
    # Keys may come back URL-encoded ("Noto%20Sans"); none of ours contain a literal "%".
    return {unquote(c.get("Key", "")) for c in (_load(text).get("Contents") or [])}


def key_count(text):
    return len(_keys(text))


def missing(local_paths, text):
    """Local paths (relative to out/, e.g. v1/syros.pmtiles) the bucket listing lacks."""
    have = _keys(text)
    return sorted(p for p in local_paths if p not in have)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    body = sys.stdin.read()
    if cmd == "next-version":
        print(next_version(body))
    elif cmd == "count":
        print(key_count(body))
    elif cmd == "missing" and len(sys.argv) > 2:
        with open(sys.argv[2], encoding="utf-8") as f:
            local = [line.strip() for line in f if line.strip()]
        gone = missing(local, body)
        for p in gone:
            print(p)
        sys.exit(1 if gone else 0)
    else:
        sys.exit("usage: r2_ls.py next-version|count|missing LOCAL.txt < listing.json")
