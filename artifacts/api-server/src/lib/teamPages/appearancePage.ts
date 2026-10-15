import type { Capability } from "../capabilities";
import type { ColourCheckCat, ColourCheckReason } from "../colourCheck";
import { REASON_ORDER } from "../colourCheck";
import { COAT_COLOURS, MARKS } from "../observations";
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

/** The colours the team may state: never Not sure (Samuel, 14 Oct 2026). */
const TEAM_COLOURS = COAT_COLOURS.filter((c) => c !== "not_sure");

const coatWord = (lang: string | undefined, code: string) =>
  (TEAM_COLOURS as readonly string[]).includes(code) ? tr(lang, `coat.${code}` as StringKey) : code;

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

/** "Ginger · Tabby · White paws · One eye", exactly as the public line (spec §5.2, plan Decision E1). */
export function publicLine(lang: string | undefined, coat: readonly string[], markings: readonly string[]): string {
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

/** "That's right": one tap. Sends the value the page shows, so a stale page confirms nothing. */
function confirmForm(
  lang: string | undefined,
  catId: number,
  kind: "coat" | "markings",
  value: readonly string[],
  guardianDecides: boolean,
  back: AppearanceBack,
): string {
  const which = tr(lang, kind === "coat" ? "appearance.colour" : "appearance.markings");
  return (
    `<form method="post" action="/api/team/cats/${catId}/appearance/confirm">` +
    `<input type="hidden" name="kind" value="${kind}">` +
    `<input type="hidden" name="expected" value="${esc(value.join(","))}">` +
    backField(back) +
    // Two of these sit side by side on the Colour check list: say which.
    `<button type="submit" class="save">${esc(tr(lang, "appearance.confirm"))}<span class="sr"> (${esc(which)})</span></button>` +
    `<p class="hint">${esc(tr(lang, "appearance.confirmHint"))}` +
    (guardianDecides ? ` ${esc(tr(lang, "appearance.confirmHintGuardian"))}` : "") +
    "</p></form>"
  );
}

/**
 * "Correct": the whole new value with a reason. Colour offers the seven
 * colours, never Not sure; markings offer all eleven, ticked as they stand,
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

function kindBlock(
  lang: string | undefined,
  catId: number,
  kind: "coat" | "markings",
  a: TeamAppearance,
  reasons: readonly ColourCheckReason[],
  mayChange: boolean,
): string {
  const label = tr(lang, kind === "coat" ? "appearance.colour" : "appearance.markings");
  const value = valueText(lang, kind, a.value);
  const canConfirm = a.value !== null && (kind === "markings" || a.value.length > 0);
  return (
    `<h3>${esc(label)}</h3><dl>` +
    `<dt>${esc(tr(lang, "appearance.recordsSay"))}</dt><dd>${esc(value)} <span class="tag">${esc(tr(lang, `appearance.level.${a.confidence}` as StringKey))}</span></dd>` +
    (reasons.length
      ? `<dt>${esc(tr(lang, "appearance.checkTitle"))}</dt><dd>${reasonList(lang, reasons)}</dd>`
      : "") +
    "</dl>" +
    (a.guardianDisagrees ? `<p class="warn">${esc(tr(lang, "appearance.guardianDisagrees"))}</p>` : "") +
    (mayChange
      ? '<div class="fixes appfix">' +
        (canConfirm ? confirmForm(lang, catId, kind, a.value!, a.guardianDecides, "cat") : "") +
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
  const line = publicLine(lang, v.publicStatus.coat, v.publicStatus.markings);
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
  const line = [
    `${tr(lang, "appearance.colour")}: ${valueText(lang, "coat", c.coat)}`,
    `${tr(lang, "appearance.markings")}: ${valueText(lang, "markings", c.markings)}`,
  ].join(" · ");
  const confirms = [
    c.coat !== null && c.coat.length > 0
      ? confirmForm(lang, c.catId, "coat", c.coat, c.above.coat.length > 0, "colour")
      : "",
    c.markings !== null
      ? confirmForm(lang, c.catId, "markings", c.markings, c.above.markings.length > 0, "colour")
      : "",
  ].join("");
  // Correct inline for the cats that matter; a link for the long
  // "not yet described" group, so that page stays light.
  const corrects = inline
    ? correctForm(lang, c.catId, "coat", c.coat, c.above.coat, "colour", `cc${c.catId}-coat`) +
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
