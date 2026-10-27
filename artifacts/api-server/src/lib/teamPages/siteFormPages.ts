import { escapeHtml as esc } from "./escape";
import { renderPage, type NavKey } from "./layout";
import { mapPageAssets, renderMap, type MapMarker } from "./map";
import { currentAreas } from "../areas/namedAreas";
import { mapPrivacyNote } from "./mapNote";
import { place, position } from "./position";
import { SITES_PATH, stampField } from "./sitePages";
import { t, wordsIn, type WordKey } from "./words";
import type { Position } from "../mapTiles/geometry";
import {
  SITE_DIRECTIONS_MAX,
  SITE_NAME_MAX,
  SITE_NOTES_MAX,
  SITE_REASON_MAX,
} from "../teamSiteWrites";

// The pages for adding and moving a feeding site (SYC-209 PR 3.3; spec §2.3,
// §2.4, §3). Since SYC-705 Task 2b.7 the place pages carry a MapLibre map
// (drag the map under a fixed pin; assets/dashboard-pin.js) and a complete
// no-map path (an area, typed numbers). A picked position travels in hidden
// fields of POST forms and nowhere else: no href, action or src on any of
// these pages holds a position (plan K13). Every value a person typed goes
// through escapeHtml. The one outbound exception is D9's "Open map" link
// (SYC-395), built by position.ts, only when the viewer is island-wide
// (`island === true`).
//
// A cat guardian reaches every page here for her own colonies' sites (PR
// 4.2): the picker, the add and move confirmations and the problem page all
// take her language and menu.

/** A spot in words and Open map for an island-wide viewer; a cat guardian's own site keeps the exact position. */
const spotText = (p: { lat: number; lng: number }, island: boolean): string =>
  island ? place(p.lat, p.lng, { link: true }) : position(p.lat, p.lng, { link: false });

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

// ── The picker (add, or move) ──────────────────────────────────────────────

/** The id of the place page's map form (renderMap's `formId`). */
export const PICK_FORM_ID = "pickform";

/**
 * The no-map path (SYC-705 Task 2b.7): shown until the map has started
 * (`.mapfallback`; map-core marks it `.maplive`, which hides it). An area
 * list (sites and colony centres only: an area's own centre is never chosen
 * from the areas) and typed coordinates, open here. Both post to the same
 * pick address as the map.
 */
function noMapPath(o: { pickAction: string; carry?: Record<string, string>; areas: boolean; lang?: string }): string {
  const { w } = wordsIn(o.lang);
  const carried = Object.entries(o.carry ?? {})
    .map(([k, v]) => hidden(k, v))
    .join("");
  const areaList = o.areas
    ? `<form method="post" action="${esc(o.pickAction)}" class="areapick">` +
      carried +
      `<label class="label" for="pick-area">${w("pick.areaLabel")}</label>` +
      `<p class="hint">${w("pick.areaHint")}</p>` +
      `<select class="text" id="pick-area" name="area" required>` +
      [...currentAreas()]
        .sort((a, b) => a.name.localeCompare(b.name, "en"))
        .map((a) => `<option value="${esc(a.key)}">${esc(a.name)}</option>`)
        .join("") +
      `</select>` +
      `<button type="submit">${w("pick.useArea")}</button></form>`
    : "";
  // The typed fallback (SYC-517, 517-B): for numbers from a vet or a GPS.
  const typed =
    `<details class="typedfold" open><summary>${w("new.typedTitle")}</summary>` +
    `<form method="post" action="${esc(o.pickAction)}" class="typedpos">` +
    carried +
    `<p class="warn">${w("new.typedWarning")}</p>` +
    `<label class="label" for="typed-lat">${w("new.lat")}</label>` +
    `<input class="text" id="typed-lat" name="lat" type="text" inputmode="decimal" required autocomplete="off">` +
    `<label class="label" for="typed-lng">${w("new.lng")}</label>` +
    `<input class="text" id="typed-lng" name="lng" type="text" inputmode="decimal" required autocomplete="off">` +
    `<button type="submit">${w("new.typedButton")}</button></form></details>`;
  return `<div class="mapfallback"><p>${w(o.areas ? "pick.noMap" : "pick.noMapTyped")}</p>${areaList}${typed}</div>`;
}

/**
 * A place page: the map with a fixed pin in the middle (drag the map under
 * it), its "Use this spot" button revealed by the script once the map has
 * started; and the no-map path (an area, typed numbers). All post to the
 * same address, which reads whichever came. Positions travel only in POST
 * bodies (K13).
 *
 * `map: false` (a 400 re-render, which keeps the strict header) draws only
 * the no-map path, so the page holds no script.
 */
