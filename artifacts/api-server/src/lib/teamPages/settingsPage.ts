import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { pageIntro } from "./help";
import { AREAS_PATH } from "./areasPage";
import { VET_SETTINGS_PATH } from "./vetSettingsPage";
import { APP_SWITCHES_PATH } from "./appSwitchesPage";

// Settings (SYC-694): the team menu's way in to the pages that set how the
// app and dashboard behave. Each keeps its own screen; this lists them, in
// one place, instead of the links that sat at the foot of Home.

export interface SettingsEntry {
  id: "areas" | "vet-settings" | "app-switches";
  name: string;
  /** What it controls, in a line. */
  note: string;
  href: string;
}

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  { id: "areas", name: "Areas", note: "The place names shown on cats and in the Cats list filters.", href: AREAS_PATH },
  { id: "vet-settings", name: "Vet settings", note: "The standard price for sterilising one cat.", href: VET_SETTINGS_PATH },
  { id: "app-switches", name: "App switches", note: "The public app's Help feed a cat button, the extra photo boxes on New spot, and the starter facts spotters see. Changes are live for everyone.", href: APP_SWITCHES_PATH },
];

// The whole card is the link (SYC-698): a tap on the note opens the page too.
const CSS =
  "<style>.settings{list-style:none;margin:0;padding:0}" +
  ".settings li{margin:0 0 12px}" +
  ".settings a{display:block;min-height:44px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;text-decoration:none;color:var(--ink)}" +
  ".settings a:hover{border-color:var(--accent)}" +
  ".settings .name{display:block;font-weight:700;font-size:18px;color:var(--accent-text);text-decoration:underline}" +
  ".settings .note{display:block;margin-top:4px;font-size:14px;color:var(--muted)}</style>";

export function renderSettingsPage(o: { personName: string; entries?: readonly SettingsEntry[] }): string {
  const entries = o.entries ?? SETTINGS_ENTRIES;
  return renderPage({
    title: "Settings",
    active: "settings",
    personName: o.personName,
    body:
      CSS +
      pageIntro("How the app and dashboard behave. Each page says what it changes.") +
      '<ul class="settings">' +
      entries
        .map((e) => `<li id="${esc(e.id)}-link"><a href="${esc(e.href)}"><span class="name">${esc(e.name)}</span><span class="note">${esc(e.note)}</span></a></li>`)
        .join("") +
      "</ul>",
  });
}
