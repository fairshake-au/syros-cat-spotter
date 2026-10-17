import type { Capability } from "../capabilities";
import type { ColourCheckCat, ColourCheckReason } from "../colourCheck";
import { REASON_ORDER } from "../colourCheck";
import { COAT_COLOURS, COAT_PATTERNS, LEGACY_COAT_CODES, MARKS } from "../appearance";
import type { TeamAppearance, TeamAppearanceStatement, TeamCatView } from "../teamCatView";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { tr, type StringKey } from "./strings";

// The Appearance section on the team cat page, and the Colour check list
// (SYC-2 PR 3.1; coat-markings-and-health.md §4.4, §5.3). Server-drawn, no
// scripts (DECISIONS Part 2k): the chip pickers are plain checkboxes in a
// form. Every value goes through escapeHtml; every fixed word comes from the
// three-language catalogue (./strings), because cat guardians read this
// section and list for their own colonies (spec §5.4). Team pages pass no
// language, so they are English.

/** The colours the team may state: the five (SYC-398 §2). Never Not sure (Samuel, 14 Oct 2026). */
const TEAM_COLOURS: readonly string[] = COAT_COLOURS;

/** The words for a coat code: the five colours and three patterns (SYC-398
 * §2), and the old public codes the guardian pages still send. */
const coatWord = (lang: string | undefined, code: string) =>
  (COAT_PATTERNS as readonly string[]).includes(code)
    ? tr(lang, `pattern.${code}` as StringKey)
    : TEAM_COLOURS.includes(code) || ((LEGACY_COAT_CODES as readonly string[]).includes(code) && code !== "not_sure")
      ? tr(lang, `coat.${code}` as StringKey)
      : code;

const markWord = (lang: string | undefined, code: string) =>
  (MARKS as readonly string[]).includes(code) ? tr(lang, `mark.${code}` as StringKey) : code;

/** As the public line words a mark (spec §5.2): "One eye", the rest as on the chip. */
const markShownWord = (lang: string | undefined, code: string) =>
  code === "missing_eye" ? tr(lang, "markShown.missing_eye") : markWord(lang, code);

const words = (lang: string | undefined, kind: "coat" | "markings", codes: readonly string[]) =>
  codes.map((c) => (kind === "coat" ? coatWord(lang, c) : markWord(lang, c))).join(" · ");

/** What a statement or answer says, in words. */
function valueText(lang: string | undefined, kind: "coat" | "markings", codes: readonly string[] | null): string {
  if (codes === null) return tr(lang, "appearance.notKnown");
  if (kind === "markings" && codes.length === 0) return tr(lang, "appearance.nothingSpecial");
  if (codes.length === 0) return tr(lang, "appearance.notKnown");
  return words(lang, kind, codes);
}

/**
 * "Brown · Ginger · Stripes · White paws · One eye", as the public line
 * (coat-colours-and-pattern.md §2, spec §5.2, plan Decision E1): the
 * colours, then the pattern except Plain (the photo shows it), then the
 * marks.
 */
export function publicLine(
  lang: string | undefined,
  coat: { colours: readonly string[] | null; pattern: string | null },
  markings: readonly string[],
): string {
  return [
    ...(coat.colours ?? []).map((c) => coatWord(lang, c)),
    ...(coat.pattern && coat.pattern !== "plain" ? [coatWord(lang, coat.pattern)] : []),
    ...markings.map((m) => markShownWord(lang, m)),
  ].join(" · ");
}

/**
 * The same line from the old public coat codes, for the guardian pages,
 * which keep the old field and words until they move to the new coat words
 * (SYC-398 plan, Coordination).
 */
export function legacyPublicLine(lang: string | undefined, coat: readonly string[], markings: readonly string[]): string {
  return [...coat.map((c) => coatWord(lang, c)), ...markings.map((m) => markShownWord(lang, m))].join(" · ");
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Athens",
  });

const time = (iso: string) => `<time datetime="${esc(iso)}">${esc(when(iso))}</time>`;

/** The `done` keys the appearance forms send back, and what each says. */
export const APPEARANCE_DONE: Record<string, StringKey> = {
  a_confirmed: "appearance.done.confirmed",
  a_corrected: "appearance.done.corrected",
  a_overruled: "appearance.done.overruled",
  a_nothing: "appearance.done.nothing",
  a_changed: "appearance.done.changed",
  a_wrong: "appearance.done.markedWrong",
};

