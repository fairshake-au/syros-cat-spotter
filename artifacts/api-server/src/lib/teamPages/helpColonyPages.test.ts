import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderColoniesPage } from "./colonyPages";
import { renderAreasPage, MOVE_WHAT, RETIRE_WHAT } from "./areasPage";
import { renderPlanPrintPage } from "./planPrintPage";
import { renderGuardianCatPage, renderGuardianColonyPage } from "./guardianPages";
import { renderCentreConfirm } from "./centrePages";
import { renderSitePage, renderSitesPage } from "./sitePages";

// SYC-739: the plain-English help on the colony, site, area, plan and
// cat-guardian pages. Wording was checked against the code that does the work.

const page = (o: Partial<Parameters<typeof renderColoniesPage>[0]> = {}) =>
  renderColoniesPage({
    query: "",
    colonies: [],
    personName: "Sam",
    canCreate: true,
    figures: new Map(),
    sort: "name",
    now: new Date("2026-10-22T00:00:00Z"),
    recentChanges: [],
    ...o,
  });

// The centre page's small map signs its tile tokens, so it needs a key here.
let savedKey: string | undefined;
beforeAll(() => {
  savedKey = process.env["TEAM_SESSION_KEYS"];
  process.env["TEAM_SESSION_KEYS"] = "vitest-help-colony-key-0123456789abcdef-0123456789";
});
afterAll(() => {
  if (savedKey === undefined) delete process.env["TEAM_SESSION_KEYS"];
  else process.env["TEAM_SESSION_KEYS"] = savedKey;
});

describe("Colonies list help", () => {
  it("always leads with what a colony is and explains the flags and the percentage", () => {
    for (const html of [page(), page({ canCreate: false }), page({ query: "zzz" })]) {
      expect(html).toContain('<p class="intro">A colony is a group of street cats, usually fed in the same place');
      expect(html).toContain("How this page works");
      expect(html).toContain("only the street cats that are sterilised for certain");
      expect(html).toContain("Probably sterilised does not count");
      expect(html).toContain("Kittens reported means");
      expect(html).toContain("within 300 metres");
      expect(html).toContain("No cat guardian means");
      expect(html).toContain("No street cat seen for 30 days means");
      expect(html).toContain("Colony = a group of cats. Feeding site = a pin where they are fed. Area = a named part of the island");
      expect(html).toContain('href="/api/team/words"');
    }
  });

  it("gives a cat guardian her own intro and none of the team-only lines", () => {
    const html = page({ island: false });
    expect(html).toContain("These are the colonies you look after.");
    expect(html).not.toContain("within 300 metres");
    expect(html).not.toContain("Area = a named part");
    expect(html).not.toContain("/api/team/words");
  });
});

describe("Areas help", () => {
  const html = renderAreasPage({
    personName: "Sam",
    link: false,
    areas: [{ key: "ermoupoli", name: "Ermoupoli", lat: 37.4447, lng: 24.9417, cats: 2 }],
    version: 21,
    firstVersion: 21,
    history: [],
  });
  it("opens with what an area is and says what Move centre and Retire do", () => {
    expect(html).toContain("Areas are the place names shown on cats, sightings and the Cats filters, like Ermoupoli.");
    expect(html).toContain(MOVE_WHAT);
    expect(html).toContain(RETIRE_WHAT);
    expect(html).toContain("You can bring it back later from the list of retired areas below.");
  });
});

describe("Centre confirm help", () => {
  it("shows the line it is given", () => {
    const html = renderCentreConfirm({
      personName: "Sam",
      active: "settings",
      title: "T",
      question: () => "Q?",
      saveLabel: "Save",
      spot: { lat: 37.44, lng: 24.94 },
      zoom: 17,
      nowLabel: "now",
      newLabel: "new",
      saveAction: "/y",
      back: { href: "/z", label: "Back" },
      help: "A place takes the name of the area whose centre is nearest.",
    });
    expect(html).toContain('<p class="what">A place takes the name of the area whose centre is nearest.</p>');
  });
});

describe("Trapping plan print help", () => {
  it("says how to use the page and what Ear clip seen means", () => {
    const html = renderPlanPrintPage(
      { id: 1, name: "Kini" },
      { toDo: [], done: [], other: [], sites: [], estimate: null } as never,
      new Date("2026-10-26T00:00:00Z"),
    );
    expect(html).toContain("Print this and take it with you. Tick each cat once it has been trapped.");
    expect(html).toContain("Ear clip seen means someone saw a clipped ear, so the cat may already be sterilised.");
  });
});

describe("Cat guardian help", () => {
  const who = { name: "Gina", language: "en" };
  it("explains confirmed and probably on her colony page", () => {
    const html = renderGuardianColonyPage({ who, colony: { id: 1, name: "Kini" }, cats: [] });
    expect(html).toContain("Probably sterilised means someone saw a clipped ear, which is never proof on its own.");
  });
  it("explains what died and home change, on a cat she can speak for", () => {
    const cat = {
      id: 5, name: "Mimi", namePending: false, syr: "SYR-0005", colony: { id: 1, name: "Kini" },
      sterilised: { value: true, confidence: "likely" }, lifeStatus: "street", lastSeen: null, vetVisits: [],
      lat: 37.44, lng: 24.94, coatColours: [], coatPattern: null, markings: [], description: null,
      mainPhotoUrl: null, photoUrls: [],
    } as never;
    const html = renderGuardianCatPage(who, cat, [], undefined, { mine: { putBack: null, lookedAgain: [] } as never });
    expect(html).toContain("Probably sterilised means someone saw a clipped ear");
    expect(html).toContain("If you say a cat has died, the app stops sending");
    expect(html).toContain("people can no longer follow her");
  });
});

describe("Feeding sites help", () => {
  const list = (o: Record<string, unknown> = {}) =>
    renderSitesPage({
      personName: "Sam",
      counts: { total: 1, public: 0, private: 1, retired: 0 },
      changes: [],
      sites: [],
      showRetired: false,
      ...o,
    } as never);
  const site = (isPublic: boolean) =>
    ({
      id: 1, name: "Steps", lat: 37.44, lng: 24.94, isPublic, madePublicAt: null, madePublicBy: null, retiredAt: null,
      publicLabel: null, colony: null, notes: null, directions: null, updatedAt: "2026-10-26 00:00:00.000000", history: [],
    }) as never;

  it("opens the list with what a pin is, and says what Public and Retired mean", () => {
    const html = list();
    expect(html).toContain('<p class="intro">Each pin is a place where street cats are fed. Every new site starts private: only Syros Cats people signed in here can see it.</p>');
    expect(html).toContain("Public means the team has chosen to show a site to visitors");
    expect(html).toContain("This page cannot make a site public yet");
    expect(html).toContain("Retired means the site comes off the map and out of every public view.");
    expect(html).not.toContain("QR sticker");
  });
  it("mentions QR stickers only where a site is public, and not to a cat guardian", () => {
    expect(list({ counts: { total: 1, public: 1, private: 0, retired: 0 } })).toContain("A QR sticker is a printed code");
    expect(list({ island: false, counts: { total: 1, public: 1, private: 0, retired: 0 } })).not.toContain("A QR sticker");
    expect(list({ island: false })).toContain("You see only the sites in your own colonies.");
  });
  it("explains the same on one site", () => {
    const html = renderSitePage({ personName: "Sam", site: site(true), colonies: [] });
    expect(html).toContain("This pin is one place where street cats are fed.");
    expect(html).toContain("A QR sticker is a printed code");
    expect(renderSitePage({ personName: "Sam", site: site(false), colonies: [] })).not.toContain("A QR sticker is");
  });
});
