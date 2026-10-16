# SYC-398: a cat's coat as colours you can see plus one pattern — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the eight-value coat list with "any of five colours plus one pattern", end to end:
- how statements are written and read;
- who wins;
- the public wire;
- the team's pages;
- the AI reader and its one checked re-read;
- the "Find the cat" filter.
No stored record is ever rewritten.

**Architecture:**
- One pure module (`appearance.ts`) owns the vocabulary and the **one translation** of every stored statement into parts (`readCoatValue`). It also owns the reverse (`partsToValue`) and the old-field truth table (`legacyCoatCodes`). Every reader and writer goes through it.
- The resolver projects the **standing** statements onto a colour part and a pattern part, and runs SYC-2's existing rule engine on each.
- The wire adds `coatColours` and `coatPattern` beside the old `coat`. The old field stays for older phones, display only.

**Tech stack:**
- Node/Express API with drizzle and Postgres, in `artifacts/api-server`;
- OpenAPI with orval codegen, in `lib/api-spec`, `lib/api-zod` and `lib/api-client-react`;
- the Expo React Native app, in `artifacts/cat-spotter`;
- vitest in both;
- `react-native-svg`, which is already installed.

**Status:** **plan approved by Samuel, 16 October 2026** ("approved, start A1 in a new session").

**Spec:** `docs/specs/coat-colours-and-pattern.md` (approved by Samuel, 16 Oct 2026, with 2A, 3A, 4A, 5A and 6A). Read it in full first. Section numbers (§n) refer to it.

## Global Constraints

- **Colours:** `black`, `grey`, `brown`, `ginger`, `white`, in that display order, with no limit on how many a coat has. **Patterns:** `plain`, `stripes`, `patches`.
- **No database migration.** Values live in the existing `observations.value` jsonb.
- **Never rewrite a stored statement.** Old shapes are read through `readCoatValue` (A1.1).
- **New coat writes use the new shape.**
  - Extra keys the team code already adds (`reason`, `agreesWith`) stay allowed.
  - Old shapes are refused after A1.
- **The old public `coat` field is display-only.** It is never used to filter.
- **`CATS_CACHE_KEY` stays `cat-spotter/cats-cache/public/v2`.** Its test stays green unedited.
- **Colour and pattern are never evidence of life, never notifiable, and never read by the matcher** (SYC2-D8).
- **The public sees only the resolved parts.** It never sees confidence, author, model version or dates.
- **Words:**
  - "cat guardian", never "colony carer";
  - "spotter", never "snapper";
  - the public never sees *tabby*, *tortoiseshell* or *calico* (§2), including from an old cached catalogue;
  - display lines are joined with " · " (Decision E1).
- **Model:** mock it in every test. No real calls, and no production writes from tests.
- **Every PR:**
  - is built in its own worktree off fresh `origin/main`;
  - has a `CHECKPOINT.md` (untracked);
  - **commits after each item**;
  - has the mutation probes listed for it, run and recorded in the PR;
  - is reviewed through `/ship`, with an adversarial reviewer in its own worktree;
  - must typecheck and pass the full suite **on its own**.
- **Never blocks the 31 Oct launch** (Decision 6A).

---

## In plain English (for Samuel)

Five PRs. A1 and A2 are the foundation. B and C can run side by side. D is the screen spotters see.

