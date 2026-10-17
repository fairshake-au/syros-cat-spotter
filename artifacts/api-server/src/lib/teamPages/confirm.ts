import { escapeHtml as esc } from "./escape";
import { renderPage, type NavKey } from "./layout";

// The dashboard's "Are you sure?" page (SYC-362, Decision 1). There are no
// scripts, so it is a second page: the form posts, the route answers with
// this page instead of acting, and Yes posts the same fields again with
// confirm=1. It protects people from slips; it is not a security control
// (the JSON routes act in one step, as before).
//
// Every value is escaped here: the sentences, the button, and every carried
// field, which holds whatever the person typed.

export interface ConfirmPageOptions {
  /** The question, e.g. "Remove Mimi's owner?". */
  title: string;
  /** Plain sentences saying what will happen. */
  lines: string[];
  /** Where Yes posts: the same route the form posted to. */
  action: string;
  /** The form's fields, carried as they were sent. `confirm` is added. */
  fields: Record<string, string | undefined>;
  /** The Yes button's words, e.g. "Yes, remove the owner". */
  yes: string;
  /** Where Cancel goes, and its words. */
  cancelHref: string;
  cancelLabel: string;
  personName: string;
  active: NavKey;
  /** The page's language, and a cat guardian's own menu (SYC-209 PR 4.2: she retires her sites). */
  lang?: string;
  nav?: "guardian";
}

export function renderConfirmPage(o: ConfirmPageOptions): string {
  const hidden = Object.entries(o.fields)
    .filter(([name, value]) => value !== undefined && name !== "confirm")
    .map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value!)}">`)
    .join("");
  return renderPage({
    title: o.title,
    active: o.active,
    nav: o.nav,
    lang: o.lang,
    personName: o.personName,
    body:
      `<ul class="sure">${o.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` +
      `<form method="post" action="${esc(o.action)}" class="sureform">` +
      hidden +
      '<input type="hidden" name="confirm" value="1">' +
      `<button type="submit" class="risky">${esc(o.yes)}</button></form>` +
      `<p><a class="tap" href="${esc(o.cancelHref)}">${esc(o.cancelLabel)}</a></p>`,
  });
}
