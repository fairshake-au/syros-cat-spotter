import { escapeHtml as esc } from "./escape";
import { backLink, SETTINGS_PATH } from "./backLink";
import { renderPage } from "./layout";
import { pageIntro, howFold, whatHappens } from "./help";
import { FACT_WORDS } from "./appSwitchFacts";
import { DEFAULT_DONATE_ADDRESS, EXPECTED_DONATE_HOST } from "../appSwitches";

// The App switches page (SYC-383): the "Help feed a cat" button and the
// starter facts, which the team can switch without a new app. Team-only
// (`edit_app_switches`). No history: Samuel chose that on 24 Oct 2026.

export const APP_SWITCHES_PATH = "/api/team/app-switches";

export const APP_SWITCHES_DONE: Record<string, string> = {
  on: "The button is on, at the address below.",
  off: "The button is off. Visitors see the words without a button.",
  shown: "That fact is now shown in the app.",
  hidden: "That fact is now hidden in the app.",
};

export interface AppSwitchesPageOptions {
  personName: string;
  /** The donation address now, or null when the button is off. */
  donateUrl: string | null;
  /** Fact ids that are hidden now. */
  hidden: ReadonlySet<string>;
  /** The address form sent back with a problem: what was typed, and why. */
  again?: { typed: string; message: string };
  /** A change that just went through. */
  done?: string;
}

/** The host a visitor is told the button opens, as the app words it. */
const hostOf = (url: string) => new URL(url).host;

function donationSection(o: AppSwitchesPageOptions): string {
  const on = o.donateUrl !== null;
  const typed = o.again ? o.again.typed : (o.donateUrl ?? DEFAULT_DONATE_ADDRESS);
  const shownHost = on ? hostOf(o.donateUrl!) : null;
  return (
    "<h2>Help feed a cat button</h2>" +
    (on
      ? `<p class="hbig"><strong>On</strong></p>` +
        '<p class="hint">Visitors see a "Help feed a cat" button and the figures. Under the button the app says:</p>' +
        `<p><strong>Opens ${esc(shownHost!)} in your browser</strong></p>` +
        (shownHost !== EXPECTED_DONATE_HOST && shownHost !== `www.${EXPECTED_DONATE_HOST}`
          ? `<p class="warn" role="status">This isn't ${esc(EXPECTED_DONATE_HOST)}. Check it is the page you mean.</p>`
          : "")
      : '<p class="hbig"><strong>Off</strong></p>' +
        '<p class="hint">Visitors see the words about feeding, with no button and no figures. To turn it on again, check the address below and press the button.</p>') +
    `<form method="post" action="${APP_SWITCHES_PATH}/donation">` +
    '<label class="label" for="addr">Donation page address</label>' +
    '<p class="hint">It must start with https://</p>' +
    (o.again ? `<p class="warn" role="alert" id="addr-err">${esc(o.again.message)}</p>` : "") +
    `<input type="text" class="text" id="addr" name="address" value="${esc(typed)}"` +
    ' inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"' +
    (o.again ? ' aria-invalid="true" aria-describedby="addr-err"' : "") +
    ">" +
    `<button type="submit" class="primary" name="do" value="on">${on ? "Save the address" : "Turn the button on"}</button>` +
    (on ? ' <button type="submit" class="secondary" name="do" value="off">Turn the button off</button>' : "") +
    "</form>"
  );
}

function factRow(id: string, text: string, n: number, hidden: boolean): string {
  return (
    `<li id="${esc(id)}"><p><strong>${n}.</strong> ${esc(text)}</p>` +
    `<form method="post" action="${APP_SWITCHES_PATH}/fact"><input type="hidden" name="id" value="${esc(id)}">` +
    `<input type="hidden" name="shown" value="${hidden ? "1" : "0"}">` +
    `<p class="meta">${hidden ? "Hidden in the app" : "Shown in the app"} ` +
    `<button type="submit" class="secondary">${hidden ? "Show it" : "Hide it"}</button></p></form></li>`
  );
}

export function renderAppSwitchesPage(o: AppSwitchesPageOptions): string {
  const done = o.done !== undefined ? APP_SWITCHES_DONE[o.done] : undefined;
  const shownCount = FACT_WORDS.filter((f) => !o.hidden.has(f.id)).length;
  return renderPage({
    title: "App switches",
    active: "settings",
    personName: o.personName,
    beforeTitle: backLink(SETTINGS_PATH, "Settings"),
    body:
      (done ? `<p class="notice" role="status">${esc(done)}</p>` : "") +
      pageIntro("Two things the public app shows, which you can change without a new version of the app.") +
      whatHappens("These switches change the public app for everyone, within about a minute. Agree a change with the team first.", { warn: true }) +
      howFold([
        'Help feed a cat button: while a visitor waits for a photo match, the app asks them not to feed the cats. It also shows "€1 feeds a cat for a day. €30 feeds one for a month." Those are the figures. With the button off, visitors see the words with no button and no figures.',
        'Starter facts: short facts about street cats that the app shows while it looks for a match. Hide a fact to stop it appearing.',
        "A change reaches phones within about a minute.",
      ], { words: false }) +
      donationSection(o) +
      `<h2 id="facts">Starter facts</h2><p class="hint">${shownCount} of ${FACT_WORDS.length} shown. These appear while the app looks for a match.</p>` +
      "<ul>" +
      FACT_WORDS.map((f, i) => factRow(f.id, f.text, i + 1, o.hidden.has(f.id))).join("") +
      "</ul>",
  });
}
