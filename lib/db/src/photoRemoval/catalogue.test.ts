import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createThrowawayDatabase, dropThrowawayDatabase } from "../migrate/testDatabase";

// SYC-462 spec §3.1, T3: every place that can link to a photo, or hold bytes
// or JSON, is on a reviewed list. A new one turns this red until someone
// decides how a removal treats it, and updates the spec's map and this list.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

/** Spec §3.1 P1–P8: columns that point at photos.id. */
const PHOTO_LINKS = [
  "cats.primary_photo_id", // P3: repointed
  "observations.photo_id", // P6: left pointing (append-only)
  // SYC-527 §6.1: deleted. A trigger deletes the row when the photo is
  // hidden or removed (migration 0039), and the cascade when the row goes.
  "photo_fingerprints.photo_id",
  "photo_variants.photo_id", // P2: deleted
  "photo_visibility_events.photo_id", // P8: untouched
  "sighting_photos.photo_id", // P5: left in place
  "sightings.photo_id", // P4: left pointing (append-only)
  // SYC-677: a draft batch's staged photo, and a saved visit's kept photo
  // (add-only). Left in place: removal nulls the picture like any other
  // photo's, and the link rows stay (remove.test.ts, "SYC-677").
  "vet_batch_photos.photo_id",
  "vet_visit_photos.photo_id",
  "welfare_reports.photo_id", // P7: left pointing
];

/**
 * Every bytea, json and jsonb column, reviewed against spec §3.1 (19 Oct
 * 2026): none holds a catalogue photo's picture, id or address except the
 * two picture tables, which removal handles, and the reporters' own photos
 * (out of scope, D3; SYC-478).
 */
const BYTES_AND_JSON = [
  "app_settings.value", // switches
  "held_typing.fields", // SYC-516: a signed-out save's named text boxes; never bytes, a photo id or an address
  "mail_outbox.payload", // kind + digest counts; never bytes or an id
  "map_data_files.bytes", // SYC-705: map style and font files; public map data, never a photo
  "mapping_events.after",
  "mapping_events.before",
  "observations.suggested_value", // the model's raw colour answer
  "observations.value",
  "person_events.detail",
  "photo_variants.bytes", // P2: deleted by removal
  "sighting_matches.suggested", // cat ids and scores
  "vet_batch_cats.did", // SYC-677: what was done, e.g. ["sterilised"]; never a photo id or bytes
  "vet_batch_cats.new_cat", // SYC-677: { name, description } of a cat not yet in the catalogue
  "vet_batch_cats.suggestions", // SYC-677: the photo search's cat ids and scores
  "vet_batches.vaccines", // SYC-677: vaccine names
  "welfare_report_photos.bytes", // reporters' own photos: out of scope (D3, SYC-478)
];

let name: string;
let c: pg.Client;

beforeAll(async () => {
  const t = await createThrowawayDatabase(baseUrl, { prefix: "photo_catalogue" });
  name = t.name;
  c = new pg.Client({ connectionString: t.url });
  await c.connect();
});

afterAll(async () => {
  await c?.end();
  await dropThrowawayDatabase(baseUrl, name);
});

describe("T3: every link to photos, and every byte or JSON column, is reviewed", () => {
  it("links to photos.id (foreign keys, and columns named photo_id / *_photo_id)", async () => {
    const fk = await c.query<{ col: string }>(
      `select kcu.table_name || '.' || kcu.column_name as col
         from information_schema.referential_constraints rc
         join information_schema.key_column_usage kcu
           on kcu.constraint_name = rc.constraint_name and kcu.constraint_schema = rc.constraint_schema
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = rc.unique_constraint_name and ccu.constraint_schema = rc.unique_constraint_schema
        where kcu.constraint_schema = 'public' and ccu.table_name = 'photos'`,
    );
    const named = await c.query<{ col: string }>(
      `select table_name || '.' || column_name as col from information_schema.columns
        where table_schema = 'public' and table_name <> 'photos'
          and (column_name = 'photo_id' or column_name like '%\\_photo\\_id' escape '\\')`,
    );
    const found = [...new Set([...fk.rows, ...named.rows].map((r) => r.col))].sort();
    expect(found).toEqual([...PHOTO_LINKS].sort());
  });

  it("bytea, json and jsonb columns", async () => {
    const r = await c.query<{ col: string }>(
      `select c.table_name || '.' || c.column_name as col
         from information_schema.columns c
         join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
          and c.data_type in ('bytea', 'json', 'jsonb')
        order by 1`,
    );
    expect(r.rows.map((x) => x.col)).toEqual([...BYTES_AND_JSON].sort());
  });
});
