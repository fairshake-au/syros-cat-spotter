/**
 * TEST-ONLY. SYC-398 A1.3 test 15 (parity): the colours part of
 * `resolveCoatParts`, checked against the frozen pre-SYC-398 engine
 * (`resolveCoatV1`) whenever every coat row in the fixture is old-shape.
 *
 * Parity: the new colours are the translation (`readCoatValue`) of what the
 * old engine resolved, apart from its cap of two: the old answer's
 * translated colours are all shown, and more are shown only where the old
 * engine had already shown two. A fixture where the spec changes the answer
 * on purpose passes `exempt` with the reason (spec §4: a statement that
 * doesn't state the colours, such as an old "Tabby", never decides them).
 */
import { expect } from "vitest";
import type { Observation } from "@workspace/db/schema";
import { readCoatValue } from "../appearance";
import { appearanceAuthorityLevel, resolveCoatParts, type AppearanceRanking } from "../resolve";
import { resolveCoatV1 } from "./resolveCoatV1";

function isOldShape(o: Observation): boolean {
  if (o.kind !== "coat") return true;
  const v = o.value as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return true;
  return !("pattern" in v) && !("notSure" in v);
}

export function coloursWithParity(
  rows: readonly Observation[],
  ranking: AppearanceRanking = appearanceAuthorityLevel,
  opts: { exempt?: string } = {},
) {
  const parts = resolveCoatParts(rows, ranking);
  if (!opts.exempt && rows.every(isOldShape)) {
    const old = resolveCoatV1(rows, ranking);
    const translated = old.value ? (readCoatValue({ colours: old.value })?.colours ?? null) : null;
    const now = parts.colours.value;
    if (translated === null) {
      expect(now, `parity: the old engine resolved ${JSON.stringify(old.value)}`).toBeNull();
    } else {
      expect(now, `parity: the old engine resolved ${JSON.stringify(old.value)}`).not.toBeNull();
      expect(now).toEqual(expect.arrayContaining(translated));
      // The old engine was capped when it showed two codes (one may have
      // been "tabby", now the pattern) or two colours (black_and_white is
      // one code but two colours).
      if (now!.length > translated.length) {
        const capped = old.value!.length === 2 || translated.length === 2;
        expect(capped, "more colours than the old engine showed, but it wasn't capped").toBe(true);
      }
    }
  }
  return parts.colours;
}
