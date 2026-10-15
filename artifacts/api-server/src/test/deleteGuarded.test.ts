import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { deleteTestRows } from "./deleteGuarded";

// SYC-298: the helper switches a never-deleted guard off for one statement and
// must always switch it back on, whether the delete succeeds or fails.
const enabled = async (trigger: string) =>
  (await pool.query("select tgenabled from pg_trigger where tgname = $1", [trigger])).rows[0]?.tgenabled;

afterAll(async () => {
  await pool.end();
});

describe("deleteTestRows re-arms the guard", () => {
  it("after a delete, the colonies guard is on again and still refuses", async () => {
    const name = `vt-guard-${randomBytes(4).toString("hex")}`;
    const { rows } = await pool.query(
      "insert into colonies (name, normalised_name) values ($1, $1) returning id",
      [name],
    );
    await deleteTestRows("colonies", "id = $1", [rows[0].id]);
    expect(await enabled("colonies_never_deleted")).toBe("O");
    const again = await pool.query(
      "insert into colonies (name, normalised_name) values ($1, $1) returning id",
      [`${name}-2`],
    );
    await expect(pool.query("delete from colonies where id = $1", [again.rows[0].id])).rejects.toThrow(
      /never deleted/,
    );
    await deleteTestRows("colonies", "id = $1", [again.rows[0].id]);
  });

  it("after a failed delete, the feeding_sites guard is on again", async () => {
    await expect(deleteTestRows("feeding_sites", "no_such_column = $1", [1])).rejects.toThrow();
    expect(await enabled("feeding_sites_never_deleted")).toBe("O");
  });
});
