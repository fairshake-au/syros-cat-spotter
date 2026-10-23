import { escapeHtml as esc } from "./escape";

/** Home: the team's front page (not the Queue, which is `/api/team`). */
export const HOME_PATH = "/api/team/home";

/**
 * The one kind of back link (spec §2.5): "← " and the name of the page you'll
 * land on. `label` is plain text and is escaped here.
 */
export function backLink(href: string, label: string): string {
  return `<p class="back"><a href="${esc(href)}">← ${esc(label)}</a></p>`;
}
