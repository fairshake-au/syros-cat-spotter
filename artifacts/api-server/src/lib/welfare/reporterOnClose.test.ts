import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { addPerson, db, pool } from "@workspace/db";
import { removeTestPerson } from "../../test/removeTestPerson";
import { addressFingerprint } from "../mail/fingerprint";
import { clearWelfareTables, seedReport } from "../teamAuth/__fixtures__/queueKit";
import { reporterOnClose } from "./reporterEmail";
import { listWelfareQueue } from "../welfareQueue";

// SYC-515 B1: one answer to "what happens to the reporter if this closes?".

const ADDRESS = "vitest-onclose@example.org";
const STAFF = "vitest-onclose-staff@example.com";
let staffId: string;

beforeAll(async () => {
  await removeTestPerson(STAFF);
  staffId = (await addPerson({ email: STAFF, name: "Staff", addedBy: "cli:vitest" })).id;
});

beforeEach(async () => {
  await clearWelfareTables();
  await db.execute(sql`delete from email_suppressions`);
  await db.execute(sql`delete from email_contacts where purpose = 'report'`);
});

afterAll(async () => {
  await clearWelfareTables();
  await db.execute(sql`delete from email_suppressions`);
  await db.execute(sql`delete from email_contacts where purpose = 'report'`);
  await removeTestPerson(STAFF);
  await pool.end();
});

async function reportWithContact(status: "pending" | "confirmed", kind: "welfare" | "content" = "welfare") {
  const r = await seedReport({ kind });
  const [c] = (
    await db.execute(sql`
      insert into email_contacts (purpose, address, address_hmac, address_mask, device_id, status, confirmed_at)
      values ('report', ${ADDRESS}, ${addressFingerprint("report", ADDRESS)}, 'v•••@example.org', 'vitest-onclose-dev', ${status},
              ${status === "confirmed" ? sql`now()` : null})
      returning id
    `)
  ).rows as { id: number }[];
  await db.execute(sql`update welfare_reports set reporter_contact_id = ${c!.id} where id = ${r.id}`);
  return r;
}

describe("reporterOnClose", () => {
  it("none: no address left", async () => {
    const r = await seedReport();
    expect(await reporterOnClose(db, r.id)).toBe("none");
  });

  it("none: an issue report, even one that somehow holds a contact", async () => {
    const r = await reportWithContact("confirmed", "content");
    expect(await reporterOnClose(db, r.id)).toBe("none");
  });

  it("will_send: a confirmed address", async () => {
    const r = await reportWithContact("confirmed");
    expect(await reporterOnClose(db, r.id)).toBe("will_send");
  });

  it("held: an address not yet confirmed", async () => {
    const r = await reportWithContact("pending");
    expect(await reporterOnClose(db, r.id)).toBe("held");
  });

  it("already_sent: this report already sent its one outcome", async () => {
    const r = await reportWithContact("confirmed");
    await db.execute(sql`
      insert into report_state_events (report_id, from_state, to_state, person_id, reporter_message)
      values (${r.id}, 'new', 'done', ${staffId}, 'report_outcome')
    `);
    expect(await reporterOnClose(db, r.id)).toBe("already_sent");
  });

  it("none: a confirmed contact with no device on file (onReportStateChanged queues nothing)", async () => {
    const r = await reportWithContact("confirmed");
    await db.execute(sql`update email_contacts set device_id = null where purpose = 'report'`);
    expect(await reporterOnClose(db, r.id)).toBe("none");
  });

  it("none: an address that was forgotten", async () => {
    const r = await reportWithContact("confirmed");
    await db.execute(sql`update email_contacts set address = null where purpose = 'report'`);
    expect(await reporterOnClose(db, r.id)).toBe("none");
  });

  it("may_not_arrive: confirmed, but the address bounced", async () => {
    const r = await reportWithContact("confirmed");
    await db.execute(sql`
      insert into email_suppressions (address_hmac, reason, scope)
      values (${addressFingerprint("all", ADDRESS)}, 'bounce', 'all')
    `);
    expect(await reporterOnClose(db, r.id)).toBe("may_not_arrive");
  });

  it("the queue carries the same answer as onClose", async () => {
    const none = await seedReport();
    const will = await reportWithContact("confirmed");
    const q = await listWelfareQueue({ onClose: true });
    const by = new Map(q.open.map((x) => [x.id, x.onClose]));
    expect(by.get(none.publicId)).toBe("none");
    expect(by.get(will.publicId)).toBe("will_send");
  });
});