export function renderPicker(o: {
  personName: string;
  title: string;
  intro: string;
  back: { href: string; label: string };
  /** Where the map opens, and how close (app zoom). */
  centre: Position;
  zoom: number;
  markers?: MapMarker[];
  /** The pick route: the map's form, the area list and the typed numbers all post here. */
  pickAction: string;
  /** Hidden fields every form on the page carries (the move page's `updated_at`). */
  carry?: Record<string, string>;
  note?: string;
  legend?: string;
  below?: string;
  /** Offer the area list (feeding sites and colony centres; never an area's own centre). */
  areas: boolean;
  /** Draw the map (its scripts, so the wider header). Default true. */
  map?: boolean;
  /** Which menu item is lit; the sites by default (the colony and area pickers say their own). */
  active?: NavKey | null;
} & FormViewer): string {
  // A cat guardian reaches the add and move pages for her own sites (SYC-209
  // PR 4.2), so they are drawn in her language with her menu.
  const { w } = wordsIn(o.lang);
  const withMap = o.map !== false;
  const mapForm = withMap
    ? `<form method="post" action="${esc(o.pickAction)}" id="${PICK_FORM_ID}" class="pickform">` +
      Object.entries(o.carry ?? {})
        .map(([k, v]) => hidden(k, v))
        .join("") +
      `<p class="hint" data-mapon hidden>${w("pick.dragHint")}</p>` +
      renderMap({ mode: "place", lang: o.lang, formId: PICK_FORM_ID, centre: o.centre, zoom: o.zoom, markers: o.markers }) +
      `<input type="hidden" name="lat" value=""><input type="hidden" name="lng" value="">` +
      `<div class="actions"><button type="submit" class="save" data-mapon hidden>${w("map.useSpot")}</button></div>` +
      `</form>`
    : "";
  return renderPage({
    title: o.title,
    active: o.active === undefined ? "sites" : o.active,
    nav: o.island === false ? "guardian" : undefined,
    lang: o.lang,
    personName: o.personName,
    ...(withMap ? mapPageAssets() : {}),
    beforeTitle: `<p class="back"><a href="${esc(o.back.href)}">${esc(o.back.label)}</a></p>`,
    body:
      `<p>${esc(o.intro)}</p>` +
      (o.note ? `<p class="warn">${esc(o.note)}</p>` : "") +
      mapForm +
      (o.legend ? `<p class="hint">${esc(o.legend)}</p>` : "") +
      noMapPath({ pickAction: o.pickAction, carry: o.carry, areas: o.areas, lang: o.lang }) +
      mapPrivacyNote(o.lang) +
      (o.below ?? ""),
  });
}

// ── The confirmation page ──────────────────────────────────────────────────

/** The id of a confirmation page's one form: its details and its small map's lat/lng. */
export const DETAILS_FORM_ID = "detailsform";

/**
 * A confirmation page's small place map, inside the details form (SYC-705
 * Task 2b.7; closes SYC-355): dragging the map moves the pin and rewrites the
 * form's own hidden lat/lng, so nothing typed is lost. The spot is also said
 * in words on the page, which is complete with no script. Trusted HTML.
 */
export function confirmMap(o: {
  spot: Position;
  zoom: number;
  markers?: MapMarker[];
  approximate?: boolean;
  lang?: string;
}): string {
  const { w } = wordsIn(o.lang);
  return (
    renderMap({ mode: "place", lang: o.lang, formId: DETAILS_FORM_ID, centre: o.spot, zoom: o.zoom, markers: o.markers }) +
    `<p class="hint" data-mapon hidden>${w("confirm.drag")}</p>` +
    hidden("lat", String(o.spot.lat)) +
    hidden("lng", String(o.spot.lng)) +
    (o.approximate ? hidden("approximate", "1") : "")
  );
}

/** How close a confirmation's map opens: the street, or the area for an area's centre. */
export const confirmZoom = (approximate: boolean) => (approximate ? 15 : CONFIRM_ZOOM);

/** What the add form held at the previous step (all strings; empty if nothing). */
export interface AddCarry {
  name: string;
  colonyId: string;
  directions: string;
  notes: string;
}

/** The picked spot, said in words: where it is, and that an area's centre is rough. Trusted HTML. */
function spotLine(o: { spot: Position; approximate: boolean; island?: boolean; lang?: string }, label: "confirm.spot" | "move.new"): string {
  const { w } = wordsIn(o.lang);
  return (
    `<p class="tapped">${w(label)}: <strong>${spotText(o.spot, o.island === true)}</strong></p>` +
    (o.approximate ? `<p class="notice">${w("pick.areaHint")}</p>` : "")
  );
}

