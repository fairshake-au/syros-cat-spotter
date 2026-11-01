import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "./app";
import { NUL_MESSAGE } from "./middlewares/refuseNul";

// SYC-691: a NUL in a query string or a path parameter reached Postgres and
// answered 500 (SYC-406 fixed JSON bodies only). It is now the same plain 400
// before any route runs, except where a route already answers it itself.
// A device secret is sent so the profile routes get as far as the database:
// without one they answer 401 first, which is how the 500 hid in tests.
const SECRET = "s".repeat(40);

describe("a NUL character in the URL", () => {
  for (const path of [
    "/api/profiles/%00/username",
    "/api/profiles/a%00b",
    "/api/profiles/%00/moments",
    "/api/cats/1%00",
    "/api/profiles/username-availability?username=a%00b",
    "/api/cats?colour=%00",
    "/api/profiles/x/username?a[b]=%00",
  ]) {
    it(`on GET ${path} is a 400 with a plain message, not a 500`, async () => {
      const res = await request(app).get(path).set("X-Device-Secret", SECRET);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: NUL_MESSAGE });
      expect(res.headers["cache-control"]).toBe("no-store");
    });
  }

  it("in a path parameter of a POST is refused too", async () => {
    const res = await request(app).post("/api/profiles/%00/username").set("X-Device-Secret", SECRET).send({ username: "Lili" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: NUL_MESSAGE });
  });

  it("leaves the dashboard's own handling alone: its search box answers a NUL itself", async () => {
    const res = await request(app).get("/api/team/colonies?q=%00").set("Accept", "application/json");
    expect(res.body).not.toEqual({ error: NUL_MESSAGE });
  });

  it("leaves the email-link pages alone: a NUL token gets the 'link not valid' page", async () => {
    const res = await request(app).get("/api/mail/confirm?t=%00");
    expect(res.status).toBe(410);
    expect(res.type).toBe("text/html");
  });

  it("leaves the donation redirect alone (it never reads the query)", async () => {
    const res = await request(app).get("/api/go/give?x=%00");
    expect(res.status).not.toBe(400);
  });

  it("doesn't refuse an encoded percent sign ('%2500' is the text '%00', not a NUL)", async () => {
    const res = await request(app).get("/api/profiles/username-availability?username=a%2500b");
    expect(res.body).not.toEqual({ error: NUL_MESSAGE });
  });
});
