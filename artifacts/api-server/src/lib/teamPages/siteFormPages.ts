import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { renderMap, type MapMarker } from "./map";
import { fmtPos, SITES_PATH, stampField } from "./sitePages";
import { t, wordsIn, type WordKey } from "./words";
import { viewAround, type Position, type View } from "../mapTiles/geometry";
import {
  SITE_DIRECTIONS_MAX,
  SITE_NAME_MAX,
  SITE_NOTES_MAX,
  SITE_REASON_MAX,
} from "../teamSiteWrites";

// The pages for adding and moving a feeding site (SYC-209 PR 3.3; spec §2.3,
// §2.4, §3). Server-drawn, no scripts. A picked position travels in hidden
// fields of POST forms and nowhere else: no href, action or src on any of
// these pages holds a position (plan K13). Every value a person typed goes
// through escapeHtml.
//
// The picker and the move pages are the team's (English) until PR 4.2. The
// confirmation page and the problem page can be reached by a cat guardian
// through "Make a feeding site here" on a sighting of her own colony's cat
// (PR 4.1), so they take her language and menu; saving is still the team's.

const w = (key: WordKey) => esc(t(key));

/** A cat guardian's language and menu; omitted for the team. */
export interface FormViewer {
  lang?: string;
  island?: boolean;
}

export const NEW_PATH = `${SITES_PATH}/new`;
export const PICK_PATH = `${SITES_PATH}/pick`;

/** How close the confirmation page's small map is drawn around the spot. */
export const CONFIRM_ZOOM = 17;

