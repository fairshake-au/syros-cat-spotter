/**
 * TEST-ONLY ORACLE. A frozen, verbatim copy of `resolveCoat` from
 * `resolve.ts` as it stood on main at 9313db86, before SYC-398 A1 (only its
 * names changed: CoatColour -> LegacyCoatCode, COAT_COLOURS ->
 * LEGACY_COAT_CODES, plus a local copy of the removed `normaliseColours`).
 * `resolve.coatParts.test.ts` runs it beside `resolveCoatParts` on every
 * old-shape fixture (A1.3 test 15: parity): the new colours must be the
 * translation of what this engine resolved, apart from its cap of two.
 * Never imported by production code.
 */
import type { Observation } from "@workspace/db/schema";
import {
  appearanceAuthorityLevel,
  appearanceVoiceKeys,
  hasTwoVoices,
  highestAuthority,
  onePerVoice,
  standingAppearanceRows,
  type AppearanceRanking,
  type Voice,
} from "../resolve";
import { LEGACY_COAT_CODES, type LegacyCoatCode } from "../appearance";

export interface V1Resolved {
  value: LegacyCoatCode[] | null;
  confidence: "confirmed" | "likely" | "reported" | "unknown";
  supportingObservationIds: number[];
  conflicts: number[];
  asOf: string;
  checkReasons: string[];
}
type AppearanceCheckReason = string;

const EPOCH = new Date(0).toISOString();

function normaliseColours(colours: readonly string[]): string[] {
  const unique = [...new Set(colours)];
  if (unique.length === 2 && unique.includes("black") && unique.includes("white")) {
    return ["black_and_white"];
  }
  return unique;
}

function toIso(d: Date | string): string {
  return typeof d === "string" ? new Date(d).toISOString() : d.toISOString();
}

function isRetractionValue(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { retracted?: unknown }).retracted === true
  );
}

function isNewer(a: Observation, b: Observation): boolean {
  const at = a.observedAt.getTime();
  const bt = b.observedAt.getTime();
  return at > bt || (at === bt && a.id > b.id);
}

/** The voices that count towards a value's tally: those with at least one
 * row that is not a prompted tap. */
function countingVoices(voices: readonly Voice[]): Voice[] {
  return voices.filter((v) => v.rows.some((r) => r.provenance !== "prompted"));
}

/** The newest supporting statement: the newest non-prompted row. */
function newestVoiceAt(voices: readonly Voice[]): number {
  return Math.max(
    -Infinity,
    ...voices.flatMap((v) =>
      v.rows.filter((r) => r.provenance !== "prompted").map((r) => r.observedAt.getTime()),
    ),
  );
}

/** The authority statement that decides, or undefined: Decision G's order
 * through `highestAuthority` (highest level, then newest by `observedAt`,
 * ties by id). Machine readings are never authority. */
function pickAuthority<T extends { row: Observation }>(
  statements: readonly T[],
  ranking: AppearanceRanking,
): T | undefined {
  const candidates = statements.filter((s) => s.row.provenance !== "machine");
  const winner = highestAuthority(
    candidates.map((s) => s.row),
    ranking,
  );
  return winner ? candidates.find((s) => s.row === winner) : undefined;
}

const COAT_COLOUR_SET: ReadonlySet<string> = new Set(LEGACY_COAT_CODES);

/** A coat row's colours, normalised (black + white is black and white), or
 * null for a malformed value. `["not_sure"]` comes back as `[]`: it says
 * nothing. */
function coatColours(value: unknown): LegacyCoatCode[] | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = (value as { colours?: unknown }).colours;
  if (!Array.isArray(raw) || !raw.every((c) => COAT_COLOUR_SET.has(c as string))) return null;
  const colours = normaliseColours(raw as string[]) as LegacyCoatCode[];
  return colours.filter((c) => c !== "not_sure");
}

function sameColourSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c) => b.includes(c));
}

/**
 * A cat's coat colour (spec §4.2 "Colour", data spine §10.2). Pure.
 *
 * Machine readings are the `provenance: "machine"` rows in the same list.
 *
 * 1. Authority: the highest `ranking` level present, then the newest by
 *    `observedAt`. A team Confirm is a statement with the same value.
 *    *Confirmed*. A later machine reading or spotter never beats it.
 * 2. Two independent voices per colour. Separate camps (nobody named both)
 *    show only the camp with the newer support, flagged `tied_camps`.
 *    *Likely*. If the machine has a different real reading, flagged
 *    `spotters_over_machine`.
 * 3. The machine's newest reading, if it is not Not sure. *Reported*.
 * 4. The newest single spotter fills a gap the machine left. *Reported*.
 * 5. Not sure: `value: null`, *unknown*.
 *
 * `no_authority` is set when the colour is the machine's alone or not sure.
 */
