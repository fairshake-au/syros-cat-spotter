import { pool } from "@workspace/db";

// Tests only: this switches an add-only guard off. Refuse to load anywhere
// else.
if (!process.env["VITEST"]) {
  throw new Error("removeTestPerson is for tests only (VITEST is not set).");
}

// SYC-53 PR 0.1: `removePerson` is retired from the app (spec 9.6): every
// person now has an `added` event with a strict link, so a hard delete can
// never succeed, and marking as left is the only way off the list.
//
// Tests still need to clean up the people they create, in a database that
// lasts the whole run. This does what the old function did, for tests only:
// inside one transaction it switches the add-only trigger on person_events
// off, deletes the person's events, switches it back on, then deletes their
// roles and the person. It refuses (and so changes nothing, the trigger
// switch-off included) for anyone another table still names, or who has
// written an observation, exactly as removePerson did. It is never imported
// by anything that ships.

function isForeignKeyViolation(err: unknown): boolean {
  let e = err;
  while (e && typeof e === "object") {
    if ((e as { code?: unknown }).code === "23503") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** True if the person existed and is now gone; false if never on the list. */
export async function removeTestPerson(email: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query(
      `select id from people where email = $1 for update`,
      [email.trim().toLowerCase()],
    );
    const id: string | undefined = found.rows[0]?.id;
    if (!id) {
      await client.query("rollback");
      return false;
    }
    const authored = await client.query(
      `select 1 from observations where account_id = $1 limit 1`,
      [id],
    );
    if (authored.rowCount) {
      throw new Error("This person has history. Use mark-left instead.");
    }
    await client.query(
      `alter table person_events disable trigger person_events_append_only`,
    );
    await client.query(`delete from person_events where person_id = $1`, [id]);
    await client.query(
      `alter table person_events enable trigger person_events_append_only`,
    );
    // SYC-396 PR 3.3a: the record of their report downloads is add-only too.
    await client.query(
      `alter table report_downloads disable trigger report_downloads_append_only`,
    );
    await client.query(`delete from report_downloads where person_id = $1`, [id]);
    await client.query(
      `alter table report_downloads enable trigger report_downloads_append_only`,
    );
    await client.query(`delete from person_scopes where person_id = $1`, [id]);
    await client.query(`delete from people where id = $1`, [id]);
    await client.query("commit");
    return true;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    if (isForeignKeyViolation(err)) {
      throw new Error("This person has history. Use mark-left instead.");
    }
    throw err;
  } finally {
    client.release();
  }
}