export function appearanceNotice(lang: string | undefined, done: string | undefined): string {
  // Own keys only: ?done=constructor must not reach Object.prototype.
  if (!done || !Object.hasOwn(APPEARANCE_DONE, done)) return "";
  return `<p class="notice" role="status">${esc(tr(lang, APPEARANCE_DONE[done]!))}</p>`;
}

/** Where a form goes back to: the cat page, or the Colour check list. */
export type AppearanceBack = "cat" | "colour";

const backField = (back: AppearanceBack) =>
  back === "colour" ? '<input type="hidden" name="back" value="colour">' : "";

const reasonInput = (lang: string | undefined, id: string) =>
  `<label class="label" for="${id}">${esc(tr(lang, "appearance.why"))}</label>` +
  `<input class="text" id="${id}" name="reason" required maxlength="500" autocomplete="off">`;

/** A coat's two parts as the page shows them (SYC-398 §4). */
type CoatShown = { colours: readonly string[] | null; pattern: string | null };

/** What a Confirm sends back as the value the page showed: for a coat, each
 * part on its own (SYC-398 §4). */
function expectedFields(kind: "coat" | "markings", value: readonly string[], coat: CoatShown | undefined): string {
  if (kind === "coat" && coat) {
    return (
      `<input type="hidden" name="expectedColours" value="${esc((coat.colours ?? []).join(","))}">` +
      `<input type="hidden" name="expectedPattern" value="${esc(coat.pattern ?? "")}">`
    );
  }
  return `<input type="hidden" name="expected" value="${esc(value.join(","))}">`;
}

/** "That's right": one tap. Sends the value the page shows, so a stale page confirms nothing. */
function confirmForm(
  lang: string | undefined,
  catId: number,
  kind: "coat" | "markings",
  value: readonly string[],
  guardianDecides: boolean,
  back: AppearanceBack,
  coat?: CoatShown,
): string {
  const which = tr(lang, kind === "coat" ? "appearance.colour" : "appearance.markings");
  // On the Colour check list two of these sit together, so the button says
  // which; on the cat page it sits under its own heading.
  const label =
    back === "colour"
      ? esc(tr(lang, "appearance.confirmWhich", { what: which.toLowerCase() }))
      : `${esc(tr(lang, "appearance.confirm"))}<span class="sr"> (${esc(which)})</span>`;
  return (
    `<form method="post" action="/api/team/cats/${catId}/appearance/confirm">` +
    `<input type="hidden" name="kind" value="${kind}">` +
    expectedFields(kind, value, coat) +
    backField(back) +
    `<button type="submit" class="save">${label}</button>` +
    `<p class="hint">${esc(tr(lang, "appearance.confirmHint"))}` +
    (guardianDecides ? ` ${esc(tr(lang, "appearance.confirmHintGuardian"))}` : "") +
    "</p></form>"
  );
}

/**
 * "Correct": the whole new value with a reason. Colour offers the five
 * colours, ticked as they stand, never Not sure (the pattern comes in
 * SYC-398 PR B); markings offer all eleven, ticked as they stand,
 * and none ticked means "nothing special". The hidden empty `marks` says the
 * list was sent, so an empty list is a choice, not a missing field.
 */
