import { sql, type SQL } from "drizzle-orm";
import { foldNameSql } from "./foldSql";
import { catsTable } from "./schema/cats";

const PLACEHOLDER = "\u0000name\u0000";

/**
 * `cats.normalised_name = <the name folded in SQL>`, for finding the cat that
 * already holds a name. It folds with the same expression as the column, not
 * with `foldName`, so a lookup always agrees with the unique index, even on
 * the few letters newer than the database's Unicode (see foldSql.test.ts).
 */
export function foldedNameEquals(name: string): SQL {
  const [before, after] = foldNameSql(PLACEHOLDER).split(PLACEHOLDER);
  return sql`${catsTable.normalisedName} = ${sql.raw(before!)}${name}::text${sql.raw(after!)}`;
}
