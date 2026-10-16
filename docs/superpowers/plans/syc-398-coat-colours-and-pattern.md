# SYC-398: a cat's coat as colours you can see plus one pattern — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the eight-value coat list with "any of five colours plus one pattern", end to end:
- how statements are written and read;
- who wins;
- the public wire;
- the team's pages;
- the AI reader and its one checked re-read;
- the "Find the cat" filter.
No existing record is rewritten.

**Architecture:**
- One pure module (`appearance.ts`) owns the vocabulary, the **translation of every stored statement into parts**, and the old-field truth table. Every reader goes through it.
- The resolver projects each statement onto its colour part and its pattern part, and runs SYC-2's existing rules on each.
- The wire adds `coatColours` and `coatPattern` beside the old `coat`, which stays for display on older phones.

**Tech stack:**
- Node/Express API with drizzle and Postgres, in `artifacts/api-server`;
- OpenAPI with orval codegen, in `lib/api-spec`, `lib/api-zod` and `lib/api-client-react`;
- the Expo React Native app, in `artifacts/cat-spotter`;
- vitest in both;
- `react-native-svg`, which is already installed.

**Spec:** `docs/specs/coat-colours-and-pattern.md` (approved by Samuel, 16 Oct 2026, with 2A, 3A, 4A, 5A and 6A). Read it in full first. Section numbers below (§n) refer to it.

## Global Constraints

- **Colours:** `black`, `grey`, `brown`, `ginger`, `white`, in that display order, with no limit on how many a coat has. **Patterns:** `plain`, `stripes`, `patches`.
- **No database migration.** Values live in the existing `observations.value` jsonb.
- **Never rewrite a stored statement.** Old shapes are read through `readCoatValue` (Task A1.1).
- **New writes use the new shape only.** Old-shape writes are refused after PR A1.
- **The old public `coat` field is display-only.** It is never used to filter.
- **`CATS_CACHE_KEY` stays `cat-spotter/cats-cache/public/v2`.** Its existing test must stay green unedited.
- **Colour and pattern are never evidence of life, never notifiable, and never read by the matcher** (SYC2-D8).
- **The public sees only the resolved parts.** It never sees confidence, author, model version or dates.
- **Words:**
  - "cat guardian", never "colony carer";
  - "spotter", never "snapper";
  - the public never sees *tabby*, *tortoiseshell* or *calico* (§2);
  - display lines are joined with " · " (Decision E1).
- **Model:** mock it in every test. No real calls, and no production writes from tests.
- **Every PR:**
  - is built in its own worktree off fresh `origin/main`;
  - has a `CHECKPOINT.md` (untracked);
  - **commits after each item**;
  - has the mutation probes listed for it, run and recorded in the PR;
  - is reviewed through `/ship`, with an adversarial reviewer in its own worktree.
- **Never blocks the 31 Oct launch** (Decision 6A). Every PR leaves `main` shippable on its own.

---

## In plain English (for Samuel)

Five PRs, in this order. The first two are the foundation. The next two can run side by side. The last is the screen spotters see.

| PR | What it does | What people notice |
|---|---|---|
| **A1** Server foundation | Teaches the server the new words, how to read every old statement in the new terms, and who wins for colours and pattern separately | Nothing yet |
| **A2** Public data | Cat pages and cards get the new coat line ("Brown · Ginger · Stripes"); older phones keep working | The new coat line on cat pages |
| **B** Team pages | The team's Correct becomes a form (colour checkboxes and pattern buttons), Confirm keeps only what's known, and the Colour check list gains its new reasons | The team can set Samuel's verdicts |
| **C** The AI reader | The new prompt (coat-v2) and the one-off checked re-read, started by hand | Nothing until the re-read is approved |
| **D** "Find the cat" chips | Drawn colour and pattern chips, the drawn cat, the two filter rows | Spotters can filter by colour and pattern |

After each publish there is a short check (§ "Rollout"). Samuel's only steps:
- the usual pull in Replit;
- one contact sheet after PR C (about 5 minutes);
- the browser check of the drawings in PR D.

**Not in this plan:** the spotter's colour question after naming a cat, and the "add details later" card. They belong to SYC-2's PRs 4.1–4.3, which aren't built yet. Those PRs build straight on this vocabulary and reuse PR D's drawn components (see "Coordination").

---

## File structure

**API server** (`artifacts/api-server/src`):
- `lib/appearance.ts`: the vocabulary; `readCoatValue` (the one translation, §6); `legacyCoatCodes` (the old-field truth table, §6); `orderColours`. **Pure; no database import.**
- `lib/observations.ts`: the `case "coat"` validation (the new shape only); `STATEMENT_KEYS` gains `pattern` and `notSure`.
- `lib/coatResolve.ts` (new): `resolveCoatParts` and the per-part projection. This keeps `resolve.ts` (1,433 lines) from growing. `resolve.ts` re-exports it and uses it in `resolveCat`.
- `lib/resolve.ts`: `CatSnapshot` gets `coatColours` and `coatPattern` in place of `coat`; `resolveCoat` is removed after its callers move.
- `lib/catHelpers.ts`: the derived and wire fields.
- `lib/handPick.ts`, `lib/colourCheck.ts`, `lib/teamCatView.ts`, `lib/teamCorrections.ts`, `lib/teamPages/appearancePage.ts`, `lib/teamPages/strings/{en,el,fr}.ts`, `routes/teamCorrections.ts`.
- `lib/coatReading/{reader,due,record,sweep}.ts`, `routes/internalCoat.ts`.

**Shared:** `lib/api-spec/openapi.yaml`, regenerated into `lib/api-zod` and `lib/api-client-react`.

