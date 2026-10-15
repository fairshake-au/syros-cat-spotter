import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool, withdrawInvitation, type PersonWithScopes } from "@workspace/db";
import app from "../app";
import { installFakeResend } from "../test/fakeResend";
import { cleanUpPeople, emailFor, invited, joined } from "../test/inviteKit";
import { newColony } from "../test/roleKit";
import { settleOutbox } from "../lib/mail/outbox";

// T8, completed (SYC-53 PR 1.1; roles spec §4.5, §14 cases 11 and 13; plan
// review minor 6): the sign-in Worker's question about someone invited and
// not yet joined. Invited and unexpired, by the database's clock: version 2
// says yes with the dashboard door only, her language and who she is; the
// old shape says no (its yes means the workspace). Expired, withdrawn, not
// sent yet and anonymised all get the identical "no", byte for byte, in
// both shapes.

const TOKEN = "vitest-internal-token-invitee-0123456789abcdef";
let susan: PersonWithScopes & { cookie: string };
let colony: number;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = "vitest-invitee-allow-key-0123456789abcdef-0123";
  process.env["RESEND_API_KEY"] = "re_test_not_real";
  installFakeResend();
  colony = await newColony("allow-invitee");
  susan = await joined("al-susan", ["staff", "management"]);
});

afterEach(() => {
  delete process.env["INTERNAL_PEOPLE_TOKEN"];
});

afterAll(async () => {
  await settleOutbox();
  await cleanUpPeople();
  delete process.env["TEAM_SESSION_KEYS"];
  delete process.env["RESEND_API_KEY"];
});

const ask = (body: Record<string, unknown>) => {
  process.env["INTERNAL_PEOPLE_TOKEN"] = TOKEN;
  return request(app).post("/api/internal/people/allowed").set("Authorization", `Bearer ${TOKEN}`).send(body);
};
const seen = (res: request.Response) => {
  const headers = { ...res.headers };
  for (const h of ["date", "connection", "keep-alive"]) delete headers[h];
  return { status: res.status, text: res.text, headers };
};

describe("T8: an Invited, unexpired invitee", () => {
  it("version 2: the dashboard door only, her language, id, name and session version", async () => {
    const p = await invited(susan, "al-g", [{ role: "guardian", colonyId: colony }], "el");
    const res = await ask({ email: p.email.toUpperCase(), version: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      allowed: true,
      doors: { workspace: false, dashboard: true },
      language: "el",
      personId: p.id,
      name: "Vt al-g",
      sessionVersion: 1,
    });
  });

  it("the old shape: no, exactly as a stranger gets (it would mean the workspace)", async () => {
    const p = await invited(susan, "al-old", [{ role: "staff" }]);
    expect(seen(await ask({ email: p.email }))).toEqual(seen(await ask({ email: emailFor("al-never") })));
    expect((await ask({ email: p.email })).body).toEqual({ allowed: false });
  });

  it("expired, withdrawn, not sent yet and anonymised: the identical no in both shapes", async () => {
    const expired = await invited(susan, "al-exp");
    await pool.query(`update people set invite_expires_at = now() - interval '1 second' where id = $1`, [expired.id]);
    const withdrawn = await invited(susan, "al-wd");
    await withdrawInvitation(susan.id, withdrawn.id); // and anonymised
    const notSent = await invited(susan, "al-ns");
    await pool.query(`update people set invite_sent_at = null where id = $1`, [notSent.id]);
    const anon = `withdrawn-${withdrawn.id}@invalid`;
    for (const version of [undefined, 2]) {
      const body = (email: string) => (version === undefined ? { email } : { email, version });
      const stranger = seen(await ask(body(emailFor("al-nobody"))));
      for (const email of [expired.email, withdrawn.email, notSent.email, anon]) {
        expect({ version, email, answer: seen(await ask(body(email))) }).toEqual({ version, email, answer: stranger });
      }
    }
  });
});