function correctForm(
  lang: string | undefined,
  catId: number,
  kind: "coat" | "markings",
  current: readonly string[] | null,
  /** The cat guardian statements Correct will mark wrong (empty: none decides). */
  above: readonly number[],
  back: AppearanceBack,
  idBase: string,
): string {
  const codes: readonly string[] = kind === "coat" ? TEAM_COLOURS : MARKS;
  const field = kind === "coat" ? "colours" : "marks";
  // A coat's value is its colours then its pattern: only the colours tick.
  const ticked = new Set(current ?? []);
  const boxes = codes
    .map(
      (c) =>
        `<label class="choice" for="${idBase}-${c}"><input type="checkbox" id="${idBase}-${c}" name="${field}" value="${c}"${ticked.has(c) ? " checked" : ""}> ` +
        `${esc(kind === "coat" ? coatWord(lang, c) : markWord(lang, c))}</label>`,
    )
    .join("");
  return (
    `<details><summary>${esc(tr(lang, kind === "coat" ? "appearance.correctColour" : "appearance.correctMarkings"))}</summary>` +
    `<form method="post" action="/api/team/cats/${catId}/appearance/correct">` +
    `<input type="hidden" name="kind" value="${kind}">` +
    (kind === "markings" ? '<input type="hidden" name="marks" value="">' : "") +
    // What the page showed it will overrule: if that changed, nothing is written.
    `<input type="hidden" name="shownAbove" value="${esc(above.join(","))}">` +
    backField(back) +
    (above.length > 0 ? `<p class="warn">${esc(tr(lang, "appearance.overruleHint"))}</p>` : "") +
    `<fieldset><legend class="label">${esc(tr(lang, kind === "coat" ? "appearance.pickColours" : "appearance.pickMarks"))}</legend>` +
    `<div class="chips">${boxes}</div></fieldset>` +
    reasonInput(lang, `${idBase}-why`) +
    `<button type="submit">${esc(tr(lang, "appearance.save"))}</button></form></details>`
  );
}

/** "Mark wrong" on one standing statement: a retraction through the existing route. */
function markWrongForm(lang: string | undefined, s: TeamAppearanceStatement): string {
  return (
    `<details><summary>${esc(tr(lang, "appearance.markWrong"))}</summary>` +
    `<form method="post" action="/api/team/statements/${s.id}/wrong">` +
    '<input type="hidden" name="choice" value="retract">' +
    `<p class="hint">${esc(tr(lang, "appearance.markWrongHint"))}</p>` +
    reasonInput(lang, `aw${s.id}-why`) +
    `<button type="submit">${esc(tr(lang, "appearance.markWrong"))}</button></form></details>`
  );
}

function authorText(lang: string | undefined, s: TeamAppearanceStatement): string {
  if (s.source === "machine") return tr(lang, "appearance.byMachine");
  if (s.source === "guardian") return tr(lang, "appearance.byGuardian", { name: s.author.label });
  if (s.source === "spotter" && s.author.kind === "spotter") return tr(lang, "appearance.bySpotter");
  return s.author.label;
}

function statementItem(
  lang: string | undefined,
  kind: "coat" | "markings",
  s: TeamAppearanceStatement,
  mayChange: boolean,
): string {
  const said =
    s.codes === null
      ? tr(lang, kind === "coat" ? "appearance.notSure" : "appearance.cantTell")
      : valueText(lang, kind, s.codes);
  const extras = [
    s.prompted ? tr(lang, "appearance.prompted") : null,
    s.agreesWith !== null ? tr(lang, "appearance.agrees", { id: String(s.agreesWith) }) : null,
    s.modelVersion !== null ? tr(lang, "appearance.model", { version: s.modelVersion }) : null,
  ].filter((x): x is string => x !== null);
  return (
    `<li class="statement" id="a-${s.id}">` +
    `<p class="said"><span class="sid">#${s.id}</span> ${esc(said)}` +
    (s.counts ? ` <span class="tag">${esc(tr(lang, "appearance.counts"))}</span>` : "") +
    "</p>" +
    `<p class="meta">${esc(authorText(lang, s))} · ${time(s.createdAt)}` +
    (extras.length ? ` · ${esc(extras.join(" · "))}` : "") +
    "</p>" +
    (s.photoUrl
      ? `<p class="meta"><a class="tap" href="${esc(s.photoUrl)}"><img class="thumb" src="${esc(s.photoUrl)}" alt="${esc(tr(lang, "appearance.photo"))}" loading="lazy"></a></p>`
      : "") +
    (mayChange && s.markable ? markWrongForm(lang, s) : "") +
    "</li>"
  );
}

function reasonList(lang: string | undefined, reasons: readonly ColourCheckReason[]): string {
  const ordered = REASON_ORDER.filter((r) => reasons.includes(r));
  if (ordered.length === 0) return "";
  return `<ul class="refs">${ordered.map((r) => `<li>${esc(tr(lang, `reason.${r}` as StringKey))}</li>`).join("")}</ul>`;
}

const levelTag = (lang: string | undefined, confidence: string) =>
  `<span class="tag">${esc(tr(lang, `appearance.level.${confidence}` as StringKey))}</span>`;