const hidden = (name: string, value: string) =>
  `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;

const checkTapBlock = (note: string | undefined) =>
  note
    ? `<details class="checkdetails"><summary>${w("confirm.checkTap")}</summary><p class="meta">${esc(note)}</p></details>`
    : "";

// ── The picker (add, or move) ──────────────────────────────────────────────

/**
 * The map in `place` mode, and the second way in: typed coordinates for
 * anyone who can't tap, with the warning not to copy them from a map
 * company. Both post to the same address, which reads whichever came.
 */
export function renderPicker(o: {
  personName: string;
  title: string;
  intro: string;
  back: { href: string; label: string };
  view: View;
  markers?: MapMarker[];
  tapAction: string;
  moveAction: string;
  /** Hidden fields every form on the page carries (the move page's `updated_at`). */
  carry?: Record<string, string>;
  note?: string;
  legend?: string;
  below?: string;
}): string {
  const typed =
    `<h2>${w("new.typedTitle")}</h2>` +
    `<form method="post" action="${esc(o.tapAction)}" class="typedpos">` +
    Object.entries(o.carry ?? {})
      .map(([k, v]) => hidden(k, v))
      .join("") +
    `<p class="warn">${w("new.typedWarning")}</p>` +
    `<label class="label" for="typed-lat">${w("new.lat")}</label>` +
    `<input class="text" id="typed-lat" name="lat" type="text" inputmode="decimal" required autocomplete="off">` +
    `<label class="label" for="typed-lng">${w("new.lng")}</label>` +
    `<input class="text" id="typed-lng" name="lng" type="text" inputmode="decimal" required autocomplete="off">` +
    `<button type="submit">${w("new.typedButton")}</button></form>`;
  return renderPage({
    title: o.title,
    active: "sites",
    personName: o.personName,
    mainClass: "mappage",
    beforeTitle: `<p class="back"><a href="${esc(o.back.href)}">${esc(o.back.label)}</a></p>`,
    body:
      // Fixed line heights above the map (see .mappage in layout.ts).
      `<p>${esc(o.intro)}</p>` +
      renderMap({
        view: o.view,
        markers: o.markers,
        mode: "place",
        tapAction: o.tapAction,
        moveAction: o.moveAction,
        hidden: o.carry,
      }) +
      (o.note ? `<p class="warn">${esc(o.note)}</p>` : "") +
      (o.legend ? `<p class="hint">${esc(o.legend)}</p>` : "") +
      `<p class="hint">${w("new.mapNote")}</p>` +
      (o.below ?? "") +
      typed,
  });
}

// ── The confirmation page ──────────────────────────────────────────────────

/**
 * The confirmation page's small map, centred on the picked spot, in tap mode:
 * a tap nudges the pin (spec §3). The tap posts to the same pick route as the
 * first one, carrying what the previous step had in hidden fields, plus
 * `nudge` (a re-tap keeps the zoom instead of zooming in again). Nothing in
 * any address.
 */
const smallMap = (
  spot: Position,
  zoom: number,
  markers: MapMarker[],
  tapAction: string,
  carry: Record<string, string>,
  lang?: string,
) =>
  renderMap({
    lang,
    view: viewAround(spot, zoom),
    markers,
    mode: "place",
    tapAction,
    controls: false,
    hidden: { ...carry, nudge: "1" },
  });

/** What the add form held at the previous step (all strings; empty if nothing). */
export interface AddCarry {
  name: string;
  colonyId: string;
  directions: string;
  notes: string;
}

/** After a tap on /sites/new: the spot, a small map around it, and the form. */
export function renderAddConfirm(o: {
  personName: string;
  spot: Position;
  zoom: number;
  colonies: Array<{ id: number; name: string }>;
  checkNote?: string;
  carry?: AddCarry;
} & FormViewer): string {
  const { t, w } = wordsIn(o.lang);
  const c0: AddCarry = o.carry ?? { name: "", colonyId: "", directions: "", notes: "" };
  const options =
    `<option value="">${w("confirm.noColony")}</option>` +
    o.colonies
      .map((c) => `<option value="${c.id}"${String(c.id) === c0.colonyId ? " selected" : ""}>${esc(c.name)}</option>`)
      .join("");
  return renderPage({
    title: t("confirm.title"),
    active: "sites",
    nav: o.island === false ? "guardian" : undefined,
    lang: o.lang,
    personName: o.personName,
    mainClass: "mappage",
    beforeTitle: `<p class="back"><a href="${esc(NEW_PATH)}">${w("confirm.again")}</a></p>`,
    body:
      smallMap(o.spot, o.zoom, [{ ...o.spot, label: t("confirm.spot"), look: "private" }], PICK_PATH, { ...c0 }, o.lang) +
      `<p class="hint">${w("confirm.nudge")}</p>` +
      `<p class="tapped">${w("confirm.spot")}: <strong>${esc(fmtPos(o.spot.lat, o.spot.lng))}</strong>. ${w("confirm.legend")}</p>` +
      checkTapBlock(o.checkNote) +
      `<p class="hint">${w("new.private")}</p>` +
      `<form method="post" action="${esc(SITES_PATH)}">` +
      hidden("lat", String(o.spot.lat)) +
      hidden("lng", String(o.spot.lng)) +
      `<label class="label" for="new-name">${w("confirm.name")}</label>` +
      `<p class="hint">${w("confirm.nameHint")}</p>` +
      `<input class="text" id="new-name" name="name" type="text" required maxlength="${SITE_NAME_MAX}" value="${esc(c0.name)}" autocomplete="off">` +
      `<label class="label" for="new-colony">${w("confirm.colony")}</label>` +
      `<select class="text" id="new-colony" name="colonyId">${options}</select>` +
      `<label class="label" for="new-directions">${w("confirm.directions")}</label>` +
      `<p class="hint">${w("confirm.directionsHint")}</p>` +
      `<input class="text" id="new-directions" name="directions" type="text" maxlength="${SITE_DIRECTIONS_MAX}" value="${esc(c0.directions)}" autocomplete="off">` +
      `<label class="label" for="new-notes">${w("confirm.notes")}</label>` +
      `<textarea id="new-notes" name="notes" maxlength="${SITE_NOTES_MAX}">${esc(c0.notes)}</textarea>` +
      `<p class="hint">${w("notes.hint")}</p>` +
      `<div class="actions"><button type="submit" class="save">${w("confirm.save")}</button></div>` +
      `</form>`,
  });
}

/** After a tap on a site's move page: old and new spot, and the required reason. */
export function renderMoveConfirm(o: {
  personName: string;
  site: { id: number; name: string; lat: number; lng: number; stamp: string; isPublic: boolean };
  spot: Position;
  zoom: number;
  checkNote?: string;
  reason?: string;
}): string {
  const base = `${SITES_PATH}/${o.site.id}`;
  return renderPage({
    title: `${t("move.title")} ${o.site.name}`,
    active: "sites",
    personName: o.personName,
    mainClass: "mappage",
    beforeTitle: `<p class="back"><a href="${esc(base)}/move">${w("confirm.again")}</a></p>`,
    body:
      smallMap(o.spot, o.zoom, [
        { lat: o.site.lat, lng: o.site.lng, label: t("move.now"), look: "retired" },
        { ...o.spot, label: t("move.new"), look: "private" },
      ], `${base}/move/pick`, { updatedAt: o.site.stamp, reason: o.reason ?? "" }) +
      `<p class="hint">${w("confirm.nudge")}</p>` +
      `<p class="hint">${w("move.legend")}</p>` +
      `<p class="tapped">${w("move.now")}: ${esc(fmtPos(o.site.lat, o.site.lng))}<br>` +
      `${w("move.new")}: <strong>${esc(fmtPos(o.spot.lat, o.spot.lng))}</strong></p>` +
      checkTapBlock(o.checkNote) +
      (o.site.isPublic ? `<p class="notice">${w("move.publicWarning")}</p>` : "") +
      `<form method="post" action="${esc(base)}/move">` +
      stampField(o.site.stamp) +
      hidden("lat", String(o.spot.lat)) +
      hidden("lng", String(o.spot.lng)) +
      `<label class="label" for="move-reason">${w("move.reason")}</label>` +
      `<p class="hint">${w("move.reasonHint")}</p>` +
      `<input class="text" id="move-reason" name="reason" type="text" required maxlength="${SITE_REASON_MAX}" value="${esc(o.reason ?? "")}" autocomplete="off">` +
      `<div class="actions"><button type="submit" class="save">${w("move.save")}</button></div>` +
      `</form>`,
  });
}

// ── Something went wrong ───────────────────────────────────────────────────

/** A short page saying what was wrong, with a way back. */
export function renderSiteProblem(
  personName: string,
  message: string,
  back: { href: string; label: string },
  viewer: FormViewer = {},
): string {
  const { t, w } = wordsIn(viewer.lang);
  return renderPage({
    title: t("sproblem.title"),
    active: "sites",
    nav: viewer.island === false ? "guardian" : undefined,
    lang: viewer.lang,
    personName,
    body:
      `<p>${esc(message)} ${w("sproblem.nothingSaved")}</p>` +
      `<p><a class="tap" href="${esc(back.href)}">${esc(back.label)}</a></p>`,
  });
}
