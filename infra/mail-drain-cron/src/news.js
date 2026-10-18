// SYC-45 Slice 1 (docs/superpowers/plans/syc-344-email-capture.md, PR 1.1):
// the nightly news check's tick, the Worker's second cron. Kept free of
// Workers-only imports so `node --test` can run it with stand-ins, like
// drain.js.
//
// One tick: ask the API to run tonight's check (POST
// /api/internal/news/nightly with NEWS_JOB_TOKEN), then ask when the last
// night finished (GET /api/internal/news/last-run). Email Samuel through
// Cloudflare Email Routing if the run call fails, if more than 50 news
// changes were found and all silenced (a bulk correction, plan C14), or if
// no night has finished in 36 hours (review finding 17). The check itself
// sends nobody anything.
//
// The cron is in UTC; the night is the Athens date. 00:30 UTC is 03:30 in
// Athens in summer time and 02:30 in winter time, always on the same Athens
// date, so the 25 October clock change neither skips a night nor runs one
// twice (and the API refuses a second run for the same night anyway).

export const NEWS_CRON = "30 0 * * *";
export const NIGHTLY_PATH = "/api/internal/news/nightly";
export const LAST_RUN_PATH = "/api/internal/news/last-run";
export const STALE_HOURS = 36;

/** How long before the same kind of news-check problem is emailed again. */
export const NEWS_REPEAT_SECONDS = {
  failed: 20 * 60 * 60, // the run call failed: once a night
  bulk: 20 * 60 * 60, // a bulk night: once
  stale: 20 * 60 * 60, // no finished night in 36 hours: once a night
  not_configured: 20 * 60 * 60,
};

/** Set while a news-check problem is open; separate from the drain's. */
export const NEWS_OPEN_KEY = "news:alarm:open";

const RETRYABLE = new Set([0, 502, 503, 504]);

