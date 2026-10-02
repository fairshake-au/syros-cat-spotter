import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createThrowawayDatabase, dropThrowawayDatabase } from "./testDatabase";

// SYC-111. Proves two things about createThrowawayDatabase:
//  1. it runs the real checked-in migrations, not just a table shape — a
//     hand-written trigger (observations_append_only, migration 0001) is
//     there and enforced, which `drizzle-kit push` would never create;
//  2. it refuses to touch a Neon host.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const created: { name: string }[] = [];
const open: pg.Client[] = [];

afterAll(async () => {
  for (const c of open) await c.end();
  for (const { name } of created) await dropThrowawayDatabase(baseUrl!, name);
});

describe("createThrowawayDatabase", () => {
  it("applies the real migrations: the observations append-only trigger is live", async () => {
    const { url, name } = await createThrowawayDatabase(baseUrl!, {
      prefix: "throwaway_proof",
    });
    created.push({ name });
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    open.push(client);

    const inserted = await client.query<{ id: number }>(
      `insert into observations (cat_id, kind, value, device_id, observed_at)
       values (1, 'sterilised', '{"value": true}'::jsonb, 'throwaway-proof-device', now())
       returning id`,
    );
    const id = inserted.rows[0]!.id;

    // PROOF: with the migration (and its trigger) applied, deleting an
    // observation is refused. A test asserting this would pass vacuously —
    // and prove nothing about whether migrations really ran — on a database
    // whose schema came from `drizzle-kit push` instead, since push never
    // creates hand-written triggers.
    await expect(
      client.query(`delete from observations where id = $1`, [id]),
    ).rejects.toThrow(/observations are append-only/);
  });

  it("refuses a Neon host", async () => {
    await expect(
      createThrowawayDatabase(
        "postgresql://u:p@ep-dev.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full",
      ),
    ).rejects.toThrow(/refuses a Neon host/);
  });
});