/** What the records say. A coat says each part on its own, with its own
 * confidence (SYC-398 §4). */
function recordsSay(lang: string | undefined, kind: "coat" | "markings", a: TeamAppearance): string {
  if (kind === "coat" && a.parts) {
    const { colours, pattern } = a.parts;
    return (
      `<dt>${esc(tr(lang, "appearance.recordsSay"))}: ${esc(tr(lang, "appearance.coatColours"))}</dt>` +
      `<dd>${esc(valueText(lang, "coat", colours.value))} ${levelTag(lang, colours.confidence)}</dd>` +
      `<dt>${esc(tr(lang, "appearance.recordsSay"))}: ${esc(tr(lang, "appearance.coatPattern"))}</dt>` +
      `<dd>${esc(valueText(lang, "coat", pattern.value === null ? null : [pattern.value]))} ${levelTag(lang, pattern.confidence)}</dd>`
    );
  }
  return `<dt>${esc(tr(lang, "appearance.recordsSay"))}</dt><dd>${esc(valueText(lang, kind, a.value))} ${levelTag(lang, a.confidence)}</dd>`;
}

function kindBlock(
  lang: string | undefined,
  catId: number,
  kind: "coat" | "markings",
  a: TeamAppearance,
  reasons: readonly ColourCheckReason[],
  mayChange: boolean,
): string {
  const label = tr(lang, kind === "coat" ? "appearance.colour" : "appearance.markings");
  const canConfirm = a.value !== null && (kind === "markings" || a.value.length > 0);
  const coat = kind === "coat" && a.parts ? { colours: a.parts.colours.value, pattern: a.parts.pattern.value } : undefined;
  return (
    `<h3>${esc(label)}</h3><dl>` +
    recordsSay(lang, kind, a) +
    (reasons.length
      ? `<dt>${esc(tr(lang, "appearance.checkTitle"))}</dt><dd>${reasonList(lang, reasons)}</dd>`
      : "") +
    "</dl>" +
    (a.guardianDisagrees ? `<p class="warn">${esc(tr(lang, "appearance.guardianDisagrees"))}</p>` : "") +
    (mayChange
      ? '<div class="fixes appfix">' +
        (canConfirm ? confirmForm(lang, catId, kind, a.value!, a.guardianDecides, "cat", coat) : "") +
        correctForm(lang, catId, kind, a.value, a.aboveTeamIds, "cat", `ac-${kind}`) +
        "</div>"
      : "") +
    `<p class="label">${esc(tr(lang, "appearance.statements"))}</p>` +
    (a.statements.length === 0
      ? `<p class="empty">${esc(tr(lang, "appearance.noStatements"))}</p>`
      : `<ol class="history">${a.statements.map((s) => statementItem(lang, kind, s, mayChange)).join("")}</ol>`)
  );
}

/**
 * The Appearance section (spec §5.3): what the public sees, then colour and
 * markings, each with what the records say, why it is worth a second look,
 * Confirm and Correct, and every statement that stands with Mark wrong.
 */
export function renderAppearanceSection(
  v: TeamCatView,
  may: (c: Capability) => boolean,
  done?: string,
  lang?: string,
): string {
  const a = v.appearance;
  const mayChange = may("set_appearance");
  // The resolved parts the public payload carries from SYC-398 PR A2; never
  // a breeder's word (Decision 4A). Until A2 is live the app still shows the
  // old `coat` codes (Ginger · Tabby where this says Ginger · Stripes): a
  // known, short gap, accepted in A1 (Opus spot review, finding 3).
  const parts = a.coat.parts;
  const line = publicLine(
    lang,
    { colours: parts?.colours.value ?? null, pattern: parts?.pattern.value ?? null },
    v.publicStatus.markings,
  );
  const coatReasons: ColourCheckReason[] = [...a.coat.checkReasons, ...(a.handPick ? (["hand_pick"] as const) : [])];
  return (
    `<h2 id="appearance">${esc(tr(lang, "appearance.title"))}</h2>` +
    appearanceNotice(lang, done) +
    `<h3>${esc(tr(lang, "appearance.publicSees"))}</h3>` +
    `<p class="public">${esc(line || tr(lang, "appearance.publicNothing"))}</p>` +
    kindBlock(lang, v.cat.id, "coat", a.coat, coatReasons, mayChange) +
    kindBlock(lang, v.cat.id, "markings", a.markings, a.markings.checkReasons, mayChange) +
    `<p class="hint">${esc(tr(lang, "appearance.historyHint"))}</p>`
  );
}

