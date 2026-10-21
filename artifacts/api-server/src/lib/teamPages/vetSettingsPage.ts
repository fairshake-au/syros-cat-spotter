import type { PriceChange } from "../vetSettings";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";

// The Vet settings page (SYC-396 PR 3.1b; dashboard §8.4, §10.3): the
// standard sterilisation price, a form to change it, and the history of every
// change with who made it. Team-only (`edit_vet_settings`). The vet list
// isn't here: it stays as team-access §5.7 sets it.

export const VET_SETTINGS_PATH = "/api/team/vet-settings";

export const VET_SETTINGS_DONE: Record<string, string> = {
  changed: "The standard price was changed.",
};

export interface VetSettingsPageOptions {
  personName: string;
  /** The standard price now, in whole euros. */
  priceEur: number;
  history: readonly PriceChange[];
  /** The form sent back with a problem: what was typed, and why. */
  again?: { typed: string; message: string };
  /** A change that just went through. */
  done?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "18 Oct 2026", in Athens. The month by our own list: ICU writes September "Sept". */
export function day(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "Europe/Athens",
  }).formatToParts(d);
  const part = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return `${part("day")} ${MONTHS[part("month") - 1]} ${part("year")}`;
}

const euros = (eur: number | null) => (eur === null ? "a price no longer shown" : `€${eur}`);

function historyList(history: readonly PriceChange[]): string {
  if (history.length === 0) return '<p class="hint">No changes yet.</p>';
  return (
    '<ol class="history">' +
    history
      .map(
        (c) =>
          `<li class="meta"><time datetime="${esc(c.at.toISOString())}">${esc(day(c.at))}</time> · ` +
          `${esc(c.who ?? "Cat Spotters")} · ${esc(euros(c.before))} → ${esc(euros(c.after))}</li>`,
      )
      .join("") +
    "</ol>"
  );
}

function priceForm(o: VetSettingsPageOptions): string {
  const again = o.again;
  return (
    `<form method="post" action="${VET_SETTINGS_PATH}">` +
    '<label class="label" for="price">New standard price, in euros</label>' +
    '<p class="hint">A whole number from 1 to 500.</p>' +
    (again ? `<p class="warn" role="alert" id="price-err">${esc(again.message)}</p>` : "") +
    `<input type="text" class="text" id="price" name="eur" value="${esc(again ? again.typed : String(o.priceEur))}"` +
    ' inputmode="numeric" autocomplete="off"' +
    (again ? ' aria-invalid="true" aria-describedby="price-err"' : "") +
    ">" +
    '<button type="submit" class="primary">Change the price</button></form>'
  );
}

export function renderVetSettingsPage(o: VetSettingsPageOptions): string {
  const done = o.done !== undefined ? VET_SETTINGS_DONE[o.done] : undefined;
  return renderPage({
    title: "Vet settings",
    active: null,
    personName: o.personName,
    body:
      (done ? `<p class="notice" role="status">${esc(done)}</p>` : "") +
      "<h2>Standard sterilisation price</h2>" +
      `<p class="hbig"><strong>€${o.priceEur}</strong> per cat</p>` +
      '<p class="hint">The trapping planner\'s estimate uses it, and a vet visit with Sterilised ticked starts with it as the cost. ' +
      "The cost of each visit can still be changed. A new price is used everywhere within a minute.</p>" +
      priceForm(o) +
      '<h2 id="history">History</h2>' +
      historyList(o.history),
  });
}
