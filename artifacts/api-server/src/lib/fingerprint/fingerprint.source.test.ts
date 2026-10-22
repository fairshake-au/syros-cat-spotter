import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// SYC-527 piece 3, spec docs/specs/find-from-a-photo-whole-island.md §6.2:
// "a source test fails if any new code writes a fingerprint without the
// locked re-check". A hidden or removed photo must never get a fingerprint.
// The hide and removal triggers (migration 0039) delete one in the same
// transaction; what they can't stop is a writer that saves a fingerprint
// AFTER a hide, without looking. So there is exactly one writer,
// saveFingerprint in lib/fingerprint/index.ts, and it must, inside one
// transaction:
//   1. lock the photo row `for share` (the hide paths take `for update`, so
//      a hide and a save queue on the same row);
//   2. re-check with hiddenPhotoIds (hidden, or removed for good);
//   3. only then write.
//
// How the check works (textual, deliberately simple):
//   - every non-test source file under api-server src/, lib/*/src/ and
//     scripts/src/ is read, and any write to the table is looked for: raw
//     SQL `insert into` / `update` / `merge into` / `copy` naming
//     photo_fingerprints, or Drizzle `.insert(` / `.update(` on
//     photoFingerprintsTable, or the table object being given another name
//     (`= photoFingerprintsTable`), which would hide a write from the rest.
//     Deleting fingerprints is allowed anywhere: it can only make the index
//     safer;
//   - a write in any file but lib/fingerprint/index.ts fails;
//   - in that file, each write must be preceded, in order, by a
//     `.transaction(`, then `for share`, then `hiddenPhotoIds(`, with no
//     `.transaction(` opening between them and the write; and a Drizzle
//     write must go through the transaction (`tx.insert`), never `db.`.
// Until Task 7 adds the writer, the file may not exist; then there is
// simply no write anywhere, and the test passes.
//
// Limits (a determined author could get past a textual check): a table
// name built at run time, or a write in a helper the writer calls. Code
// review covers those; this catches the ordinary mistake.

const REPO = join(__dirname, "../../../../..");
const ALLOWED = "artifacts/api-server/src/lib/fingerprint/index.ts";

const ROOTS = [
  "artifacts/api-server/src",
  "scripts/src",
  ...readdirSync(join(REPO, "lib"))
    .map((pkg) => `lib/${pkg}/src`)
    .filter((dir) => existsSync(join(REPO, dir))),
];

/** Test files and test support: they set up rows; they aren't the app. */
const isTestSupport = (rel: string) =>
  /\.test\.tsx?$/.test(rel) ||
  rel.split("/").some((part) => part === "__fixtures__" || part === "__snapshots__" || part === "test");

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

const WRITE_PATTERNS: RegExp[] = [
  /\binsert\s+into\s+(?:"?public"?\s*\.\s*)?"?photo_fingerprints"?/gi,
  /\bupdate\s+(?:only\s+)?(?:"?public"?\s*\.\s*)?"?photo_fingerprints"?\s+set\b/gi,
  /\bmerge\s+into\s+(?:"?public"?\s*\.\s*)?"?photo_fingerprints"?/gi,
  /\bcopy\s+(?:"?public"?\s*\.\s*)?"?photo_fingerprints"?/gi,
  /\.\s*(?:insert|update)\s*\(\s*(?:schema\s*\.\s*)?photoFingerprintsTable\b/g,
  /=\s*(?:schema\s*\.\s*)?photoFingerprintsTable\b(?!\s*\.)/g,
];

/** Where in `text` a fingerprint is written (offsets), and how. */
function findWrites(text: string): { at: number; match: string }[] {
  const out: { at: number; match: string }[] = [];
  for (const re of WRITE_PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags))) out.push({ at: m.index!, match: m[0] });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * The source with line and block comments blanked to spaces (offsets and line
 * breaks kept), so a lock or re-check reduced to a comment doesn't count.
 * Quoted strings and template literals are walked over, not blanked: the
 * `for share` lives in a sql template, and a `//` inside a string is no comment.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") {
        out += " ";
        i += 1;
      }
    } else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** Why a write in the allowed file isn't guarded, or null if it is. */
function unguarded(text: string, write: { at: number; match: string }): string | null {
  const before = text.slice(0, write.at);
  const lastTx = before.lastIndexOf(".transaction(");
  if (lastTx < 0) return "not inside a transaction";
  const inTx = before.slice(lastTx);
  const share = inTx.search(/for\s+share/i);
  if (share < 0) return "no `for share` lock on the photo row before it, in the same transaction";
  const recheck = inTx.indexOf("hiddenPhotoIds(", share);
  if (recheck < 0) return "no hiddenPhotoIds re-check after the lock and before it";
  if (/^\./.test(write.match) && /\bdb\s*$/.test(before.replace(/\s+$/, ""))) {
    return "written through db, not the transaction";
  }
  if (/^=/.test(write.match)) return "the table object is given another name";
  return null;
}

