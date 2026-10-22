import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { addPerson, catsTable, db, markLeft, photosTable, pool } from "@workspace/db";
import { like } from "drizzle-orm";
import app from "../app";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import {
  clearWelfareTables,
  seedReport,
  signInThroughHandoff,
} from "../lib/teamAuth/__fixtures__/queueKit";
import { QUEUE_COLUMNS, type WelfareQueue } from "../lib/welfareQueue";
import { removeTestPerson } from "../test/removeTestPerson";

// SYC-43 part 2 plan, PR 1: the welfare queue's data (GET /api/team/reports).
// P1-2 (order and sections) and P1-4 (nothing private leaves). The page's own
// tests are in team.queuePage.test.ts.

const EMAIL = "vitest-queue-susan@example.com";
const MARIA = "vitest-queue-maria@example.com";
const KEY = "vitest-queue-key-0123456789abcdef-0123456789";
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
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await clearWelfareTables();
  await db.delete(catsTable).where(like(catsTable.name, "vt-queue-%"));
  await db.delete(photosTable).where(like(photosTable.publicId, "vt-queue-%"));
  await removeTestPerson(EMAIL);
  await removeTestPerson(MARIA);
  await pool.end();
});

const getQueue = async () => {
  const res = await request(app).get("/api/team/reports").set("Cookie", cookie);
  expect(res.status).toBe(200);
  return res.body as WelfareQueue;
};

// Every key a report carries. Adding one is a privacy decision (P1-4), so it
// has to be added here too.
const EXPECTED_REPORT_KEYS = [
  "at",
  // PR 5: the cat the team tied the report to ({ id, name } or null). Its
  // name is a catalogue name, not a private field.
  "cat",
  "contactLeft",
  // SYC-42 Slice 3: what happened to the reporter's emails, never the address.
  "emailToReporter",
  "emailToTeam",
  "id",
  "isLitter",
  "lat",
  "lng",
  "note",
  // SYC-515: what closing would do for the reporter; a fixed word, never an address.
  "onClose",
  "photo",
  "severity",
  "state",
  "stateChangedAt",
  "stateChangedBy",
  // SYC-504: the cat whose page the reporter sent it from ({ id, name,
  // photoUrl } or null). A public cat id and name; the team route's photo.
  "suggestedCat",
  "teamNote",
  "teamNoteAt",
  "teamNoteBy",
  // SYC-170: accepted while Cloudflare was unreachable (a flag, nothing private).
  "unchecked",
];

describe("P1-2: order and sections", () => {
  it("puts urgent above attention, then newest first; closed ones apart and newest first; drafts apart", async () => {
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
      state: "looking",
      sentMinutesAgo: 60,
    });
    await seedReport({
      publicId: "closed-old",
      state: "done",
      severity: "urgent",
      sentMinutesAgo: 900,
    });
    await seedReport({
      publicId: "closed-new",
      state: "nothing_needed",
      sentMinutesAgo: 1,
    });
    await seedReport({ publicId: "draft-1", isDraft: true });

    const q = await getQueue();
    expect(q.open.map((r) => r.id)).toEqual([
      "urgent-new",
      "urgent-old",
      "attn-new",
      "attn-old",
    ]);
    expect(q.closed.map((r) => r.id)).toEqual(["closed-new", "closed-old"]);
    expect(q.closedTotal).toBe(2);
    expect(q.drafts.map((d) => d.id)).toEqual(["draft-1"]);
    // A draft is in no other list, and a closed one is not among the open.
    const everywhere = [...q.open, ...q.closed].map((r) => r.id);
    expect(everywhere).not.toContain("draft-1");
    expect(q.open.map((r) => r.id)).not.toContain("closed-new");
  });

  it("shows a draft with severity, place and time only", async () => {
    await seedReport({
      publicId: "draft-2",
      isDraft: true,
      severity: "urgent",
      note: "should never show",
      isLitter: true,
    });
    const q = await getQueue();
    expect(Object.keys(q.drafts[0]!).sort()).toEqual([
      "id",
      "lat",
      "lng",
      "severity",
      // SYC-504: the cat the reporter began it from, or null.
      "startedAt",
      "suggestedCat",
    ]);
  });

  it("SYC-519: listWelfareQueue({ drafts: false }) reads no drafts, checked or unchecked, and everything else as before", async () => {
    await seedReport({ publicId: "nd-draft", isDraft: true });
    await seedReport({ publicId: "nd-draft-unc", isDraft: true, tokenChecked: false });
    await seedReport({ publicId: "nd-report" });
    const { listWelfareQueue } = await import("../lib/welfareQueue");
    const q = await listWelfareQueue({ drafts: false });
    expect(q.drafts).toEqual([]);
    expect(q.draftsTotal).toBe(0);
    expect(q.unchecked.drafts).toEqual([]);
    expect(q.unchecked.draftsTotal).toBe(0);
    expect(q.open.map((r) => r.id)).toContain("nd-report");
    // The default still reads them (the JSON route keeps its shape).
    expect((await listWelfareQueue()).drafts.map((d) => d.id)).toContain("nd-draft");
  });

  it("shows what each report holds: the photo through the team route, kittens, the team note and who wrote it, with left people marked", async () => {
    await markLeft(MARIA, "cli:vitest").catch(() => undefined);
    const bytes = Buffer.from("not really a jpeg");
    const r = await seedReport({
      publicId: "full",
      isLitter: true,
      photo: { mime: "image/jpeg", bytes },
      teamNote: "Maria went, the cat had moved on",
      teamNoteBy: mariaId,
      stateChangedBy: mariaId,
      state: "looking",
      mail: { state: "sent" },
    });
    await seedReport({ publicId: "waiting", photo: "pending" });
    await seedReport({
      publicId: "bare",
      photo: "failed",
      mail: { state: "failed" },
    });
    const q = await getQueue();
    const byId = Object.fromEntries(q.open.map((x) => [x.id, x]));
    expect(byId["full"]).toMatchObject({
      isLitter: true,
      photo: {
        status: "attached",
        url: `/api/team/report-photos/${r.photoPublicId}`,
      },
      teamNote: "Maria went, the cat had moved on",
      teamNoteBy: { name: "Maria", left: true },
      stateChangedBy: { name: "Maria", left: true },
      contactLeft: false,
      emailToTeam: "sent",
    });
    expect(byId["waiting"]!.photo).toEqual({ status: "pending", url: null });
    expect(byId["bare"]!.photo).toEqual({ status: "failed", url: null });
    expect(byId["bare"]!.emailToTeam).toBe("failed");
    expect(byId["waiting"]!.emailToTeam).toBeNull();
  });
});

