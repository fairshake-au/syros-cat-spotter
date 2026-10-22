import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getAppSettings } from "../lib/appSettings";
import { logger, safeError } from "../lib/logger";
import { todayInStreakTimezone } from "../lib/streak";

const router: IRouter = Router();

/** The count never holds the redirect up for longer than this. */
export const COUNT_TIMEOUT_MS = 500;

/** Add one to today's tap count (Athens day). Best effort: a failure or a
 * slow database is logged and the tap goes uncounted. */
async function countTap(now: Date): Promise<void> {
  const day = todayInStreakTimezone(now);
  const write = db.execute(sql`
    insert into donation_link_taps (day, taps) values (${day}, 1)
    on conflict (day) do update set taps = donation_link_taps.taps + 1`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), COUNT_TIMEOUT_MS);
  });
  try {
    const outcome = await Promise.race([write.then(() => "ok" as const), timeout]);
    if (outcome === "timeout") logger.warn("donation tap count took too long; not waiting for it");
  } catch (err) {
    logger.error({ err: safeError(err) }, "could not count a donation tap");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Shown to anyone who follows a donations link while the setting is empty
 * (a phone whose switches are out of date, plan small call 5, Appendix B.2).
 * It must not point at a tab: with the link off, the app shows no giving
 * section either (help-and-info spec §2.1). */
const LINK_OFF_PAGE = {
  en: {
    title: "This link isn't available",
    body: "This link isn't available right now.",
  },
  el: {
    title: "Αυτός ο σύνδεσμος δεν είναι διαθέσιμος",
    body: "Αυτός ο σύνδεσμος δεν είναι διαθέσιμος αυτή τη στιγμή.",
  },
  fr: {
    title: "Ce lien n’est pas disponible",
    body: "Ce lien n’est pas disponible pour le moment.",
  },
} as const;

function sendLinkOff(res: Response, lang: keyof typeof LINK_OFF_PAGE): void {
  const words = LINK_OFF_PAGE[lang];
  res.status(200).type("html").send(
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${words.title}</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5">` +
      `<h1 style="font-size:1.4rem">${words.title}</h1><p>${words.body}</p></body></html>`,
  );
}

/** Redirect to the donations page in the switches, or show the link-off page. */
async function forwardToDonations(
  req: Request,
  res: Response,
  opts: { count: boolean },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const settings = await getAppSettings();

  if (!settings.donateUrl) {
    const lang = (req.acceptsLanguages("en", "el", "fr") || "en") as keyof typeof LINK_OFF_PAGE;
    sendLinkOff(res, lang);
    return;
  }

  // Express answers HEAD with the GET handler; only a real GET is a tap
  // (a link preview fetches HEAD).
  if (opts.count && req.method === "GET" && settings.countTaps) {
    await countTap(new Date());
  }
  res.redirect(302, settings.donateUrl);
}

/**
 * "Help feed a cat" (SYC-36, `feeding-nudge.md` §9, plan PR 1). Counts the
 * tap and forwards to the donation page in the switches. Nothing about who
 * tapped is read or kept: no query string, no device, no limiter (the
 * limiter would keep a salted fingerprint of the address; plan Decision 5).
 * Let through the pre-launch pass by exact path (plan Decision 3).
 */
router.get("/go/feed", (req, res) => forwardToDonations(req, res, { count: true }));

/**
 * The Help & info page's "Give" link (SYC-120, help-and-info spec §3.7).
 * The same page, headers and link-off page as /go/feed, but it keeps
 * nothing: a tap from here would inflate the feeding nudge's count
 * (`donation_link_taps`, SYC-36). Counting per source is SYC-525. Let through
 * the pre-launch pass by exact path, like /go/feed.
 */
router.get("/go/give", (req, res) => forwardToDonations(req, res, { count: false }));

export default router;
