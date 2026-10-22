import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import type { Express } from "express";
import {
  addPerson,
  pool,
  signOutEverywhere,
} from "@workspace/db";
import app from "../app";
import {
  claimsFor,
  makeKey,
  mint,
  mintHs256WithPublicKey,
  mintNone,
} from "../lib/teamAuth/__fixtures__/mint";
import { removeTestPerson } from "../test/removeTestPerson";

// POST /api/team/handoff (SYC-43 part 1 plan §5, tests 9–13; spec §8.6 #6,
// #7). The test makes its own Ed25519 key pairs in memory.

const EMAIL = "vitest-handoff-susan@example.com";
const STALE_EMAIL = "vitest-handoff-stale@example.com";
const SESSION_KEY = "vitest-session-key-0123456789abcdef-0123456789";
const key = makeKey();
const otherKey = makeKey();
let personId: string;
let stalePersonId: string;

beforeAll(async () => {
  await removeTestPerson(EMAIL);
  await removeTestPerson(STALE_EMAIL);
  personId = (
    await addPerson({ email: EMAIL, name: "Susan", addedBy: "cli:vitest" })
  ).id;
  stalePersonId = (
    await addPerson({
      email: STALE_EMAIL,
      name: "Stale",
      addedBy: "cli:vitest",
    })
  ).id;
  await signOutEverywhere(STALE_EMAIL, "cli:vitest"); // now at version 2
});

beforeEach(() => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = key.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = SESSION_KEY;
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await removeTestPerson(EMAIL);
  await removeTestPerson(STALE_EMAIL);
  await pool.end();
});

const handoff = (
  token: string,
  opts: { origin?: string | null; navigate?: boolean; target?: Express } = {},
) => {
  const r = request(opts.target ?? app).post("/api/team/handoff");
  const origin =
    opts.origin === undefined ? "https://admin.catspotters.com" : opts.origin;
  if (origin !== null) r.set("Origin", origin);
  if (opts.navigate) r.set("Sec-Fetch-Mode", "navigate");
  return r.type("form").send({ token });
};

function expectRefusal(res: request.Response) {
  expect(res.status).toBe(401);
  expect(res.text).toBe('{"error":"not_signed_in"}');
  expect(res.headers["set-cookie"]).toBeUndefined();
  expect(res.headers["location"]).toBeUndefined();
}

