#!/usr/bin/env python3
"""Simulates the two proposed structural guards (SYC-410 PR 1.2) over the source tree.
Run from the repo root: python3 -I guard_sim.py [cats|statements] [--lines]
Same file walk as catIdentityGuard.test.ts: artifacts, lib, scripts; skip node_modules, dist, build,
.expo, .git, coverage, migrations, __fixtures__; skip *.test.* and anything under /test/. Comments stripped.
"""
import os, re, sys

SCAN_ROOTS = ["artifacts", "lib", "scripts"]
SKIP = {"node_modules", "dist", "build", ".expo", ".git", "coverage", "migrations", "__fixtures__"}
EXT = re.compile(r"\.(ts|tsx|mts|cts|js|mjs|cjs)$")


def files():
    for root in SCAN_ROOTS:
        for dp, dns, fns in os.walk(root):
            dns[:] = [d for d in dns if d not in SKIP]
            for f in fns:
                p = os.path.join(dp, f).replace(os.sep, "/")
                if EXT.search(f) and not re.search(r"\.test\.[a-z]+$", p) and "/test/" not in p:
                    yield p


def strip(text):
    # same as catIdentityGuard.withoutComments, but keeps line breaks so lines can be reported
    text = re.sub(r"/\*[\s\S]*?\*/", lambda m: "\n" * m.group(0).count("\n"), text)
    return re.sub(r"(^|[^:])//.*$", r"\1", text, flags=re.M)


CATS = [
    re.compile(r"\.(from|innerJoin|leftJoin|rightJoin|fullJoin|crossJoin)\(\s*catsTable\b"),
    re.compile(r"\balias\(\s*catsTable\b"),
    re.compile(r"\$\{\s*catsTable\s*\}"),
    re.compile(r"\bquery\.cats\b"),
    re.compile(r"\b(from|join)\s+cats\b", re.I),
    re.compile(r"=\s*catsTable\s*[;,)]"),  # const c = catsTable (rebinding hides reads)
]


def stmt_patterns(code):
    names = ["observationsTable"] + re.findall(r"\b(\w+)\s*=\s*alias\(\s*observationsTable\b", code)
    alt = "|".join(map(re.escape, names))
    col = rf"\b(?:{alt})\.catId\b"
    return [
        re.compile(rf"\b(?:eq|ne|inArray|notInArray)\(\s*{col}"),          # eq(observationsTable.catId, x)
        re.compile(rf"\b(?:eq|ne)\([^()]*?,\s*{col}\s*\)"),               # eq(x, observationsTable.catId)
        re.compile(rf"\$\{{\s*{col}\s*\}}"),                               # sql`${observationsTable.catId} = ...`
        re.compile(r"=\s*observationsTable\s*[;,)]"),                    # const o = observationsTable (rebinding hides reads)
    ]


def select_patterns(code):
    names = ["observationsTable"] + re.findall(r"\b(\w+)\s*=\s*alias\(\s*observationsTable\b", code)
    col = rf"\b(?:{'|'.join(map(re.escape, names))})\.catId\b"
    return [re.compile(rf"\bcatId:\s*{col}"), re.compile(rf"\bselectDistinctOn\(\s*\[\s*{col}")]


RAW_OBS = re.compile(r"\bobservations\b(?!Table)")
RAW_CATCMP = re.compile(r"\bcat_id\s*(=|<>|!=|\bin\b)|(=|<>|!=)\s*(\w+\.)?cat_id\b")


def templates(code):
    i, n = 0, len(code)
    while i < n:
        if code[i] == "`":
            j, depth = i + 1, 0
            while j < n:
                c = code[j]
                if c == "\\":
                    j += 2; continue
                if c == "$" and j + 1 < n and code[j + 1] == "{":
                    depth += 1; j += 2; continue
                if c == "}" and depth > 0:
                    depth -= 1; j += 1; continue
                if c == "`" and depth == 0:
                    break
                j += 1
            yield i, code[i + 1 : j]
            i = j + 1
        else:
            i += 1


def hits(kind):
    out = []
    for path in sorted(files()):
        code = strip(open(path, encoding="utf8").read())
        lineno = lambda off: code.count("\n", 0, off) + 1
        if kind == "cats":
            for rx in CATS:
                for m in rx.finditer(code):
                    out.append((path, lineno(m.start()), m.group(0)))
        elif kind == "selects":
            for rx in select_patterns(code):
                for m in rx.finditer(code):
                    out.append((path, lineno(m.start()), m.group(0)))
        else:
            for rx in stmt_patterns(code):
                for m in rx.finditer(code):
                    out.append((path, lineno(m.start()), m.group(0)))
            for start, body in templates(code):
                if RAW_OBS.search(body) and RAW_CATCMP.search(body):
                    out.append((path, lineno(start), "raw observations by cat_id"))
    return sorted(set(out))


if __name__ == "__main__":
    kind = sys.argv[1]
    hs = hits(kind)
    if "--lines" in sys.argv:
        for p, l, t in hs:
            print(f"{p}:{l}\t{t}")
    else:
        from collections import Counter
        c = Counter(p for p, _, _ in hs)
        for p, n in sorted(c.items()):
            print(f"{n:3} {p}")
        print(f"total {len(hs)} hits in {len(c)} files")
