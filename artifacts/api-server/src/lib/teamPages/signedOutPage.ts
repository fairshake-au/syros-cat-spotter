import { SIGN_IN_PAGE } from "../teamAuth/config";
import { escapeHtml } from "./escape";
import { renderPage } from "./layout";
import { LIVE_LANGUAGES, pageLanguage, tr, type Language, type StringKey } from "./strings";

// SYC-516 C2/C3 (spec 3.2): the page a dashboard form post gets when its
// sign-in has lapsed. Dashboard look, no menu, no name, no meta refresh, no
// script: one "Sign in again" link. Either we kept what they typed (`kept`),
// or, when we can't tell whose it was, it is shown back read-only to copy.

/**
 * The line at the top of a page whose form was filled in again after signing
 * in (SYC-516 C3): "You were signed out before this was saved. We kept what
 * you typed. Check it and press Save." In the viewer's language.
 */
export function keptLine(lang?: string | null, live: readonly Language[] = LIVE_LANGUAGES): string {
  return `<p class="notice" role="status">${escapeHtml(tr(pageLanguage(lang, live), "kept.line", undefined, live))}</p>`;
}

/** What was kept for one form on a landing page (SYC-516 C3): field name to text. */
export type KeptFields = Readonly<Record<string, string>>;

/** One typed box shown back to copy: its field name and what was in it. */
export interface CopyBack {
  field: string;
  value: string;
}

const FIELD_LABEL: Record<string, StringKey> = {
  note: "signedOut.field.note",
  name: "signedOut.field.name",
  guardianName: "signedOut.field.guardianName",
  notes: "signedOut.field.notes",
  directions: "signedOut.field.directions",
  reason: "signedOut.field.reason",
};

export function renderSignedOutPage(opts: {
  kept: boolean;
  /** Nothing typed was kept, but signing in again comes back to this page. */
  comeBack?: boolean;
  copyBack?: readonly CopyBack[];
  lang?: string | null;
  liveLanguages?: readonly Language[];
}): string {
  const live = opts.liveLanguages ?? LIVE_LANGUAGES;
  const lang = pageLanguage(opts.lang, live);
  const t = (key: StringKey) => escapeHtml(tr(lang, key, undefined, live));
  const copy = opts.kept ? [] : (opts.copyBack ?? []).filter((c) => c.value.trim() !== "");
  const boxes = copy
    .map((c, i) => {
      const key = Object.hasOwn(FIELD_LABEL, c.field) ? FIELD_LABEL[c.field]! : "signedOut.field.notes";
      return (
        `<p><label for="typed-${i}">${t(key)}</label><br>` +
        `<textarea id="typed-${i}" readonly rows="4">${escapeHtml(c.value)}</textarea></p>`
      );
    })
    .join("");
  const body =
    `<p>${t("signedOut.notSaved")}${opts.kept ? ` ${t("signedOut.kept")}` : opts.comeBack ? ` ${t("signedOut.comeBack")}` : ""}</p>` +
    (boxes ? `<p>${t("signedOut.copy")}</p>${boxes}` : "") +
    `<p><a class="tap" href="${escapeHtml(SIGN_IN_PAGE)}">${t("signedOut.signIn")}</a></p>`;
  return renderPage({
    title: tr(lang, "signedOut.title", undefined, live),
    active: null,
    nav: false,
    island: false,
    mine: false,
    personName: null,
    lang,
    liveLanguages: live,
    body,
  });
}
