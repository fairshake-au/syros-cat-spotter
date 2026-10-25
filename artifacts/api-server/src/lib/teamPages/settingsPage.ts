import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
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
  { id: "areas", name: "Areas", note: "The place names used in labels and filters.", href: AREAS_PATH },
  { id: "vet-settings", name: "Vet settings", note: "The standard sterilisation price.", href: VET_SETTINGS_PATH },
  { id: "app-switches", name: "App switches", note: "The feed button and the starter facts.", href: APP_SWITCHES_PATH },
];

// The whole card is the link (SYC-698): a tap on the note opens the page too.
const CSS =
  "<style>.settings{list-style:none;margin:0;padding:0}" +
  ".settings li{margin:0 0 12px}" +
  ".settings a{display:block;min-height:44px;background:#fff;border:1px solid #d9d5ca;border-radius:12px;padding:12px 16px;text-decoration:none;color:#1d1d1b}" +
  ".settings a:hover{border-color:#0b5c6b}" +
  ".settings .name{display:block;font-weight:700;font-size:18px;color:#0b5c6b;text-decoration:underline}" +
  ".settings .note{display:block;margin-top:4px;font-size:14px;color:#55524a}</style>";

export function renderSettingsPage(o: { personName: string; entries?: readonly SettingsEntry[] }): string {
  const entries = o.entries ?? SETTINGS_ENTRIES;
  return renderPage({
    title: "Settings",
    active: "settings",
    personName: o.personName,
    body:
      CSS +
      '<ul class="settings">' +
      entries
        .map((e) => `<li id="${esc(e.id)}-link"><a href="${esc(e.href)}"><span class="name">${esc(e.name)}</span><span class="note">${esc(e.note)}</span></a></li>`)
        .join("") +
      "</ul>",
  });
}
