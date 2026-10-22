import type { LikelyCat } from "../likelyReview";
import { keptLine, type KeptFields } from "./signedOutPage";
import { syrNumber } from "../teamCatView";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";

// The Probably sterilised list (SYC-43 part 2 plan, PR 4; spec §4.5 point 3).
// Server-drawn, no scripts. Two buttons per cat: "Looks right" (Decision 6)
// and "That's not a clip" (PR 8's supersede). Every value goes through
// escapeHtml; photos come only from the team photo route.

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Athens",
  });

const SIDE: Record<string, string> = {
  left: "left ear",
  right: "right ear",
  unsure: "ear not sure",
};

const DONE: Record<string, string> = {
  looks_right: "Saved. The cat stays Probably sterilised and is off this list.",
  not_clipped: "Saved. The cat now reads Not known yet, and is off this list.",
  already: "Someone already dealt with that cat. The list below is up to date.",
};

/** The text the reason box starts with. The person can change it. */
export const NOT_A_CLIP_REASON = "Checked the photo: not a clip";

function card(c: LikelyCat, kept?: { formKey: string; fields: KeptFields }): string {
  const why = kept?.formKey === `wrong:${c.reviewObservationId}` ? kept.fields["reason"] : undefined;
  const photos = c.evidence.filter((e) => e.photoUrl);
  const gallery =
    photos.length === 0
      ? '<div class="nophoto">No photo found for this answer</div>'
      : '<div class="evidence">' +
        photos
          .map(
            (e) =>
              `<figure><a href="${esc(e.photoUrl!)}"><img src="${esc(e.photoUrl!)}" alt="${esc(`Photo of ${c.name}, ${day(e.observedAt)}`)}" loading="lazy"></a>` +
              `<figcaption>${esc(day(e.observedAt))}${e.side && SIDE[e.side] ? ` · ${esc(SIDE[e.side]!)}` : ""}` +
              `${e.matchedByHand ? " · <strong>picked by hand</strong>" : ""}</figcaption></figure>`,
          )
          .join("") +
        "</div>";
  const said = c.evidence.length === 1 ? "1 spotter says" : `${c.evidence.length} answers say`;
  return (
    `<article class="report likely" id="c-${c.catId}">` +
    `<div class="head"><a href="/api/team/cats/${c.catId}"><strong>${esc(c.name)}</strong></a> ` +
    `<span class="syr">${esc(syrNumber(c.catId))}</span>` +
    (c.matchedByHand ? ' <span class="tag kittens">Picked by hand</span>' : "") +
    "</div>" +
    `<p class="meta">${esc(said)} the ear tip is clipped. Newest ${esc(day(c.sterilisedAsOf))}.</p>` +
    gallery +
    '<div class="actions likelyactions">' +
    `<form method="post" action="/api/team/likely/${c.reviewObservationId}/looks-right">` +
    '<button type="submit" class="save">Looks right</button></form>' +
    `<form method="post" action="/api/team/statements/${c.reviewObservationId}/wrong">` +
    '<input type="hidden" name="choice" value="not_clipped">' +
    '<input type="hidden" name="back" value="likely">' +
    `<label class="label" for="why-${c.catId}">Why it isn't a clip</label>` +
    `<input class="text" id="why-${c.catId}" name="reason" value="${esc(why ?? NOT_A_CLIP_REASON)}" required maxlength="500">` +
    "<button type=\"submit\">That's not a clip</button></form>" +
    "</div></article>"
  );
}

export function renderLikelyPage(
  cats: LikelyCat[],
  personName: string,
  done?: string,
  /** "That's not a clip" filled in again after signing in (SYC-516 C3). */
  kept?: { formKey: string; fields: KeptFields },
): string {
  const notice =
    (kept ? keptLine() : "") +
    (done && Object.hasOwn(DONE, done) ? `<p class="notice" role="status">${esc(DONE[done]!)}</p>` : "");
  const intro =
    "<p>These cats show as <strong>Probably sterilised</strong> only because a spotter said they saw a clipped ear. Look at each photo.</p>" +
    '<ul class="hintlist">' +
    "<li><strong>Looks right</strong>: the cat stays Probably sterilised, and leaves this list until a spotter sends a newer answer.</li>" +
    "<li><strong>That's not a clip</strong>: the cat goes back to Not known yet.</li>" +
    "</ul>" +
    '<p class="hint">Neither makes it Sterilised. Only Syros Cats or a vet knowing does that, on the cat\'s own page.</p>';
  const body =
    cats.length === 0
      ? '<p class="empty">Nothing to check. Every Probably sterilised cat has been looked at.</p>'
      : `<h2>${cats.length === 1 ? "1 cat" : `${cats.length} cats`} to check</h2>` + cats.map((c) => card(c, kept)).join("");
  return renderPage({
    // SYC-365: the list is a job, so it's named for what the team does.
    title: "Ear clips to check",
    active: "likely",
    personName,
    beforeTitle: '<p class="back"><a href="/api/team">&larr; Back to Home</a></p>',
    body: notice + intro + body,
  });
}
