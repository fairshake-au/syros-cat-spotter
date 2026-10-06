import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { addPerson, markLeft, pool, removePerson } from "@workspace/db";
import app from "../app";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import {
  clearWelfareTables,
  seedReport,
  signInThroughHandoff,
} from "../lib/teamAuth/__fixtures__/queueKit";
import { timeAgo } from "../lib/teamPages/queuePage";

// SYC-43 part 2 plan, PR 1: the queue page itself. P1-2 (HTML order), P1-6
// (words that must not appear), P1-7 (the mail banner), P1-8 (escaping).

const EMAIL = "vitest-qpage-susan@example.com";
const MARIA = "vitest-qpage-maria@example.com";
const KEY = "vitest-qpage-key-0123456789abcdef-0123456789";
const handoffKey = makeKey();
let cookie: string;
let mariaId: string;

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await clearWelfareTables();
  await removePerson(EMAIL);
  await removePerson(MARIA);
  const susan = await addPerson({
    email: EMAIL,
    name: "Susan",
    addedBy: "cli:vitest",
  });
  mariaId = (
    await addPerson({ email: MARIA, name: "Maria", addedBy: "cli:vitest" })
  ).id;
  cookie = await signInThroughHandoff(app, handoffKey, susan.id);
});

beforeEach(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await clearWelfareTables();
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await clearWelfareTables();
  await removePerson(EMAIL);
  await removePerson(MARIA);
  await pool.end();
});

const getPage = async () => {
  const res = await request(app).get("/api/team").set("Cookie", cookie);
  expect(res.status).toBe(200);
  expect(res.type).toBe("text/html");
  return res.text;
};

const JPEG = { mime: "image/jpeg", bytes: Buffer.from("fake jpeg bytes") };

describe("P1-2: the page's order", () => {
  it("lists urgent above attention, then newest; closed below the open ones; drafts only under their own heading", async () => {
    await seedReport({ publicId: "attn-old", sentMinutesAgo: 300 });
    await seedReport({ publicId: "attn-new", sentMinutesAgo: 2 });
    await seedReport({
      publicId: "urgent-old",
      severity: "urgent",
      sentMinutesAgo: 600,
    });
    await seedReport({
      publicId: "urgent-new",
      severity: "urgent",
      sentMinutesAgo: 60,
    });
    await seedReport({ publicId: "closed-1", state: "done", sentMinutesAgo: 1 });
    await seedReport({
      publicId: "closed-2",
      state: "nothing_needed",
      sentMinutesAgo: 9,
    });
    await seedReport({ publicId: "a-draft", isDraft: true });

    const html = await getPage();
    const at = (id: string) => html.indexOf(`id="r-${id}"`);
    const order = ["urgent-new", "urgent-old", "attn-new", "attn-old"].map(at);
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const closedHeading = html.indexOf("<h2>Closed (2)</h2>");
    expect(closedHeading).toBeGreaterThan(Math.max(...order));
    expect(at("closed-1")).toBeGreaterThan(closedHeading);
    expect(at("closed-1")).toBeLessThan(at("closed-2"));

    const draftHeading = html.indexOf("<h2>Started but not sent</h2>");
    expect(draftHeading).toBeGreaterThan(-1);
    expect(html.indexOf('id="d-a-draft"')).toBeGreaterThan(draftHeading);
    expect(html).not.toContain('id="r-a-draft"');
  });

  it("says so when nothing is waiting", async () => {
    const html = await getPage();
    expect(html).toContain("No reports are waiting for the team.");
    expect(html).not.toContain("Started but not sent");
  });
});

describe("what each row shows", () => {
  it("shows the photo through the team route, the place, kittens, the note, contact, state, team note and the email state", async () => {
    await markLeft(MARIA, "cli:vitest").catch(() => undefined);
    const r = await seedReport({
      publicId: "rich",
      severity: "urgent",
      isLitter: true,
      state: "looking",
      note: "Three kittens under the red boat",
      lat: 37.44412,
      lng: 24.94123,
      photo: JPEG,
      teamNote: "Maria went, the cat had moved on",
      teamNoteBy: mariaId,
      stateChangedBy: mariaId,
      mail: { state: "sent" },
      sentMinutesAgo: 185,
    });
    await seedReport({
      publicId: "no-photo-yet",
      photo: "pending",
      mail: { state: "queued" },
    });
    await seedReport({ publicId: "no-photo", mail: { state: "failed" } });
    await seedReport({ publicId: "bad-photo", photo: "failed" });
    const html = await getPage();
    expect(html).toContain(
      `<img class="photo" src="/api/team/report-photos/${r.photoPublicId}"`,
    );
    expect(html).toContain("Photo still uploading");
    expect(html).toContain(">No photo<");
    expect(html).toContain("No photo: the photo could not be received");
    expect(html).toContain("37.44412, 24.94123");
    expect(html).toContain("google.com/maps/search/?api=1&amp;query=37.44412%2C24.94123");
    expect(html).toContain("Kittens");
    expect(html).toContain("Three kittens under the red boat");
    expect(html).toContain("Contact left</dt><dd>No</dd>");
    expect(html).toContain("Looking at it");
    expect(html).toContain("3 hours ago");
    expect(html).toContain("Maria went, the cat had moved on");
    expect(html).toContain("Maria (left)");
    expect(html).toContain("Email to Syros Cats</dt><dd><span>Sent</span>");
    expect(html).toContain("Waiting to send");
    expect(html).toContain("Failed. Syros Cats may not have been told by email.");
  });

  it("has no scripts, and images only from the dashboard's own routes", async () => {
    await seedReport({ photo: JPEG });
    const html = await getPage();
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    const srcs = [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]);
    expect(srcs).toHaveLength(1);
    expect(srcs[0]).toMatch(/^\/api\/team\/report-photos\//);
    expect(html).not.toContain("/api/photos/");
  });

  it("never shows the reporter's device", async () => {
    await seedReport({ reporterDevice: "device-that-must-not-show" });
    await seedReport({
      reporterDevice: "device-that-must-not-show",
      isDraft: true,
    });
    expect(await getPage()).not.toContain("device-that-must-not-show");
  });
});

