import type pg from "pg";
import { quoteIdent } from "../switchover/fingerprint";
import { PHOTO_REF_RE, type Fingerprint } from "./rules";

// SYC-462 spec §5.5: the search that proves a removed photo is gone. One line
// per check, in this order; the run ends GONE only if every check passes.

export type CheckName = "picture" | "versions" | "main_photo" | "hidden" | "record" | "bytes" | "mentions";

export interface SearchLine {
  check: CheckName;
  ok: boolean | "not_verified";
  detail: string;
}

export type Verdict = "GONE" | "NOT GONE" | "NOT VERIFIED";

export interface SearchResult {
  lines: SearchLine[];
  verdict: Verdict;
  ms: number;
  /** Other photos rows holding the same picture (a race can save one spot twice). */
  otherPhotoIds: number[];
}

export interface PhotoRef {
  id: number;
  publicId: string;
}

/** Column types the scan reads. */
const SCANNED = new Set(["text", "character varying", "json", "jsonb", "ARRAY", "bytea"]);
/** Column types that can't hold a picture or an id string, so aren't scanned. */
const CANNOT_HOLD = new Set([
  "integer",
  "bigint",
  "smallint",
  "boolean",
  "uuid",
  "date",
  "numeric",
  "real",
  "double precision",
  "timestamp with time zone",
  "timestamp without time zone",
  "time without time zone",
  "interval",
  // A Postgres enum (USER-DEFINED with typtype 'e'): only its fixed labels.
  "enum",
]);

const STATEMENT_TIMEOUT_MS = 120_000;
const TIMEOUT = "57014";

interface Column {
  table: string;
  column: string;
  type: string;
}

async function columns(q: pg.ClientBase): Promise<Column[]> {
  const r = await q.query<{ table_name: string; column_name: string; data_type: string }>(
    `select c.table_name, c.column_name,
            case when c.data_type = 'USER-DEFINED'
                  and exists (select 1 from pg_type ty where ty.typname = c.udt_name and ty.typtype = 'e')
                 then 'enum' else c.data_type end as data_type
       from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      order by c.table_name, c.ordinal_position`,
  );
  return r.rows.map((x) => ({ table: x.table_name, column: x.column_name, type: x.data_type }));
}

/** Runs `fn` under a statement timeout; a timeout comes back as "not_verified". */
async function timed<T>(q: pg.ClientBase, timeoutMs: number, fn: () => Promise<T>): Promise<T | "not_verified"> {
  await q.query(`set statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`);
  try {
    return await fn();
  } catch (err) {
    if ((err as { code?: string }).code === TIMEOUT) return "not_verified";
    throw err;
  } finally {
    await q.query(`reset statement_timeout`);
  }
}

/**
 * Check 5: the picture's bytes appear nowhere but (at most) other photos rows,
 * which are reported by id. Every text, varchar, json, jsonb, array and bytea
 * column of every table in `public` is read; a column of any other type that
 * could hold text is reported as unscanned, and fails the check.
 *
 * Assumption (spec §5.5): pictures are stored as one unbroken line of base64
 * (api-server lib/spotPhotos.ts), so a whole copy carries the same slice.
 */
export async function scanBytes(
  q: pg.ClientBase,
  photo: PhotoRef,
  fp: Fingerprint,
  timeoutMs = STATEMENT_TIMEOUT_MS,
): Promise<{ line: SearchLine; otherPhotoIds: number[] }> {
  const cols = await columns(q);
  const unscanned = cols.filter((c) => !SCANNED.has(c.type) && !CANNOT_HOLD.has(c.type));
  const hits: string[] = [];
  const otherPhotoIds: number[] = [];
  const outcome = await timed(q, timeoutMs, async () => {
    for (const c of cols.filter((x) => SCANNED.has(x.type))) {
      const col = `x.${quoteIdent(c.column)}`;
      const match = c.type === "bytea" ? `position($1::bytea in ${col}) > 0` : `${col}::text like '%' || $1 || '%'`;
      const param = c.type === "bytea" ? fp.bytes : fp.text;
      if (c.table === "photos" && c.column === "data") {
        const r = await q.query<{ id: number }>(
          `select x.id from photos x where x.id <> $2 and ${match}`,
          [param, photo.id],
        );
        otherPhotoIds.push(...r.rows.map((row) => row.id));
        continue;
      }
      const r = await q.query<{ n: number }>(
        `select count(*)::int as n from ${quoteIdent(c.table)} x where ${match}`,
        [param],
      );
      if (r.rows[0]!.n > 0) hits.push(`${c.table}.${c.column}`);
    }
    return true;
  });
  if (outcome === "not_verified") {
    return { line: { check: "bytes", ok: "not_verified", detail: "the scan timed out" }, otherPhotoIds };
  }
  const problems = [
    ...hits.map((h) => `found in ${h}`),
    ...otherPhotoIds.map((id) => `the same picture is photo row ${id}`),
    ...unscanned.map((c) => `unscanned column ${c.table}.${c.column} (${c.type})`),
  ];
  return {
    line: {
      check: "bytes",
      ok: problems.length === 0,
      detail: problems.length === 0 ? `nowhere else (${cols.filter((x) => SCANNED.has(x.type)).length} columns read)` : problems.join("; "),
    },
    otherPhotoIds,
  };
}

