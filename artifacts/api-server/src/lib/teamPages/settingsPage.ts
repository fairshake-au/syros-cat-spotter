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

const CSS =
  "<style>.settings{list-style:none;margin:0;padding:0}" +
  ".settings li{background:#fff;border:1px solid #d9d5ca;border-radius:12px;margin:0 0 12px;padding:4px 16px 12px}" +
  ".settings a{display:flex;align-items:center;min-height:44px;font-weight:700;font-size:18px}</style>";

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
        .map((e) => `<li id="${esc(e.id)}-link"><a href="${esc(e.href)}">${esc(e.name)}</a><p class="hint">${esc(e.note)}</p></li>`)
        .join("") +
      "</ul>",
  });
}
