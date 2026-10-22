import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NoteBody } from "../../routes/teamReports";
import { CreateForm, UpdateForm } from "../../routes/teamColonies";
import { EditForm } from "../../routes/teamSites";
import {
  DiedForm,
  LifeStatusForm,
  RenameForm,
  SterilisationForm,
  WrongForm,
} from "../../routes/teamCorrections";
import { isKeptLanding, KEEPABLE, keepableFor, LANDING_ONLY, landingOnlyFor, mayOpenPath, typedFields } from "./heldTyping";
import type { CapabilityHolder } from "../capabilities";

// SYC-516 C3: the fixed list of forms whose typed text may be kept, and the
// fixed list of pages a kept row may land on.

/** Each KEEPABLE route's zod schema, as the route parses its body. */
const SCHEMAS: Record<keyof typeof KEEPABLE, z.ZodTypeAny> = {
  "POST /api/team/reports/:publicId/note": NoteBody,
  "POST /api/team/colonies": CreateForm,
  "POST /api/team/colonies/:id": UpdateForm,
  "POST /api/team/sites/:id": EditForm,
  "POST /api/team/cats/:id/name": RenameForm,
  "POST /api/team/cats/:id/died": DiedForm,
  "POST /api/team/cats/:id/life-status": LifeStatusForm,
  "POST /api/team/cats/:id/sterilisation": SterilisationForm,
  "POST /api/team/statements/:id/wrong": WrongForm,
};