// ── The Colour check list ───────────────────────────────────────────────────

function checkRow(lang: string | undefined, c: ColourCheckCat, inline: boolean): string {
  const thumb = c.photoUrl
    ? `<img class="thumb" src="${esc(c.photoUrl)}" alt="" loading="lazy">`
    : `<span class="thumb nothumb">${esc(tr(lang, "appearance.noPhoto"))}</span>`;
  // The coat's two parts (SYC-398 §4): its colours, then its pattern.
  const coatCodes = [...(c.coatColours ?? []), ...(c.coatPattern ? [c.coatPattern] : [])];
  const coat = coatCodes.length > 0 ? coatCodes : null;
  const line = [
    `${tr(lang, "appearance.colour")}: ${valueText(lang, "coat", coat)}`,
    `${tr(lang, "appearance.markings")}: ${valueText(lang, "markings", c.markings)}`,
  ].join(" · ");
  const confirms = [
    coat !== null
      ? confirmForm(lang, c.catId, "coat", coat, c.above.coat.length > 0, "colour", {
          colours: c.coatColours,
          pattern: c.coatPattern,
        })
      : "",
    c.markings !== null
      ? confirmForm(lang, c.catId, "markings", c.markings, c.above.markings.length > 0, "colour")
      : "",
  ].join("");
  // Correct inline for the cats that matter; a link for the long
  // "not yet described" group, so that page stays light.
  const corrects = inline
    ? correctForm(lang, c.catId, "coat", c.coatColours, c.above.coat, "colour", `cc${c.catId}-coat`) +
      correctForm(lang, c.catId, "markings", c.markings, c.above.markings, "colour", `cc${c.catId}-markings`)
    : "";
  return (
    `<li class="report colourcheck" id="c-${c.catId}">` +
    `<a class="catrow" href="/api/team/cats/${c.catId}#appearance">${thumb}` +
    `<span><strong>${esc(c.name)}</strong> <span class="syr">${esc(c.syr)}</span>` +
    `<span class="status">${esc(line)}</span></span></a>` +
    reasonList(lang, c.reasons) +
    `<div class="fixes appfix">${confirms}${corrects}</div>` +
    `<p><a class="tap" href="/api/team/cats/${c.catId}#appearance">${esc(tr(lang, "colourCheck.openCat"))}</a></p>` +
    "</li>"
  );
}

/**
 * GET /api/team/colour-check (spec §5.3): cats with a reason other than "not
 * yet described" first, newest first; the never-described cats in one
 * collapsed group at the bottom, with their count.
 */
export function renderColourCheckPage(
  cats: ColourCheckCat[],
  personName: string,
  done?: string,
  lang?: string,
): string {
  const check = cats.filter((c) => c.group === "check");
  const notDescribed = cats.filter((c) => c.group === "not_described");
  // Everyone who reaches this list holds set_appearance (the route asks).
  const row = (c: ColourCheckCat, inline: boolean) => checkRow(lang, c, inline);
  const body =
    appearanceNotice(lang, done) +
    `<p>${esc(tr(lang, "colourCheck.intro"))}</p>` +
    (check.length === 0 && notDescribed.length === 0
      ? `<p class="empty">${esc(tr(lang, "colourCheck.empty"))}</p>`
      : "") +
    (check.length
      ? `<h2>${esc(tr(lang, "colourCheck.toCheck", { count: String(check.length) }))}</h2>` +
        `<ul class="cats">${check.map((c) => row(c, true)).join("")}</ul>`
      : "") +
    (notDescribed.length
      ? `<details class="notdescribed"><summary>${esc(
          notDescribed.length === 1
            ? tr(lang, "colourCheck.notDescribedOne")
            : tr(lang, "colourCheck.notDescribed", { count: String(notDescribed.length) }),
        )}</summary>` +
        `<ul class="cats">${notDescribed.map((c) => row(c, false)).join("")}</ul></details>`
      : "");
  return renderPage({
    title: tr(lang, "colourCheck.title"),
    active: "colour",
    personName,
    lang,
    body,
  });
}
