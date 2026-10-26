import type { Request } from "express";
import { isBrowserNavigation, TEAM_HOME_PATH } from "../teamAuth/refuse";
import { escapeHtml } from "./escape";
import { renderPage } from "./layout";
import { LIVE_LANGUAGES, pageLanguage, tr, type Language } from "./strings";

// SYC-516 C1 (spec 3.1, decision 516-A; closes SYC-339): the dashboard's
// error page. Dashboard look, one link home, no menu, no name. It never reads
// the session, so a broken sign-in can't make an error worse. No script.

export type TeamErrorKind = "not_found" | "broken" | "bad_request";

/** The request's path in full, even from inside a mounted `app.use("/api", ...)`. */
export function fullPath(req: Pick<Request, "path"> & { baseUrl?: string }): string {
  return ((req.baseUrl ?? "") + req.path).toLowerCase();
}

export function isTeamPath(req: Pick<Request, "path"> & { baseUrl?: string }): boolean {
  const p = fullPath(req);
  return p === "/api/team" || p.startsWith("/api/team/");
}

/**
 * A browser page under /api/team: the browser says it is navigating, or it
 * asks for a web page (older iPhones don't send Sec-Fetch-Mode).
 */
export function wantsTeamPage(req: Request): boolean {
  if (!isTeamPath(req)) return false;
  if (isBrowserNavigation(req)) return true;
  const accept = req.headers["accept"];
  return typeof accept === "string" && accept.toLowerCase().includes("text/html");
}

const ASKABLE: readonly Language[] = ["el", "fr", "en"];

/** The first of el/fr/en in Accept-Language, in the order the browser lists them. */
export function preferredLanguage(req: Request): Language {
  const header = req.headers["accept-language"];
  if (typeof header !== "string") return "en";
  for (const part of header.split(",")) {
    const tag = (part.split(";")[0] ?? "").trim().toLowerCase().split("-")[0] ?? "";
    const hit = ASKABLE.find((l) => l === tag);
    if (hit) return hit;
  }
  return "en";
}

export function renderTeamErrorPage(
  kind: TeamErrorKind,
  opts: { afterSave: boolean; lang: string; liveLanguages?: readonly Language[] },
): string {
  const live = opts.liveLanguages ?? LIVE_LANGUAGES;
  const lang = pageLanguage(opts.lang, live);
  const t = (key: Parameters<typeof tr>[1]) => escapeHtml(tr(lang, key, undefined, live));
  const title =
    kind === "not_found" ? "error.notFound.title" : kind === "broken" ? "error.broken.title" : "error.bad.title";
  const line =
    kind === "not_found" ? "error.notFound.line" : opts.afterSave ? "error.broken.afterSave" : "error.broken.retry";
  return renderPage({
    title: tr(lang, title, undefined, live),
    active: null,
    nav: false,
    island: false,
    mine: false,
    personName: null,
    lang,
    liveLanguages: live,
    body: `<p>${t(line)}</p>${kind === "broken" ? `<p class="hint">${t("error.broken.contact")}</p>` : ""}<p><a class="tap" href="${TEAM_HOME_PATH}">${t("error.home")}</a></p>`,
  });
}
