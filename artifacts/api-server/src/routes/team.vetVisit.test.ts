import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, observationsTable, pool } from "@workspace/db";
import { and, eq } from "drizzle-orm";

// SYC-396 PR 3.1a, Task 3.1.3 (team-dashboard-redesign.md §7.2, §8, §10.2,
// §13): the vet visit form, its routes, the cat page's Vet visits, the
// Decision 7 refusal on the generic Mark wrong routes, and the cat
// guardian's line. Staff hold every capability today, so `can` is wrapped:
// `denied.cap` is refused to everyone.
const denied = vi.hoisted(() => ({ cap: null as string | null }));
vi.mock("../lib/capabilities", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/capabilities")>();
  return {
    ...real,
    can: (...args: Parameters<typeof real.can>) => (args[1] === denied.cap ? false : real.can(...args)),
  };
});
vi.mock("../lib/push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));

import app from "../app";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { guardianOn, newColony, seedCat, signedPerson, type SeededCat, type Signed } from "../test/roleKit";
import { removeTestPerson } from "../test/removeTestPerson";
import { getAppSettings } from "../lib/appSettings";
import { FROM_VET_VISIT_WORDS } from "../lib/teamCorrections";

let staff: Signed;
let eleni: Signed;
let colony: number;

const KEY = "vitest-vetvisit-key-0123456789abcdef-0123456789";

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  colony = await newColony("vetvisit");
  staff = await signedPerson("vv-staff", ["staff"]);
  eleni = await guardianOn("vv-eleni", [colony]);
});
beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  denied.cap = null;
});
afterAll(async () => {
  await removeTestPerson(staff.id);
  await removeTestPerson(eleni.id);
  await pool.end();
});

const get = (path: string, who: Signed = staff) =>
  request(app).get(path).set("Cookie", who.cookie).set("Accept", "text/html");
const post = (path: string, form: Record<string, string | string[]>, who: Signed = staff) =>
  request(app).post(path).set("Cookie", who.cookie).set("Origin", TEAM_ORIGIN).type("form").send(form);

const FORM = { date: "2026-08-13", did: "sterilised", clinicId: "symviosis", costEur: "60", paidBy: "syros_cats" };
const CLINIC = "Symviosis";

async function visitOf(catId: number) {
  const [visit] = await db
    .select()
    .from(observationsTable)
    .where(and(eq(observationsTable.catId, catId), eq(observationsTable.kind, "vet_visit")));
  return visit!;
}

