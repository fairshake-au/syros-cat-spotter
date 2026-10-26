import { placeLabel } from "../areas/placeLabel";
import { escapeHtml as esc } from "./escape";
import { renderPage, type NavKey } from "./layout";
import type { MapMarker } from "./map";
import { openMapLink } from "./position";
import { smallMap, type FormViewer } from "./siteFormPages";
import { wordsIn } from "./words";
import type { Position } from "../mapTiles/geometry";

// The confirmation page for "tap the map" centres (SYC-517, decision 517-B):
// a colony's centre and an area's centre. The same small map as the site
// pages' confirmation (a tap nudges the pin), then one button that posts the
// centre to the page's existing form route. The place is in words (placeLabel);
// the exact position goes only into hidden fields, never an address, and "Open
// map" is for an island-wide viewer alone (position.ts). Server-drawn, no scripts.

const hidden = (name: string, value: string) =>
  `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;

export function renderCentreConfirm(
  o: {
    personName: string;
    active: NavKey | null;
    /** Page title, plain text. */
    title: string;
    /** "Set the centre here, in {place}?", plain text, already worded. */
    question: (place: string) => string;
    saveLabel: string;
    spot: Position;
    zoom: number;
    /** The centre as it is now, if there is one. */
    now?: Position | null;
    /**
     * Say where the centre is now in words, under the question (default yes).
     * An area's own page says no: placeLabel of an area's centre names that
     * area itself, or a neighbour, which helps nobody. The map still shows it.
     */
    nowInWords?: boolean;
    nowLabel: string;
    newLabel: string;
    /** Where a nudge tap posts back to, and what that post carries. */
    tapAction: string;
    carry?: Record<string, string>;
    /** The existing route that saves it, and the fields it wants besides lat and lng. */
    saveAction: string;
    saveFields?: Record<string, string>;
    back: { href: string; label: string };
    /** One plain line saying what saving the centre changes (SYC-739), already worded. */
    help?: string;
  } & FormViewer,
): string {
  const { w } = wordsIn(o.lang);
  const markers: MapMarker[] = [
    ...(o.now ? [{ lat: o.now.lat, lng: o.now.lng, label: o.nowLabel, look: "retired" as const }] : []),
    { ...o.spot, label: o.newLabel, look: "private" as const },
  ];
  const link = o.island === true;
  return renderPage({
    title: o.title,
    active: o.active,
    nav: o.island === false ? "guardian" : undefined,
    lang: o.lang,
    personName: o.personName,
    mainClass: "mappage",
    beforeTitle: `<p class="back"><a href="${esc(o.back.href)}">${esc(o.back.label)}</a></p>`,
    body:
      smallMap(o.spot, o.zoom, markers, o.tapAction, { ...(o.carry ?? {}) }, o.lang) +
      `<p class="hint">${w("confirm.nudge")}</p>` +
      `<p class="tapped">${esc(o.question(placeLabel(o.spot)))}${link ? ` &middot; ${openMapLink(o.spot.lat, o.spot.lng)}` : ""}</p>` +
      (o.now && o.nowInWords !== false ? `<p class="hint">${esc(o.nowLabel)}: ${esc(placeLabel(o.now))}</p>` : "") +
      (o.help ? `<p class="what">${esc(o.help)}</p>` : "") +
      `<form method="post" action="${esc(o.saveAction)}">` +
      Object.entries(o.saveFields ?? {})
        .map(([k, v]) => hidden(k, v))
        .join("") +
      hidden("lat", String(o.spot.lat)) +
      hidden("lng", String(o.spot.lng)) +
      `<div class="actions"><button type="submit" class="save">${esc(o.saveLabel)}</button></div>` +
      `</form>`,
  });
}