describe("the only writer of photo_fingerprints is saveFingerprint, after the locked re-check", () => {
  it("no source file but lib/fingerprint/index.ts writes a fingerprint", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const root of ROOTS) {
      for (const path of files(join(REPO, root))) {
        const rel = relative(REPO, path).split(sep).join("/");
        if (!/\.(ts|tsx|js|mjs|cjs)$/.test(rel) || isTestSupport(rel) || rel === ALLOWED) continue;
        scanned += 1;
        for (const w of findWrites(readFileSync(path, "utf8"))) offenders.push(`${rel}: ${w.match}`);
      }
    }
    // An empty walk would pass for the wrong reason.
    expect(scanned).toBeGreaterThan(200);
    expect(offenders).toEqual([]);
  });

  it("lib/fingerprint/index.ts writes only inside a transaction, after `for share` and hiddenPhotoIds", () => {
    const path = join(REPO, ALLOWED);
    if (!existsSync(path)) return; // Task 7 adds it.
    const text = stripComments(readFileSync(path, "utf8"));
    const problems = findWrites(text)
      .map((w) => [w, unguarded(text, w)] as const)
      .filter(([, why]) => why !== null)
      .map(([w, why]) => `${w.match}: ${why}`);
    expect(problems).toEqual([]);
  });

  describe("the check itself catches what it should", () => {
    const writes = (s: string) => findWrites(s).map((w) => w.match.replace(/\s+/g, " "));
    it("finds raw SQL and Drizzle writes, and an alias", () => {
      expect(writes("insert into photo_fingerprints (photo_id) values (1)")).toHaveLength(1);
      expect(writes('INSERT INTO "photo_fingerprints" (photo_id)')).toHaveLength(1);
      expect(writes('insert into public."photo_fingerprints" values')).toHaveLength(1);
      expect(writes("update photo_fingerprints set model = 'x'")).toHaveLength(1);
      expect(writes("db.insert(photoFingerprintsTable).values(x)")).toHaveLength(1);
      expect(writes("tx\n  .insert( photoFingerprintsTable )")).toHaveLength(1);
      expect(writes("db.update(photoFingerprintsTable).set(x)")).toHaveLength(1);
      expect(writes("const t = photoFingerprintsTable;")).toHaveLength(1);
      expect(writes("copy photo_fingerprints from stdin")).toHaveLength(1);
    });
    it("ignores reads and deletes", () => {
      expect(writes("select vector from photo_fingerprints where photo_id = 1")).toEqual([]);
      expect(writes("delete from photo_fingerprints where photo_id = 1")).toEqual([]);
      expect(writes("db.select().from(photoFingerprintsTable)")).toEqual([]);
      expect(writes("db.delete(photoFingerprintsTable)")).toEqual([]);
      expect(writes("photoFingerprintsTable.photoId")).toEqual([]);
    });
    it("a lock or re-check that is only in a comment doesn't count", () => {
      const write = "await tx.insert(photoFingerprintsTable).values(row);";
      const open = "return db.transaction(async (tx) => {";
      const lock = "await tx.execute(sql`select id from photos where id = ${id} for share`);";
      const recheck = "if ((await hiddenPhotoIds([id], tx)).has(id)) return;";
      const why = (body: string) => {
        const text = stripComments(body);
        const [w] = findWrites(text);
        return unguarded(text, w!);
      };
      expect(why([open, lock, recheck, write].join("\n"))).toBeNull();
      expect(why([open, "// " + lock, recheck, write].join("\n"))).toMatch(/for share/);
      expect(why([open, lock, "/* " + recheck + " */", write].join("\n"))).toMatch(/hiddenPhotoIds/);
      expect(why([open, lock, "// " + recheck, write].join("\n"))).toMatch(/hiddenPhotoIds/);
      expect(why([open, lock + " // for share", recheck, write].join("\n"))).toBeNull();
      expect(stripComments("const u = 'https://x'; // gone\nnext")).toBe(`const u = 'https://x'; ${" ".repeat(7)}\nnext`);
    });
    it("accepts the locked re-check, and refuses each step missing or out of order", () => {
      const write = "await tx.insert(photoFingerprintsTable).values(row);";
      const lock = "await tx.execute(sql`select id from photos where id = ${id} for share`);";
      const recheck = "if ((await hiddenPhotoIds([id], tx)).has(id)) return;";
      const open = "return db.transaction(async (tx) => {";
      const why = (body: string) => {
        const [w] = findWrites(body);
        return unguarded(body, w!);
      };
      expect(why([open, lock, recheck, write].join("\n"))).toBeNull();
      expect(why([lock, recheck, write].join("\n"))).toMatch(/not inside a transaction/);
      expect(why([open, recheck, write].join("\n"))).toMatch(/for share/);
      expect(why([open, lock, write].join("\n"))).toMatch(/hiddenPhotoIds/);
      expect(why([open, recheck, lock, write].join("\n"))).toMatch(/hiddenPhotoIds/);
      // The lock and re-check in one transaction, the write in another.
      expect(why([open, lock, recheck, "});", open, write].join("\n"))).toMatch(/for share/);
      expect(why([open, lock, recheck, "await db.insert(photoFingerprintsTable).values(row);"].join("\n"))).toMatch(
        /through db/,
      );
    });
  });
});
