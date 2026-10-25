"""Parse `aws s3api list-objects-v2 --output json` output from R2.

  python r2_ls.py next-version < listing.json   -> prints 1 + highest v<number>/ prefix (1 if none)
  python r2_ls.py count < listing.json          -> prints how many objects were listed

Both exit non-zero on unparseable input. The aws call itself is made by the workflow,
and any non-zero exit from it fails the job; an empty prefix is a successful call.
"""
import json
import re
import sys


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


def key_count(text):
    # Count Contents (merged across pages by the CLI); KeyCount is per page, so not used.
    return len(_load(text).get("Contents") or [])


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    body = sys.stdin.read()
    if cmd == "next-version":
        print(next_version(body))
    elif cmd == "count":
        print(key_count(body))
    else:
        sys.exit("usage: r2_ls.py next-version|count < listing.json")