/** Check 6: the photo's public id appears in no text column but photos.public_id. */
async function scanMentions(q: pg.ClientBase, photo: PhotoRef, timeoutMs: number): Promise<SearchLine> {
  const cols = (await columns(q)).filter(
    (c) => SCANNED.has(c.type) && c.type !== "bytea" && !(c.table === "photos" && c.column === "public_id"),
  );
  const hits: string[] = [];
  const outcome = await timed(q, timeoutMs, async () => {
    for (const c of cols) {
      const r = await q.query<{ n: number }>(
        `select count(*)::int as n from ${quoteIdent(c.table)} x where x.${quoteIdent(c.column)}::text like '%' || $1 || '%'`,
        [photo.publicId],
      );
      if (r.rows[0]!.n > 0) hits.push(`${c.table}.${c.column}`);
    }
    return true;
  });
  if (outcome === "not_verified") return { check: "mentions", ok: "not_verified", detail: "the scan timed out" };
  return {
    check: "mentions",
    ok: hits.length === 0,
    detail: hits.length === 0 ? "no other mention" : `mentioned in ${hits.join(", ")}`,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function verdictOf(lines: SearchLine[]): Verdict {
  if (lines.some((l) => l.ok === false)) return "NOT GONE";
  if (lines.some((l) => l.ok === "not_verified")) return "NOT VERIFIED";
  return "GONE";
}

/**
 * Every check (spec §5.5). `bytes` is the in-transaction result of
 * {@link scanBytes} when the removal ran it; null means it wasn't run here
 * (a dry run, or a re-run after "already removed"). `apply` lets the
 * versions check delete versions it finds (after a real removal only).
 */
export async function searchFor(
  q: pg.ClientBase,
  photo: PhotoRef,
  opts: {
    apply: boolean;
    bytes: { line: SearchLine; otherPhotoIds: number[] } | null;
    recheckDelayMs?: number;
    timeoutMs?: number;
  },
): Promise<SearchResult> {
  const t0 = Date.now();
  const timeoutMs = opts.timeoutMs ?? STATEMENT_TIMEOUT_MS;
  const lines: SearchLine[] = [];

  const row = (
    await q.query<{ no_picture: boolean; removed_at: Date | null; removed_by: string | null; removed_reason: string | null }>(
      `select data is null as no_picture, removed_at, removed_by, removed_reason from photos where id = $1`,
      [photo.id],
    )
  ).rows[0];
  lines.push({
    check: "picture",
    ok: Boolean(row?.no_picture && row.removed_at),
    detail: row?.no_picture ? "no picture; marked removed" : "the picture is still there",
  });

  if (opts.apply) {
    const first = await q.query(`delete from photo_variants where photo_id = $1 returning size`, [photo.id]);
    await sleep(opts.recheckDelayMs ?? 2000);
    const second = await q.query(`delete from photo_variants where photo_id = $1 returning size`, [photo.id]);
    const found = (first.rowCount ?? 0) + (second.rowCount ?? 0);
    lines.push({
      check: "versions",
      ok: found === 0,
      detail: found === 0 ? "none (checked twice)" : `found and deleted ${found}; look into how they were made`,
    });
  } else {
    const n = (await q.query<{ n: number }>(`select count(*)::int as n from photo_variants where photo_id = $1`, [photo.id]))
      .rows[0]!.n;
    lines.push({ check: "versions", ok: n === 0, detail: n === 0 ? "none" : `${n} still kept` });
  }

  const mains = await q.query<{ id: number }>(`select id from cats where primary_photo_id = $1 order by id`, [photo.id]);
  lines.push({
    check: "main_photo",
    ok: mains.rowCount === 0,
    detail: mains.rowCount === 0 ? "no cat's main photo" : `main photo of cat ${mains.rows.map((m) => m.id).join(", ")}`,
  });

  const newest = (
    await q.query<{ action: string }>(
      `select action from photo_visibility_events where photo_id = $1 order by id desc limit 1`,
      [photo.id],
    )
  ).rows[0];
  lines.push({
    check: "hidden",
    ok: newest?.action === "hide",
    detail: newest?.action === "hide" ? "hidden" : "not hidden",
  });

  const recorded =
    Boolean(row?.removed_at && row.removed_by && row.removed_reason) && PHOTO_REF_RE.test(row?.removed_reason ?? "");
  lines.push({
    check: "record",
    ok: recorded,
    detail: recorded ? "who, when and the request are recorded" : "no complete removal record",
  });

  lines.push(
    opts.bytes?.line ?? {
      check: "bytes",
      ok: row?.no_picture ? true : false,
      detail: row?.no_picture ? "checked during the removal run" : "not checked: the picture is still there",
    },
  );

  lines.push(await scanMentions(q, photo, timeoutMs));

  return { lines, verdict: verdictOf(lines), ms: Date.now() - t0, otherPhotoIds: opts.bytes?.otherPhotoIds ?? [] };
}
