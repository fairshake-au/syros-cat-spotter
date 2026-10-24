import type { DerivedCatStatus } from "../catHelpers";
import type { Capability } from "../capabilities";
import { reasonLabel } from "../issues/alertEmail";
import type { IssueReport } from "../issues/queue";
import type { Confidence } from "../resolve";
import { markOf } from "../teamCatList";
import type { TeamCatView, TeamStatement } from "../teamCatView";
import { LIFE } from "./catActions";
import { coatPhraseOf, day, renderCatFacts, type Shown } from "./catFacts";
import { escapeHtml as esc } from "./escape";
import { markIconOnly } from "./marks";
import { timeAgo } from "./queuePage";

// The team cat page's header card (SYC-655 spec §2, §5): everything about who
// the cat is in one card. Open reports first, then the photo, the name with
// its sterilisation mark, the facts, the description and the public line, and
// the buttons. Every value goes through escapeHtml.

export type IssueStrip = { reports: IssueReport[]; total: number; open?: number };

/**
 * The public sterilised line, word for word as the app shows it
 * (catStatusLines.ts's sterilisedLineKey): only confirmed and likely say
 * anything; everything else, "reported" included, is "Not known yet".
 */
function publicSterilisedText(s: { value: boolean | null; confidence: Confidence }): string {
  if (s.confidence === "confirmed")
    return s.value ? "Sterilised — confirmed by Syros Cats" : "Not sterilised — Syros Cats' records";
  if (s.confidence === "likely") return "Probably sterilised — a clipped ear tip has been seen";
  return "Not known yet";
}

function publicStatusText(s: DerivedCatStatus): string {
  const life = LIFE[s.lifeStatus];
  const seen = s.notSeenSince ? ` · Not seen since ${day(s.notSeenSince)}` : "";
  return `${life} · ${publicSterilisedText(s.sterilised)}${seen}`;
}

/**
 * The amber box above the facts (spec §3.1): "1 open report: Looks injured ·
 * 2 days ago", linking to the newest open one in the Queue. Open means the
 * Queue's own open states, `new` and `looking`; `done` and `nothing_needed`
 * are closed. Nothing when none is open (the Reports section still lists the
 * closed ones). `open` counts them all; `reports` holds only the newest 50.
 */
export function openReportsBox(strip: IssueStrip | null | undefined, now: Date): string {
  if (!strip) return "";
  const open = strip.reports.filter((i) => i.state === "new" || i.state === "looking");
  const newest = open[0];
  if (!newest) return "";
  const n = Math.max(strip.open ?? 0, open.length);
  const id = esc(encodeURIComponent(newest.id));
  return (
    '<aside class="openreports" aria-label="Open reports">' +
    `<a href="/api/team?open=${id}#r-${id}">${n === 1 ? "1 open report" : `${n} open reports`}: ${esc(reasonLabel(newest.reason))} · ` +
    `${esc(timeAgo(newest.at, now))}</a></aside>`
  );
}

export interface CatCardOptions {
  now: Date;
  byId: Map<number, TeamStatement>;
  shown: Shown;
  island: boolean;
  issues?: IssueStrip | null;
  /** The buttons (renderCatActions), trusted HTML. */
  actions: string;
}

/**
 * The main photo, or its placeholder. With more than one photo on file (or
 * any, when there is no main photo) a "5 photos" label sits on it and the
 * whole thing links to the Photos tab. The count includes hidden photos, so
 * it matches the tab. A hidden main photo is dimmed.
 */
function cardPhoto(v: TeamCatView): string {
  const { cat } = v;
  const coat = coatPhraseOf(v);
  const mainHidden = v.photos.find((p) => p.source === "main")?.hidden ?? null;
  const picture = cat.mainPhotoUrl
    ? `<img class="photo catmain${mainHidden ? " ishidden" : ""}" src="${esc(cat.mainPhotoUrl)}" alt="${esc(`Photo of ${cat.name}${coat !== null ? `, ${coat}` : ""}`)}">`
    : '<div class="nophoto">No photo</div>';
  const n = v.photos.length;
  if (n === 0 || (n === 1 && cat.mainPhotoUrl)) return picture;
  return `<a class="photo" href="#tab-photos">${picture}<span class="photocount">${n} ${n === 1 ? "photo" : "photos"}</span></a>`;
}

/**
 * The header card. `heading` is the name with the sterilisation mark beside
 * it; `card` is the whole card with that heading (its one <h1>) inside, so
 * the page draws `card` where it would draw the plain <h1>.
 */
export function renderCatCard(
  v: TeamCatView,
  _may: (c: Capability) => boolean,
  opts: CatCardOptions,
): { heading: string; card: string } {
  const { cat } = v;
  const heading = `<div class="nameline"><h1>${esc(cat.name)}</h1>${markIconOnly(markOf(v.records.sterilised))}</div>`;
  const card =
    `<div class="catcard${opts.actions ? "" : " noactions"}">` +
    openReportsBox(opts.issues, opts.now) +
    `<div class="cardphoto">${cardPhoto(v)}</div>` +
    '<div class="cardcat">' +
    heading +
    `<p class="syrline">${esc(cat.syr)} · on our records since ${esc(day(cat.createdAt))}</p>` +
    renderCatFacts(v, opts.now, { byId: opts.byId, shown: opts.shown, island: opts.island }) +
    (cat.description ? `<p class="desc">${esc(cat.description)}</p>` : "") +
    `<p class="publicline">What the public sees: <span class="public">${esc(publicStatusText(v.publicStatus))}</span></p>` +
    "</div>" +
    (opts.actions ? `<div class="catactions">${opts.actions}</div>` : "") +
    "</div>";
  return { heading, card };
}