**App** (`artifacts/cat-spotter`):
- `lib/coat.ts` (new): pure. The display line; reading the wire with the old-field fallback, for display only; `placeCat` (the filter's three-way placement, §5).
- `components/coat/` (new): `ColourSwatch.tsx`, `PatternTile.tsx`, `DrawnCat.tsx` and `CoatChips.tsx`, all shared. SYC-2 4.x reuses them.
- `components/CatPicker.tsx`, `lib/appearance.ts`, `lib/i18n.ts`.

**Workflow:** `.github/workflows/coat-readings.yml`.

---

## PR A1 — Server foundation: vocabulary, translation, validation, who wins

**Depends on:** nothing. **Safe alone:** yes. The wire is unchanged (`coat` is still worked out, now from the new parts), and the reader keeps working because its writes are translated.

### Task A1.1: The vocabulary and the one translation

**Files:**
- Modify: `artifacts/api-server/src/lib/appearance.ts` (currently 65 lines)
- Test: `artifacts/api-server/src/lib/appearance.coat.test.ts` (new)

**Interfaces:**
- Produces: `COAT_COLOURS`, `CoatColour`, `COAT_PATTERNS`, `CoatPattern`, `LEGACY_COAT_CODES`, `LegacyCoatCode`, `CoatParts`, `readCoatValue`, `orderColours`, `legacyCoatCodes`, `LEGACY_PUBLIC_CODES`, `LegacyPublicCode`.
- `normaliseColours` is removed in Task A1.4, once nothing imports it.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { legacyCoatCodes, readCoatValue } from "./appearance";

describe("readCoatValue: the one translation (spec §6)", () => {
  const cases: [string, unknown, ReturnType<typeof readCoatValue>][] = [
    ["new shape, both parts", { colours: ["brown", "ginger"], pattern: "stripes" }, { colours: ["brown", "ginger"], pattern: "stripes", notSure: false }],
    ["new shape, colours only", { colours: ["ginger"] }, { colours: ["ginger"], pattern: null, notSure: false }],
    ["new shape, pattern only", { pattern: "stripes" }, { colours: null, pattern: "stripes", notSure: false }],
    ["notSure", { notSure: true }, { colours: null, pattern: null, notSure: true }],
    ["old ginger · tabby", { colours: ["ginger", "tabby"] }, { colours: ["ginger"], pattern: "stripes", notSure: false }],
    ["old tabby alone", { colours: ["tabby"] }, { colours: null, pattern: "stripes", notSure: false }],
    ["old tabby · white: white never becomes known", { colours: ["tabby", "white"] }, { colours: null, pattern: "stripes", notSure: false }],
    ["old black_and_white", { colours: ["black_and_white"] }, { colours: ["black", "white"], pattern: null, notSure: false }],
    ["old tortoiseshell_or_calico", { colours: ["tortoiseshell_or_calico"] }, { colours: ["black", "ginger"], pattern: "patches", notSure: false }],
    ["old grey", { colours: ["grey"] }, { colours: ["grey"], pattern: null, notSure: false }],
    ["old not_sure", { colours: ["not_sure"] }, { colours: null, pattern: null, notSure: true }],
    ["machine v1 with modelVersion", { colours: ["ginger", "tabby"], modelVersion: "gpt-5.6-terra/coat-v1" }, { colours: ["ginger"], pattern: "stripes", notSure: false }],
    ["retraction is not a coat", { retracted: true }, null],
    ["unknown code", { colours: ["purple"] }, null],
    ["no parts", {}, null],
  ];
  for (const [label, value, expected] of cases) it(label, () => expect(readCoatValue(value)).toEqual(expected));

  it("orders colours black, grey, brown, ginger, white whatever the stored order", () => {
    expect(readCoatValue({ colours: ["white", "brown", "black"], pattern: "patches" })?.colours).toEqual(["black", "brown", "white"]);
  });
});

describe("legacyCoatCodes: the old field for older phones (spec §6 truth table)", () => {
  const C = ["black", "grey", "brown", "ginger", "white"] as const;
  const P = ["plain", "stripes", "patches", null] as const;
  it("every combination gives at most two old codes, and never an invented one", () => {
    for (let mask = 0; mask < 32; mask++) {
      const colours = C.filter((_, i) => mask & (1 << i));
      for (const pattern of P) {
        const out = legacyCoatCodes(colours, pattern);
        expect(out.length).toBeLessThanOrEqual(2);
        for (const code of out) expect(["black", "white", "ginger", "grey", "tabby", "tortoiseshell_or_calico", "black_and_white"]).toContain(code);
      }
    }
  });
  it.each([
    [["black", "white"], "plain", ["black_and_white"]],
    [["black", "white"], "patches", ["black_and_white"]],
    [["black", "white"], null, ["black_and_white"]],
    [["black", "ginger", "white"], "patches", ["tortoiseshell_or_calico"]],
    [["brown"], "stripes", ["tabby"]],
    [["brown", "ginger"], "stripes", ["ginger", "tabby"]],
    [["brown", "white"], "stripes", ["tabby", "white"]],
    [["grey"], "stripes", ["grey", "tabby"]],
    [["brown"], "plain", []],
    [["brown"], null, []],
    [[], "stripes", ["tabby"]],
    [[], null, []],
    [["ginger", "white"], "plain", ["white", "ginger"]],
  ] as const)("%j + %s → %j", (colours, pattern, expected) => {
    expect(legacyCoatCodes(colours, pattern)).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** From `artifacts/api-server`, with the darwin esbuild workaround (memory "Local vitest/esbuild workaround"), run `pnpm exec vitest run src/lib/appearance.coat.test.ts`. Expected: FAIL, because `readCoatValue` is not exported.

- [ ] **Step 3: Implement it in `appearance.ts`.** Keep `MARKS` as it is.

```ts
/** The five coat colours, in display order (spec §2). Cream is ginger. */
export const COAT_COLOURS = ["black", "grey", "brown", "ginger", "white"] as const;
export type CoatColour = (typeof COAT_COLOURS)[number];
/** The three coat patterns (spec §2). */
export const COAT_PATTERNS = ["plain", "stripes", "patches"] as const;
export type CoatPattern = (typeof COAT_PATTERNS)[number];

/** Codes stored before SYC-398. Read only, never written again. */
export const LEGACY_COAT_CODES = [
  "black", "white", "ginger", "grey", "tabby", "tortoiseshell_or_calico", "black_and_white", "not_sure",
] as const;
export type LegacyCoatCode = (typeof LEGACY_COAT_CODES)[number];
/** The old public `coat` codes an older phone knows (never `not_sure`). */
export const LEGACY_PUBLIC_CODES = LEGACY_COAT_CODES.filter((c) => c !== "not_sure");
export type LegacyPublicCode = Exclude<LegacyCoatCode, "not_sure">;

/** A coat statement read as parts. `null` part = not stated. */
export interface CoatParts {
  colours: CoatColour[] | null;
  pattern: CoatPattern | null;
  notSure: boolean;
}

const COLOUR_SET: ReadonlySet<string> = new Set(COAT_COLOURS);
const PATTERN_SET: ReadonlySet<string> = new Set(COAT_PATTERNS);
const LEGACY_ONLY: ReadonlySet<string> = new Set(["tabby", "tortoiseshell_or_calico", "black_and_white", "not_sure"]);

export function orderColours(colours: Iterable<string>): CoatColour[] {
  const present = new Set(colours);
  return COAT_COLOURS.filter((c) => present.has(c));
}

/**
 * The one translation (spec §6): any stored `coat` value, old or new shape,
 * as parts. Only what the statement said becomes known. `null` for a
 * retraction or a malformed value. Every reader goes through this.
 */
export function readCoatValue(value: unknown): CoatParts | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v["retracted"] === true) return null;
  if (v["notSure"] === true) return { colours: null, pattern: null, notSure: true };
  const rawColours = v["colours"];
  const rawPattern = v["pattern"];
  if (rawColours !== undefined && !Array.isArray(rawColours)) return null;
  if (rawPattern !== undefined && !(typeof rawPattern === "string" && PATTERN_SET.has(rawPattern))) return null;
  const codes = (rawColours as unknown[] | undefined) ?? [];
  if (!codes.every((c) => typeof c === "string" && (COLOUR_SET.has(c) || LEGACY_ONLY.has(c)))) return null;
  if (codes.length === 0 && rawPattern === undefined) return null;
  if (codes.includes("not_sure")) return codes.length === 1 ? { colours: null, pattern: null, notSure: true } : null;

  let pattern: CoatPattern | null = (rawPattern as CoatPattern | undefined) ?? null;
  const colours = new Set<string>();
  const tabby = codes.includes("tabby");
  for (const c of codes) {
    if (c === "tabby") continue;
    if (c === "black_and_white") { colours.add("black"); colours.add("white"); continue; }
    if (c === "tortoiseshell_or_calico") { colours.add("black"); colours.add("ginger"); pattern ??= "patches"; continue; }
    colours.add(c);
  }
  if (tabby) {
    pattern ??= "stripes";
    colours.delete("white"); // an old Tabby never makes White a known colour (§6)
  }
  const ordered = orderColours(colours);
  return { colours: ordered.length ? ordered : null, pattern, notSure: false };
}

/** The old public `coat` for older phones (spec §6 truth table). Display only. */
export function legacyCoatCodes(colours: readonly CoatColour[], pattern: CoatPattern | null): LegacyPublicCode[] {
  const has = (c: CoatColour) => colours.includes(c);
  const others = colours.filter((c) => c !== "black" && c !== "white");
  if (has("black") && has("white") && others.length === 0 && pattern !== "stripes") return ["black_and_white"];
  if (pattern === "patches" && has("black") && has("ginger")) return ["tortoiseshell_or_calico"];
  if (pattern === "stripes") {
    const first = (["ginger", "grey", "black", "white"] as const).find(has);
    return first ? (first === "white" ? ["tabby", "white"] : [first, "tabby"]) : ["tabby"];
  }
  return (["black", "white", "ginger", "grey"] as const).filter(has).slice(0, 2);
}
```

The order of the stripes case matches the test table: a white-and-stripes coat is sent as `["tabby","white"]`, the order today's app already renders as "Tabby · White".

- [ ] **Step 4: Run the tests and watch them pass.** Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/appearance.ts artifacts/api-server/src/lib/appearance.coat.test.ts
git commit -m "SYC-398 A1: the coat vocabulary and the one translation of stored statements"
```

### Task A1.2: The check on write (new shape only)

**Files:**
- Modify: `artifacts/api-server/src/lib/observations.ts`: the `case "coat"` block (currently lines 343–415); `STATEMENT_KEYS` (line 176); the `COAT_COLOUR_SET` import (line 152)
- Test: `artifacts/api-server/src/lib/observations.coat.test.ts` (new). Update the coat cases in `observations.test.ts`: the "1 or 2", "three" and `not_sure` cases move here in their new form.

**Interfaces:**
- Consumes: `COAT_COLOURS` and `COAT_PATTERNS` from Task A1.1.
- Produces: valid values are `{colours?, pattern?, modelVersion?}`, `{notSure: true}` or a retraction. Refusal code `MALFORMED_VALUE`, as now.

- [ ] **Step 1: Write the failing tests.** Each goes through `writeObservation(db, …)` on a throwaway cat, as `observations.test.ts` already does:
  - **accepted:** a spotter `{colours:["brown","ginger"],pattern:"stripes"}`; a spotter `{colours:["black","grey","brown","ginger","white"]}` (all five); a spotter `{notSure:true}`; a team `{pattern:"plain"}`; a team `{colours:["ginger"]}`; a machine `{colours:["grey"],modelVersion:"x/coat-v2"}`; a machine `{pattern:"stripes",modelVersion:"x"}`; a machine `{notSure:true,modelVersion:"x"}`.
  - **refused (`MALFORMED_VALUE`):** an old shape `{colours:["tabby"]}`, `{colours:["black_and_white"]}` and `{colours:["not_sure"]}`; an unknown colour; a duplicate colour; an unknown pattern; `{}`; a spotter `{pattern:"stripes"}` with no colours; a team `{notSure:true}`; a team `{}`; `notSure` alongside any part; `modelVersion` on a non-machine row; a machine row without `modelVersion`.
  - **A retraction carrying `pattern` or `notSure` is refused**: `STATEMENT_KEYS` covers the new keys.

- [ ] **Step 2: Run and watch them fail.** Run `pnpm exec vitest run src/lib/observations.coat.test.ts`. Expected: several FAIL.

- [ ] **Step 3: Implement.** Replace the body of `case "coat"`:

```ts
case "coat": {
  if (isRetraction(value)) return;
  if (!isPlainObject(value)) refuse("MALFORMED_VALUE", "coat needs { colours?, pattern? } or { notSure: true }");
  const keys = Object.keys(value);
  const allowed = new Set(["colours", "pattern", "notSure", "modelVersion"]);
  if (!keys.every((k) => allowed.has(k))) refuse("MALFORMED_VALUE", "coat has an unknown key");
  const machine = ctx.provenance === "machine";
  if (value["notSure"] === true) {
    if (keys.some((k) => k === "colours" || k === "pattern")) refuse("MALFORMED_VALUE", "notSure is never combined with a colour or pattern");
    if (statesAppearanceWithAuthority(ctx.roleAtTime)) refuse("MALFORMED_VALUE", 'the team and cat guardians never state "not sure"; use Mark wrong');
  } else {
    const colours = value["colours"];
    const pattern = value["pattern"];
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
  if (machine) {
    if (typeof modelVersion !== "string" || modelVersion.length === 0) refuse("MALFORMED_VALUE", "a machine coat needs a non-empty modelVersion");
  } else if (modelVersion !== undefined) {
    refuse("MALFORMED_VALUE", "modelVersion is only allowed on a machine-provenance coat");
  }
  return;
}
```

Also:
- `const COAT_PATTERN_SET = new Set(COAT_PATTERNS)` sits beside `COAT_COLOUR_SET`;
- `STATEMENT_KEYS` becomes `["colours", "pattern", "notSure", "marks", "cantTell", "modelVersion"]`.

- [ ] **Step 4: Run.** Run the new file and `src/lib/observations.test.ts` (with its coat cases updated). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/observations.ts artifacts/api-server/src/lib/observations.coat.test.ts artifacts/api-server/src/lib/observations.test.ts
git commit -m "SYC-398 A1: the coat write check accepts only colours-plus-pattern"
```

### Task A1.3: Who wins, per part

**Files:**
- Create: `artifacts/api-server/src/lib/coatResolve.ts`
- Modify: `artifacts/api-server/src/lib/resolve.ts`:
  - make the generic core of `resolveCoat` (lines 1045–1235) `resolveCodeSet(statements, opts)`, parameterised on the code list and `maxShown`;
  - `AppearanceCheckReason` (line 999) gains `pattern_tied_camps` and `mixed_sources`;
  - `CatSnapshot.coat` (line 122) becomes `coatColours: AppearanceResolved<CoatColour[]>` and `coatPattern: AppearanceResolved<CoatPattern | null>`;
  - `resolveCat` (line 1429) changes to match.
- Test: `artifacts/api-server/src/lib/coatResolve.test.ts` (new). Move the coat cases of `resolve.appearance.test.ts` there, in their new form.

**Interfaces:**
- Consumes: `readCoatValue` and `CoatParts`.
- Produces:
  - `resolveCoatParts(observations, ranking = appearanceAuthorityLevel): { colours: AppearanceResolved<CoatColour[]>; pattern: AppearanceResolved<CoatPattern | null> }`;
  - `CatSnapshot.coatColours` and `CatSnapshot.coatPattern`;
  - the new reasons `pattern_tied_camps` and `mixed_sources`.

**The projection** (this is the subtle part; it implements §4 exactly). For each part, build a list of pseudo-observations, each a shallow copy of a `coat` row with its `value` replaced by `{ colours: string[] }`, so the existing rule engine runs unchanged:
- **A retraction** (`{retracted:true}`) is kept as it is in both projections, so Mark wrong still retracts both parts.
- **A `notSure` row** projects to `{colours:["not_sure"]}` in both parts. It is the only withdrawal.
- **A machine row** (`provenance === "machine"`) is **always kept** in both projections. A part it doesn't state projects to `{colours: []}`, an empty machine reading. That makes "the newest machine row only; an absent part is not known" hold, because the existing code treats an empty machine reading as "no machine reading" and never falls back to an older one.
- **A non-machine row that doesn't state the part is dropped** from that part's projection. It is neither a statement nor a withdrawal there, so it falls through to the next rule.
- **Otherwise** colours project to `{colours: parts.colours}`, and pattern projects to `{colours: [parts.pattern]}`.

Run the core with `maxShown: Infinity` for colours and `maxShown: 1` for pattern. For pattern, a camps result with more than one camp sets the reason `pattern_tied_camps` instead of `tied_camps`.

**Mixed sources.** When both parts are known, and the `confidence` of one is `confirmed` or `likely` while the other is `reported` from a machine row (or the reverse), add `mixed_sources` to both parts' `checkReasons`.

- [ ] **Step 1: Write the failing tests** (`coatResolve.test.ts`, pure, using the `obs()` helper style of `appearance.notNotifiable.test.ts`):
  1. A team `{colours:["ginger"]}` with a machine `{colours:["brown"],pattern:"stripes"}`: colours ginger (confirmed); pattern stripes (reported, from the machine); `mixed_sources` on both.
  2. A team `{pattern:"plain"}` only: pattern plain (confirmed); colours fall through to the machine.
  3. Two independent spotters `{colours:["brown","ginger"],pattern:"stripes"}`: colours brown and ginger, pattern stripes, both likely.
  4. All five colours from two voices: all five shown (no cap).
  5. Pattern camps: two voices for stripes and two for patches, never together: the newer is shown; `pattern_tied_camps`.
  6. Machine v1 `{colours:["ginger","tabby"]}` dated earlier, then machine v2 `{colours:["ginger"]}` dated later: pattern **not known** (the newest machine row has no pattern; the older never fills it). This is the probe for "an older reading never comes back".
  7. A spotter's `{pattern:"stripes"}` translated from an old `["tabby"]` row does **not** withdraw that device's earlier colours (only `notSure` withdraws).
  8. A spotter's `notSure` withdraws its own earlier answer in both parts.
  9. A mixed history from one device (an old `{colours:["ginger","tabby"]}`, then a new `{colours:["ginger"],pattern:"stripes"}`): one voice.
  10. A later machine reading never beats a team statement, in either part.
  11. Mark wrong on a two-part team statement: both parts fall to the next rule.
  12. **Parity:** for every old-shape fixture in the existing `resolve.appearance.test.ts` coat cases, the colours resolve to the translation of what the old engine resolved, so nothing that resolved before resolves differently now, apart from the cap of two.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement.** Extract the body of `resolveCoat` into `resolveCodeSet<C extends string>(observations, codes: readonly C[], maxShown: number, ranking)`:
  - replace `COAT_COLOURS` with `codes`;
  - replace `normaliseColours` with identity, because Black + White is two colours now;
  - replace `.slice(0, 2)` with `.slice(0, maxShown)`.

  The private `coatColours(value)` becomes "read `value.colours`, drop `not_sure`, keep only `codes`". Write `coatResolve.ts` with the projection and `resolveCoatParts`. In `resolveCat`, set `coatColours: parts.colours` and `coatPattern` from `parts.pattern`, mapped as `value: v?.[0] ?? null`.

- [ ] **Step 4: Run** `src/lib/coatResolve.test.ts src/lib/resolve.appearance.test.ts src/lib/resolve.test.ts src/lib/resolve.authority.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/coatResolve.ts artifacts/api-server/src/lib/coatResolve.test.ts artifacts/api-server/src/lib/resolve.ts artifacts/api-server/src/lib/resolve.appearance.test.ts
git commit -m "SYC-398 A1: who wins, for colours and pattern separately"
```

### Task A1.4: Every reader of the snapshot and of stored coat values

**Files:**
- Modify:
  - `lib/catHelpers.ts`: `DerivedCatStatus.coat` (line 76) stays as the old public codes, now worked out via `legacyCoatCodes`, from `snapshot.coatColours` and `snapshot.coatPattern` in `deriveCatStatuses` (line 349; the legacy branch at line 330 stays `[]`). The wire shape is unchanged in A1.
  - `lib/handPick.ts`: read the spotter's answer through `readCoatValue`. Flag when it shares no colour with the resolved colours, **or** when both patterns are known and differ.
  - `lib/colourCheck.ts`: `ColourCheckCat.coat` becomes `coatColours` plus `coatPattern`; `REASON_ORDER` gains `pattern_tied_camps` and `mixed_sources` after `tied_camps`.
  - `lib/teamCatView.ts`: `codesOf` (line 858) and the history line (lines 214–220) read through `readCoatValue`; the `COAT` map gets the new words.
  - `lib/teamCorrections.ts`: `resolvedAppearance` (line 472) and `confirmAppearance` (lines 516–563) use `resolveCoatParts`. **The Confirm rules for parts are Task B.1.** Here, Confirm writes `{colours}` when only colours are known, `{pattern}` when only pattern, both when both are, and refuses as "nothing" when neither is.
  - `lib/coatReading/record.ts`: `recordReading` and `copyReadingForward` write the **translated** shape: `{...readCoatValue(v1Answer) parts, modelVersion}`. A coat-v1 answer `["ginger","tabby"]` is written as `{colours:["ginger"],pattern:"stripes",modelVersion:"…/coat-v1"}`. `copyReadingForward` translates its source the same way.
  - `lib/appearance.notNotifiable.test.ts`: `SYC2_FIELDS` becomes `["coatColours","coatPattern","markings","vaccinations"]`, and the R7a allow-list reads `snapshot.coatColours.value` and `snapshot.coatPattern.value` inside `deriveCatStatuses`.
  - Remove `normaliseColours` from `appearance.ts` and its re-export from `observations.ts`.
- Test: update every coat-touching test listed in the survey:
  - `catHelpers.derivedStatus.test.ts`;
  - `routes/team.appearance.test.ts` (the Confirm and Correct value shapes);
  - `lib/teamPages/catPages.history.test.ts`;
  - `lib/coatReading/coatReading.test.ts` (rows are now written in the new shape);
  - `routes/cats.appearance.public.test.ts`: `CatCoatItem` still equals the seven old public codes in A1;
  - `routes/internalCoat.test.ts`.

  Add to `handPick`'s tests: a translated old answer; a shared colour (no flag); a pattern mismatch (flag).

- [ ] **Step 1: Make the test updates and the new hand-pick tests.** Run them and watch them fail.
- [ ] **Step 2: Implement the reader changes above.**
- [ ] **Step 3: Run the whole api-server suite and the typecheck.** From the repo root, `pnpm run typecheck`, then the full vitest run. Expected: green, except the known flake SYC-334 (re-run that file alone to confirm).
- [ ] **Step 4: Commit**, one commit per file group as you go (after each item):

```bash
git commit -m "SYC-398 A1: every coat reader goes through the translation"
```

### A1 mutation probes (break it, see the named test go red, restore it)

1. **`readCoatValue` keeps White on an old `tabby`.** Expect red: Task A1.1 "old tabby · white".
2. **`readCoatValue` maps `black_and_white` to `plain`.** Expect red: Task A1.1 "old black_and_white".
3. **The projection drops machine rows that lack the part, instead of projecting them empty.** Expect red: A1.3 test 6.
4. **The projection treats an empty spotter part as a withdrawal.** Expect red: A1.3 test 7.
5. **`maxShown` is set back to 2.** Expect red: A1.3 test 4.
6. **The write check accepts an old-shape value.** Expect red: A1.2 "refused old shape".
7. **`mixed_sources` is never set.** Expect red: A1.3 test 1.
8. **`handPick` compares raw `value.colours`.** Expect red: the hand-pick "translated old answer" test.
9. **`record.ts` writes the untranslated v1 answer.** Expect red: `coatReading.test.ts` T-row, which now asserts the new shape.

**A1 review:** Opus spot review of `coatResolve.ts` and `readCoatValue` before the PR opens. Why Opus: the projection's interplay with "newest machine row only" and "only notSure withdraws" is where a green suite hides a wrong answer, as on SYC-161.

---

## PR A2 — Public data: the new fields, older phones safe, cat pages show the new line

**Depends on:** A1 merged.

### Task A2.1: The wire

**Files:**
- Modify:
  - `lib/api-spec/openapi.yaml`, the Cat schema near lines 1033–1054. Add:

```yaml
        coatColours:
          type: array
          description: The cat's resolved coat colours (coat-colours-and-pattern.md §6), in display order; [] when not known. Only the value.
          items: { type: string, enum: [black, grey, brown, ginger, white] }
        coatPattern:
          type: string
          nullable: true
          description: The cat's resolved coat pattern (§6), or null when not known. Only the value.
          enum: [plain, stripes, patches]
```

    Keep `coat` exactly as it is (`maxItems: 2`, the seven old codes). Change its description to "For older app versions, display only: worked out from coatColours and coatPattern (§6). Never filter on it."
  - Regenerate the types with `pnpm --filter @workspace/api-spec run codegen`.
  - `lib/catHelpers.ts`: `DerivedCatStatus` gains `coatColours: CoatColour[]` and `coatPattern: CoatPattern | null` (the legacy branch gets `[]` and `null`). `serialiseCat` (line 203) emits both.
  - **R7a's allow-list** in `appearance.notNotifiable.test.ts` gains the two copies in `serialiseCat`.
- Test:
  - `routes/cats.appearance.public.test.ts`: a cat with a team `{colours:["brown","ginger"],pattern:"stripes"}` gives `coatColours: ["brown","ginger"]`, `coatPattern: "stripes"` and `coat: ["ginger","tabby"]`. A brown-only cat gives `coat: []`. No other new key; the `NEVER_PUBLIC` list holds.
  - Snapshots: regenerate `routes/__snapshots__/publicPayload.p6.txt` and `cats.publicDetail.p3-2.txt` **on purpose**. The only change is `"coatColours":[],"coatPattern":null` beside `"coat":[]`. Record the regeneration in the PR, as the p6 test header requires.

- [ ] **Step 1: Failing tests** (the public test cases above).
- [ ] **Step 2: Implement:** openapi, then codegen, then catHelpers.
- [ ] **Step 3: Regenerate the snapshots, and diff them** to show only the two keys changed.
- [ ] **Step 4: Run the full suite and the typecheck.**
- [ ] **Step 5: Commit.**

### Task A2.2: The app shows the new line; older data is display-only

**Files:**
- Create: `artifacts/cat-spotter/lib/coat.ts`, `artifacts/cat-spotter/lib/__tests__/coat.test.ts`
- Modify: `artifacts/cat-spotter/lib/appearance.ts`. `appearanceLine` (line 74) uses `coatLineKeys` from `coat.ts`, then the marks.
- Modify: `artifacts/cat-spotter/lib/i18n.ts`. Add `coat_brown`, `pattern_plain`, `pattern_stripes` and `pattern_patches` in en, el and fr (§2 drafts). Keep the old `coat_*` keys for the fallback.

```ts
// lib/coat.ts — pure
import type { Cat } from '@workspace/api-client-react';
export const COLOURS = ['black', 'grey', 'brown', 'ginger', 'white'] as const;
export type Colour = (typeof COLOURS)[number];
export const PATTERNS = ['plain', 'stripes', 'patches'] as const;
export type Pattern = (typeof PATTERNS)[number];

/** The cat's coat as parts, from the new fields only; null parts = not known. Never reads the old `coat`. */
export function coatParts(cat: Pick<Cat, 'coatColours' | 'coatPattern'>): { colours: Colour[] | null; pattern: Pattern | null } {
  const colours = Array.isArray(cat.coatColours) ? COLOURS.filter((c) => cat.coatColours!.includes(c)) : [];
  const pattern = PATTERNS.find((p) => p === cat.coatPattern) ?? null;
  return { colours: colours.length ? colours : null, pattern };
}

/** i18n keys for the coat part of the display line (§2): colours, then the pattern unless plain. Falls back to the old `coat` for DISPLAY only, when the new fields are absent. */
export function coatLineKeys(cat: Pick<Cat, 'coat' | 'coatColours' | 'coatPattern'>): string[] {
  if (cat.coatColours === undefined && cat.coatPattern === undefined) return legacyLineKeys(cat.coat);
  const { colours, pattern } = coatParts(cat);
  return [...(colours ?? []).map((c) => `coat_${c}`), ...(pattern && pattern !== 'plain' ? [`pattern_${pattern}`] : [])];
}
```

`legacyLineKeys` is today's `inOrder(cat.coat, COAT_ORDER)` mapped through `COAT_LABEL_KEYS`, moved here.

- [ ] **Step 1: Failing tests:**
  - new fields `["brown","ginger"]` with stripes give the keys `coat_brown`, `coat_ginger`, `pattern_stripes`;
  - plain gives no pattern word;
  - `[]` with null gives `[]`;
  - absent new fields with `coat: ["ginger","tabby"]` give the legacy keys;
  - every new key exists in all three languages.
- [ ] **Step 2: Implement** the module above and the i18n keys.
- [ ] **Step 3: Run the app tests** (`artifacts/cat-spotter`: `pnpm exec vitest run lib/__tests__/coat.test.ts lib/__tests__/appearance.test.ts lib/__tests__/catalogue.test.ts`). The catalogue cache-key test must stay green **unedited**.
- [ ] **Step 4: Browser check.** Run the web preview at about 390 px and at desktop width, in en, el and fr. Check a cat page shows "Brown · Ginger · Stripes", a page from a cached old catalogue shows the old words, and nothing raw is ever shown.
- [ ] **Step 5: Commit.**

### A2 mutation probes

1. **`serialiseCat` emits the old `coat` worked out from the wrong part.** Expect red: the public test's `coat: ["ginger","tabby"]`.
2. **`coatParts` falls back to the old `coat`.** Expect red: a coat.test case asserting "absent new fields: parts are null".
3. **A confidence leaks onto the wire.** Expect red: the `NEVER_PUBLIC` keys test.

---

## PR B — The team's pages

**Depends on:** A1 merged. **Coordinate:** the SYC-2 PR 3.1 owner, whose code this is (see "Coordination").

### Task B.1: Correct as a form, and Confirm per part

**Files:**
- Modify:
  - `routes/teamCorrections.ts`:
    - `TEAM_COLOURS` (line 824) becomes `COAT_COLOURS`;
    - `CorrectForm` (lines 832–851) becomes `colours: z.array(z.enum(COAT_COLOURS)).max(5).optional()` and `pattern: z.enum(["plain","stripes","patches","none"]).optional()`;
    - the Correct route (around lines 895–935) needs at least one part: colours non-empty, or a pattern other than `none`.
  - `lib/teamCorrections.ts`: `correctAppearance` (lines 599–636) writes `{colours?, pattern?}`; `confirmAppearance` writes only the known parts.
  - `lib/teamPages/appearancePage.ts`:
    - `correctForm` (around lines 120–170): five colour checkboxes, each with a CSS swatch;
    - pattern radio buttons: Plain, Stripes, Patches and *Not stated* (`none`, the default);
    - after saving, a static inline-SVG drawn cat of the saved coat (server-drawn; **no script**, since `layout.ts` has none);
    - `publicLine` (line 43) shows the new line.
  - `lib/teamPages/strings/{en,el,fr}.ts`:
    - the `coat.*` words for the five colours;
    - `pattern.*` for the three patterns and `none`;
    - `appearance.pickColours` changes from "Pick one or two" to "Tick every colour you can see";
    - `reason.pattern_tied_camps` reads "Spotters disagree on the pattern";
    - `reason.mixed_sources` reads "Colour and pattern from different sources".
- Test: `routes/team.appearance.test.ts`:
  - Correct with colours only; with pattern only; with both;
  - with neither, refused with the form shown again;
  - Correct on a guardian's statement retracts both parts;
  - Confirm on a half-known coat writes only the known part;
  - Confirm with neither part known isn't offered;
  - the form has no `<script>`;
  - every new word exists in all three string files (the `strings.test.ts` parity).

- [ ] **Steps:** failing tests, then implement, then run `routes/team.appearance.test.ts`, `lib/teamPages/*.test.ts` and `routes/team.walk.test.ts`, then commit after each item.

### Task B.2: The Colour check list and the cat's history

- Modify:
  - `lib/colourCheck.ts`: render both parts in a row;
  - the `checkRow` reasons (`appearancePage.ts` line 271);
  - `teamCatView.ts`: the history line shows "Brown · Ginger · Stripes" through `readCoatValue`, for old and new rows alike.
- Test: a cat with mixed sources is listed with `mixed_sources`; a pattern tie with `pattern_tied_camps`; an old v1 machine row's history reads "Ginger · Stripes".

### B mutation probes

1. **Confirm writes a part that isn't known.** Expect red: B.1 "half-known coat".
2. **Correct accepts neither part.** Expect red: B.1 "neither, refused".
3. **A `<script>` tag is added to the form.** Expect red: B.1 "no script".

### After B is live: Samuel's verdicts (SYC-399)

Samuel gets a one-line heads-up first: it writes on production. Then a team member, or Claude through the team route with a team session if Samuel prefers, records each verdict as §8 of the spec translates it. Each one is checked in the cat's history.

---

## PR C — The reader: coat-v2 and the one checked re-read

**Depends on:** A1 merged. It can run in parallel with B.

### Task C.1: The coat-v2 prompt and answer

**Files:**
- Modify: `lib/coatReading/reader.ts`:
  - `MODEL_VERSION` becomes `…/coat-v2`;
  - `COLOUR_DESCRIPTIONS` becomes a `Record<CoatColour,string>` for the five colours;
  - add a `PATTERN_DESCRIPTIONS: Record<CoatPattern,string>`;
  - rewrite `coatPrompt()` to ask for `{catCount, photoClear, colours: string[], pattern: "plain"|"stripes"|"patches"|"cant_tell", confidence}`, with the plain descriptions of §7 (patchy is Patches and never Stripes; sandy brown is Brown, not Ginger; white counts when it is part of the coat);
  - `interpretCoatAnswer` returns `CoatParts` (a `notSure` for each Not sure case; pattern `null` for `cant_tell`).
- Test: rewrite `reader.test.ts`:
  - the prompt lists exactly the five colours and three patterns, in order;
  - every Not sure case;
  - five colours accepted;
  - `cant_tell` gives a null pattern while the colours stand;
  - an old code such as `tabby` from the model gives Not sure.

### Task C.2: The re-read, with its guards (§7)

**Files:**
- Modify:
  - `lib/coatReading/due.ts`: `catsDueForReading(limit, q, opts: { catIds?; reread?: boolean })`. With `reread`, a cat is also due (`because: "older_version"`) when its newest machine reading of the shown photo has a `modelVersion` other than `MODEL_VERSION`, **unless**:
    - (a) any reading of that photo was marked wrong;
    - (b) both parts of the cat are decided by a team or guardian statement.
    Without `reread` (automatic runs), the version is never a reason, so an automatic run never lists such a cat.
  - `lib/coatReading/record.ts`: `lockAndRecheck` passes the run's `reread` to `catsDueForReading`; `recordReading` takes `parts: CoatParts`.
  - `lib/coatReading/sweep.ts`:
    - `sweepCoatReadings` gets `reread` and passes it to every `catsDueForReading` call, **including the re-check before a photo is sent**;
    - **hold back** (status `held_back`, nothing written) any reading that would leave unknown a part that the cat's current machine reading knows, and any whole Not sure, on a re-read;
    - `SweepItem` gains `current: {colours, pattern} | null` for the contact sheet.
  - `routes/internalCoat.ts`: the `Body` gains `reread: z.boolean().default(false)`.
  - `.github/workflows/coat-readings.yml`: a `reread` choice (`false`/`true`, default `false`), passed in the body through `jq`, with the same host check.
- Test (`coatReading.test.ts`, `internalCoat.test.ts`, `coatReadingsWorkflow.test.ts`):
  - an automatic run (`reread` false) never lists a cat for an older version;
  - a manual re-read lists it once, writes it, and then never again under the same version;
  - a marked-wrong photo is skipped;
  - a team-decided cat is skipped;
  - a reading that loses a known pattern is `held_back`;
  - a whole Not sure is `held_back`;
  - `exclude` holds;
  - copy-forward translates and keeps its own `modelVersion`;
  - the re-check honours `reread` (with a forced interleave like T-race);
  - the workflow's `reread` reaches the body;
  - the route rejects a non-boolean `reread`.

### C mutation probes

1. **`reread` is ignored in the re-check.** Expect red: every re-read write returns `not_due` (the "writes it" test).
2. **An automatic run lists older-version cats.** Expect red: the "never lists" test.
3. **The hold-back guard is removed.** Expect red: the "loses a known pattern" test.
4. **The marked-wrong skip is removed.** Expect red: the "marked-wrong skipped" test.
5. **The team-decided skip is removed.** Expect red: the "team-decided skipped" test.

**C review:** Opus spot review of the `due.ts` and `sweep.ts` changes. Why Opus: R2 and R4 plus versions is the same subtle ground as SYC-161 PR 1, where the spot review found a real hole.

### After C is live: the checked re-read (Samuel gets a one-line heads-up first)

1. **Dry run** with `reread=true`. Expect about 28 cats, less any team-decided ones.
2. **Trial** with `reread=true`. About 28 calls; nothing written.
3. **Contact sheet**, built in the browser pane as on 15 October. Each cat's photo, its current coat, and the new reading drawn as the drawn cat; held-back cats marked. Samuel approves.
4. **Write** with `reread=true` and `exclude` set to the cats he rejects.
5. **Compare** the write with the trial, cat by cat, and show him any cat that changed.
6. **Dry run** with `reread=true` again: expect 0 due, apart from the excluded and held-back cats. The public payload shows the new coats. Three cats' `lastSeen` is unchanged.

---

## PR D — "Find the cat": the drawn chips and the filter

**Depends on:** A2 merged (it needs `coatColours` and `coatPattern` on the wire). It replaces SYC-161 PR 3.

### Task D.1: The filter's placement rule (pure)

**Files:** add `placeCat` to `artifacts/cat-spotter/lib/coat.ts`; test in `lib/__tests__/coat.test.ts`.

```ts
export type Placement = 'match' | 'not_known' | 'hidden';
/** Spec §5: hidden if any picked row is a known mismatch; else not_known if any picked row is unknown; else match.
 *  Plain and Patches are forgiving for a cat with White. */
export function placeCat(
  cat: Pick<Cat, 'coatColours' | 'coatPattern'>,
  picked: { colours: ReadonlySet<Colour>; patterns: ReadonlySet<Pattern> },
): Placement {
  const { colours, pattern } = coatParts(cat);
  const rows: ('match' | 'mismatch' | 'unknown')[] = [];
  if (picked.colours.size) rows.push(colours === null ? 'unknown' : colours.some((c) => picked.colours.has(c)) ? 'match' : 'mismatch');
  if (picked.patterns.size) {
    const forgiving = colours?.includes('white') && (pattern === 'plain' || pattern === 'patches');
    const ok = pattern !== null && (picked.patterns.has(pattern) || (forgiving && (picked.patterns.has('plain') || picked.patterns.has('patches'))));
    rows.push(pattern === null ? 'unknown' : ok ? 'match' : 'mismatch');
  }
  if (rows.includes('mismatch')) return 'hidden';
  if (rows.includes('unknown')) return 'not_known';
  return 'match';
}
```

- [ ] **Tests:**
  - every combination of (colours known, match or mismatch, unknown) × (pattern known, match or mismatch, unknown) × (which rows are picked);
  - the forgiveness rule;
  - a cat object with no new fields (an old cache) is `not_known` under any picked row, and `match` under none;
  - the counts: matching + not_known + hidden = the search results.

### Task D.2: The drawn components (shared)

**Files** (new, in `artifacts/cat-spotter/components/coat/`):
- `ColourSwatch.tsx`: a circle in the colour, with the word underneath.
- `PatternTile.tsx`: a small `react-native-svg` tile for plain, stripes and patches, and "?" for Can't tell.
- `DrawnCat.tsx`: a sitting-cat silhouette (`react-native-svg` paths) that takes `{colours, pattern}`:
  - first colour = fill;
  - other colours = patches;
  - white = chest and legs;
  - stripes = a pattern overlay;
  - patches = larger patches.
- `CoatChips.tsx`: the two rows. Toggle buttons with `accessibilityState.selected`, *All* in each row, and the word under each picture.

**Tests:**
- every combination of the five colours × four pattern states renders without throwing, and its accessibility label is the caption;
- each chip is a toggle with `selected`;
- every word exists in all three languages.

### Task D.3: The picker

**Files:**
- Modify `components/CatPicker.tsx`:
  - the chips under the search box;
  - the matches, then the *Not known* heading and those cats;
  - then the hidden-count line, with "Show all", **directly above** "Can't find it? Add it as a new cat";
  - the "No cats like that called “{text}”." line with "Search all" when the search plus filter finds nothing but the search alone would;
  - a reset to *All* each time it opens.
- Remove the "Not in this slice: the colour chips" comment.
- The match record: when the spotter resolves with either row picked, send `colourFilterOn: true` on the resolve request. Add the optional field to the openapi resolve body, regenerate, and set it in `routes/sightings.ts`, which writes `colour_filter_on` in the `sighting_matches` insert (lines 362 and 819).
- i18n: the §5 lines and the hidden-count plural forms.

**Tests:**
- the hidden-count line sits above the new-cat link (checked through the order of the rendered tree);
- "Show all" resets both rows;
- the search-empty line, with its clear action;
- `colour_filter_on` is true when a row was picked and false otherwise;
- offline, with the network mocked off, over a saved catalogue;
- the review screen's suggestions are identical whatever the filter (a source check that `review.tsx` doesn't import `placeCat`);
- the cache key is still v2 (the test unedited).

**Browser check before the PR opens:** about 390 px and desktop, in en, el and fr, on a seeded list of 40 cats with mixed coats, some not known, and some with old-only data. Screenshots go in the PR. **Samuel judges the drawings** (Decision 5A).

### D mutation probes

1. **`placeCat` puts an unknown part under `hidden`.** Expect red: the D.1 unknown cases.
2. **The forgiveness rule is removed.** Expect red: the D.1 forgiveness case.
3. **`placeCat` reads the old `coat`.** Expect red: the D.1 old-cache case.
4. **The hidden line moves below the new-cat link.** Expect red: the D.3 order test.
5. **`colourFilterOn` is never sent.** Expect red: the D.3 match-record test.

---

## Every place the rules must hold

| Rule | Must hold at | Held by |
|---|---|---|
| One translation of stored values | resolver, hand pick, Colour check, team history, codesOf, copy-forward, wire | `readCoatValue` only; A1 probes 1, 2 and 8 |
| Only what was said becomes known | every reader | `readCoatValue`; A1.1 cases |
| New writes in the new shape only | every writer: team Correct and Confirm, the reader, the future SYC-2 4.1 answers route | the `case "coat"` check; A1.2 |
| Per-part who-wins; only notSure withdraws; newest machine row only | public payload, team pages, Colour check, Confirm | `resolveCoatParts`; A1.3 tests 6–8 |
| Never hidden for unknown | the picker, and the future cat-alog filter (SYC-2 4.3) | `placeCat` (shared); D.1 |
| The old field is display-only | the app | `coatParts` never reads `coat`; A2 probe 2, D probe 3 |
| Never notifiable; never evidence of life; never in the matcher | snapshot, notifiers, matcher | `SYC2_FIELDS` updated (A1.4); the existing guards |
| The public sees values only | `GET /cats`, `GET /cats/:id`, the name-taken body | `serialiseCat`; `NEVER_PUBLIC`; snapshots |
| Re-read guards | the sweep, the re-checks, the route, the workflow | C.2 tests and probes |
| The cache key stays v2 | `catalogue.ts` | the existing test, unedited |

---

## Coordination

- **SYC-2 (team pages and 4.x):**
  - PR B changes code that SYC-2 PR 3.1 (#191) built. Its session is archived, so this plan owns those files for PR B.
  - SYC-2 PRs 4.1–4.3 (the spotter question, the details card, the cat-alog filter) must build on this vocabulary. They take the answer body `{colours, pattern?}` or `{notSure:true}`, and reuse `components/coat/*` and `placeCat`.
  - A comment on SYC-2 says so before any 4.x build starts.
- **SYC-161:**
  - PR 3 (the chips) is replaced by PR D;
  - PR 2 (automatic reading) must pass `reread: false`, which is the default, and is otherwise unchanged;
  - SYC-397 closes when C's trial is approved.
- **Johnny (SYC-346):** the words are on the ticket for the 22 Oct pack. Any word added later goes in the second pack.
- **The launch plan (#172):**
  - A1 and A2 aim for the Wed 21 / Fri 23 Oct publishes;
  - B and C for Mon 26 Oct;
  - D for Wed 28 Oct.
  - Nothing is on the must-launch list (6A).
- **Before each merge:** list the live sessions and open PRs, and agree the order (`/ship`). No migrations here.

---

## Model delegation

This session is on Opus 5.5. The spec and this plan were written here.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| A1.1–A1.2 (vocabulary, translation, write check) | Sonnet | Clear spec; code given above | The tests above; A1 probes 1, 2 and 6; adversarial review in `/ship` |
| A1.3 (per-part resolver and projection) | **Opus** | The projection's interplay with "newest machine row only" and "only notSure withdraws" is subtle; a green suite can hide a wrong answer here | A1.3 tests 1–12 including the parity test; probes 3, 4, 5 and 7; Opus spot review |
| A1.4 (moving every reader) | Sonnet | Mechanical but wide | Full suite and typecheck; probes 8 and 9; the session reviews the diff |
| A2 (wire, codegen, app display) | Sonnet | Standard | Tests; snapshot diff limited to the two keys; A2 probes; browser check at 390 px and desktop in 3 languages |
| B (team form, Confirm, check list) | Sonnet | Standard server HTML | Tests; B probes; `/ship` adversarial review |
| C (coat-v2, re-read guards) | Sonnet build, **Opus** spot review of `due.ts` and `sweep.ts` | The guards are silent-failure guards, the same ground as SYC-161 PR 1 | C tests; C probes 1–5; Opus spot review; the production dry run showing "0 due" afterwards |
| D (drawn components, picker) | Sonnet | Standard UI and a pure function | D tests and probes; browser check; Samuel judges the drawings |
| i18n key plumbing (en, el and fr keys, parity) | Haiku | Mechanical, well specified (the words are in §2 of the spec and on SYC-346) | The i18n parity tests; the session spot-reviews the diff |
| Adversarial review of this plan | Sonnet, own worktree | Checking claims against files | Every finding checked against the file it names before it's folded in |
| Each `/ship` review | Sonnet, own worktree | Standard | It re-runs the named tests itself and pastes the runner's "Tests N passed" line |
| The contact sheet and the go/no-go call | Opus (session) | Judging photos against colours | Samuel approves |

Every build prompt restates: **commit after each item**, keep `CHECKPOINT.md` untracked, and use your own worktree off fresh `origin/main`. No nested background agents.

---

## Rollout and checks after each publish

Each publish follows the launch routine: Samuel pulls main in Replit; whoever owns publishing that round publishes; Claude waits until `/api/healthz` shows the commit.

- **A1:** the public payload is unchanged (`coat` identical for every cat, compared before and after); the team pages render.
- **A2:** `GET /api/cats` carries `coatColours` and `coatPattern`; `coat` matches the truth table for every live cat; a cat page shows the new line at 390 px.
- **B:** a team member opens Correct and sees the form. Samuel's verdicts are applied (SYC-399), with a heads-up first.
- **C:** the checked re-read, steps 1–6 above.
- **D:** the picker on the live site at 390 px and desktop: the chips, *Not known*, and the hidden line above "Add it as a new cat".

## Rollback

Each PR reverts on its own. New-shape statements written after A1 are read correctly only by A1's code, so **revert A1 last**, after B, C and D. Statements are never deleted. The old `coat` field keeps older phones working throughout.