| PR | What it does | What people notice |
|---|---|---|
| **A1** Server foundation | The new words; how every old statement is read in the new terms; who wins for colours and pattern separately; everything that reads or writes a coat moved over, team pages included, so it all still works | Team pages show the new words. Two cats (#10, #19) lose "White" from their coat line until the re-read (§6) |
| **A2** Public data | Cat pages and cards show "Brown · Ginger · Stripes"; older phones keep working | The new coat line on cat pages |
| **B** Team pages, the rest | Pattern buttons on the team's Correct form and the drawn cat after saving | The team can record pattern, and Samuel's verdicts |
| **C** The AI reader | The new prompt (coat-v2) and the one-off checked re-read, started by hand | Nothing until the re-read is approved |
| **D** "Find the cat" chips | Drawn colour and pattern chips and the drawn cat; the two filter rows | Spotters can filter by colour and pattern |

Samuel's steps:
- the usual pull in Replit;
- one contact sheet after C (about 5 minutes);
- the browser check of the drawings in D.

**Not in this plan:** the spotter's colour question, the "add details later" card and the cat-alog's filter. They are SYC-2 PRs 4.1–4.3, not built yet, and they build on this vocabulary. A comment on SYC-2, dated 16 Oct, records the contract: the answer body `{colours, pattern?}` or `{notSure:true}`, and reuse of D's components and `placeCat`.

---

## File structure

**API server** (`artifacts/api-server/src`):
- `lib/appearance.ts`: the vocabulary, `readCoatValue`, `partsToValue`, `legacyCoatCodes` and `orderColours`. **Pure; no database import.** It keeps the old eight codes as `LEGACY_COAT_CODES` for the coat-v1 reader until C.
- `lib/observations.ts`: the `case "coat"` check; `STATEMENT_KEYS`.
- `lib/resolve.ts`: the per-part resolver lives **here**, not in a new file, to avoid a `resolve.ts` ↔ `coatResolve.ts` import cycle:
  - `resolveCodeSet` (generic, extracted from `resolveCoat`);
  - `resolveCoatParts`;
  - the projection;
  - `CatSnapshot.coatColours` and `CatSnapshot.coatPattern`.
- The readers and writers moved in A1.4:
  - `lib/catHelpers.ts`, `lib/guardianCatView.ts`, `lib/handPick.ts`, `lib/colourCheck.ts`, `lib/teamCatView.ts`;
  - `lib/teamCorrections.ts`, `routes/teamCorrections.ts`;
  - `lib/teamPages/appearancePage.ts`, `lib/teamPages/strings/{en,el,fr}.ts`;
  - `lib/coatReading/{reader,record,sweep}.ts`.
- C: `lib/coatReading/{reader,due,record,sweep}.ts`, `routes/internalCoat.ts`, `.github/workflows/coat-readings.yml`.

**Shared:** `lib/api-spec/openapi.yaml`, regenerated into `lib/api-zod` and `lib/api-client-react`.

**App** (`artifacts/cat-spotter`):
- `lib/coat.ts` (new, pure): `coatParts`, which reads the new fields or translates the old `coat` **for display only**; `coatLineKeys`; `placeCat`.
- `components/coat/` (new, shared): `ColourSwatch`, `PatternTile`, `DrawnCat` and `CoatChips`.
- `components/CatPicker.tsx`, `lib/appearance.ts`, `lib/i18n.ts`.

**Docs:** the spec amendments listed at the top of the spec, plus a `DECISIONS.md` entry (A1.5).

---

## PR A1 — Server foundation (it must typecheck and keep every page working on its own)

**Depends on:** nothing.
**On the wire:** `coat` is the same **set** for every live cat, except #10 and #19 (`[tabby, white]` → `[tabby]`, spec §6). Array order can change. The new fields arrive in A2.

### Task A1.1: The vocabulary, the translation and its reverse

**Files:** modify `lib/appearance.ts`; test `lib/appearance.coat.test.ts` (new).

**Interfaces (produced):**
- `COAT_COLOURS`, `CoatColour`, `COAT_PATTERNS`, `CoatPattern`;
- `LEGACY_COAT_CODES`, `LegacyCoatCode`, `LegacyPublicCode`;
- `CoatParts { colours: CoatColour[] | null; pattern: CoatPattern | null; notSure: boolean }`;
- `readCoatValue(value: unknown): CoatParts | null`;
- `partsToValue(parts: CoatParts): { colours?: CoatColour[]; pattern?: CoatPattern } | { notSure: true }`;
- `orderColours(xs: Iterable<string>): CoatColour[]`;
- `legacyCoatCodes(colours: readonly CoatColour[], pattern: CoatPattern | null): LegacyPublicCode[]`.

`normaliseColours` stays until A1.4 removes its last caller.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { COAT_COLOURS, COAT_PATTERNS, legacyCoatCodes, partsToValue, readCoatValue } from "./appearance";

describe("readCoatValue: the one translation (spec §6)", () => {
  const cases: [string, unknown, ReturnType<typeof readCoatValue>][] = [
    ["new, both parts", { colours: ["brown", "ginger"], pattern: "stripes" }, { colours: ["brown", "ginger"], pattern: "stripes", notSure: false }],
    ["new, colours only", { colours: ["ginger"] }, { colours: ["ginger"], pattern: null, notSure: false }],
    ["new, pattern only", { pattern: "stripes" }, { colours: null, pattern: "stripes", notSure: false }],
    ["new, with the team's reason and agreesWith", { colours: ["grey"], reason: "x", agreesWith: 4 }, { colours: ["grey"], pattern: null, notSure: false }],
    ["notSure", { notSure: true }, { colours: null, pattern: null, notSure: true }],
    ["old ginger · tabby", { colours: ["ginger", "tabby"] }, { colours: ["ginger"], pattern: "stripes", notSure: false }],
    ["old tabby", { colours: ["tabby"] }, { colours: null, pattern: "stripes", notSure: false }],
    ["old tabby · white: a bare white never becomes known", { colours: ["tabby", "white"] }, { colours: null, pattern: "stripes", notSure: false }],
    ["old black_and_white · tabby keeps black and white", { colours: ["black_and_white", "tabby"] }, { colours: ["black", "white"], pattern: "stripes", notSure: false }],
    ["old black_and_white", { colours: ["black_and_white"] }, { colours: ["black", "white"], pattern: null, notSure: false }],
    ["old tortoiseshell_or_calico", { colours: ["tortoiseshell_or_calico"] }, { colours: ["black", "ginger"], pattern: "patches", notSure: false }],
    ["old not_sure", { colours: ["not_sure"] }, { colours: null, pattern: null, notSure: true }],
    ["machine v1 row", { colours: ["ginger", "tabby"], modelVersion: "gpt-5.6-terra/coat-v1" }, { colours: ["ginger"], pattern: "stripes", notSure: false }],
    ["retraction", { retracted: true }, null],
    ["unknown code", { colours: ["purple"] }, null],
    ["nothing stated", {}, null],
  ];
  for (const [label, value, expected] of cases) it(label, () => expect(readCoatValue(value)).toEqual(expected));

  it("orders colours black, grey, brown, ginger, white", () => {
    expect(readCoatValue({ colours: ["white", "brown", "black"] })?.colours).toEqual(["black", "brown", "white"]);
  });
});

describe("partsToValue: never writes nulls", () => {
  it.each([
    [{ colours: ["ginger"], pattern: null, notSure: false }, { colours: ["ginger"] }],
    [{ colours: null, pattern: "stripes", notSure: false }, { pattern: "stripes" }],
    [{ colours: ["brown"], pattern: "plain", notSure: false }, { colours: ["brown"], pattern: "plain" }],
    [{ colours: null, pattern: null, notSure: true }, { notSure: true }],
  ] as const)("%j → %j", (parts, value) => expect(partsToValue(parts as never)).toEqual(value));
});

/** The spec §6 truth table, written independently of the implementation. */
function oracle(colours: readonly string[], pattern: string | null): string[] {
  const s = new Set(colours);
  const nonBW = colours.filter((c) => c !== "black" && c !== "white");
  if (s.has("black") && s.has("white") && nonBW.length === 0 && pattern !== "stripes") return ["black_and_white"];
  if (pattern === "patches" && s.has("black") && s.has("ginger")) return ["tortoiseshell_or_calico"];
  if (pattern === "stripes") {
    for (const c of ["ginger", "grey", "black", "white"]) if (s.has(c)) return c === "white" ? ["tabby", "white"] : [c, "tabby"];
    return ["tabby"];
  }
  return ["black", "white", "ginger", "grey"].filter((c) => s.has(c)).slice(0, 2);
}

describe("legacyCoatCodes: the old field for older phones", () => {
  it("matches the spec table for all 32 colour sets × 4 pattern states", () => {
    for (let mask = 0; mask < 32; mask++) {
      const colours = COAT_COLOURS.filter((_, i) => mask & (1 << i));
      for (const pattern of [...COAT_PATTERNS, null]) {
        expect(legacyCoatCodes(colours, pattern), `${colours}+${pattern}`).toEqual(oracle(colours, pattern));
      }
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** From `artifacts/api-server`, with the darwin esbuild workaround (memory "Local vitest/esbuild workaround"), run `pnpm exec vitest run src/lib/appearance.coat.test.ts`. Expected: FAIL (not exported).

- [ ] **Step 3: Implement** in `appearance.ts`. Keep `MARKS`, and keep `normaliseColours` for now.

```ts
export const COAT_COLOURS = ["black", "grey", "brown", "ginger", "white"] as const;
export type CoatColour = (typeof COAT_COLOURS)[number];
export const COAT_PATTERNS = ["plain", "stripes", "patches"] as const;
export type CoatPattern = (typeof COAT_PATTERNS)[number];
/** Codes stored before SYC-398 (and still asked of the coat-v1 reader until PR C). Never written again from A1. */
export const LEGACY_COAT_CODES = ["black", "white", "ginger", "grey", "tabby", "tortoiseshell_or_calico", "black_and_white", "not_sure"] as const;
export type LegacyCoatCode = (typeof LEGACY_COAT_CODES)[number];
export type LegacyPublicCode = Exclude<LegacyCoatCode, "not_sure">;

export interface CoatParts { colours: CoatColour[] | null; pattern: CoatPattern | null; notSure: boolean }

const COLOUR_SET: ReadonlySet<string> = new Set(COAT_COLOURS);
const PATTERN_SET: ReadonlySet<string> = new Set(COAT_PATTERNS);
const LEGACY_ONLY: ReadonlySet<string> = new Set(["tabby", "tortoiseshell_or_calico", "black_and_white", "not_sure"]);

export function orderColours(xs: Iterable<string>): CoatColour[] {
  const present = new Set(xs);
  return COAT_COLOURS.filter((c) => present.has(c));
}

/** The one translation (§6). Only what a statement said becomes known. Null for a retraction or a malformed value. Ignores other keys (reason, agreesWith, modelVersion). */
export function readCoatValue(value: unknown): CoatParts | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v["retracted"] === true) return null;
  if (v["notSure"] === true) return { colours: null, pattern: null, notSure: true };
  const raw = v["colours"];
  const rawPattern = v["pattern"];
  if (raw !== undefined && !Array.isArray(raw)) return null;
  if (rawPattern !== undefined && !(typeof rawPattern === "string" && PATTERN_SET.has(rawPattern))) return null;
  const codes = (raw as unknown[] | undefined) ?? [];
  if (!codes.every((c) => typeof c === "string" && (COLOUR_SET.has(c) || LEGACY_ONLY.has(c)))) return null;
  if (codes.length === 0 && rawPattern === undefined) return null;
  if (codes.includes("not_sure")) return codes.length === 1 && rawPattern === undefined ? { colours: null, pattern: null, notSure: true } : null;

  let pattern = (rawPattern as CoatPattern | undefined) ?? null;
  const colours = new Set<string>();
  let bareWhite = false;
  for (const c of codes as string[]) {
    if (c === "tabby") continue;
    if (c === "black_and_white") { colours.add("black"); colours.add("white"); continue; }
    if (c === "tortoiseshell_or_calico") { colours.add("black"); colours.add("ginger"); pattern ??= "patches"; continue; }
    if (c === "white") bareWhite = true;
    colours.add(c);
  }
  if (codes.includes("tabby")) {
    pattern ??= "stripes";
    if (bareWhite && !codes.includes("black_and_white")) colours.delete("white"); // §6: the tabby's own colour was never said
  }
  const ordered = orderColours(colours);
  return { colours: ordered.length ? ordered : null, pattern, notSure: false };
}

/** The reverse, for writers: never emits a null or false part. */
export function partsToValue(parts: CoatParts): { colours?: CoatColour[]; pattern?: CoatPattern } | { notSure: true } {
  if (parts.notSure) return { notSure: true };
  return { ...(parts.colours?.length ? { colours: [...parts.colours] } : {}), ...(parts.pattern ? { pattern: parts.pattern } : {}) };
}

/** The old public `coat` for older phones (§6 truth table). Display only. */
export function legacyCoatCodes(colours: readonly CoatColour[], pattern: CoatPattern | null): LegacyPublicCode[] {
  const has = (c: CoatColour) => colours.includes(c);
  const nonBW = colours.filter((c) => c !== "black" && c !== "white");
  if (has("black") && has("white") && nonBW.length === 0 && pattern !== "stripes") return ["black_and_white"];
  if (pattern === "patches" && has("black") && has("ginger")) return ["tortoiseshell_or_calico"];
  if (pattern === "stripes") {
    const first = (["ginger", "grey", "black", "white"] as const).find(has);
    return first ? (first === "white" ? ["tabby", "white"] : [first, "tabby"]) : ["tabby"];
  }
  return (["black", "white", "ginger", "grey"] as const).filter(has).slice(0, 2);
}
```

- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/appearance.ts artifacts/api-server/src/lib/appearance.coat.test.ts
git commit -m "SYC-398 A1: the coat vocabulary, the one translation and its reverse"
```

### Task A1.2: The check on write

**Files:** modify `lib/observations.ts`:
- the `case "coat"` block (lines 343–415);
- `STATEMENT_KEYS` (line 176);
- a `COAT_PATTERN_SET` beside `COAT_COLOUR_SET` (line 152).

Test: `lib/observations.coat.test.ts` (new). Delete the old coat cases in `observations.test.ts`, including the `normaliseColours` describe at lines 521–530; they move here in their new form.

**There is no key allow-list.** The team code stores `reason` (`teamCorrections.ts:215`) and `agreesWith` (`teamCorrections.ts:554`) in the value. The check validates the coat keys and leaves the rest alone, as today.

- [ ] **Step 1: Failing tests**, each through `writeObservation(db, …)` on a throwaway cat:
  - **accepted:**
    - a spotter `{colours:["brown","ginger"],pattern:"stripes"}`;
    - a spotter with all five colours;
    - a spotter `{notSure:true}`;
    - a team `{pattern:"plain",reason:"x"}`;
    - a team `{colours:["ginger"],reason:"x",agreesWith:12}`;
    - a machine `{colours:["grey"],modelVersion:"m"}`;
    - a machine `{pattern:"stripes",modelVersion:"m"}`;
    - a machine `{notSure:true,modelVersion:"m"}`.
  - **refused (`MALFORMED_VALUE`):**
    - the old shapes `{colours:["tabby"]}`, `{colours:["black_and_white"]}` and `{colours:["not_sure"]}`;
    - an unknown colour; a duplicate colour; an unknown pattern;
    - `{}`, and `{reason:"x"}` alone;
    - a spotter `{pattern:"stripes"}` without colours;
    - a team `{notSure:true}`;
    - `notSure` together with a part;
    - `modelVersion` on a non-machine row; a machine row without `modelVersion`.
  - **A retraction carrying `pattern` or `notSure`** is refused.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement**

```ts
case "coat": {
  if (isRetraction(value)) return;
  if (!isPlainObject(value)) refuse("MALFORMED_VALUE", "coat needs { colours?, pattern? } or { notSure: true }");
  const colours = value["colours"];
  const pattern = value["pattern"];
  if (value["notSure"] !== undefined) {
    if (value["notSure"] !== true) refuse("MALFORMED_VALUE", "notSure must be true");
    if (colours !== undefined || pattern !== undefined) refuse("MALFORMED_VALUE", "notSure is never combined with a colour or pattern");
    if (statesAppearanceWithAuthority(ctx.roleAtTime)) refuse("MALFORMED_VALUE", 'the team and cat guardians never state "not sure"; use Mark wrong');
  } else {
    if (colours !== undefined) {
      if (!Array.isArray(colours) || colours.length < 1 || colours.length > COAT_COLOURS.length) refuse("MALFORMED_VALUE", "coat.colours must have 1 to 5 entries");
      if (!colours.every((c) => COAT_COLOUR_SET.has(c as string))) refuse("MALFORMED_VALUE", "coat.colours must be from the five colours");
      if (new Set(colours).size !== colours.length) refuse("MALFORMED_VALUE", "coat.colours must be distinct");
    }
    if (pattern !== undefined && !(typeof pattern === "string" && COAT_PATTERN_SET.has(pattern))) refuse("MALFORMED_VALUE", "coat.pattern must be plain, stripes or patches");
    if (colours === undefined && pattern === undefined) refuse("MALFORMED_VALUE", "coat states nothing");
    if (ctx.roleAtTime === "public" && colours === undefined) refuse("MALFORMED_VALUE", "a spotter's coat answer names at least one colour");
  }
  const modelVersion = value["modelVersion"];
  if (ctx.provenance === "machine") {
    if (typeof modelVersion !== "string" || modelVersion.length === 0) refuse("MALFORMED_VALUE", "a machine coat needs a non-empty modelVersion");
  } else if (modelVersion !== undefined) {
    refuse("MALFORMED_VALUE", "modelVersion is only allowed on a machine-provenance coat");
  }
  return;
}
```

`STATEMENT_KEYS` becomes `["colours", "pattern", "notSure", "marks", "cantTell", "modelVersion"]`.

- [ ] **Step 4: Run them and watch them pass.**
- [ ] **Step 5: Commit**

### Task A1.3: Who wins, per part

**Files:** modify `lib/resolve.ts`:
- extract `resolveCodeSet` from `resolveCoat` (lines 1045–1235);
- add the projection and `resolveCoatParts`;
- `AppearanceCheckReason` (line 999) gains `pattern_tied_camps` and `mixed_sources`;
- `CatSnapshot` (line 122) swaps `coat` for `coatColours: AppearanceResolved<CoatColour[]>` and `coatPattern: AppearanceResolved<CoatPattern | null>`;
- `resolveCat` (line 1429) changes to match.

Test: `lib/resolve.coatParts.test.ts` (new). Move the coat cases of `resolve.appearance.test.ts` there, in their new form, and update `resolve.test.ts:1050`.

**Interfaces (produced):** `resolveCoatParts(observations, ranking = appearanceAuthorityLevel): { colours: AppearanceResolved<CoatColour[]> & { rule: 1|2|3|4|5 }; pattern: AppearanceResolved<CoatPattern | null> & { rule: 1|2|3|4|5 } }`.

**The algorithm** (this is the subtle part; implement it exactly):
1. **Take only the standing statements first.** Run `standingAppearanceRows(coatRows, "coat", false, ranking)` on the **full, untransformed** coat history. Keep those rows, plus every retraction row and every machine row. So a superseded row never comes back, even when the row that superseded it doesn't state the part being resolved.
   - A newer statement by the same author replaces the whole earlier one. If it doesn't state the pattern, that author's pattern is "not stated", not the old one.
2. **Project each kept row for each part.**
   - A **retraction** stays as it is.
   - A **`notSure`** row becomes `{colours:["not_sure"]}`. It is the only withdrawal.
   - A **machine row** is always kept. A part it doesn't state becomes `{colours: []}`, so the newest machine row's missing part is not known and an older machine row never fills it.
   - A **non-machine row that doesn't state the part** is dropped from that part.
   - **Otherwise** colours project to `{colours: parts.colours}`, and the pattern projects to `{colours: [parts.pattern]}`.
3. **Run the engine.** `resolveCodeSet(projected, codes, maxShown)` is today's `resolveCoat` body with:
   - `COAT_COLOURS` replaced by `codes`;
   - `normaliseColours` replaced by identity;
   - `.slice(0, 2)` replaced by `.slice(0, maxShown)`;
   - the rule number it returned from added to the result.

   Colours run with `maxShown = Infinity`. The pattern runs with `maxShown = 1`, and its `tied_camps` becomes `pattern_tied_camps`.
4. **Mixed sources:** when both parts are known and their `rule` numbers differ, add `mixed_sources` to both `checkReasons` (spec §4 and Decision 2A).

- [ ] **Step 1: Failing tests** (pure, using the `obs()` helper style of `appearance.notNotifiable.test.ts`):
  1. A team `{colours:["ginger"]}` and a machine `{colours:["brown"],pattern:"stripes"}`: colours are ginger (rule 1); the pattern is stripes (rule 3); `mixed_sources` on both parts.
  2. A team `{colours:["ginger"]}` and two independent spotters giving the pattern stripes: `mixed_sources` (rule 1 against rule 2).
  3. A team `{pattern:"plain"}` alone: the colours fall through to the machine.
  4. Two independent spotters `{colours:["brown","ginger"],pattern:"stripes"}`: both parts likely, rule 2, with no `mixed_sources`.
  5. All five colours from two voices: all five are shown.
  6. Two voices for stripes and two for patches, never together: the newer is shown, with `pattern_tied_camps`.
  7. A machine v1 `{colours:["ginger"],pattern:"stripes"}` dated earlier, then a machine v2 `{colours:["ginger"]}`: the pattern is **not known**.
  8. A spotter's old `["tabby"]` row (pattern only) does not withdraw that device's earlier colours.
  9. A spotter's `notSure` withdraws both of its own parts.
  10. **Supersession (spotter):** S1 `{colours:["ginger"],pattern:"stripes"}`, then the same device supersedes it with S2 `{colours:["ginger"]}`. S1's stripes don't come back, so the pattern falls to the next rule.
  11. **Supersession (team):** T1 `{colours:["ginger"]}`, then T2 `{pattern:"plain"}` supersedes T1. T1's colours don't come back.
  12. One device's old-then-new history counts as one voice.
  13. A later machine reading never beats a team statement, in either part.
  14. Mark wrong on a two-part team statement: both parts fall to the next rule.
  15. **Parity:** for every old-shape fixture in the existing coat tests, the colours resolve to the translation of what the old engine resolved, apart from the cap of two.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement the algorithm above.**
- [ ] **Step 4: Run** `src/lib/resolve.coatParts.test.ts src/lib/resolve*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**

### Task A1.4: Every other reader and writer, so A1 builds and every page works

Each item below is its own commit (**commit after each item**). Each has its tests updated in the same commit.

1. **`lib/catHelpers.ts`:**
   - `PublicCoatColour` (line 64) becomes `LegacyPublicCode` from `appearance.ts`;
   - `deriveCatStatuses` (line 349) reads `snapshot.coatColours.value` and `snapshot.coatPattern.value` **once each into locals**, then sets `coat: legacyCoatCodes(colours ?? [], pattern)`;
   - the legacy branch stays `coat: []`.
2. **`lib/guardianCatView.ts`** (lines 71 and 191): the same `LegacyPublicCode` type. Guardian pages keep the old field and words until SYC-53 Slice 6 is ticketed.
3. **`lib/handPick.ts`:**
   - read the spotter's answer through `readCoatValue`;
   - **flag** when it shares no colour with `resolveCoatParts(...).colours.value`, or when both patterns are known and differ;
   - the signature takes the parts.
4. **`lib/colourCheck.ts`:**
   - `ColourCheckCat.coat` becomes `coatColours` and `coatPattern`;
   - `REASON_ORDER` gains `pattern_tied_camps` and `mixed_sources` after `tied_camps`;
   - the reasons are the union of both parts' `checkReasons`.
5. **`lib/teamCatView.ts`:**
   - the `COAT` map holds the five colours and three patterns;
   - the history line (lines 214–220) and `codesOf` (line 858) read through `readCoatValue`, giving for example "brown and ginger, stripes";
   - `appearanceOf` (line 841) takes the two parts.
6. **`lib/teamCorrections.ts` and `routes/teamCorrections.ts`:**
   - `TEAM_COLOURS` (route, line 824) becomes `COAT_COLOURS`;
   - drop the 1–2 cap (lines 904–907) and `normaliseColours`;
   - `correctAppearance` writes `{colours}` (the pattern comes in B);
   - **Confirm per part:** `confirmAppearance` writes `partsToValue` of the known parts plus `agreesWith`, and refuses as "nothing" when neither part is known;
   - `ConfirmForm.expected` carries `expectedColours` and `expectedPattern`, and `sameCodes` compares each part.
7. **`lib/teamPages/appearancePage.ts` and `strings/{en,el,fr}.ts`:**
   - `TEAM_COLOURS` becomes the five;
   - add `coat.brown` and `pattern.{plain,stripes,patches,none}` (the team's words follow the team-page language rule);
   - `appearance.pickColours` becomes "Tick every colour you can see";
   - add `reason.pattern_tied_camps` and `reason.mixed_sources`;
   - `publicLine` builds from the two parts;
   - the colour-check cells read `coatColours` and `coatPattern`.
8. **`lib/coatReading/reader.ts`** (still coat-v1 until C):
   - `COLOUR_DESCRIPTIONS` becomes `Record<LegacyCoatCode, string>`, and `coatPrompt()` maps `LEGACY_COAT_CODES`, **so the live v1 prompt is unchanged byte for byte**;
   - `interpretCoatAnswer` validates against `LEGACY_COAT_CODES`, with a local black + white merge;
   - its result also carries `parts: CoatParts` (via `readCoatValue({colours})`);
   - `reader.test.ts` gains: **"the v1 prompt is unchanged"** (a snapshot of `coatPrompt()` taken before A1).
9. **`lib/coatReading/record.ts`:**
   - `recordReading` writes `{...partsToValue(parts), modelVersion}`;
   - `copyReadingForward` translates its source with `readCoatValue` and writes `partsToValue` plus the source's own `modelVersion`;
   - its "no colours" guard (around line 108) becomes "unreadable value".
10. **`lib/coatReading/sweep.ts`:** `SweepItem.colours` becomes `parts?: CoatParts`. Types only.
11. **`lib/appearance.notNotifiable.test.ts`:**
    - `SYC2_FIELDS` becomes `["coatColours","coatPattern","markings","vaccinations"]`;
    - update the test at line 74 (`after.coat.value`);
    - the regexes `\.(coat|markings|vaccinations)\b` and the destructuring pattern become `\.(coat(?:Colours|Pattern)?|markings|vaccinations)\b`;
    - R7a's allow-list reads `snapshot.coatColours.value` and `snapshot.coatPattern.value` in `deriveCatStatuses`, counted with word boundaries;
    - add a self-test that `snapshot.coatColours.confidence` is flagged.
12. **Remove `normaliseColours`** from `appearance.ts` and its re-export from `observations.ts`.
13. **The other tests:**
    - `routes/team.appearance.test.ts` (value shapes; Confirm per part);
    - `lib/teamPages/catPages.*.test.ts`;
    - `lib/coatReading/coatReading.test.ts` (T-row now asserts the new shape);
    - `routes/cats.appearance.public.test.ts` (`CatCoatItem` still equals the seven old public codes);
    - `routes/internalCoat.test.ts`;
    - `lib/catHelpers.derivedStatus.test.ts`.

- [ ] **Run the full api-server suite, the root `pnpm run typecheck`, and the web preview's team Appearance page** for a live-shaped cat. Expected: all green (re-run any SYC-334 flake alone), and no raw code or `undefined` on the page.

### Task A1.5: The documents

Amend everything listed at the top of the spec ("Amends" and "Replaces this wording"). Add a `DECISIONS.md` Part 2n entry recording Samuel's 16 October decisions and the pointer to the spec. Commit.

### A1 mutation probes (break it, see the named test go red, restore it)

1. **`readCoatValue` keeps a bare White beside `tabby`.** Expect red: A1.1 "old tabby · white".
2. **It drops White from `black_and_white · tabby`.** Expect red: A1.1 "keeps black and white".
3. **It maps `black_and_white` to `plain`.** Expect red: A1.1 "old black_and_white".
4. **`legacyCoatCodes` always returns `["tabby"]` for Stripes.** Expect red: the 128-combination oracle.
5. **`partsToValue` writes `colours: null`.** Expect red: the A1.1 partsToValue tests.
6. **The write check refuses `reason` or `agreesWith`.** Expect red: A1.2 team accepted cases.
7. **The write check accepts an old shape.** Expect red: A1.2 refused cases.
8. **The resolver skips the standing pre-filter.** Expect red: A1.3 tests 10 and 11.
9. **Machine rows lacking a part are dropped instead of projected empty.** Expect red: A1.3 test 7.
10. **An empty spotter part is treated as a withdrawal.** Expect red: A1.3 test 8.
11. **`maxShown` is set back to 2.** Expect red: A1.3 test 5.
12. **`mixed_sources` only fires for machine against people.** Expect red: A1.3 test 2.
13. **`handPick` reads raw `value.colours`.** Expect red: the hand-pick "translated old answer" test.
14. **`record.ts` writes the untranslated v1 answer.** Expect red: `coatReading.test.ts` T-row.
15. **The v1 prompt changes.** Expect red: "the v1 prompt is unchanged".
16. **A notifier reads `snapshot.coatColours.confidence`.** Expect red: the not-notifiable guard.

**A1 reviews:**
- an Opus spot review of `readCoatValue`, the A1.3 algorithm and the A1.4 diff before the PR opens. Why Opus: the projection's interplay with supersession, "newest machine row only" and "only notSure withdraws" is where a green suite hides a wrong answer, and A1.4 is where the first draft of this plan broke the build;
- then `/ship`.

---

## PR A2 — Public data

**Depends on:** A1 merged.

### Task A2.1: The wire

- **`lib/api-spec/openapi.yaml`:** add `coatColours` and `coatPattern` to the Cat schema, next to `coat` (around lines 1033–1054):

```yaml
        coatColours:
          type: array
          description: The cat's resolved coat colours (coat-colours-and-pattern.md §6), in display order; [] when not known. Only the value.
          items: { type: string, enum: [black, grey, brown, ginger, white] }
        coatPattern:
          type: string
          nullable: true
          enum: [plain, stripes, patches]
          description: The cat's resolved coat pattern (§6), or null when not known. Only the value.
```

  Keep `coat` exactly as it is, with its description changed to: "For older app versions, display only, worked out from coatColours and coatPattern (§6). Never filter on it."
- **Regenerate** with `pnpm --filter @workspace/api-spec run codegen`.
- **`lib/catHelpers.ts`:**
  - `DerivedCatStatus` gains `coatColours: CoatColour[]` and `coatPattern: CoatPattern | null`, from the same two locals as A1.4 item 1;
  - the legacy branch gets `[]` and `null`;
  - `serialiseCat` emits `coat`, then `coatColours`, then `coatPattern`, **in that order, right after `coat`**;
  - R7a's allow-list gains the two `cat.derived.coatColours` and `cat.derived.coatPattern` reads in `serialiseCat`, counted with word boundaries.
- **Tests:**
  - in `routes/cats.appearance.public.test.ts`:
    - `PUBLIC_CAT_KEYS` gains `coatColours` and `coatPattern`;
    - a team `{colours:["brown","ginger"],pattern:"stripes"}` gives `coatColours ["brown","ginger"]`, `coatPattern "stripes"` and `coat ["ginger","tabby"]`;
    - brown alone gives `coat []`;
    - the `NEVER_PUBLIC` list holds;
  - regenerate `routes/__snapshots__/publicPayload.p6.txt` and `cats.publicDetail.p3-2.txt` **on purpose**. The only diff is `,"coatColours":[],"coatPattern":null` right after `"coat":[]`. Record it in the PR, as the p6 header requires.

### Task A2.2: The app shows the new line, and never the old words

Create `artifacts/cat-spotter/lib/coat.ts` and its test.

```ts
import type { Cat } from '@workspace/api-client-react';
export const COLOURS = ['black', 'grey', 'brown', 'ginger', 'white'] as const;
export type Colour = (typeof COLOURS)[number];
export const PATTERNS = ['plain', 'stripes', 'patches'] as const;
export type Pattern = (typeof PATTERNS)[number];
type CoatFields = Pick<Cat, 'coat' | 'coatColours' | 'coatPattern'>;
export type Parts = { colours: Colour[] | null; pattern: Pattern | null };

const hasNewFields = (cat: CoatFields) => cat.coatColours !== undefined || cat.coatPattern !== undefined;

/** The cat's coat for the FILTER: the new fields only; a cat without them is not known. */
export function filterParts(cat: CoatFields): Parts {
  if (!hasNewFields(cat)) return { colours: null, pattern: null };
  const colours = COLOURS.filter((c) => (cat.coatColours ?? []).includes(c));
  return { colours: colours.length ? colours : null, pattern: PATTERNS.find((p) => p === cat.coatPattern) ?? null };
}

/** The cat's coat for DISPLAY: the new fields, or the old `coat` translated by the same table as the server (§6), so no old word is ever shown. */
export function displayParts(cat: CoatFields): Parts {
  if (hasNewFields(cat)) return filterParts(cat);
  const codes = Array.isArray(cat.coat) ? (cat.coat as string[]) : [];
  const colours = new Set<string>();
  let pattern: Pattern | null = null;
  for (const c of codes) {
    if (c === 'tabby') pattern = 'stripes';
    else if (c === 'black_and_white') { colours.add('black'); colours.add('white'); }
    else if (c === 'tortoiseshell_or_calico') { colours.add('black'); colours.add('ginger'); pattern ??= 'patches'; }
    else colours.add(c);
  }
  if (codes.includes('tabby') && codes.includes('white') && !codes.includes('black_and_white')) colours.delete('white');
  const ordered = COLOURS.filter((c) => colours.has(c));
  return { colours: ordered.length ? ordered : null, pattern };
}

/** i18n keys for the coat part of the display line: colours, then the pattern unless plain. */
export function coatLineKeys(cat: CoatFields): string[] {
  const { colours, pattern } = displayParts(cat);
  return [...(colours ?? []).map((c) => `coat_${c}`), ...(pattern && pattern !== 'plain' ? [`pattern_${pattern}`] : [])];
}
```

- **`lib/appearance.ts`:**
  - `appearanceLabelKeys` (line 66) **and** `appearanceLine` (line 74) both use `coatLineKeys` for the coat, then the marks, so the label keys, the accessibility label and the line agree;
  - `COAT_LABEL_KEYS` and the private `inOrder` for coat are removed.
- **`lib/i18n.ts`:** add `coat_brown` and `pattern_plain|stripes|patches` in en, el and fr (the §2 drafts). Remove the old `coat_tabby`, `coat_tortoiseshell_or_calico` and `coat_black_and_white` keys, which nothing shows any more.
- **Tests:**
  - new fields brown and ginger with stripes give `coat_brown`, `coat_ginger`, `pattern_stripes`;
  - plain gives no pattern word;
  - an old cached cat `coat:["ginger","tabby"]` displays `coat_ginger, pattern_stripes`;
  - an old cached cat `["tabby","white"]` displays only `pattern_stripes`;
  - `filterParts` of an old cached cat is null and null;
  - every key exists in all three languages;
  - `CatPicker.test.tsx:122` (the accessibility label) is updated;
  - the catalogue cache-key test is green **unedited**.
- **Browser check:** about 390 px and desktop, in en, el and fr. A cat page shows "Brown · Ginger · Stripes", a cached-old cat shows "Ginger · Stripes", and nothing raw or old is ever shown.

### A2 mutation probes

1. **`serialiseCat` works out the old `coat` from the wrong part.** Expect red: the public test `coat ["ginger","tabby"]`.
2. **`filterParts` falls back to the old `coat`.** Expect red: "filterParts of an old cached cat is null".
3. **`displayParts` shows the old codes raw.** Expect red: "old cached displays coat_ginger, pattern_stripes".
4. **A confidence leaks onto the wire.** Expect red: the `NEVER_PUBLIC` test.

---

## PR B — The team's Correct gains the pattern, and the drawn cat

**Depends on:** A1 merged. **Owner of these files:** this plan (the SYC-2 PR 3.1 session is archived).

- **`routes/teamCorrections.ts`:**
  - `CorrectForm` gains `pattern: z.enum(["plain","stripes","patches","none"]).default("none")`;
  - Correct needs at least one part: colours non-empty, or a pattern other than `none`;
  - it writes `partsToValue`.
- **`lib/teamPages/appearancePage.ts`:**
  - pattern radio buttons, with *Not stated* as the default;
  - after saving, a **static inline-SVG** drawn cat of the saved coat (server-drawn; `layout.ts` has no scripts and must stay that way).
- **Tests (`routes/team.appearance.test.ts`):**
  - Correct with colours only, pattern only, and both;
  - with neither, the form is shown again with an error;
  - **a colours-only Correct leaves an older team pattern standing** (§4: a part not stated falls through);
  - Correct on a guardian's statement retracts that statement, both parts (§4, as before);
  - the page contains no `<script>`;
  - the string parity across the three string files.

### B mutation probes

1. **Correct accepts neither part.** Expect red: "neither".
2. **A colours-only Correct writes `pattern: "none"`.** Expect red: "leaves an older team pattern standing".
3. **A `<script>` is added.** Expect red: "no script".

### After B is live: Samuel's verdicts (SYC-399)

Samuel gets a one-line heads-up first: this writes on production. A team member (or Claude through the team route, if Samuel prefers) records each verdict as §8 translates it, and checks it in the cat's history.

---

## PR C — The reader: coat-v2 and the one checked re-read

**Depends on:** A1 merged. Runs in parallel with B.

### Task C.1: The coat-v2 prompt and answer

- **`lib/coatReading/reader.ts`:**
  - `MODEL_VERSION` becomes `…/coat-v2`;
  - `COLOUR_DESCRIPTIONS: Record<CoatColour,string>` for the five colours, and `PATTERN_DESCRIPTIONS: Record<CoatPattern,string>`;
  - `coatPrompt()` asks for `{catCount, photoClear, colours: string[], pattern: "plain"|"stripes"|"patches"|"cant_tell", confidence}`, with the §7 plain descriptions;
  - `interpretCoatAnswer` returns `CoatParts`: `notSure` for each Not sure case; pattern `null` for `cant_tell`; an old code such as `tabby` gives Not sure;
  - the `LEGACY_COAT_CODES` v1 path is removed.
- **`reader.test.ts`:**
  - the prompt lists exactly the five colours and the three patterns, in order;
  - each Not sure case;
  - all five colours accepted;
  - `cant_tell` gives a null pattern while the colours stand.

### Task C.2: The re-read and its guards (§7)

**`lib/coatReading/due.ts`:**
- the signature becomes `catsDueForReading(limit, q, opts: { catIds?: readonly number[]; reread?: boolean })`;
- `DueCat.because` gains `"older_version"`.

For each cat, in this exact order:
1. `shown` = the display photo (unchanged).
2. `latest` = the newest machine row (unchanged).
3. The existing R2 reasons, computed as today, set `because`.
4. **Only if `opts.reread` and `because` is still unset**, and `latest` is of `shown` and `latest.value.modelVersion !== MODEL_VERSION`:
   - skip if any reading of `shown` was marked wrong;
   - skip if `resolveCoatParts(observations)` has **both** parts at rule 1 (team or guardian);
   - otherwise set `because = "older_version"`.
5. If `because` is unset, `continue`. The existing `latest?.photoId === shown` short-circuit applies **only** to R2 reasons, never to `older_version`.
6. **The action:**
   - for `older_version`, always `action: "read"`;
   - for R2 reasons, `ofPhoto` = machine readings of `shown` **whose `modelVersion === MODEL_VERSION`**. If there are none, the action is `read` under `reread`. Without `reread`, the existing "copy the newest reading of that photo" stands, so automatic runs behave as today.

**`lib/coatReading/record.ts`:**
- `lockAndRecheck` passes the run's `reread` to `catsDueForReading`;
- `recordReading` takes `parts: CoatParts`.

**`lib/coatReading/sweep.ts`:**
- **`reread`** goes to every `catsDueForReading` call, **including the re-check before a photo is sent** (around lines 140–150).
- **The current coat:** for every read, `current` = `readCoatValue` of the cat's newest machine row **that is not marked wrong** (loaded through `loadCatRecords`, as `due.ts` does). `SweepItem` gains `current: CoatParts | null` for the contact sheet.
- **Hold back** (status `held_back`, nothing written) on a re-read if:
  - the new reading is `notSure`; or
  - it leaves unknown a part that `current` knows.

**`routes/internalCoat.ts`:** `Body` gains `reread: z.boolean().default(false)`.

**`.github/workflows/coat-readings.yml`:** a `reread` choice (`false`/`true`, default `false`), passed in the body through `jq`, behind the same host check.

**Tests:**
- an automatic run never lists a cat for an older version;
- **a cat whose shown photo already has a v1 reading is listed with `action: "read"` under `reread`**;
- after the v2 write it isn't listed again;
- a v1 copy-forward under an automatic run isn't due again;
- marked-wrong photos are skipped;
- team-decided cats are skipped;
- a reading that loses a known pattern is `held_back`;
- a whole Not sure is `held_back`;
- `exclude` holds;
- the re-check honours `reread` (with a forced interleave, as in T-race);
- the workflow's `reread` reaches the body;
- a non-boolean `reread` is refused.

### C mutation probes

1. **`reread` is ignored in the re-check.** Expect red: the "listed with action read, then written" test.
2. **An automatic run lists older-version cats.** Expect red: the "never lists" test.
3. **`older_version` goes through the `latest?.photoId === shown` short-circuit.** Expect red: the "listed with action read" test.
4. **`ofPhoto` isn't filtered by version.** Expect red: "after the v2 write" and copy-forward loop tests.
5. **The hold-back guard is removed.** Expect red: "loses a known pattern".
6. **The marked-wrong skip is removed.** Expect red: "marked-wrong skipped".
7. **The team-decided skip is removed.** Expect red: "team-decided skipped".

**C reviews:** an Opus spot review of `due.ts` and `sweep.ts`, then `/ship`.

### After C is live: the checked re-read (Samuel gets a one-line heads-up first)

1. **Dry run** with `reread=true`. Expect about 28 cats, less any team-decided ones.
2. **Trial** with `reread=true`. About 28 calls; nothing is written.
3. **Contact sheet**, built in the browser pane as on 15 October. Each cat's photo, its `current` coat and the new reading, shown as drawn cats; held-back cats are marked. Samuel approves.
4. **Write** with `reread=true` and `exclude`. About 28 calls; the trial and the write together use 56 of the 60-an-hour budget, so a second trial waits an hour.
5. **Compare** the write with the trial, cat by cat, and show Samuel any changes.
6. **Dry run** with `reread=true` again. Expect 0 due, apart from the excluded and held-back cats (they stay listed, by design). Then check the public payload, and that `lastSeen` is unchanged for three cats.

---

## PR D — "Find the cat": the drawn chips and the filter

**Depends on:** A2 merged. Replaces SYC-161 PR 3.

### Task D.1: The placement rule (pure, `lib/coat.ts`)

```ts
export type Placement = 'match' | 'not_known' | 'hidden';
/** Spec §5: hidden if any picked row is a known mismatch; else not_known if any picked row is unknown; else match. Plain and Patches are forgiving for a cat with White. Reads the new fields only. */
export function placeCat(cat: CoatFields, picked: { colours: ReadonlySet<Colour>; patterns: ReadonlySet<Pattern> }): Placement {
  const { colours, pattern } = filterParts(cat);
  const rows: ('match' | 'mismatch' | 'unknown')[] = [];
  if (picked.colours.size) rows.push(colours === null ? 'unknown' : colours.some((c) => picked.colours.has(c)) ? 'match' : 'mismatch');
  if (picked.patterns.size) {
    const forgiving = !!colours?.includes('white') && (pattern === 'plain' || pattern === 'patches');
    const ok = pattern !== null && (picked.patterns.has(pattern) || (forgiving && (picked.patterns.has('plain') || picked.patterns.has('patches'))));
    rows.push(pattern === null ? 'unknown' : ok ? 'match' : 'mismatch');
  }
  if (rows.includes('mismatch')) return 'hidden';
  if (rows.includes('unknown')) return 'not_known';
  return 'match';
}
```

**Tests:**
- every combination of the colour part (match, mismatch, unknown) × the pattern part (match, mismatch, unknown) × which rows are picked;
- the forgiveness rule;
- an old cached cat (no new fields) is `not_known` under any picked row, and `match` under none;
- the counts: matching + not_known + hidden = the search results.

### Task D.2: The drawn components (shared, `components/coat/`)

- `ColourSwatch`, `PatternTile` (plain, stripes, patches, and "?" for Can't tell), `DrawnCat` (`react-native-svg`) and `CoatChips` (the two rows, toggle buttons with `accessibilityState.selected`, and *All* in each row).
- **Tests:**
  - all 32 colour sets × 4 pattern states render, with the right accessibility label;
  - the chips are toggles;
  - every word exists in all three languages.

### Task D.3: The picker

**`components/CatPicker.tsx`:**
- the chips under the search box;
- the matches, then the *Not known* heading and those cats;
- the hidden-count line with "Show all", **directly above** "Can't find it? Add it as a new cat";
- the search-empty line, with "Search all";
- a reset to *All* on open;
- remove the "Not in this slice" comment.

**The match record:**
- add an optional `colourFilterOn: boolean` to `ResolveSightingRequest` (`lib/api-spec/openapi.yaml`, around line 1306) and regenerate;
- `routes/sightings.ts` (where `ResolveSightingBody` is parsed, around line 604) threads it into the `labelChoice` label, so the `sighting_matches` insert (around line 819) writes `colour_filter_on`;
- the app sends `true` when either row had a chip picked.

**Tests:**
- the hidden line sits above the new-cat link (checked through the order of the rendered tree);
- "Show all" resets both rows;
- the search-empty line;
- `colour_filter_on` is true or false as picked (an api-server test on resolve);
- offline, over a saved catalogue, with the network mocked off;
- **the review screen's suggestions are identical whatever the filter**: render the review screen with chips picked and unpicked, and compare the suggestion list;
- the cache key is still v2, with the test unedited.

**Browser check before the PR opens:** about 390 px and desktop, in en, el and fr. Use 40 seeded cats with mixed coats, some not known, and some old-only. Screenshots go in the PR. **Samuel judges the drawings** (5A).

### D mutation probes

1. **An unknown part is treated as `hidden`.** Expect red: the D.1 unknown cases.
2. **The forgiveness rule is removed.** Expect red: the D.1 forgiveness case.
3. **`placeCat` uses `displayParts`, and so the old `coat`.** Expect red: the D.1 old-cache case.
4. **The hidden line moves below the new-cat link.** Expect red: the D.3 order test.
5. **`colourFilterOn` isn't threaded through.** Expect red: the D.3 match-record test.
6. **The review screen filters its suggestions by coat.** Expect red: the D.3 review-screen test.

---

## Every place the rules must hold

| Rule | Must hold at | Held by |
|---|---|---|
| One translation of stored values | resolver, hand pick, Colour check, team history, codesOf, Confirm, copy-forward, wire, the app's display of old caches | `readCoatValue` on the server, its app twin `displayParts` (the same table, tested on the same cases); A1 probes 1–3 and 13; A2 probe 3 |
| Only what was said becomes known | every reader | A1.1 cases |
| New writes in the new shape | team Correct and Confirm, the reader, copy-forward, the future 4.1 answers route | the `case "coat"` check plus `partsToValue`; A1 probes 5–7 and 14 |
| A superseded statement never comes back | resolver | the standing pre-filter; A1 probe 8 |
| Per-part who-wins; only notSure withdraws; newest machine row only | public payload, team pages, Colour check, Confirm | `resolveCoatParts`; A1 probes 9–12 |
| Never hidden for unknown | the picker, the future cat-alog filter (SYC-2 4.3) | `placeCat` (shared); D probes 1 and 3 |
| The old field is display-only | the app | `filterParts`; A2 probe 2; D probe 3 |
| Never notifiable; never evidence of life; never in the matcher | snapshot, notifiers, matcher | `SYC2_FIELDS` and the widened regexes; A1 probe 16; the existing guards |
| The public sees values only | `GET /cats`, `GET /cats/:id`, the name-taken body | `serialiseCat`; `NEVER_PUBLIC`; snapshots |
| Re-read guards | sweep, re-checks, route, workflow | C tests; C probes 1–7 |
| The cache key stays v2 | `catalogue.ts` | the existing test, unedited |
| The v1 reader's prompt is unchanged until C | the live reader | A1 probe 15 |

---

## Coordination

- **SYC-2:**
  - PR B and A1.4 rework PR 3.1's (#191) files. Its session is archived, so this plan owns them.
  - SYC-2 PRs 4.1–4.3 follow the contract in the SYC-2 comment of 16 Oct.
  - **Guardian pages** (`guardianCatView.ts`) keep the old `coat` field until the guardian work is next touched. A ticket is filed on approval: "guardian pages show the new coat words".
- **SYC-161:**
  - PR 3 is replaced by D;
  - PR 2 (automatic reading) uses `reread: false`, the default;
  - SYC-397 closes when C's trial is approved.
- **Johnny (SYC-346):** the words are on the ticket for the 22 Oct pack. Anything added later goes in the second pack.
- **The launch plan (#172):**
  - A1 aims for Wed 21 Oct, A2 for Fri 23 Oct;
  - B and C for Mon 26 Oct;
  - D for Wed 28 Oct.
  - Nothing is on the must-launch list (6A).
- **Before each merge:** list the live sessions and open PRs and agree the order (`/ship`). No migrations here.

---

## Model delegation

This session is on Opus 5.5. The spec and this plan were written here.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| A1.1–A1.2 (vocabulary, translation, write check) | Sonnet | Clear spec; code given above | The tests above, including the 128-case oracle; A1 probes 1–7 |
| A1.3 (per-part resolver: standing pre-filter, projection) | **Opus** | Supersession, "newest machine row only" and "only notSure withdraws" interact subtly; a green suite can hide a wrong answer | A1.3 tests 1–15 including parity and supersession; A1 probes 8–12; Opus spot review |
| A1.4 (every other reader and writer) | Sonnet build, **Opus** review of the diff | Wide, and it is where the first draft of this plan broke the build | Full suite, typecheck, the team page rendered in the web preview; A1 probes 13–16; Opus diff review |
| A1.5 (documents) | Sonnet | Text edits from the spec | The session reads the diff against the spec's "Amends" list |
| A2 (wire, codegen, app display) | Sonnet | Standard | Tests; snapshot diff limited to the two keys; A2 probes; browser check at 390 px and desktop in 3 languages |
| B (pattern on the team form, the drawn cat) | Sonnet | Standard server HTML | Tests; B probes; `/ship` adversarial review |
| C (coat-v2, re-read guards) | Sonnet build, **Opus** spot review of `due.ts` and `sweep.ts` | Silent-failure guards on the same ground as SYC-161 PR 1, where the spot review found a real hole | C tests; C probes 1–7; Opus spot review; the production dry run showing "0 due" |
| D (drawn components, picker, match record) | Sonnet | Standard UI and a pure function | D tests and probes; browser check; Samuel judges the drawings |
| i18n key plumbing (en, el, fr; parity) | Haiku | Mechanical, words given in §2 and on SYC-346 | The i18n and team-string parity tests; the session spot-reviews the diff |
| Adversarial review of this plan, and of each PR in `/ship` | Sonnet, own worktree | Checking claims against files | Every finding checked against the file it names; the reviewer pastes the runner's "Tests N passed" line |
| The contact sheet and go/no-go | Opus (session) | Judging photos against colours | Samuel approves |

Every build prompt restates: **commit after each item**, keep `CHECKPOINT.md` untracked, and use your own worktree off fresh `origin/main`. No nested background agents.

---

## Rollout and checks after each publish

Samuel pulls main in Replit; whoever owns publishing that round publishes; Claude waits until `/api/healthz` shows the commit.

- **A1:** `coat` on `GET /api/cats`, compared **as sets** before and after for every live cat. It must be identical, except #10 and #19 (`{tabby, white}` → `{tabby}`, spec §6). The team Appearance page renders the new words for three cats.
- **A2:** `coatColours` and `coatPattern` are present; `coat` matches `legacyCoatCodes` for every cat; a cat page shows the new line at 390 px.
- **B:** Correct shows the pattern buttons; Samuel's verdicts are applied (SYC-399), with a heads-up first.
- **C:** the checked re-read, steps 1–6.
- **D:** the picker on the live site at 390 px and desktop: the chips, *Not known*, and the hidden line above "Add it as a new cat".

## Rollback

Each PR reverts on its own, except that **A1 reverts last**, because new-shape statements are read correctly only by A1's code. Nothing is ever deleted. The old `coat` field keeps older phones working throughout.

---

## Review outcome

An independent adversarial review (Sonnet, its own worktree) of the first draft, `beabc5d3`, ran `readCoatValue` and `legacyCoatCodes` (both correct: 0 mismatches over 128 combinations) and read the rest. It found 2 blockers, 6 majors and the rest minor. All were accepted.

| # | Finding | What changed |
|---|---|---|
| 1 (blocker) | The new write check's key allow-list would refuse every team Correct and Confirm (`reason`, `agreesWith`) | No allow-list; tests with `reason` and `agreesWith`; probe A1-6 |
| 2 (blocker) | A1 wouldn't typecheck: the reader, sweep, team route and page, team strings, guardian view, `appearanceOf` | A1.4 now lists every one. The v1 reader keeps the old codes, with its prompt unchanged byte for byte (probe A1-15) |
| 3 | The not-notifiable guard went quiet for `coatColours` and `coatPattern` | Widened regexes, word-bounded counts, one read each, probe A1-16 |
| 4 | The re-read in `due.ts` would skip or loop | The exact branch order; `action: "read"`; version-filtered copies; probes C-3 and C-4 |
| 5 | The projection could bring back superseded rows | The standing pre-filter runs first; A1.3 tests 10 and 11; probe A1-8 |
| 6 | `record.ts` would write nulls | `partsToValue`; the copy-forward guard changed; probe A1-5 |
| 7 | `mixed_sources` was narrower than the spec | Defined by rule number; A1.3 test 2; probe A1-12 |
| 8–16 | The rollout check, the truth-table test strength, `black_and_white · tabby`, the docs task, A2 and C and B and D details, the import cycle | All fixed in place (A1.1 oracle, A1.5, A2.2 `displayParts`, C.2 `current`, B tests, D threading and review-screen test, the resolver kept in `resolve.ts`) |