describe("a good pass", () => {
  it("signs the person in: 303 to the dashboard and a __Host-cs_team cookie with the right flags", async () => {
    const res = await handoff(mint(key, claimsFor(personId)));
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(
      "https://team.catspotters.com/api/team/home",
    );
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies).toHaveLength(1);
    const cookie = cookies[0]!;
    expect(cookie).toMatch(/^__Host-cs_team=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/);
    expect(cookie).toMatch(/; Path=\/(;|$)/);
    expect(cookie).toMatch(/; HttpOnly(;|$)/);
    expect(cookie).toMatch(/; Secure(;|$)/);
    expect(cookie).toMatch(/; SameSite=Lax(;|$)/);
    expect(cookie).toMatch(/; Max-Age=2678400(;|$)/);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("every failure gets the identical 401 (§8.6 #6)", () => {
  const now = () => Math.floor(Date.now() / 1000);
  const cases: [string, () => Parameters<typeof handoff>][] = [
    ["bad signature", () => [mint(otherKey, claimsFor(personId))]],
    [
      "wrong aud",
      () => [
        mint(
          key,
          claimsFor(personId, { aud: "https://admin.catspotters.com" }),
        ),
      ],
    ],
    [
      "wrong iss",
      () => [
        mint(key, claimsFor(personId, { iss: "https://evil.catspotters.com" })),
      ],
    ],
    [
      "expired",
      () => [
        mint(key, claimsFor(personId, { iat: now() - 200, exp: now() - 140 })),
      ],
    ],
    [
      "iat more than 60 s in the future",
      () => [
        mint(key, claimsFor(personId, { iat: now() + 120, exp: now() + 150 })),
      ],
    ],
    [
      "exp − iat over 60",
      () => [mint(key, claimsFor(personId, { iat: now(), exp: now() + 61 }))],
    ],
    [
      "unknown sub",
      () => [mint(key, claimsFor("00000000-0000-4000-8000-000000000000"))],
    ],
    ["stale sv", () => [mint(key, claimsFor(stalePersonId, { sv: 1 }))]],
    [
      "wrong Origin (a sibling subdomain)",
      () => [
        mint(key, claimsFor(personId)),
        { origin: "https://evil.catspotters.com" },
      ],
    ],
    [
      "wrong Origin (the dashboard itself)",
      () => [
        mint(key, claimsFor(personId)),
        { origin: "https://team.catspotters.com" },
      ],
    ],
    ["no Origin", () => [mint(key, claimsFor(personId)), { origin: null }]],
    ["malformed token", () => ["not.a.token"]],
    ["empty token", () => [""]],
  ];

  for (const [name, args] of cases) {
    it(`refuses: ${name}`, async () => {
      expectRefusal(await handoff(...args()));
    });
  }

  it("refuses a replayed jti", async () => {
    const token = mint(key, claimsFor(personId));
    expect((await handoff(token)).status).toBe(303);
    expectRefusal(await handoff(token));
  });

  it("refuses everything when no public key is configured", async () => {
    delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
    expectRefusal(await handoff(mint(key, claimsFor(personId))));
  });

  it("refuses when no session key is configured, without spending the pass", async () => {
    const token = mint(key, claimsFor(personId));
    delete process.env["TEAM_SESSION_KEYS"];
    expectRefusal(await handoff(token));
    process.env["TEAM_SESSION_KEYS"] = SESSION_KEY;
    expect((await handoff(token)).status).toBe(303);
  });
});

describe("the algorithm is fixed in code (§8.6 #7)", () => {
  it("refuses HS256 signed with the public key's bytes", async () => {
    expectRefusal(
      await handoff(mintHs256WithPublicKey(key, claimsFor(personId))),
    );
  });

  it("refuses alg: none with an empty signature", async () => {
    expectRefusal(await handoff(mintNone(claimsFor(personId))));
  });

  it("refuses a good Ed25519 signature under a header that doesn't say EdDSA", async () => {
    expectRefusal(
      await handoff(
        mint(key, claimsFor(personId), { alg: "HS256", typ: "JWT" }),
      ),
    );
  });
});

describe("single use holds across servers", () => {
  it("a pass spent on one app instance is refused by another sharing the database", async () => {
    vi.resetModules();
    const other = (await import("../app")).default;
    const otherDb = await import("@workspace/db");
    try {
      const token = mint(key, claimsFor(personId));
      expect((await handoff(token, { target: other })).status).toBe(303);
      expectRefusal(await handoff(token));
      const second = mint(key, claimsFor(personId));
      expect((await handoff(second)).status).toBe(303);
      expectRefusal(await handoff(second, { target: other }));
    } finally {
      await otherDb.pool.end();
    }
  });
});

describe("key change", () => {
  it("accepts a pass signed by either of two configured keys", async () => {
    process.env["TEAM_HANDOFF_PUBLIC_KEYS"] =
      `${key.publicRaw},${otherKey.publicRaw}`;
    expect((await handoff(mint(key, claimsFor(personId)))).status).toBe(303);
    expect((await handoff(mint(otherKey, claimsFor(personId)))).status).toBe(
      303,
    );
  });

  it("with one key, refuses a pass signed by the other", async () => {
    process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = otherKey.publicRaw;
    expectRefusal(await handoff(mint(key, claimsFor(personId))));
  });
});

describe("a browser page load", () => {
  it("gets the same 401 and a page that redirects straight back to the sign-in page, whatever failed", async () => {
    const failures = [
      await handoff(mint(otherKey, claimsFor(personId)), { navigate: true }),
      await handoff(mint(key, claimsFor(personId)), {
        navigate: true,
        origin: null,
      }),
      await handoff(mint(key, claimsFor(stalePersonId)), { navigate: true }),
      await handoff("garbage", { navigate: true }),
    ];
    for (const res of failures) {
      expect(res.status).toBe(401);
      expect(res.headers["content-type"]).toMatch(/^text\/html/);
      expect(res.text).toBe(failures[0]!.text);
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
    const refresh = failures[0]!.text.match(
      /<meta http-equiv="refresh" content="0;url=([^"]+)">/,
    );
    expect(refresh?.[1]).toBe("https://admin.catspotters.com/");
    expect(failures[0]!.text).toContain(
      '<a href="https://admin.catspotters.com/">',
    );
    expect(failures[0]!.text).not.toMatch(/<script/i);
  });
});
