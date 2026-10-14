// SYC-231: what one tick (every 2 hours) does. Kept free of Workers-only imports so
// `node --test` can run it with stand-ins for fetch, KV and the alarm email.
//
// One tick: ask the API to send any queued mail (POST /api/internal/mail/drain
// with MAIL_DRAIN_TOKEN). If the API says a cat-report alert has been unsent
// for over an hour, or the call fails, email Samuel through Cloudflare Email
// Routing. That's a different delivery path from Resend, which is what the
// stuck alert is waiting on (SYC-42 layer 3, F1). It pages nobody: it is about
// the system being broken, not about a cat.

export const DRAIN_PATH = "/api/internal/mail/drain";

/**
 * How long before the same kind of problem is emailed again. The Worker runs
 * every 2 hours, so 1 hour means "at every run" and 3 hours "every other run".
 */
export const REPEAT_SECONDS = {
  overdue: 60 * 60, // a cat-report alert is stuck: remind at every run
  failed: 3 * 60 * 60, // the API is down or answering oddly
  not_configured: 3 * 60 * 60, // the Worker has no token
};

/** Set while a problem is open, so the first good tick says "back to normal". */
export const OPEN_KEY = "alarm:open";

const RETRYABLE = new Set([0, 502, 503, 504]);

/**
 * Calls the drain once, retrying once on a connection error, a timeout, or a
 * 502/503/504 (the first call can wake a sleeping deployment), like the
 * GitHub workflow did.
 *
 * Returns { kind, status, attempts, body }: kind is "ok" (200 with the
 * drain's own JSON, `overdue: 0`), "overdue" (a welfare alert is over an hour
 * late), "failed" (anything else, including a 200 that isn't the drain's
 * answer, like a login wall or holding page) or "not_configured" (no token).
 * Redirects aren't followed, so a 3xx is "failed" too. The token is never
 * logged or returned.
 */
export async function callDrain({
  baseUrl,
  token,
  fetchImpl,
  sleep,
  timeoutMs = 90_000,
  retryDelayMs = 20_000,
}) {
  if (!token) return { kind: "not_configured", status: 0, attempts: 0, body: "" };
  const url = `${baseUrl.replace(/\/+$/, "")}${DRAIN_PATH}`;
  let status = 0;
  let body = "";
  let attempts = 0;
  for (attempts = 1; attempts <= 2; attempts++) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = res.status;
      // Our own API's small JSON summary (counts only); capped anyway.
      body = (await res.text()).slice(0, 2000);
    } catch (err) {
      status = 0;
      body = err instanceof Error ? `${err.name}: ${err.message}` : "fetch failed";
    }
    if (attempts === 1 && RETRYABLE.has(status)) {
      await sleep(retryDelayMs);
      continue;
    }
    break;
  }
  if (status === 200 && isDrainOk(body)) return { kind: "ok", status, attempts, body };
  if (body.includes("welfare_alert_overdue")) return { kind: "overdue", status, attempts, body };
  return { kind: "failed", status, attempts, body };
}

/** True only for the drain's own all-clear: JSON with `overdue: 0`. */
function isDrainOk(body) {
  try {
    return JSON.parse(body)?.overdue === 0;
  } catch {
    return false;
  }
}