describe("P1-6: words the page must not use (spec §3.1, §3.6, F1)", () => {
  it("never says escalate, assign, due, on call or urgent alert", async () => {
    await seedReport({
      publicId: "w1",
      severity: "urgent",
      isLitter: true,
      photo: JPEG,
      teamNote: "Went there",
      teamNoteBy: mariaId,
      stateChangedBy: mariaId,
      state: "looking",
      mail: { state: "failed", minutesAgo: 120 },
    });
    await seedReport({ publicId: "w2", state: "done", photo: "pending" });
    await seedReport({
      publicId: "w3",
      mail: { state: "queued", minutesAgo: 90 },
    });
    await seedReport({ publicId: "w4", isDraft: true, severity: "urgent" });
    const html = await getPage();
    // The banner is on: it is part of the page too.
    expect(html).toContain('class="banner"');
    const text = html.replace(/<style>[\s\S]*?<\/style>/, "");
    expect(text).not.toMatch(/escalat/i);
    expect(text).not.toMatch(/assign/i);
    expect(text).not.toMatch(/\bdue\b|overdue/i);
    expect(text).not.toMatch(/on[\s-]call/i);
    expect(text).not.toMatch(/urgent\s+alert/i);
    expect(text).not.toMatch(/countdown|deadline|page someone/i);
  });
});

describe("P1-7: the mail banner", () => {
  it("is not shown when mail is fine, a queued alert is recent, or an old one was sent", async () => {
    await seedReport({ mail: { state: "sent", minutesAgo: 500 } });
    await seedReport({ mail: { state: "queued", minutesAgo: 30 } });
    await seedReport({ mail: { state: "sending", minutesAgo: 59 } });
    expect(await getPage()).not.toContain('class="banner"');
  });

  it("is shown for a failed alert", async () => {
    await seedReport({ mail: { state: "failed", minutesAgo: 5 } });
    const html = await getPage();
    expect(html).toContain('class="banner"');
    expect(html).toContain("could not be sent");
    expect(html).toContain("Every report is still safe in the queue");
  });

  it("is shown for an alert still unsent an hour on", async () => {
    await seedReport({ mail: { state: "queued", minutesAgo: 61 } });
    const html = await getPage();
    expect(html).toContain('class="banner"');
    expect(html).toContain("more than an hour late");
  });

  it("is shown with no reports at all showing, if mail is broken", async () => {
    // The report is closed and the failed row belongs to it: the banner is
    // about the mail system, not about what is on screen.
    await seedReport({ state: "done", mail: { state: "failed" } });
    expect(await getPage()).toContain('class="banner"');
  });
});

describe("P1-8: values are escaped", () => {
  it("renders a note, a team note, a person's name and a title as text", async () => {
    const evil = '<script>alert("x")</script>';
    const bad = await addPerson({
      email: "vitest-qpage-evil@example.com",
      name: evil,
      addedBy: "cli:vitest",
    }).catch(async () => {
      await removePerson("vitest-qpage-evil@example.com");
      return addPerson({
        email: "vitest-qpage-evil@example.com",
        name: evil,
        addedBy: "cli:vitest",
      });
    });
    try {
      await seedReport({
        note: `<img src=x onerror=alert(1)> ${evil}`,
        teamNote: `team ${evil}`,
        teamNoteBy: bad.id,
        stateChangedBy: bad.id,
        state: "looking",
      });
      const html = await getPage();
      expect(html).not.toContain("<script>alert");
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(html).toContain("team &lt;script&gt;");
    } finally {
      await clearWelfareTables();
      await removePerson("vitest-qpage-evil@example.com");
    }
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it("reads plainly", () => {
    expect(timeAgo(ago(10_000), now)).toBe("just now");
    expect(timeAgo(ago(60_000), now)).toBe("1 minute ago");
    expect(timeAgo(ago(5 * 60_000), now)).toBe("5 minutes ago");
    expect(timeAgo(ago(3600_000), now)).toBe("1 hour ago");
    expect(timeAgo(ago(26 * 3600_000), now)).toBe("1 day ago");
    expect(timeAgo(ago(45 * 86_400_000), now)).toBe("22 Aug 2026");
    expect(timeAgo(ago(-5000), now)).toBe("just now");
  });
});
