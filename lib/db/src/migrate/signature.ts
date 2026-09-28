import type { ClientBase } from "pg";

/**
 * A schema's shape as a sorted list of lines: every column (type, nullability,
 * default), index, constraint and enum. Two schemas with equal signatures are
 * interchangeable for the application.
 *
 * Schema names are stripped from every definition so a schema built under a
 * scratch name compares equal to the same schema built in `public`.
 */
export async function schemaSignature(
  client: ClientBase,
  schema: string,
): Promise<string[]> {
  const strip = (s: string | null) =>
    s === null
      ? "null"
      : s.split(`"${schema}".`).join("").split(`${schema}.`).join("");

  const lines: string[] = [];

  const columns = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    `select c.table_name, c.column_name, c.data_type, c.udt_name,
            c.is_nullable, c.column_default
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = $1 and t.table_type = 'BASE TABLE'`,
    [schema],
  );
  for (const c of columns.rows) {
    lines.push(
      `column ${c.table_name}.${c.column_name} ${c.data_type}/${c.udt_name}` +
        ` nullable=${c.is_nullable} default=${strip(c.column_default)}`,
    );
  }

  const indexes = await client.query<{ indexname: string; indexdef: string }>(
    `select indexname, indexdef from pg_indexes where schemaname = $1`,
    [schema],
  );
  for (const i of indexes.rows) {
    lines.push(`index ${i.indexname} ${strip(i.indexdef)}`);
  }

  const constraints = await client.query<{
    relname: string;
    conname: string;
    contype: string;
    def: string;
  }>(
    `select cl.relname, con.conname, con.contype,
            pg_get_constraintdef(con.oid) as def
       from pg_constraint con
       join pg_class cl on cl.oid = con.conrelid
       join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = $1`,
    [schema],
  );
  for (const c of constraints.rows) {
    lines.push(
      `constraint ${c.relname}.${c.conname} ${c.contype} ${strip(c.def)}`,
    );
  }

  const enums = await client.query<{ typname: string; labels: string[] }>(
    `select t.typname, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
       from pg_type t
       join pg_enum e on e.enumtypid = t.oid
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = $1
      group by t.typname`,
    [schema],
  );
  for (const e of enums.rows) {
    lines.push(`enum ${e.typname} (${e.labels.join(", ")})`);
  }

  return lines.sort();
}

/** Lines present in one signature and not the other, labelled by side. */
export function signatureDiff(
  actual: string[],
  expected: string[],
  labels: { actual: string; expected: string },
): string[] {
  const a = new Set(actual);
  const e = new Set(expected);
  return [
    ...actual
      .filter((l) => !e.has(l))
      .map((l) => `only in ${labels.actual}: ${l}`),
    ...expected
      .filter((l) => !a.has(l))
      .map((l) => `only in ${labels.expected}: ${l}`),
  ];
}
