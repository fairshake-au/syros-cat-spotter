// SYC-45 Slice 1: the nightly news check's tick, with stand-ins for fetch, KV
// and the alarm email. Run with: node --test infra/mail-drain-cron/test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LAST_RUN_PATH, NEWS_CRON, NEWS_OPEN_KEY, NIGHTLY_PATH, runNewsTick } from "../src/news.js";

const BASE = "https://apptest.catspotters.com";
const NOW = Date.parse("2026-10-25T00:30:00Z");
const RAN = '{"night":"2026-10-25","catsWalked":12,"changesFound":1,"news":1,"silenced":0,"silencedBulk":false}';
const lastRun = (iso) => JSON.stringify({ lastRun: iso ? { finishedAt: iso } : null });

function fakeKv() {
  const store = new Map();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    put: async (k, v, opts) => void store.set(k, { v, opts }),
    delete: async (k) => void store.delete(k),
  };
}

/** answers: [status, body] per call, in order; "conn" throws. */
function tick({ answers, kv = fakeKv(), token = "news-token" }) {
  const calls = [];
  const sent = [];
  const logs = [];
  const promise = runNewsTick({
    env: { MAIL_DRAIN_BASE_URL: BASE, NEWS_JOB_TOKEN: token },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const a = answers[calls.length - 1];
      if (a === "conn") throw new TypeError("fetch failed");
      return new Response(a[1], { status: a[0] });
    },
    sleep: async () => {},
    kv,
    sendAlarm: async (m) => void sent.push(m),
    log: (f) => logs.push(f),
    nowMs: NOW,
  });
  return { promise, calls, sent, logs, kv };
}

test("a good night: runs the check, reads the last run, sends no email", async () => {
  const t = tick({ answers: [[200, RAN], [200, lastRun("2026-10-25T00:30:05Z")]] });
  const r = await t.promise;
  assert.equal(r.kind, "ok");
  assert.equal(t.calls[0].url, `${BASE}${NIGHTLY_PATH}`);
  assert.equal(t.calls[0].init.method, "POST");
  assert.equal(t.calls[0].init.headers.Authorization, "Bearer news-token");
  assert.equal(t.calls[1].url, `${BASE}${LAST_RUN_PATH}`);
  assert.equal(t.calls[1].init.method, "GET");
  assert.equal(t.sent.length, 0);
});

test("already done tonight is fine", async () => {
  const t = tick({ answers: [[200, '{"already":true,"night":"2026-10-25"}'], [200, lastRun("2026-10-25T00:31:00Z")]] });
  assert.equal((await t.promise).kind, "ok");
  assert.equal(t.sent.length, 0);
});

test("a non-200 alarms", async () => {
  const t = tick({ answers: [[500, '{"error":"news_check_failed"}']] });
  await assert.rejects(t.promise, /news check: failed \(HTTP 500\)/);
  assert.equal(t.sent.length, 1);
  assert.match(t.sent[0].subject, /news check failed/);
  assert.ok(t.kv.store.has(NEWS_OPEN_KEY));
});

test("a 200 that isn't the check's answer (a login wall) alarms", async () => {
  const t = tick({ answers: [[200, "<html>sign in</html>"]] });
  await assert.rejects(t.promise, /failed/);
  assert.equal(t.sent.length, 1);
});

test("a bulk night alarms once, and isn't left open", async () => {
  const t = tick({
    answers: [[200, RAN.replace('"silencedBulk":false', '"silencedBulk":true')], [200, lastRun("2026-10-25T00:30:05Z")]],
  });
  await assert.rejects(t.promise, /bulk/);
  assert.equal(t.sent.length, 1);
  assert.match(t.sent[0].subject, /over 50 changes/);
  assert.ok(!t.kv.store.has(NEWS_OPEN_KEY));
});

test("no finished night in 36 hours alarms, even when the run call says busy", async () => {
  const t = tick({ answers: [[200, '{"busy":true,"night":"2026-10-25"}'], [200, lastRun("2026-10-23T11:00:00Z")]] });
  await assert.rejects(t.promise, /stale/);
  assert.equal(t.sent.length, 1);
  assert.match(t.sent[0].subject, /36 hours/);
});

test("35 hours is not stale; never run is", async () => {
  const fine = tick({ answers: [[200, '{"busy":true}'], [200, lastRun(new Date(NOW - 35 * 3_600_000).toISOString())]] });
  assert.equal((await fine.promise).kind, "ok");
  const never = tick({ answers: [[200, '{"busy":true}'], [200, lastRun(null)]] });
  await assert.rejects(never.promise, /stale/);
});

test("no token: alarms without calling the API", async () => {
  const t = tick({ answers: [], token: "" });
  await assert.rejects(t.promise, /not_configured/);
  assert.equal(t.calls.length, 0);
  assert.equal(t.sent.length, 1);
});

test("the token is never logged or in an email", async () => {
  const t = tick({ answers: [[401, '{"error":"unauthorized"}']], token: "s3cret-news-token" });
  await assert.rejects(t.promise);
  assert.ok(!JSON.stringify(t.logs).includes("s3cret-news-token"));
  assert.ok(!JSON.stringify(t.sent).includes("s3cret-news-token"));
});

test("a recovery after an open problem says so", async () => {
  const kv = fakeKv();
  kv.store.set(NEWS_OPEN_KEY, "1");
  const t = tick({ kv, answers: [[200, RAN], [200, lastRun("2026-10-25T00:30:05Z")]] });
  await t.promise;
  assert.equal(t.sent.length, 1);
  assert.match(t.sent[0].subject, /back to normal/);
  assert.ok(!kv.store.has(NEWS_OPEN_KEY));
});

test("wrangler.jsonc has the drain's cron and the news cron, and the news cron is one Athens night either side of 25 Oct", () => {
  const text = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(text, /"crons": \["0 \*\/2 \* \* \*", "30 0 \* \* \*"\]/);
  assert.equal(NEWS_CRON, "30 0 * * *");
  const athens = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/Athens" });
  const hour = (iso) => Number(new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", hourCycle: "h23" }));
  for (const day of ["2026-10-24", "2026-10-25", "2026-10-26", "2027-03-28", "2027-03-29"]) {
    const iso = `${day}T00:30:00Z`;
    assert.equal(athens(iso), day, `${iso} is the Athens night of ${day}`);
    assert.ok(hour(iso) >= 2 && hour(iso) <= 3, `${iso} is in the small hours in Athens`);
  }
});
