import { describe, expect, it } from "vitest";
import type { MoveScreen } from "../moveScreen";
import { renderMovePage, renderMoveStopPage, type MovePageOptions } from "./movePage";
import { moveHref } from "./moveLinks";

// The move screen, drawn (which-cat-is-which.md §5.2; SYC-150 PR 3.3). Pure:
// no database. The words are the spec's.

const screen = (over: Partial<MoveScreen> = {}): MoveScreen => ({
  from: {
    id: 7,
    name: "Mimi",
    syr: "SYR-0007",
    thumbnailUrl: "/api/team/photos/mimi-main",
    mainPhotoUrl: "/api/team/photos/mimi-main",
    recentPhotoUrls: ["/api/team/photos/mimi-a", "/api/team/photos/mimi-b"],
    keeps: 6,
  },
  moving: [{ id: 41, at: "2026-10-03T09:30:00Z", place: "Ermoupoli", photoUrls: ["/api/team/photos/moving-1"] }],
  chosen: null,
  chooseNote: "",
  results: null,
  whatMoves: {
    items: ["this photo", '"ear tip clipped (left)"', '"food and water were out"', "the spotter's note"],
    keeps: "Mimi keeps 6 sightings.",
    points: "The spotter keeps their 15 points.",
  },
  mainPhoto: null,
  warnings: [],
  ...over,
});

const ask = (over: Partial<MovePageOptions["ask"]> = {}): MovePageOptions["ask"] => ({
  cat: 7,
  sightings: [41],
  source: "cat_page",
  fresh: false,
  q: "",
  ...over,
});

const agatha = { id: 9, name: "Agatha", syr: "SYR-0009", thumbnailUrl: "/api/team/photos/agatha-main", namePending: false };

const draw = (s: MoveScreen, o: Partial<MovePageOptions> = {}) =>
  renderMovePage(s, { personName: "Maria", ask: ask(), ...o });

describe("the move screen: choosing the cat", () => {
  const choosing = screen({
    results: {
      heading: "Cats near this photo",
      cats: [
        { id: 9, name: "Agatha", syr: "SYR-0009", thumbnailUrl: "/api/team/photos/agatha-main", away: "120 m away" },
        { id: 12, name: "Tiger", syr: "SYR-0012", thumbnailUrl: null, away: "1.4 km away" },
      ],
    },
  });

  it("shows the photo, the cat it is under now, the search, the cats nearest first and “It's a new cat”", () => {
    const html = draw(choosing);
    expect(html).toContain("Moving this sighting");
    expect(html).toContain("Filed under now");
    expect(html).toContain('href="/api/team/cats/7"');
    expect(html).toContain("Which cat is it?");
    expect(html).toContain('role="search"');
    expect(html).toContain("Cats near this photo");
    expect(html).toContain("120 m away");
    expect(html).toContain("1.4 km away");
    expect(html).toContain("It's a new cat");
    // The way in to a different cat is a plain link carrying the numbers, never a position.
    expect(html).toContain(`href="${moveHref({ cat: 7, sightings: [41], to: 9 }).replace(/&/g, "&amp;")}"`);
    expect(html).not.toContain('name="reason"');
  });

  it("carries the sightings, the cat and the source in the search, and keeps the words typed", () => {
    const html = draw(choosing, { ask: ask({ q: "aga", sightings: [41, 42], source: "report", report: "r-1" }) });
    expect(html).toContain('<input type="hidden" name="cat" value="7">');
    expect(html).toContain('<input type="hidden" name="s" value="41,42">');
    expect(html).toContain('<input type="hidden" name="source" value="report">');
    expect(html).toContain('<input type="hidden" name="report" value="r-1">');
    expect(html).toContain('value="aga"');
  });

  it("says when nothing matched, and when the address named a cat it can't use", () => {
    const html = draw(
      screen({ results: { heading: "No cat found for “zzz”", cats: [] }, chooseNote: "That's the cat it's filed under already." }),
    );
    expect(html).toContain("No cat found for “zzz”");
    expect(html).toContain("No cats to show.");
    expect(html).toContain("That&#39;s the cat it&#39;s filed under already.");
  });

  it("says “these sightings” for several", () => {
    const two = screen({
      moving: [
        { id: 41, at: "2026-10-03T09:30:00Z", place: "Ermoupoli", photoUrls: ["/api/team/photos/m1"] },
        { id: 42, at: "2026-10-04T09:30:00Z", place: "Ermoupoli", photoUrls: ["/api/team/photos/m2"] },
      ],
    });
    expect(draw(two)).toContain("Moving these 2 sightings");
  });

  it("escapes every name", () => {
    const html = draw(screen({ results: { heading: "Cats near this photo", cats: [{ id: 5, name: "<b>Evil</b>", syr: "SYR-0005", thumbnailUrl: null, away: null }] } }));
    expect(html).not.toContain("<b>Evil</b>");
    expect(html).toContain("&lt;b&gt;Evil&lt;/b&gt;");
  });
});

