import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import { addPerson, db, pool } from "@workspace/db";

// The real function, watched: counted, never replaced.
vi.mock("../lib/welfare/reporterEmail", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/welfare/reporterEmail")>();
  return { ...real, reporterOnClose: vi.fn(real.reporterOnClose) };
});

import app from "../app";
import { reporterOnClose } from "../lib/welfare/reporterEmail";
import { addressFingerprint } from "../lib/mail/fingerprint";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import { clearWelfareTables, seedReport, signInThroughHandoff } from "../lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "../test/removeTestPerson";

// Final review, fix 1 (SYC-515 B): "what happens to the reporter if this
// closes?" is worked out per report only where it is shown, the JSON routes.
// The Queue page and Home never ask it.

const EMAIL = "vitest-queue-onclose@example.com";
const ADDRESS = "vitest-queue-onclose@example.org";
const KEY = "vitest-queue-onclose-key-0123456789abcdef-012345";
const handoffKey = makeKey();
let cookie: string;

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await removeTestPerson(EMAIL);
  const susan = await addPerson({ email: EMAIL, name: "Susan", addedBy: "cli:vitest" });
  cookie = await signInThroughHandoff(app, handoffKey, susan.id);
});

beforeEach(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await clearWelfareTables();
  await db.execute(sql`delete from email_contacts where purpose = 'report'`);
  // A report whose reporter left a confirmed address: the case that asks.
  const r = await seedReport({ publicId: "onclose-1" });
  const [c] = (
    await db.execute(sql`
      insert into email_contacts (purpose, address, address_hmac, address_mask, device_id, status, confirmed_at)
      values ('report', ${ADDRESS}, ${addressFingerprint("report", ADDRESS)}, 'v•••@example.org', 'vitest-qoc-dev', 'confirmed', now())
      returning id
    `)
  ).rows as { id: number }[];
  await db.execute(sql`update welfare_reports set reporter_contact_id = ${c!.id} where id = ${r.id}`);
  vi.mocked(reporterOnClose).mockClear();
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await clearWelfareTables();
  await db.execute(sql`delete from email_contacts where purpose = 'report'`);
  await removeTestPerson(EMAIL);
  await pool.end();
});

describe("onClose is worked out only for the JSON routes", () => {
  it("the Queue page never asks it", async () => {
    const res = await request(app).get("/api/team").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("onclose-1");
    expect(reporterOnClose).not.toHaveBeenCalled();
  });

  it("Home never asks it", async () => {
    const res = await request(app).get("/api/team/home").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(reporterOnClose).not.toHaveBeenCalled();
  });

  it("the queue's JSON still carries it", async () => {
    const res = await request(app).get("/api/team/reports").set("Cookie", cookie).set("Accept", "application/json");
    expect(res.status).toBe(200);
    expect(res.body.open[0].onClose).toBe("will_send");
    expect(reporterOnClose).toHaveBeenCalled();
  });
});
