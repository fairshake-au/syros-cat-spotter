import type { TeamCatView } from "../teamCatView";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";

// "This cat has died" (SYC-513, docs/specs/mark-a-cat-as-died.md §4): one
// short page, server-drawn, no scripts. It IS the confirmation: saving records
// the death and nothing else, and never touches the owner.

/** Today on Syros, for the date box's max. */
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Athens" });

export interface DiedPageOptions {
  /** One plain sentence saying why the last save didn't happen. */
  problem?: string;
  /** What was typed, kept when the page comes back. */
  fields?: { reason?: string; date?: string };
}

export function renderDiedPage(view: TeamCatView, personName: string, opts: DiedPageOptions = {}): string {
  const { cat } = view;
  const name = cat.name;
  const hasOwner = view.owner.has || view.owner.orphanedHome;
  const photo = cat.mainPhotoUrl
    ? `<img class="photo catmain diedphoto" src="${esc(cat.mainPhotoUrl)}" alt="${esc(`Photo of ${name}`)}">`
    : '<div class="nophoto">No photo</div>';
  const happens = [
    `The public will see “No longer with us” on ${name}'s page.`,
    `Nobody will get alerts or news about ${name} any more.`,
    `${name} can't be claimed, and spotters can't pick ${name} by hand: the cat is greyed out in the list.`,
    `If someone spots ${name} after the date below, ${name} will show as alive again, and you'll see that on this page. That includes a photo taken earlier but only sent once the spotter had signal.`,
    ...(hasOwner
      ? [
          `${name}'s owner stays. They aren't told, and they'll see “No longer with us” the next time they open the page.`,
        ]
      : []),
  ];
  const f = opts.fields ?? {};
  const base = `/api/team/cats/${cat.id}`;
  return renderPage({
    title: `${name} has died`,
    active: "cats",
    personName,
    body:
      photo +
      (opts.problem ? `<p class="notice" role="alert">${esc(opts.problem)} Nothing was changed.</p>` : "") +
      `<p>What will happen:</p><ul class="happens">${happens.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` +
      `<form method="post" action="${base}/died" class="diedpage">` +
      `<fieldset><legend class="label">About ${esc(name)}</legend>` +
      '<label class="label" for="died-date">Date it happened <span class="hint">(leave blank if you\'re not sure)</span></label>' +
      `<input id="died-date" name="date" type="date" max="${today()}" value="${esc(f.date ?? "")}">` +
      '<label class="label" for="died-why">How do you know?</label>' +
      '<p class="hint" id="died-why-hint">For example: found by the harbour; Maria, her cat guardian, told us; the vet let us know.</p>' +
      `<input class="text" id="died-why" name="reason" required maxlength="500" autocomplete="off" aria-describedby="died-why-hint" value="${esc(f.reason ?? "")}">` +
      "</fieldset>" +
      `<button type="submit" class="primary wide">${esc(`Save: ${name} has died`)}</button></form>` +
      `<p><a class="tap" href="${base}">${esc(`Back to ${name} (nothing changed)`)}</a></p>`,
  });
}
