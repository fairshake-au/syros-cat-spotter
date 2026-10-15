import { Router, type IRouter, type Response } from "express";
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

/** Shown only to a phone whose switches are out of date (plan small call 5,
 * Appendix B.2). The tab names match the app's `tabHelp`. */
const LINK_OFF_PAGE = {
  en: {
    title: "This link isn't available",
    body: "The Help tab in the Cat Spotters app shows how to give.",
  },
  el: {
    title: "Αυτός ο σύνδεσμος δεν είναι διαθέσιμος",
    body: "Στην καρτέλα «Βοήθεια» της εφαρμογής Cat Spotters θα δεις πώς μπορείς να κάνεις δωρεά.",
  },
  fr: {
    title: "Ce lien n’est pas disponible",
    body: "L’onglet « Aider » de l’appli Cat Spotters te montre comment faire un don.",
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

/**
 * "Help feed a cat" (SYC-36, `feeding-nudge.md` §9, plan PR 1). Counts the
 * tap and forwards to the donation page in the switches. Nothing about who
 * tapped is read or kept: no query string, no device, no limiter (the
 * limiter would keep a salted fingerprint of the address; plan Decision 5).
 * Let through the pre-launch pass by exact path (plan Decision 3).
 */
router.get("/go/feed", async (req, res) => {
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
  if (req.method === "GET" && settings.countTaps) {
    await countTap(new Date());
  }
  res.redirect(302, settings.donateUrl);
});

export default router;