async function call({ url, method, token, fetchImpl, sleep, timeoutMs, retryDelayMs }) {
  let status = 0;
  let body = "";
  let attempts = 0;
  for (attempts = 1; attempts <= 2; attempts++) {
    try {
      const res = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = res.status;
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
  return { status, body, attempts };
}

function parse(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * Runs tonight's check and reads the last finished night. Returns
 * { kind, status, attempts, body, lastFinishedAt }: kind is "ok", "bulk",
 * "stale", "failed" or "not_configured". The token is never logged or
 * returned.
 */
export async function callNews({
  baseUrl,
  token,
  fetchImpl,
  sleep,
  nowMs,
  timeoutMs = 120_000,
  retryDelayMs = 20_000,
}) {
  if (!token) return { kind: "not_configured", status: 0, attempts: 0, body: "", lastFinishedAt: null };
  const base = baseUrl.replace(/\/+$/, "");
  const run = await call({ url: `${base}${NIGHTLY_PATH}`, method: "POST", token, fetchImpl, sleep, timeoutMs, retryDelayMs });
  const json = run.status === 200 ? parse(run.body) : null;
  const isRunAnswer =
    json !== null &&
    (json.already === true || json.busy === true || typeof json.catsWalked === "number");
  if (!isRunAnswer) return { kind: "failed", ...run, lastFinishedAt: null };

  const last = await call({ url: `${base}${LAST_RUN_PATH}`, method: "GET", token, fetchImpl, sleep, timeoutMs, retryDelayMs });
  const lastJson = last.status === 200 ? parse(last.body) : null;
  if (lastJson === null || !("lastRun" in lastJson)) {
    return { kind: "failed", status: last.status, attempts: last.attempts, body: last.body, lastFinishedAt: null };
  }
  const lastFinishedAt = lastJson.lastRun?.finishedAt ?? null;
  const finishedMs = lastFinishedAt ? Date.parse(lastFinishedAt) : NaN;
  if (json.silencedBulk === true) return { kind: "bulk", ...run, lastFinishedAt };
  if (!Number.isFinite(finishedMs) || nowMs - finishedMs > STALE_HOURS * 3_600_000) {
    return { kind: "stale", ...run, lastFinishedAt };
  }
  return { kind: "ok", ...run, lastFinishedAt };
}

/** The alarm email for a problem, in plain words. */
export function newsAlarmMessage(result, baseUrl) {
  if (result.kind === "bulk") {
    return {
      subject: "Syros Cat Spotters: the nightly news check found over 50 changes and held them all",
      text: [
        "Tonight's news check found more than 50 pieces of cat news at once. That looks like a",
        "batch of corrections rather than real news, so it held every one of them back.",
        "Nothing was sent to anyone (the check doesn't send email yet in any case).",
        "",
        "Worth a look at the review list (GET /api/team/news-changes) to see what changed.",
        "",
        `What the app said: ${result.body}`,
      ].join("\n"),
    };
  }
  if (result.kind === "stale") {
    return {
      subject: `Syros Cat Spotters: the nightly news check hasn't finished a night in ${STALE_HOURS} hours`,
      text: [
        `The nightly news check on ${baseUrl} has no finished night in the last ${STALE_HOURS} hours.`,
        `Last finished: ${result.lastFinishedAt ?? "never"}.`,
        "",
        "The two-week clock for switching cat news on only counts nights that finished.",
        "See docs/runbooks/mail-drain.md.",
        "",
        `What the run call said (HTTP ${result.status}): ${result.body}`,
      ].join("\n"),
    };
  }
  if (result.kind === "not_configured") {
    return {
      subject: "Syros Cat Spotters: the nightly news check has no token",
      text: [
        "The mail-drain-cron Cloudflare Worker has no NEWS_JOB_TOKEN secret, so the nightly",
        "news check isn't running. Put it back with `wrangler secret put NEWS_JOB_TOKEN`",
        "from infra/mail-drain-cron.",
      ].join("\n"),
    };
  }
  return {
    subject: `Syros Cat Spotters: the nightly news check failed (HTTP ${result.status || "no answer"})`,
    text: [
      `The nightly news check could not get a good answer from ${baseUrl}.`,
      "GitHub's daily backup (news-nightly.yml) will try again later today.",
      "",
      `HTTP ${result.status || "000 (no answer)"} after ${result.attempts} attempt(s): ${result.body}`,
      "",
      "401 means the token in the Worker and in Replit no longer match; 503 not_configured means",
      "Replit has no NEWS_JOB_TOKEN.",
    ].join("\n"),
  };
}

/** One news tick. Throws when it wasn't clean, so the invocation shows as an error. */
export async function runNewsTick({ env, fetchImpl, sleep, kv, sendAlarm, log, nowMs }) {
  const baseUrl = env.MAIL_DRAIN_BASE_URL;
  const result = await callNews({ baseUrl, token: env.NEWS_JOB_TOKEN, fetchImpl, sleep, nowMs });
  log({ event: "news_check", kind: result.kind, status: result.status, attempts: result.attempts, body: result.body });

  if (result.kind === "ok") {
    try {
      if (await kv.get(NEWS_OPEN_KEY)) {
        await sendAlarm({
          subject: "Syros Cat Spotters: the nightly news check is back to normal",
          text: `The nightly news check finished a night again.\n\nWhat the app said: ${result.body}`,
        });
        await kv.delete(NEWS_OPEN_KEY);
        for (const kind of Object.keys(NEWS_REPEAT_SECONDS)) await kv.delete(`news:alarm:last:${kind}`);
      }
    } catch (err) {
      log({ event: "news_check_alarm", sent: false, reason: "recovery email failed", error: errText(err) });
    }
    return result;
  }

  const lastKey = `news:alarm:last:${result.kind}`;
  let recentlyEmailed = false;
  try {
    recentlyEmailed = Boolean(await kv.get(lastKey));
  } catch (err) {
    log({ event: "news_check_alarm", reason: "kv read failed, sending anyway", error: errText(err) });
  }
  if (!recentlyEmailed) {
    let sent = false;
    try {
      await sendAlarm(newsAlarmMessage(result, baseUrl));
      sent = true;
      log({ event: "news_check_alarm", sent: true, kind: result.kind });
    } catch (err) {
      log({ event: "news_check_alarm", sent: false, reason: "send failed", error: errText(err) });
    }
    if (sent) {
      try {
        await kv.put(lastKey, String(nowMs), { expirationTtl: NEWS_REPEAT_SECONDS[result.kind] });
        // A bulk night is a one-off, not an open problem.
        if (result.kind !== "bulk") await kv.put(NEWS_OPEN_KEY, String(nowMs));
      } catch (err) {
        log({ event: "news_check_alarm", reason: "kv write failed after sending", error: errText(err) });
      }
    }
  } else {
    log({ event: "news_check_alarm", sent: false, reason: "already emailed recently", kind: result.kind });
  }
  throw new Error(`news check: ${result.kind} (HTTP ${result.status})`);
}

function errText(err) {
  return err instanceof Error ? err.message : String(err);
}