function shapeOf(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> {
  let s: z.ZodTypeAny = schema;
  while (s instanceof z.ZodEffects) s = s.innerType();
  if (!(s instanceof z.ZodObject)) throw new Error("not an object schema");
  return s.shape as Record<string, z.ZodTypeAny>;
}

const post = (path: string, body: Record<string, unknown> = {}) =>
  ({ method: "POST", originalUrl: path, body }) as unknown as Request;

describe("KEEPABLE", () => {
  it("names exactly the routes that have a schema here", () => {
    expect(Object.keys(KEEPABLE).sort()).toEqual(Object.keys(SCHEMAS).sort());
  });

  for (const [route, entry] of Object.entries(KEEPABLE)) {
    it(`${route}: every kept field is in the route's zod schema, as a text field`, () => {
      const shape = shapeOf(SCHEMAS[route as keyof typeof KEEPABLE]);
      for (const f of entry.fields) expect(Object.keys(shape), `${route} ${f}`).toContain(f);
      // Never a position, a state or a choice.
      for (const f of ["lat", "lng", "from", "to", "status", "choice", "back", "updatedAt", "confirm", "date"]) {
        expect(entry.fields, `${route} keeps ${f}`).not.toContain(f);
      }
    });
  }

  it("matches the posted paths, and nothing else", () => {
    expect(keepableFor(post("/api/team/reports/vt-abc_1/note"))?.entry).toBe(KEEPABLE["POST /api/team/reports/:publicId/note"]);
    expect(keepableFor(post("/api/team/colonies"))?.entry).toBe(KEEPABLE["POST /api/team/colonies"]);
    expect(keepableFor(post("/api/team/colonies/12?x=1"))?.entry).toBe(KEEPABLE["POST /api/team/colonies/:id"]);
    expect(keepableFor(post("/api/team/colonies/12/cats"))).toBeNull();
    expect(keepableFor(post("/api/team/sites/12/retire"))).toBeNull();
    expect(keepableFor(post("/api/team/my/language"))).toBeNull();
    expect(keepableFor(post("/api/team/reports/x/state"))).toBeNull();
    expect(keepableFor({ method: "GET", originalUrl: "/api/team/colonies", body: {} } as unknown as Request)).toBeNull();
  });

  it("typedFields takes only listed, non-empty strings, cut to 4,000 characters", () => {
    const entry = KEEPABLE["POST /api/team/colonies/:id"]!;
    const out = typedFields(
      post("/api/team/colonies/3", {
        name: "x".repeat(4100),
        guardianName: "  ",
        notes: ["array"],
        lat: "37.44",
        lng: "24.94",
        __proto__: "nope",
      }),
      entry,
    );
    expect(Object.keys(out)).toEqual(["name"]);
    expect(out["name"]!.length).toBe(4000);
  });
});

describe("the landing list", () => {
  it("accepts only the fixed dashboard page shapes", () => {
    for (const ok of [
      "/api/team?open=vt-1",
      "/api/team/colonies",
      "/api/team/colonies/3",
      "/api/team/sites/3",
      "/api/team/cats/3",
      "/api/team/cats/3?s=9",
      "/api/team/cats/3/died",
      "/api/team/likely",
    ]) {
      expect(isKeptLanding(ok), ok).toBe(true);
    }
    for (const bad of [
      "https://evil.example/api/team",
      "//evil.example/api/team",
      "/api/team/../../x",
      "/api/team?open=<b>",
      "/api/team?open=a&next=//evil",
      "/api/team/cats/3?lat=37",
      "/api/team/people",
      "/api/team/colonies/3/../4",
      "",
    ]) {
      expect(isKeptLanding(bad), bad).toBe(false);
    }
  });
});

describe("mayOpenPath", () => {
  const island = (): CapabilityHolder => ({ scopes: [{ role: "staff", colonyId: null, reach: "island" }] });
  const guardian = (colonyId: number): CapabilityHolder => ({ scopes: [{ role: "guardian", colonyId, reach: "colony" }] });

  it("the team may open every landing; a cat guardian none of the team's pages", () => {
    const team = island();
    const g = guardian(7);
    for (const p of ["/api/team?open=x", "/api/team/cats/3", "/api/team/cats/3/died", "/api/team/likely", "/api/team/areas"]) {
      expect(mayOpenPath(team, p), p).toBe(true);
      expect(mayOpenPath(g, p), p).toBe(false);
    }
    // Her own Colonies and Feeding sites pages pass the same door as their GET routes.
    expect(mayOpenPath(g, "/api/team/colonies")).toBe(true);
    expect(mayOpenPath(g, "/api/team/colonies/7")).toBe(true);
    expect(mayOpenPath(g, "/api/team/sites/7")).toBe(true);
    // Anything off the list: no.
    expect(mayOpenPath(team, "https://evil.example/")).toBe(false);
  });
});

describe("LANDING_ONLY (final review, fix 2)", () => {
  it("keeps no field, ever, and every landing is on the list", async () => {
    for (const [route, entry] of Object.entries(LANDING_ONLY)) {
      expect(entry.fields, route).toEqual([]);
    }
    const state = landingOnlyFor(post("/api/team/reports/vt-abc_1/state"))!;
    expect(await state.entry.landing(state.m, {})).toBe("/api/team?open=vt-abc_1");
    const tie = landingOnlyFor(post("/api/team/reports/vt-abc_1/cat"))!;
    expect(await tie.entry.landing(tie.m, {})).toBe("/api/team?open=vt-abc_1");
    // SYC-44 PR 7.1's Issues row buttons come back to that row too.
    for (const action of ["keep-hidden", "restore", "hide"]) {
      const issue = landingOnlyFor(post(`/api/team/issues/vt-abc_1/${action}`))!;
      expect(issue, action).not.toBeNull();
      expect(await issue.entry.landing(issue.m, {}), action).toBe("/api/team?open=vt-abc_1");
      expect(issue.entry.formKey(issue.m), action).toBe(`issue:${action}:vt-abc_1`);
    }
    const areas = landingOnlyFor(post("/api/team/areas"))!;
    expect(await areas.entry.landing(areas.m, { op: "move" })).toBe("/api/team/areas");
    expect(await areas.entry.landing(areas.m, { op: "add" })).toBeNull();
    expect(await areas.entry.landing(areas.m, { op: ["move"] })).toBeNull();
    for (const l of ["/api/team?open=vt-abc_1", "/api/team/areas"]) expect(isKeptLanding(l), l).toBe(true);
  });

  it("matches the posted paths, and nothing else", () => {
    expect(landingOnlyFor(post("/api/team/reports/x/state"))?.entry).toBe(LANDING_ONLY["POST /api/team/reports/:publicId/state"]);
    expect(landingOnlyFor(post("/api/team/reports/x/note"))).toBeNull();
    expect(landingOnlyFor(post("/api/team/reports/x/state/extra"))).toBeNull();
    expect(landingOnlyFor(post("/api/team/areas/kini/centre/pick"))).toBeNull();
    expect(landingOnlyFor(post("/api/team/issues/x/delete"))).toBeNull();
    expect(landingOnlyFor(post("/api/team/issues/x/hide/extra"))).toBeNull();
    expect(landingOnlyFor(post("/api/team/issues/x"))).toBeNull();
    expect(landingOnlyFor({ method: "GET", originalUrl: "/api/team/areas", body: {} } as unknown as Request)).toBeNull();
  });
});
