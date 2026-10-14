import type { ClientBase } from "pg";
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, type Migration } from "./runner";

/**
 * SYC-178. Checks a database's own record of applied migrations
 * (drizzle.__drizzle_migrations) against meta/_journal.json, and nothing
 * else: no second database, no row counts. So it still gives a real answer
 * after go-live, when testers' writes make any comparison with the old
 * database fail.
 *
 * A recorded row matches a journal entry by its timestamp (the journal's
 * `when`, as the runner records it) and must carry the same sha256 as the
 * file. Rows are read in id order, which is the order they were written, so
 * the check also sees a migration that ran after a later one.
 *
 * Read-only: one `begin read only` transaction, always rolled back.
 */

export interface RecordedRow {
  id: number;
  hash: string;
  created_at: string | number | null;
}

/** Plain-English problems; empty means the history matches the journal. */
export function historyProblems(
  recorded: RecordedRow[],
  migrations: Migration[],
): string[] {
  if (!recorded.length) {
    return [
      "The database has no migrations recorded. Either migrate has never run here, or this is the wrong database.",
    ];
  }
  const byWhen = new Map(migrations.map((m) => [m.when, m]));
  const problems: string[] = [];
  const seen = new Set<number>();
  let latest: Migration | null = null;

  for (const row of [...recorded].sort((a, b) => a.id - b.id)) {
    if (row.created_at === null) {
      problems.push(
        `Row ${row.id} of the migration history has no timestamp, so it can't be matched to any migration. Something wrote it by hand.`,
      );
      continue;
    }
    const when = Number(row.created_at);
    const m = byWhen.get(when);
    if (!m) {
      problems.push(
        `The database has a migration this code does not know (recorded with timestamp ${when}, row ${row.id}). ` +
          "The database is ahead of this code, or something applied it by hand.",
      );
      continue;
    }
    if (seen.has(when)) {
      problems.push(`${m.tag} is recorded twice (again at row ${row.id}).`);
      if (row.hash !== m.hash) {
        problems.push(
          `${m.tag}'s second record (row ${row.id}) does not match the file in this code either.`,
        );
      }
      continue;
    }
    seen.add(when);
    if (row.hash !== m.hash) {
      problems.push(
        `${m.tag} on the database does not match the file in this code: it was edited after it was applied.`,
      );
    }
    if (latest && m.idx < latest.idx) {
      problems.push(
        `${m.tag} was applied after ${latest.tag}, but comes before it in the journal (applied out of order).`,
      );
    } else {
      latest = m;
    }
  }

  for (const m of migrations) {
    if (seen.has(m.when)) continue;
    problems.push(
      latest && m.idx < latest.idx
        ? `${m.tag} has not been applied, but later migrations have: it was skipped.`
        : `${m.tag} has not been applied yet. Run migrate, then check again.`,
    );
  }
  return problems;
}

export interface HistoryResult {
  problems: string[];
  recorded: number;
  /** The newest journal entry the database has recorded, by journal order. */
  newest: string | null;
}

export async function checkHistory(
  client: ClientBase,
  migrations: Migration[],
): Promise<HistoryResult> {
  await client.query("begin read only");
  try {
    const exists = await client.query<{ t: string | null }>(
      "select to_regclass($1) as t",
      [`"${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`],
    );
    if (!exists.rows[0]?.t) {
      return {
        problems: [
          `The database has no migration history table (${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}). migrate has never run here, or this is the wrong database.`,
        ],
        recorded: 0,
        newest: null,
      };
    }
    const r = await client.query<RecordedRow>(
      `select id, hash, created_at from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" order by id`,
    );
    const known = new Set(r.rows.map((row) => Number(row.created_at)));
    const newest =
      [...migrations].reverse().find((m) => known.has(m.when))?.tag ?? null;
    return {
      problems: historyProblems(r.rows, migrations),
      recorded: r.rows.length,
      newest,
    };
  } finally {
    // A dead connection makes this throw too; keep the original error.
    await client.query("rollback").catch(() => {});
  }
}