/** The alarm email for a problem, in plain words. */
export function alarmMessage(result, baseUrl) {
  if (result.kind === "overdue") {
    return {
      subject: "Syros Cat Spotter: a cat-report alert to Syros Cats is over an hour late",
      text: [
        "A cat-in-trouble alert to Syros Cats has been waiting to send for over an hour.",
        "",
        "Check RESEND_API_KEY and WELFARE_ALERT_TO in Replit, and Resend's email log.",
        "The report itself is safe in the database; only the email is stuck.",
        "",
        `What the app said (HTTP ${result.status}): ${result.body}`,
        "",
        "This email comes from the mail-drain-cron Cloudflare Worker, and repeats at every run (every 2 hours) while the problem lasts.",
      ].join("\n"),
    };
  }
  if (result.kind === "not_configured") {
    return {
      subject: "Syros Cat Spotter: the mail drain has no token",
      text: [
        "The mail-drain-cron Cloudflare Worker has no MAIL_DRAIN_TOKEN secret, so queued mail",
        "(including cat-report alerts that missed their first send) is not being retried.",
        "",
        "Put it back with `wrangler secret put MAIL_DRAIN_TOKEN` from infra/mail-drain-cron.",
        "See docs/runbooks/mail-drain.md.",
      ].join("\n"),
    };
  }
  return {
    subject: `Syros Cat Spotter: the mail drain call failed (HTTP ${result.status || "no answer"})`,
    text: [
      `The scheduled mail drain could not get a good answer from ${baseUrl}.`,
      "Until it does, queued mail that missed its first send is not being retried,",
      "and the over-an-hour-late check for cat-report alerts is not running.",
      "",
      `HTTP ${result.status || "000 (no answer)"} after ${result.attempts} attempt(s): ${result.body}`,
      "",
      "401 means the token in the Worker and in Replit no longer match; 503 not_configured means",
      "Replit has no MAIL_DRAIN_TOKEN. See docs/runbooks/mail-drain.md.",
      "",
      "This email repeats about every 4 hours (every other run) while the problem lasts.",
    ].join("\n"),
  };
}

/**
 * One cron tick. Throws when the drain wasn't a clean 200, so the invocation
 * shows as an error in the Worker's logs too.
 */
export async function runTick({ env, fetchImpl, sleep, kv, sendAlarm, log, nowMs }) {
  const baseUrl = env.MAIL_DRAIN_BASE_URL;
  const result = await callDrain({ baseUrl, token: env.MAIL_DRAIN_TOKEN, fetchImpl, sleep });
  log({ event: "mail_drain", kind: result.kind, status: result.status, attempts: result.attempts, body: result.body });

  if (result.kind === "ok") {
    // A healthy drain never fails the tick: a recovery email or KV problem is
    // logged, and OPEN_KEY stays set so the next tick tries again.
    try {
      if (await kv.get(OPEN_KEY)) {
        await sendAlarm({
          subject: "Syros Cat Spotter: the mail drain is back to normal",
          text: `The scheduled mail drain answered 200 again, so the problem emailed earlier has cleared.\n\nWhat the app said: ${result.body}`,
        });
        await kv.delete(OPEN_KEY);
        for (const kind of Object.keys(REPEAT_SECONDS)) await kv.delete(`alarm:last:${kind}`);
        log({ event: "mail_drain_alarm", sent: "recovered" });
      }
    } catch (err) {
      log({ event: "mail_drain_alarm", sent: false, reason: "recovery email failed", error: errText(err) });
    }
    return result;
  }

  // KV only spaces the emails out. If it can't be read, send anyway: the
  // alarm matters more than a duplicate (review of #154).
  const lastKey = `alarm:last:${result.kind}`;
  let recentlyEmailed = false;
  try {
    recentlyEmailed = Boolean(await kv.get(lastKey));
  } catch (err) {
    log({ event: "mail_drain_alarm", reason: "kv read failed, sending anyway", error: errText(err) });
  }
  if (recentlyEmailed) {
    log({ event: "mail_drain_alarm", sent: false, reason: "already emailed recently", kind: result.kind });
  } else {
    let sent = false;
    try {
      await sendAlarm(alarmMessage(result, baseUrl));
      sent = true;
      log({ event: "mail_drain_alarm", sent: true, kind: result.kind });
    } catch (err) {
      log({ event: "mail_drain_alarm", sent: false, reason: "send failed", error: errText(err) });
    }
    if (sent) {
      try {
        await kv.put(lastKey, String(nowMs), { expirationTtl: REPEAT_SECONDS[result.kind] });
        await kv.put(OPEN_KEY, String(nowMs));
      } catch (err) {
        log({ event: "mail_drain_alarm", reason: "kv write failed after sending", error: errText(err) });
      }
    }
  }
  throw new Error(`mail drain: ${result.kind} (HTTP ${result.status})`);
}

function errText(err) {
  return err instanceof Error ? err.message : String(err);
}
