// SYC-231: the mail-drain Worker's tick, with stand-ins for fetch, KV and the
// alarm email. Run with: node --test infra/mail-drain-cron/test
import { test } from "node:test";
import assert from "node:assert/strict";
import { callDrain, runTick, DRAIN_PATH, OPEN_KEY } from "../src/drain.js";

const BASE = "https://apptest.catspotters.com";

/** responses: "conn" throws like a network error; a number answers with that status. */
function fakeFetch(responses, bodies = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const r = responses[calls.length - 1];
    if (r === "conn") throw new TypeError("fetch failed");
    return new Response(bodies[r] ?? `{"status":${r}}`, { status: r });
  };
  return { impl, calls };
}

function fakeKv() {
  const store = new Map();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    put: async (k, v, opts) => void store.set(k, { v, opts }),
    delete: async (k) => void store.delete(k),
  };
}

function tick({ responses, bodies, kv = fakeKv(), token = "test-token", sendFails = false }) {
  const { impl, calls } = fakeFetch(responses, bodies);
  const sent = [];
  const logs = [];
  const promise = runTick({
    env: { MAIL_DRAIN_BASE_URL: BASE, MAIL_DRAIN_TOKEN: token },
    fetchImpl: impl,
    sleep: async () => {},
    kv,
    sendAlarm: async (m) => {
      if (sendFails) throw new Error("email refused");
      sent.push(m);
    },
    log: (f) => logs.push(f),
    nowMs: 1_000,
  });
  return { promise, calls, sent, logs, kv };
}

test("a 200 posts once to the drain path with the bearer token, and sends no email", async () => {
  const t = tick({ responses: [200] });
  const r = await t.promise;
  assert.equal(r.kind, "ok");
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].url, `${BASE}${DRAIN_PATH}`);
  assert.equal(t.calls[0].init.method, "POST");
  assert.equal(t.calls[0].init.headers.Authorization, "Bearer test-token");
  assert.equal(t.sent.length, 0);
});

test("the token never appears in the logs", async () => {
  const t = tick({ responses: [401] });
  await assert.rejects(t.promise);
  assert.ok(!JSON.stringify(t.logs).includes("test-token"));
  assert.ok(!JSON.stringify(t.sent).includes("test-token"));
});

test("a connection error, then 200: retried once and passes", async () => {
  const t = tick({ responses: ["conn", 200] });
  assert.equal((await t.promise).kind, "ok");
  assert.equal(t.calls.length, 2);
});

for (const code of [502, 503, 504]) {
  test(`a ${code} is retried once`, async () => {
    const t = tick({ responses: [code, 200] });
    assert.equal((await t.promise).kind, "ok");
    assert.equal(t.calls.length, 2);
  });
}

test("a 401 is not retried, fails the tick, and emails a 'call failed' alarm", async () => {
  const t = tick({ responses: [401, 200] });
  await assert.rejects(t.promise, /failed \(HTTP 401\)/);
  assert.equal(t.calls.length, 1);
  assert.equal(t.sent.length, 1);
  assert.match(t.sent[0].subject, /failed \(HTTP 401\)/);
});

test("two connection errors fail with 'no answer'", async () => {
  const t = tick({ responses: ["conn", "conn"] });
  await assert.rejects(t.promise, /HTTP 0/);
  assert.equal(t.calls.length, 2);
  assert.match(t.sent[0].subject, /no answer/);
});

test("welfare_alert_overdue emails the stuck-alert alarm and repeats hourly", async () => {
  const bodies = { 500: '{"error":"welfare_alert_overdue","overdue":1}' };
  const t = tick({ responses: [500], bodies });
  await assert.rejects(t.promise, /overdue/);
  assert.equal(t.sent.length, 1);
  assert.match(t.sent[0].subject, /over an hour late/);
  assert.equal(t.kv.store.get("alarm:last:overdue").opts.expirationTtl, 3600);
  assert.ok(t.kv.store.has(OPEN_KEY));
});

test("a second failing tick inside the repeat window sends no second email", async () => {
  const kv = fakeKv();
  const bodies = { 500: '{"error":"welfare_alert_overdue"}' };
  await assert.rejects(tick({ responses: [500], bodies, kv }).promise);
  const second = tick({ responses: [500], bodies, kv });
  await assert.rejects(second.promise);
  assert.equal(second.sent.length, 0);
});

test("the first good tick after a problem says 'back to normal' and clears the state", async () => {
  const kv = fakeKv();
  await assert.rejects(tick({ responses: [401], kv }).promise);
  const t = tick({ responses: [200], kv });
  await t.promise;
  assert.equal(t.sent.length, 1);
  assert.match(t.sent[0].subject, /back to normal/);
  assert.equal(kv.store.size, 0);
  const again = tick({ responses: [200], kv });
  await again.promise;
  assert.equal(again.sent.length, 0);
});

test("no token: no call is made, and the 'no token' alarm is emailed", async () => {
  const t = tick({ responses: [200], token: "" });
  await assert.rejects(t.promise, /not_configured/);
  assert.equal(t.calls.length, 0);
  assert.match(t.sent[0].subject, /no token/);
});

test("if the alarm email itself fails, the tick still fails and nothing is marked as sent", async () => {
  const t = tick({ responses: [401], sendFails: true });
  await assert.rejects(t.promise);
  assert.equal(t.kv.store.size, 0);
  assert.ok(t.logs.some((l) => l.reason === "send failed"));
});

test("callDrain trims a trailing slash from the base URL", async () => {
  const { impl, calls } = fakeFetch([200]);
  await callDrain({ baseUrl: `${BASE}/`, token: "t", fetchImpl: impl, sleep: async () => {} });
  assert.equal(calls[0].url, `${BASE}${DRAIN_PATH}`);
});
