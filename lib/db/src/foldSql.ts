import { SPACE_CLASS, STRIP_CLASS } from "./foldSqlClasses";

/**
 * `foldName` (./fold.ts) written as one Postgres expression, for SYC-101's
 * `cats.normalised_name` generated column (DECISIONS.md Part 2g).
 *
 * A migration can't call TypeScript, so the database folds with this, step
 * for step in the same order as `foldName`:
 *
 *   NFD → strip combining marks and invisible formatting characters
 *   (`\p{M}`, `\p{Cf}`) → lower-case → `ς` to `σ` → collapse each run of
 *   JavaScript whitespace to one space → NFC → trim spaces.
 *
 * Postgres regexes have no `\p{…}` classes, so the marks, formatting
 * characters and whitespace are spelled out as code-point ranges in
 * ./foldSqlClasses.ts, generated from the same Unicode tables JavaScript's
 * regexes use. Lower-casing goes through the ICU root collation
 * (`und-x-icu`) so it means the same thing whatever the database's own
 * locale is (C.UTF-8 on Neon, en_US.utf8 in CI).
 *
 * **Proof that it agrees with `foldName`:** foldSql.test.ts runs this
 * expression and `foldName` over the same inputs (every Latin, Greek and
 * Cyrillic code point, every mark, formatting and space character, and the
 * named Greek and Latin cases) and fails on any difference. It also fails
 * if the generated classes stop matching JavaScript's own, which is what a
 * Node upgrade with a newer Unicode would do. Either failure means a new
 * migration, never an edit to an applied one.
 *
 * The expression is a plain string because the schema (a generated column)
 * and the tests both need exactly the same text.
 */
export function foldNameSql(column: string): string {
  return (
    `btrim(normalize(regexp_replace(replace(lower(` +
    `regexp_replace(normalize(${column}, NFD), '[${STRIP_CLASS}]', '', 'g')` +
    ` COLLATE "und-x-icu"), 'ς', 'σ'), '[${SPACE_CLASS}]+', ' ', 'g'), NFC), ' ')`
  );
}