export function resolveCoatV1(
  observations: readonly Observation[],
  ranking: AppearanceRanking = appearanceAuthorityLevel,
): V1Resolved {
  const statements = standingAppearanceRows(observations, "coat", false, ranking).flatMap((row) => {
    const colours = coatColours(row.value);
    return colours ? [{ row, colours }] : [];
  });

  // Rule 1: authority. A person's Not sure is never a statement.
  const authority = pickAuthority(
    statements.filter((s) => s.colours.length > 0),
    ranking,
  );
  if (authority) {
    return {
      value: authority.colours,
      confidence: "confirmed",
      supportingObservationIds: [authority.row.id],
      conflicts: [],
      asOf: toIso(authority.row.observedAt),
      checkReasons: [],
    };
  }

  // The machine's reading is its NEWEST reading only (Samuel, 14 Oct 2026,
  // review finding 9). If that row is Not sure, or the team marked it wrong,
  // the machine has no reading: an older reading never comes back.
  const newestMachineRow = observations
    .filter((o) => o.kind === "coat" && o.provenance === "machine" && !isRetractionValue(o.value))
    .reduce<Observation | undefined>((best, o) => (!best || isNewer(o, best) ? o : best), undefined);
  const newestMachine = newestMachineRow
    ? statements.find((s) => s.row.id === newestMachineRow.id)
    : undefined;
  const machine = newestMachine && newestMachine.colours.length > 0 ? newestMachine : undefined;

  // Rule 2: two voices per colour. A device's colour is its newest standing
  // colour row (Samuel, 14 Oct 2026, review finding 8): when that row is Not
  // sure the device holds no colour and counts towards nothing, linked to
  // its earlier answer or not. Not sure still never wins anything.
  const coloursById = new Map(statements.map((s) => [s.row.id, s.colours]));
  const coloursOfRow = (o: Observation) => coloursById.get(o.id) ?? [];
  //
  // A withdrawal also cuts off the past: once a device has said Not sure,
  // only its rows dated after its newest Not sure count for it, for
  // independence and everything else (ship review finding 6).
  const voices = onePerVoice(
    statements.map((s) => s.row),
    appearanceVoiceKeys(observations, "coat"),
  )
    .map((v) => {
      const lastNotSure = v.rows
        .filter((r) => coloursOfRow(r).length === 0)
        .reduce<Observation | undefined>((best, r) => (!best || isNewer(r, best) ? r : best), undefined);
      return lastNotSure ? { ...v, rows: v.rows.filter((r) => isNewer(r, lastNotSure)) } : v;
    })
    .filter((v) => coloursOfRow(v.row).length > 0);
  const coloursOf = (v: Voice) => coloursOfRow(v.row);

  const agreed: { colour: LegacyCoatCode; voices: Voice[] }[] = [];
  for (const colour of LEGACY_COAT_CODES) {
    // The device's current colours come from its newest row; its evidence
    // for this colour is every one of its rows that named it.
    const holding = voices
      .filter((v) => coloursOf(v).includes(colour))
      .map((v) => ({ ...v, rows: v.rows.filter((r) => (coloursById.get(r.id) ?? []).includes(colour)) }));
    if (hasTwoVoices(holding)) agreed.push({ colour, voices: holding });
  }

  if (agreed.length > 0) {
    // Camps: agreed colours joined when some voice named both.
    const parent = agreed.map((_, i) => i);
    const indexOf = new Map(agreed.map((a, i) => [a.colour, i] as const));
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    // Only a voice that said something itself joins two colours: a prompted
    // tap merely agreed with a pre-filled guess.
    for (const v of countingVoices(voices)) {
      const named = coloursOf(v).flatMap((c) => (indexOf.has(c) ? [indexOf.get(c)!] : []));
      for (let k = 1; k < named.length; k++) parent[find(named[k]!)] = find(named[0]!);
    }
    const camps = new Map<number, typeof agreed>();
    agreed.forEach((a, i) => {
      const root = find(i);
      camps.set(root, [...(camps.get(root) ?? []), a]);
    });
    const campList = [...camps.values()];
    const campNewest = (camp: typeof agreed) => Math.max(...camp.map((a) => newestVoiceAt(a.voices)));
    const camp = campList.reduce((best, c) => (campNewest(c) > campNewest(best) ? c : best));

    // Within the camp: most voices, then the newer support; at most two.
    const shown = [...camp]
      .sort(
        (x, y) =>
          countingVoices(y.voices).length - countingVoices(x.voices).length ||
          newestVoiceAt(y.voices) - newestVoiceAt(x.voices),
      )
      .slice(0, 2);
    // Two agreed colours may be black and white from separate voices; the
    // shown pair has one stored form, as every statement does.
    const value = normaliseColours(shown.map((a) => a.colour)) as LegacyCoatCode[];
    const supporting = [...new Set(shown.flatMap((a) => countingVoices(a.voices).map((v) => v.row.id)))];

    const checkReasons: AppearanceCheckReason[] = [];
    const conflicts: number[] = [];
    if (campList.length > 1) {
      checkReasons.push("tied_camps");
      for (const other of campList) {
        if (other === camp) continue;
        for (const a of other) conflicts.push(...countingVoices(a.voices).map((v) => v.row.id));
      }
    }
    if (machine && !sameColourSet(machine.colours, value)) {
      checkReasons.push("spotters_over_machine");
      conflicts.push(machine.row.id);
    }
    const asOfAt = Math.max(...shown.map((a) => newestVoiceAt(a.voices)));
    return {
      value,
      confidence: "likely",
      supportingObservationIds: supporting,
      conflicts: [...new Set(conflicts)],
      asOf: new Date(asOfAt).toISOString(),
      checkReasons,
    };
  }

  // Rule 3: the machine's real reading.
  if (machine) {
    return {
      value: machine.colours,
      confidence: "reported",
      supportingObservationIds: [machine.row.id],
      conflicts: [],
      asOf: toIso(machine.row.observedAt),
      checkReasons: ["no_authority"],
    };
  }

  // Rule 4: the newest single spotter fills the gap.
  const newestVoice = voices.reduce<Voice | undefined>(
    (best, v) => (!best || isNewer(v.row, best.row) ? v : best),
    undefined,
  );
  if (newestVoice) {
    return {
      value: coloursOf(newestVoice),
      confidence: "reported",
      supportingObservationIds: [newestVoice.row.id],
      conflicts: [],
      asOf: toIso(newestVoice.row.observedAt),
      checkReasons: [],
    };
  }

  // Rule 5: not sure.
  return {
    value: null,
    confidence: "unknown",
    supportingObservationIds: [],
    conflicts: [],
    asOf: EPOCH,
    checkReasons: ["no_authority"],
  };
}
