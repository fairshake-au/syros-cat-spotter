import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { addPerson, db, mailOutboxTable, markLeft, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import app from "../app";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import {
  clearWelfareTables,
  seedReport,
  signInThroughHandoff,
} from "../lib/teamAuth/__fixtures__/queueKit";
import { timeAgo } from "../lib/teamPages/queuePage";
import * as proximity from "../lib/feedingSiteProximity";
import {
  deleteTestFeedingSites,
  northOf,
  seedFeedingSite,
} from "../test/feedingSites";
import { removeTestPerson } from "../test/removeTestPerson";

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
  await removeTestPerson(EMAIL);
  await removeTestPerson(MARIA);
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
  await deleteTestFeedingSites();
});

afterAll(async () => {
  await deleteTestFeedingSites();
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await clearWelfareTables();
  await removeTestPerson(EMAIL);
  await removeTestPerson(MARIA);
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
    await seedReport({
      publicId: "closed-1",
      state: "done",
      sentMinutesAgo: 1,
    });
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

  it("T1-8 (SYC-170): unchecked reports sit in their own list below every checked report, newest first and never urgent-first; unchecked drafts folded", async () => {
    await seedReport({ publicId: "chk-urgent", severity: "urgent", sentMinutesAgo: 600, tokenChecked: true });
    await seedReport({ publicId: "chk-old", sentMinutesAgo: 900, tokenChecked: null });
    await seedReport({ publicId: "chk-closed", state: "done", sentMinutesAgo: 1000, tokenChecked: true });
    await seedReport({ publicId: "unc-attn-new", sentMinutesAgo: 1, tokenChecked: false });
    await seedReport({ publicId: "unc-urgent-old", severity: "urgent", sentMinutesAgo: 30, tokenChecked: false });
    await seedReport({ publicId: "unc-closed", state: "done", sentMinutesAgo: 2, tokenChecked: false });
    await seedReport({ publicId: "chk-draft", isDraft: true, tokenChecked: true });
    await seedReport({ publicId: "unc-draft", isDraft: true, tokenChecked: false });

    const html = await getPage();
    const at = (id: string) => html.indexOf(`id="r-${id}"`);
    const heading = html.indexOf("<h2>Unchecked (Cloudflare was unreachable) (2)</h2>");
    expect(heading).toBeGreaterThan(-1);
    // Below every checked report, open and closed, and below the checked drafts.
    for (const id of ["chk-urgent", "chk-old", "chk-closed"]) {
      expect(at(id), id).toBeGreaterThan(-1);
      expect(at(id), id).toBeLessThan(heading);
    }
    expect(html.indexOf('id="d-chk-draft"')).toBeLessThan(heading);
    // The queue's own count leaves them out.
    expect(html).toContain("<h2>Waiting for the team (2)</h2>");
    // Newest first: the urgent one is NOT lifted above the newer attention one.
    expect(at("unc-attn-new")).toBeGreaterThan(heading);
    expect(at("unc-urgent-old")).toBeGreaterThan(at("unc-attn-new"));
    // A closed unchecked report is with the closed ones, marked.
    expect(at("unc-closed")).toBeLessThan(heading);
    const closedCard = html.slice(at("unc-closed"), html.indexOf("</article>", at("unc-closed")));
    expect(closedCard).toContain('<span class="tag unchecked">Unchecked</span>');
    // Unchecked drafts are folded away, inside the unchecked section.
    const details = html.indexOf('<details class="unchecked-drafts"><summary>Unchecked drafts (1)</summary>');
    expect(details).toBeGreaterThan(at("unc-urgent-old"));
    expect(html.indexOf('id="d-unc-draft"')).toBeGreaterThan(details);
    expect(html.indexOf('id="d-unc-draft"')).toBeLessThan(html.indexOf("</details>", details));
  });

  it("T1-8: the unchecked count shows even when it is zero, below the checked reports", async () => {
    await seedReport({ publicId: "only-checked", tokenChecked: true });
    const html = await getPage();
    const heading = html.indexOf("<h2>Unchecked (Cloudflare was unreachable) (0)</h2>");
    expect(heading).toBeGreaterThan(html.indexOf('id="r-only-checked"'));
    // No unchecked drafts, so no fold for them (each report's team note has its own).
    expect(html).not.toContain('<details class="unchecked-drafts"');
    // Review finding 7: true for rows sent before the check existed, too.
    expect(html).toContain("Reports above were either checked or sent before the safety check existed.");
    expect(html).not.toContain("Every report above passed the safety check");
  });

  it("review finding 6: the unchecked list shows the newest 50, with the total", async () => {
    for (let i = 0; i < 52; i++) {
      await seedReport({ publicId: `unc-many-${i}`, sentMinutesAgo: i + 1, tokenChecked: false });
    }
    const html = await getPage();
    expect(html).toContain("<h2>Unchecked (Cloudflare was unreachable) (52)</h2>");
    expect(html).toContain("Showing the newest 50 of 52.");
    expect(html).toContain('id="r-unc-many-0"');
    expect(html).toContain('id="r-unc-many-49"');
    expect(html).not.toContain('id="r-unc-many-50"');
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
    expect(html).not.toContain("37.44412, 24.94123");
    expect(html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, " ")).not.toMatch(/\d{2}\.\d{5}/);
    expect(html).toContain(
      "google.com/maps/search/?api=1&amp;query=37.44412%2C24.94123",
    );
    expect(html).toContain("Kittens");
    expect(html).toContain("Three kittens under the red boat");
    expect(html).toContain("Contact left</dt><dd>No</dd>");
    expect(html).toContain("Looking at it");
    expect(html).toContain("3 hours ago");
    expect(html).toContain("Maria went, the cat had moved on");
    expect(html).toContain("Maria (left)");
    expect(html).toContain("Email to Syros Cats</dt><dd><span>Sent</span>");
    expect(html).toContain("Waiting to send");
    expect(html).toContain(
      "Failed. Syros Cats may not have been told by email.",
    );
  });

  it("has no scripts, and images only from the dashboard's own routes", async () => {
    await seedReport({ photo: JPEG });
    const html = await getPage();
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    const srcs = [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map(
      (m) => m[1],
    );
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

  it("review finding 8 (SYC-170): is shown for a \"N unchecked reports waiting\" email that failed for good", async () => {
    await db.insert(mailOutboxTable).values({
      purpose: "welfare_alert",
      reportId: null,
      recipientHash: "vitest",
      payload: { kind: "unchecked_waiting", waiting: 3 },
      state: "failed",
    });
    const html = await getPage();
    expect(html).toContain('class="banner"');
    expect(html).toContain("could not be sent");
  });

  it("is shown for an alert still unsent an hour on", async () => {
    await seedReport({ mail: { state: "queued", minutesAgo: 61 } });
    const html = await getPage();
    expect(html).toContain('class="banner"');
    expect(html).toContain("more than an hour late");
  });

  it("is shown for a failed alert on a report someone is looking at", async () => {
    await seedReport({ state: "looking", mail: { state: "failed" } });
    expect(await getPage()).toContain('class="banner"');
  });

  it("clears once the report the failed alert was for is closed", async () => {
    // Review of PR 1: one old failure must not keep the banner up for ever,
    // or staff learn to ignore it. A closed report has been dealt with.
    await seedReport({ state: "done", mail: { state: "failed" } });
    await seedReport({ state: "nothing_needed", mail: { state: "failed" } });
    expect(await getPage()).not.toContain('class="banner"');
  });

  it("still shows a late alert whatever its report's state", async () => {
    await seedReport({
      state: "done",
      mail: { state: "queued", minutesAgo: 90 },
    });
    expect(await getPage()).toContain("more than an hour late");
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
      await removeTestPerson("vitest-qpage-evil@example.com");
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
      expect(html).toContain(
        "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
      );
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(html).toContain("team &lt;script&gt;");
    } finally {
      await clearWelfareTables();
      await removeTestPerson("vitest-qpage-evil@example.com");
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

describe("drafts beyond the newest 50", () => {
  it("are counted, and the page says only the newest are shown", async () => {
    for (let i = 0; i < 51; i++) await seedReport({ isDraft: true });
    const html = await getPage();
    expect(html).toContain("Showing the newest 50 of 51.");
    expect(html.match(/id="d-/g)).toHaveLength(50);
  });
});

// SYC-395 (D9) replaces SYC-245 / SYC-209 Decision 2B's near-site rule: an
// island-wide team member gets Open map on every report and draft, near a
// feeding site or not, and the page no longer measures the distance.
describe("SYC-395 (D9): Open map on every position, near a feeding site or not", () => {
  const LAT = 37.4441234;
  const LNG = 24.9412345;
  const OPEN_MAP = "google.com/maps/search/?api=1&amp;query=37.44412%2C24.94123";

  it("30 m from a site: a report and a draft both keep their Open map link", async () => {
    await seedFeedingSite(northOf(LAT, 30), LNG);
    await seedReport({ publicId: "near-report" });
    await seedReport({ publicId: "near-draft", isDraft: true });
    const html = await getPage();
    const card = (id: string) => {
      const start = html.indexOf(`id="${id}"`);
      expect(start, id).toBeGreaterThan(-1);
      return html.slice(start, html.indexOf("</article>", start));
    };
    for (const id of ["r-near-report", "d-near-draft"]) {
      expect(card(id).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, " ")).not.toMatch(/\d{2}\.\d{5}/);
      expect(card(id)).toContain(OPEN_MAP);
      expect(card(id)).toContain(">Open map</a>");
    }
    expect(html).not.toContain("Near a feeding site");
  });

  it("the page asks for no distance check at all", async () => {
    const spy = vi.spyOn(proximity, "pointsNearFeedingSite");
    try {
      await seedReport({ publicId: "q1" });
      await getPage();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("SYC-42 Slice 3: the reporter's email on the queue page", () => {
  it("says contact was left and what happened to it, offers the optional Done line, and never shows the address", async () => {
    const address = "never-on-the-page@example.org";
    await seedReport({ publicId: "with-contact" });
    const [contact] = (
      await db.execute(sql`
        insert into email_contacts (purpose, address, address_hmac, address_mask, device_id, status)
        values ('report', ${address}, 'vitest-hmac', 'n•••@example.org', 'vitest-qpage-device', 'pending')
        returning id
      `)
    ).rows as { id: number }[];
    await db.execute(sql`update welfare_reports set reporter_contact_id = ${contact!.id} where public_id = ${"with-contact"}`);
    await seedReport({ publicId: "no-contact" });
    const html = await getPage();
    expect(html).toContain("They haven&#39;t confirmed the address yet, so nothing else goes to it.");
    // Not confirmed: no line box, since a line written now would never reach
    // them (review of #181, finding 2).
    expect(html).not.toContain('name="reporterSentence"');
    expect(html).not.toContain(address);
    expect(html).not.toContain("n•••@example.org");
    await db.execute(sql`update email_contacts set status = 'confirmed', confirmed_at = now() where id = ${contact!.id}`);
    const after = await getPage();
    expect(after).toContain("Yes. They confirmed the address.");
    expect(after).toContain("This goes to a member of the public");
    // Only the report with a confirmed address gets the line box.
    expect(after.split('name="reporterSentence"')).toHaveLength(2);
    expect(after).not.toContain(address);
    await db.execute(sql`update welfare_reports set reporter_contact_id = null where public_id = ${"with-contact"}`);
    await db.execute(sql`delete from email_contacts where id = ${contact!.id}`);
  });
});