describe("the move screen: the form", () => {
  const chosen = screen({ chosen: agatha });

  it("puts Why, What moves and Move on the screen, in the spec's words", () => {
    const html = draw(chosen, { ask: ask({ to: 9 }) });
    expect(html).toContain('action="/api/team/sightings/move/form"');
    expect(html).toContain("Why?");
    for (const w of ["Different markings", "Two cats in the photo", "Wrong cat picked", "Other…"]) expect(html).toContain(w);
    expect(html).toContain("What moves");
    // The spec's line (§5.2), Oxford comma and straight quotes.
    expect(html).toContain("Moves to <b>Agatha</b>: this photo, &quot;ear tip clipped (left)&quot;, &quot;food and water were out&quot;, and the spotter&#39;s note.");
    expect(html).toContain("Mimi keeps 6 sightings.");
    expect(html).toContain("The spotter keeps their 15 points.");
    expect(html).toContain('<input type="hidden" name="to" value="9">');
    expect(html).toContain(">Move</button>");
    expect(html).toContain("Choose a different cat");
  });

  it("shows only the warnings that are true (§5.2's table), each in its own words", () => {
    const warnings = [
      "Agatha is recorded as having died. Moving this photo says she was seen alive on 3 October, which will change her record back to alive.",
      "Agatha will go on the Likely list for a check.",
      "This photo was taken 2.3 km from where Agatha is usually seen.",
      "This photo is hidden and stays hidden after the move. If the only reason was the wrong cat, show it again from the photo's own menu.",
    ];
    const html = draw(screen({ chosen: agatha, warnings }));
    for (const w of warnings) expect(html).toContain(w.replace(/'/g, "&#39;"));
    expect(html.match(/class="warn"/g)).toHaveLength(4);
    expect(draw(chosen)).not.toContain('class="warn"');
  });

  it("asks for the old cat's next main photo, or “No photo for now”, only when its main photo is moving", () => {
    const html = draw(screen({ chosen: agatha, mainPhoto: { choices: [{ id: 301, url: "/api/team/photos/p1/small" }, { id: 302, url: "/api/team/photos/p2/small" }] } }));
    expect(html).toContain("Mimi's main photo is moving. Choose the next one.");
    expect(html).toContain('name="mainPhoto" value="301"');
    expect(html).toContain('name="mainPhoto" value="302"');
    expect(html).toContain('name="mainPhoto" value="0"');
    expect(html).toContain("No photo for now");
    expect(draw(chosen)).not.toContain('name="mainPhoto"');
  });

  it("“It's a new cat” asks for a name or “Let spotters name it”, and says what the tick does", () => {
    const html = draw(screen({ whatMoves: { items: ["this photo"], keeps: "Mimi keeps 6 sightings.", points: null } }), { ask: ask({ fresh: true }) });
    expect(html).toContain("It's a new cat");
    expect(html).toContain('name="name"');
    expect(html).toContain('name="letSpottersName"');
    expect(html).toContain("Let spotters name it");
    expect(html).toContain("shows its SYR number until someone names it");
    expect(html).toContain('<input type="hidden" name="new" value="1">');
    expect(html).toContain("Moves to <b>a new cat</b>: this photo.");
    expect(html).not.toContain("The spotter keeps");
  });

  it("keeps what was filled in when it comes back with a refusal", () => {
    const html = draw(screen({ chosen: agatha }), {
      ask: ask({ to: 9 }),
      kept: { reason: "two_cats", reasonText: "Two at the bowl <b>", mainPhoto: undefined },
    });
    expect(html).toMatch(/value="two_cats" checked/);
    expect(html).toContain('value="Two at the bowl &lt;b&gt;"');
  });

  it("keeps a typed name and the tick for a new cat", () => {
    const html = draw(screen(), { ask: ask({ fresh: true }), kept: { name: "Biscuit", letSpottersName: false } });
    expect(html).toContain('value="Biscuit"');
    const ticked = draw(screen(), { ask: ask({ fresh: true }), kept: { letSpottersName: true } });
    expect(ticked).toMatch(/name="letSpottersName" value="1" checked/);
  });
});

describe("the move screen: every refusal says why, and that nothing moved", () => {
  const refusals: [string, string][] = [
    ["MERGE_INSTEAD", "These look like the same cat. Ask for a merge."],
    ["SAME_CAT", "That's the cat it's filed under already."],
    ["MAIN_PHOTO_NEEDED", "This is Mimi's main photo. Choose Mimi's new main photo, or \"No photo for now\"."],
    ["ALREADY_ITS_OWN_CAT", "This is everything Mimi has, so it isn't a new cat: Mimi already is a cat of her own."],
    ["REPORT_NOT_FOUND", "That report doesn't exist, or isn't a \"That's a different cat\" report."],
    ["EMPTY_NAME", "Type a name, or tick “Let spotters name it”."],
    ["NAME_HAS_LINK", "A name can't hold a web link or a phone number."],
  ];
  for (const [code, message] of refusals) {
    it(`${code}: “${message}”`, () => {
      const html = draw(screen({ chosen: agatha }), { ask: ask({ to: 9 }), problem: { message } });
      expect(html).toContain('role="alert"');
      expect(html).toContain(message.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;"));
      expect(html).toContain("Nothing was moved.");
    });
  }

  it("a name already taken links to the cat that has it", () => {
    const html = draw(screen({ chosen: agatha }), {
      problem: { message: "That name is taken.", link: { href: "/api/team/cats/12", label: "Open Tiger" } },
    });
    expect(html).toContain('<a href="/api/team/cats/12">Open Tiger</a>');
  });

  it("“Someone changed this a moment ago” is its own page, with where each sighting is now", () => {
    const html = renderMoveStopPage("Maria", { message: "Someone changed this a moment ago.", now: [{ catId: 9, name: "Agatha" }] }, 7);
    expect(html).toContain("Someone changed this a moment ago. Nothing was moved.");
    expect(html).toContain('It is now filed under <a href="/api/team/cats/9">Agatha</a>');
    expect(html).toContain('href="/api/team/cats/7"');
    expect(html).not.toContain("/api/team/sightings/move/form");
  });
});