describe("the vet visit form", () => {
  it("opens with Sterilised ticked and the cost filled with the standard price", async () => {
    const cat = await seedCat(colony);
    const res = await get(`/api/team/cats/${cat.id}/vet-visit`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const price = String((await getAppSettings()).sterilisationPriceEur);
    expect(res.text).toMatch(/id="vv-did-sterilised" name="did" value="sterilised" checked/);
    expect(res.text).toContain(`name="costEur" inputmode="decimal" autocomplete="off" value="${price}"`);
    // ?did= without Sterilised: no price.
    const checked = await get(`/api/team/cats/${cat.id}/vet-visit?did=checked`);
    expect(checked.text).toMatch(/id="vv-did-checked" name="did" value="checked" checked/);
    expect(checked.text).toContain('name="costEur" inputmode="decimal" autocomplete="off" value=""');
  });

  it("round trip: the form saves, and the cat page shows the visit and the confirmed sterilisation", async () => {
    const cat = await seedCat(colony);
    const saved = await post(`/api/team/cats/${cat.id}/vet-visit`, { ...FORM, note: "Calm in the carrier" });
    expect(saved.status).toBe(303);
    expect(saved.headers["location"]).toBe(`/api/team/cats/${cat.id}?done=visit#vet-visits`);

    const page = await get(`/api/team/cats/${cat.id}?done=visit`);
    expect(page.status).toBe(200);
    expect(page.text).toContain("Yes, confirmed by Syros Cats, 13 Aug 2026");
    expect(page.text).toContain("Vet visits (1)");
    expect(page.text).toContain("Saved. The vet visit is below");
    expect(page.text).toContain("Sterilised</");
    expect(page.text).toContain("€60 · paid by Syros Cats");
    expect(page.text).toContain("Calm in the carrier");
    expect(page.text).toContain("Mark the visit wrong");
    // The main action is the full-width button.
    expect(page.text).toContain(`action="/api/team/cats/${cat.id}/vet-visit" class="vetvisit"><button type="submit" class="primary wide">Log a vet visit</button>`);
  });

  it("a failed save names the problem beside the field and keeps everything typed", async () => {
    const cat = await seedCat(colony);
    const res = await post(`/api/team/cats/${cat.id}/vet-visit`, {
      ...FORM,
      date: "",
      did: ["sterilised", "treated"],
      treatedNote: "",
      costEur: "55.50",
      note: "Typed & kept <here>",
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain('id="vv-date-err" role="alert">Give the date of the visit.');
    expect(res.text).toContain("Say what was treated");
    expect(res.text).toContain("Typed &amp; kept &lt;here&gt;</textarea>");
    expect(res.text).toContain('value="55.50"');
    expect(res.text).toMatch(/id="vv-did-treated" name="did" value="treated" checked/);
    expect((await db.select().from(observationsTable).where(eq(observationsTable.catId, cat.id))).filter((o) => o.kind !== "colony")).toEqual([]);
  });

  it("a date in the future is refused beside the date", async () => {
    const cat = await seedCat(colony);
    const res = await post(`/api/team/cats/${cat.id}/vet-visit`, { ...FORM, date: "2099-01-01" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("The date can&#39;t be in the future.");
  });

  it("a cat guardian can't open or post the form", async () => {
    const cat = await seedCat(colony);
    expect((await get(`/api/team/cats/${cat.id}/vet-visit`, eleni)).status).toBe(403);
    expect((await post(`/api/team/cats/${cat.id}/vet-visit`, FORM, eleni)).status).toBe(403);
  });
});

describe("vaccine problems are named beside the field (adversarial review F2, F3)", () => {
  it("Rabies ticked and also typed saves it once", async () => {
    const cat = await seedCat(colony);
    const res = await post(`/api/team/cats/${cat.id}/vet-visit`, {
      ...FORM, did: ["sterilised", "vaccinated"], vaccines: "rabies", vaccineOther: "Rabies",
    });
    expect(res.status).toBe(303);
    const [row] = await db
      .select()
      .from(observationsTable)
      .where(and(eq(observationsTable.catId, cat.id), eq(observationsTable.kind, "vet_visit")));
    expect((row!.value as { vaccines: unknown[] }).vaccines).toEqual(["rabies"]);
  });

  it("a one-letter other vaccine is named beside the vaccines", async () => {
    const cat = await seedCat(colony);
    const res = await post(`/api/team/cats/${cat.id}/vet-visit`, { ...FORM, did: ["sterilised", "vaccinated"], vaccineOther: "X" });
    expect(res.status).toBe(400);
    expect(res.text).toContain('id="vv-vaccines-err"');
  });

  it("ticking Vaccinated without set_vaccination comes back as the form, with the typed note", async () => {
    const cat = await seedCat(colony);
    denied.cap = "set_vaccination";
    const res = await post(`/api/team/cats/${cat.id}/vet-visit`, {
      ...FORM, did: ["sterilised", "vaccinated"], vaccines: "rabies", note: "Long note typed at the clinic",
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain("Long note typed at the clinic");
    expect(res.text).toContain('id="vv-did-err"');
  });
});

describe("why the cost is different (Samuel, 21 Oct 2026)", () => {
  it("is optional, saved with a sterilisation's cost, and shown beside it", async () => {
    const cat = await seedCat(colony);
    const form = await get(`/api/team/cats/${cat.id}/vet-visit`);
    expect(form.text).toContain('name="costReason"');
    expect(form.text).toContain("Why the cost is different");

    const plain = await post(`/api/team/cats/${cat.id}/vet-visit`, FORM);
    expect(plain.status).toBe(303);
    const saved = await post(`/api/team/cats/${cat.id}/vet-visit`, { ...FORM, date: "2026-08-14", costEur: "75", costReason: "Pregnant, longer surgery" });
    expect(saved.status).toBe(303);
    const page = await get(`/api/team/cats/${cat.id}`);
    expect(page.text).toContain("€75 · paid by Syros Cats<br>Why the cost was different: Pregnant, longer surgery");
  });

  it("isn't for a visit that didn't sterilise, and the form says so and keeps it", async () => {
    const cat = await seedCat(colony);
    const res = await post(`/api/team/cats/${cat.id}/vet-visit`, { ...FORM, did: "checked", costEur: "20", costReason: "Late night" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("A reason for the cost is only for a sterilisation.");
    expect(res.text).toContain('value="Late night"');
  });

  it("is money information: hidden without view_vet_costs and from a cat guardian", async () => {
    const cat = await seedCat(colony);
    await post(`/api/team/cats/${cat.id}/vet-visit`, { ...FORM, costEur: "75", costReason: "Pregnant XQZ" });
    denied.cap = "view_vet_costs";
    expect((await get(`/api/team/cats/${cat.id}`)).text).not.toContain("Pregnant XQZ");
    denied.cap = null;
    expect((await get(`/api/team/my/cats/${cat.id}`, eleni)).text).not.toContain("Pregnant XQZ");
    const json = await request(app).get(`/api/team/my/cats/${cat.id}`).set("Cookie", eleni.cookie).set("Accept", "application/json");
    expect(JSON.stringify(json.body)).not.toContain("Pregnant XQZ");
  });
});

describe("Decision 7: a visit's statements are undone only with the visit", () => {
  let cat: SeededCat;
  let sterilisedId: number;
  beforeAll(async () => {
    cat = await seedCat(colony);
    await post(`/api/team/cats/${cat.id}/vet-visit`, FORM);
    const visit = await visitOf(cat.id);
    const [row] = await db
      .select()
      .from(observationsTable)
      .where(and(eq(observationsTable.catId, cat.id), eq(observationsTable.kind, "sterilised")));
    expect((row!.value as { vetVisitId: number }).vetVisitId).toBe(visit.id);
    sterilisedId = row!.id;
  });

  it("the generic Mark wrong form refuses it, in words", async () => {
    const res = await post(`/api/team/statements/${sterilisedId}/wrong`, { choice: "sterilised_no", reason: "Not this cat" });
    expect(res.status).toBe(400);
    expect(res.text).toContain(FROM_VET_VISIT_WORDS);
    expect(res.text).toContain(`href="/api/team/cats/${cat.id}#vet-visits"`);
  });

  it("the JSON supersede route refuses it too", async () => {
    const res = await request(app)
      .post(`/api/team/observations/${sterilisedId}/supersede`)
      .set("Cookie", staff.cookie)
      .set("Origin", TEAM_ORIGIN)
      .send({ value: { sterilised: false }, reason: "Not this cat" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "FROM_VET_VISIT", message: FROM_VET_VISIT_WORDS });
  });

  it("the cat page offers no generic Mark wrong on it", async () => {
    const page = await get(`/api/team/cats/${cat.id}`);
    expect(page.text).not.toContain(`action="/api/team/statements/${sterilisedId}/wrong"`);
  });
});

describe("Mark the visit wrong", () => {
  it("asks first, then undoes the visit and its sterilisation together", async () => {
    const cat = await seedCat(colony);
    await post(`/api/team/cats/${cat.id}/vet-visit`, FORM);
    const visit = await visitOf(cat.id);

    const sure = await post(`/api/team/vet-visits/${visit.id}/wrong`, { reason: "Wrong cat" });
    expect(sure.status).toBe(200);
    expect(sure.text).toContain("Mark the vet visit on 13 Aug 2026 wrong?");
    expect(sure.text).toContain('name="confirm" value="1"');

    const done = await post(`/api/team/vet-visits/${visit.id}/wrong`, { reason: "Wrong cat", confirm: "1" });
    expect(done.status).toBe(303);
    expect(done.headers["location"]).toBe(`/api/team/cats/${cat.id}?done=visitWrong#vet-visits`);
    const page = await get(`/api/team/cats/${cat.id}`);
    expect(page.text).toContain("Vet visits (0)");
    expect(page.text).not.toContain("Yes, confirmed by Syros Cats");

    const again = await post(`/api/team/vet-visits/${visit.id}/wrong`, { reason: "Again", confirm: "1" });
    expect(again.headers["location"]).toBe(`/api/team/cats/${cat.id}?done=visitAlready#vet-visits`);
  });

  it("a cat guardian can't", async () => {
    const cat = await seedCat(colony);
    await post(`/api/team/cats/${cat.id}/vet-visit`, FORM);
    const visit = await visitOf(cat.id);
    expect((await post(`/api/team/vet-visits/${visit.id}/wrong`, { reason: "No", confirm: "1" }, eleni)).status).toBe(403);
  });
});

describe("odd requests (second review, findings 2 and 3)", () => {
  it("a JSON caller's numeric cost is kept, not turned into 'cost not recorded'", async () => {
    const cat = await seedCat(colony);
    const res = await request(app)
      .post(`/api/team/cats/${cat.id}/vet-visit`)
      .set("Cookie", staff.cookie)
      .set("Origin", TEAM_ORIGIN)
      .send({ date: "2026-08-13", did: ["sterilised"], clinicId: "symviosis", costEur: 60, paidBy: "donation" });
    expect(res.status).toBe(201);
    expect(((await visitOf(cat.id)).value as { costEur: unknown }).costEur).toBe(60);
  });

  it("marking an undo row wrong is 'no such visit', never a 500", async () => {
    const cat = await seedCat(colony);
    await post(`/api/team/cats/${cat.id}/vet-visit`, FORM);
    const visit = await visitOf(cat.id);
    await post(`/api/team/vet-visits/${visit.id}/wrong`, { reason: "Wrong cat", confirm: "1" });
    const [undo] = await db
      .select()
      .from(observationsTable)
      .where(and(eq(observationsTable.catId, cat.id), eq(observationsTable.supersedesId, visit.id)));
    expect((undo!.value as { retracted?: boolean }).retracted).toBe(true);
    expect((await post(`/api/team/vet-visits/${undo!.id}/wrong`, { reason: "Again" })).status).toBe(404);
    expect((await post(`/api/team/vet-visits/${undo!.id}/wrong`, { reason: "Again", confirm: "1" })).status).toBe(404);
  });
});

describe("who sees the money", () => {
  it("without view_vet_costs, the cat page shows no cost and no payer", async () => {
    const cat = await seedCat(colony);
    await post(`/api/team/cats/${cat.id}/vet-visit`, { ...FORM, costEur: "75", paidBy: "donation" });
    denied.cap = "view_vet_costs";
    const page = await get(`/api/team/cats/${cat.id}`);
    expect(page.text).toContain("Vet visits (1)");
    expect(page.text).not.toContain("€");
    expect(page.text).not.toContain("paid by");
  });

  it("a cat guardian's own cat page says a vet saw the cat, and nothing about vaccines, money or the clinic", async () => {
    const cat = await seedCat(colony);
    const res = await post(`/api/team/cats/${cat.id}/vet-visit`, {
      ...FORM,
      did: ["sterilised", "vaccinated"],
      vaccines: "rabies",
      costEur: "75",
      note: "Bit the nurse",
    });
    expect(res.status).toBe(303);
    const page = await get(`/api/team/my/cats/${cat.id}`, eleni);
    expect(page.status).toBe(200);
    expect(page.text).toContain("Seen by a vet on 13 August 2026: sterilised");
    expect(page.text.toLowerCase()).not.toContain("vaccin");
    expect(page.text.toLowerCase()).not.toContain("rabies");
    expect(page.text).not.toContain("€");
    expect(page.text).not.toContain(CLINIC);
    expect(page.text).not.toContain("Bit the nurse");

    const json = await request(app).get(`/api/team/my/cats/${cat.id}`).set("Cookie", eleni.cookie).set("Accept", "application/json");
    expect(json.body.cat.vetVisits).toEqual([{ date: "2026-08-13", did: ["sterilised"] }]);
    expect(JSON.stringify(json.body)).not.toMatch(/costEur|paidBy|clinic|vaccin/i);
  });
});