/** After a pick on /sites/new: the spot, a small map around it inside the form, and the form. */
export function renderAddConfirm(o: {
  personName: string;
  spot: Position;
  approximate: boolean;
  colonies: Array<{ id: number; name: string }>;
  carry?: AddCarry;
} & FormViewer): string {
  const { t, w } = wordsIn(o.lang);
  const c0: AddCarry = o.carry ?? { name: "", colonyId: "", directions: "", notes: "" };
  // A cat guardian's site always goes in one of her colonies (spec §7.3,
  // SYC-209 PR 4.2), so she has no "no colony" choice; the server insists too.
  const options =
    (o.island === false ? "" : `<option value="">${w("confirm.noColony")}</option>`) +
    o.colonies
      .map((c) => `<option value="${c.id}"${String(c.id) === c0.colonyId ? " selected" : ""}>${esc(c.name)}</option>`)
      .join("");
  return renderPage({
    title: t("confirm.title"),
    active: "sites",
    nav: o.island === false ? "guardian" : undefined,
    lang: o.lang,
    personName: o.personName,
    ...mapPageAssets(),
    beforeTitle: `<p class="back"><a href="${esc(NEW_PATH)}">${w("confirm.again")}</a></p>`,
    body:
      spotLine(o, "confirm.spot") +
      `<p class="hint">${w("new.private")}</p>` +
      `<form method="post" action="${esc(SITES_PATH)}" id="${DETAILS_FORM_ID}">` +
      confirmMap({ spot: o.spot, zoom: confirmZoom(o.approximate), approximate: o.approximate, lang: o.lang }) +
      `<label class="label" for="new-name">${w("confirm.name")}</label>` +
      `<p class="hint">${w("confirm.nameHint")}</p>` +
      `<input class="text" id="new-name" name="name" type="text" required maxlength="${SITE_NAME_MAX}" value="${esc(c0.name)}" autocomplete="off">` +
      `<label class="label" for="new-colony">${w(o.island === false ? "confirm.colonyOwn" : "confirm.colony")}</label>` +
      `<select class="text" id="new-colony" name="colonyId"${o.island === false ? " required" : ""}>${options}</select>` +
      `<label class="label" for="new-directions">${w("confirm.directions")}</label>` +
      `<p class="hint">${w("confirm.directionsHint")}</p>` +
      `<input class="text" id="new-directions" name="directions" type="text" maxlength="${SITE_DIRECTIONS_MAX}" value="${esc(c0.directions)}" autocomplete="off">` +
      `<label class="label" for="new-notes">${w(o.island === false ? "confirm.notesOwn" : "confirm.notes")}</label>` +
      `<textarea id="new-notes" name="notes" maxlength="${SITE_NOTES_MAX}">${esc(c0.notes)}</textarea>` +
      `<p class="hint">${w("notes.hint")}</p>` +
      `<div class="actions"><button type="submit" class="save">${w("confirm.save")}</button></div>` +
      `</form>`,
  });
}

/** After a pick on a site's move page: old and new spot, and the required reason, in one form with the map. */
export function renderMoveConfirm(o: {
  personName: string;
  site: { id: number; name: string; lat: number; lng: number; stamp: string; isPublic: boolean };
  spot: Position;
  approximate: boolean;
  reason?: string;
  /** Island-wide viewer (`isIslandWide`): only then "Open map" (D9). */
  island?: boolean;
  /** A cat guardian moves her own sites (SYC-209 PR 4.2): her language. */
  lang?: string;
}): string {
  const { t, w } = wordsIn(o.lang);
  const base = `${SITES_PATH}/${o.site.id}`;
  return renderPage({
    title: `${t("move.title")} ${o.site.name}`,
    active: "sites",
    nav: o.island === false ? "guardian" : undefined,
    lang: o.lang,
    personName: o.personName,
    ...mapPageAssets(),
    beforeTitle: `<p class="back"><a href="${esc(base)}/move">${w("confirm.again")}</a></p>`,
    body:
      `<p class="tapped">${w("move.now")}: ${spotText(o.site, o.island === true)}</p>` +
      spotLine(o, "move.new") +
      (o.site.isPublic ? `<p class="notice">${w("move.publicWarning")}</p>` : "") +
      `<form method="post" action="${esc(base)}/move" id="${DETAILS_FORM_ID}">` +
      stampField(o.site.stamp) +
      confirmMap({
        spot: o.spot,
        zoom: confirmZoom(o.approximate),
        approximate: o.approximate,
        markers: [{ lat: o.site.lat, lng: o.site.lng, label: t("move.now"), look: "retired" }],
        lang: o.lang,
      }) +
      `<p class="hint">${w("move.legend")}</p>` +
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
