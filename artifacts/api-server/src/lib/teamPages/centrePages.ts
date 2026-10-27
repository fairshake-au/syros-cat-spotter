import { placeLabel } from "../areas/placeLabel";
import { escapeHtml as esc } from "./escape";
import { renderPage, type NavKey } from "./layout";
import type { MapMarker } from "./map";
import { openMapLink } from "./position";
import { confirmMap, DETAILS_FORM_ID, spotWords, type FormViewer } from "./siteFormPages";
import { mapPageAssets } from "./map";
import { wordsIn } from "./words";
import type { Position } from "../mapTiles/geometry";

// The confirmation page for centres set on a map (SYC-517, decision 517-B):
// a colony's centre and an area's centre. The same small place map as the
// site pages' confirmation (SYC-705 Task 2b.7: drag the map to move the pin),
// inside the one form whose button posts the centre to the page's existing
// form route. The place is in words (placeLabel);
// the exact position goes only into hidden fields, never an address, and "Open
// map" is for an island-wide viewer alone (position.ts).

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
    /** Picked from the list of areas (its middle): say it is only roughly right. */
    approximate?: boolean;
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
    ...mapPageAssets(),
    beforeTitle: `<p class="back"><a href="${esc(o.back.href)}">${esc(o.back.label)}</a></p>`,
    body:
      spotWords(
        `<p class="tapped">${esc(o.question(placeLabel(o.spot)))}${link ? ` &middot; ${openMapLink(o.spot.lat, o.spot.lng)}` : ""}</p>` +
          (o.approximate ? `<p class="notice">${w("centre.approximate")}</p>` : ""),
        o.lang,
      ) +
      (o.now && o.nowInWords !== false ? `<p class="hint">${esc(o.nowLabel)}: ${esc(placeLabel(o.now))}</p>` : "") +
      (o.help ? `<p class="what">${esc(o.help)}</p>` : "") +
      `<form method="post" action="${esc(o.saveAction)}" id="${DETAILS_FORM_ID}">` +
      Object.entries(o.saveFields ?? {})
        .map(([k, v]) => hidden(k, v))
        .join("") +
      confirmMap({ spot: o.spot, zoom: o.zoom, markers, lang: o.lang }) +
      `<div class="actions"><button type="submit" class="save">${esc(o.saveLabel)}</button></div>` +
      `</form>`,
  });
}