describe("SYC-504: the suggested cat", () => {
  it("is { id, name, photoUrl } on a report and on a draft, null without one, and never sets cat", async () => {
    const [p] = await db
      .insert(photosTable)
      .values({ publicId: "vt-queue-photo-1", data: "ZmFrZQ==", mime: "image/jpeg" })
      .returning({ id: photosTable.id });
    const [c] = await db
      .insert(catsTable)
      .values({
        name: "vt-queue-Tigris",
        description: "",
        primaryPhotoId: p!.id,
        lat: 37.445,
        lng: 24.942,
        discovererDeviceId: "vt-queue-spotter",
      })
      .returning({ id: catsTable.id });
    await seedReport({ publicId: "with-cat", reporterCatId: c!.id });
    await seedReport({ publicId: "no-cat" });
    await seedReport({ publicId: "draft-cat", isDraft: true, reporterCatId: c!.id });
    await seedReport({ publicId: "draft-none", isDraft: true });
    const q = await getQueue();
    const byId = Object.fromEntries(q.open.map((x) => [x.id, x]));
    expect(byId["with-cat"]!.suggestedCat).toEqual({
      id: c!.id,
      name: "vt-queue-Tigris",
      photoUrl: "/api/team/photos/vt-queue-photo-1/small",
    });
    expect(byId["with-cat"]!.cat).toBeNull();
    expect(byId["no-cat"]!.suggestedCat).toBeNull();
    const drafts = Object.fromEntries(q.drafts.map((x) => [x.id, x]));
    expect(drafts["draft-cat"]!.suggestedCat).toEqual({
      id: c!.id,
      name: "vt-queue-Tigris",
      photoUrl: "/api/team/photos/vt-queue-photo-1/small",
    });
    expect(drafts["draft-none"]!.suggestedCat).toBeNull();
  });
  it("a cat whose photo was removed for good gets no thumbnail, not a broken one", async () => {
    const [p] = await db
      .insert(photosTable)
      .values({
        publicId: "vt-queue-photo-gone",
        data: null,
        mime: "image/jpeg",
        removedAt: new Date(),
        removedBy: mariaId,
        removedReason: "SYC-1",
      })
      .returning({ id: photosTable.id });
    const [c] = await db
      .insert(catsTable)
      .values({
        name: "vt-queue-Ghost",
        description: "",
        primaryPhotoId: p!.id,
        lat: 37.445,
        lng: 24.942,
        discovererDeviceId: "vt-queue-spotter",
      })
      .returning({ id: catsTable.id });
    await seedReport({ publicId: "photo-gone", reporterCatId: c!.id });
    const q = await getQueue();
    const r = q.open.find((x) => x.id === "photo-gone")!;
    expect(r.suggestedCat).toEqual({ id: c!.id, name: "vt-queue-Ghost", photoUrl: null });
  });
});

describe("P1-4: nothing private leaves the queue", () => {
  it("returns exactly these keys for a report, so a new field is a decision", async () => {
    await seedReport({ publicId: "keys-check" });
    const q = await getQueue();
    expect(Object.keys(q).sort()).toEqual([
      "closed",
      "closedTotal",
      "drafts",
      "draftsTotal",
      "mail",
      "open",
      "unchecked",
    ]);
    expect(Object.keys(q.open[0]!).sort()).toEqual(EXPECTED_REPORT_KEYS);
  });

  it("selects neither the reporter's device nor the reporter's contact", () => {
    const columns = Object.keys(QUEUE_COLUMNS);
    expect(columns).not.toContain("reporterDevice");
    expect(columns).not.toContain("reporterContactId");
    expect(columns).not.toContain("clientRef");
  });

  it("carries no device id, no photo bytes and no photo URL outside /api/team/", async () => {
    const bytes = Buffer.from("secret-photo-bytes-0123456789");
    await seedReport({
      publicId: "leak-check",
      reporterDevice: "device-that-must-not-leak",
      photo: { mime: "image/jpeg", bytes },
    });
    await seedReport({
      isDraft: true,
      reporterDevice: "device-that-must-not-leak",
    });
    const res = await request(app)
      .get("/api/team/reports")
      .set("Cookie", cookie);
    const json = res.text;
    expect(json).not.toContain("device-that-must-not-leak");
    expect(json).not.toContain(bytes.toString("base64"));
    expect(json).not.toContain(bytes.toString());
    expect(json).not.toContain("/api/photos/");
    expect(json).not.toMatch(/reporterDevice|reporterContact|reporter_/i);
    const urls = [...json.matchAll(/"url":"([^"]*)"/g)].map((m) => m[1]!);
    expect(urls.length).toBe(1);
    for (const u of urls) expect(u).toMatch(/^\/api\/team\/report-photos\//);
  });
});
