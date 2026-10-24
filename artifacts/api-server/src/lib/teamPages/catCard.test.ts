import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderCatPage } from "./catPages";
import { renderCatCard } from "./catCard";
import { bareCatView, catView, richCatView, statement } from "./__fixtures__/catView";

// SYC-655 Task 2: the header card (spec §2, §5).

const NOW = new Date("2026-10-17T09:00:00Z");
const may = () => true;
const page = (v = richCatView(), opts = {}) => renderCatPage(v, "Sam", { now: NOW, ...opts });
const photo = (publicId: string, source: string, hidden: unknown = null) => ({ source, publicId, url: `/${publicId}.jpg`, hidden });
const fivePhotos = () => [
  photo("p1", "main"),
  photo("p2", "sighting"),
  photo("p3", "sighting"),
  photo("p4", "sighting", { by: "Maria", at: "2026-10-01T09:00:00Z" }),
  photo("p5", "sighting"),
];
const withPhotos = (photos = fivePhotos(), main: string | null = "/p1.jpg") =>
  catView({ cat: { mainPhotoUrl: main }, photos, sightings: richCatView().sightings } as never);
/** The header card: from its opening tag to the first tab or the end of the actions. */
const cardOf = (html: string) => {
  const at = html.indexOf('<div class="catcard');
  expect(at, "no .catcard").toBeGreaterThan(-1);
  return html.slice(at, html.indexOf("</main>"));
};
const textOf = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const report = { id: "i1", reason: "wrong_cat", state: "new", at: "2026-10-15T09:00:00Z", others: 0, photo: null };

describe("the header card (SYC-655 Task 2)", () => {
  let savedKey: string | undefined;
  beforeAll(() => {
    savedKey = process.env["TEAM_SESSION_KEYS"];
    process.env["TEAM_SESSION_KEYS"] = "vitest-catcard-key-0123456789abcdef-0123456789";
  });
  afterAll(() => {
    if (savedKey === undefined) delete process.env["TEAM_SESSION_KEYS"];
    else process.env["TEAM_SESSION_KEYS"] = savedKey;
  });

  it("orders the card: open reports, photo, name, SYR line, facts, description, public line, actions", () => {
    const v = withPhotos();
    v.cat.description = "Grey tabby with white paws.";
    const html = page(v, { may, colonies: [], issues: { total: 1, reports: [report] } });
    const card = cardOf(html);
    const marks = [
      'class="openreports"',
      'class="photo" href="#tab-photos"',
      "<h1>",
      'class="syrline"',
      'class="catfacts kf"',
      'class="desc"',
      'class="publicline"',
      'id="corrections"',
    ];
    const at = marks.map((m) => card.indexOf(m));
    expect(at.every((i) => i > -1), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("draws the name and the sterilisation mark as the page heading, once, inside the card", () => {
    const html = page(richCatView());
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    const card = cardOf(html);
    const line = /<div class="nameline">[\s\S]*?<\/div>/.exec(card)![0];
    expect(line).toMatch(/^<div class="nameline"><h1>Tiger<\/h1>/);
    expect(line).toContain("mark-sterilised");
    expect(line).toContain('title="Sterilised"');
    expect(line).toContain('<span class="sr">Sterilised</span>');
    expect(html).toContain("<title>Tiger");
  });

  it("has no status line, and says when the cat was last seen once, in the facts", () => {
    const html = page(richCatView());
    expect(html).not.toContain('class="statusline"');
    const card = textOf(cardOf(html));
    expect(card.match(/4 days ago/g)).toHaveLength(1);
    expect(textOf(html).match(/4 days ago/g)).toHaveLength(1);
    expect(card).toMatch(/Last seen 4 days ago/);
  });

  describe("the photo", () => {
    it("labels five photos, one of them hidden, and links to the Photos tab", () => {
      const card = cardOf(page(withPhotos()));
      expect(card).toMatch(/<a class="photo" href="#tab-photos">[\s\S]*?<span class="photocount">5 photos<\/span><\/a>/);
      expect(card).toContain('<img class="photo catmain"');
    });

    it("makes the label at least 44px to tap", () => {
      const rule = /\.photocount\{[^}]*\}/.exec(page(withPhotos()))?.[0] ?? "";
      expect(rule).toMatch(/min-height:44px/);
    });

    it("has no label with one photo", () => {
      const card = cardOf(page(withPhotos([photo("p1", "main")])));
      expect(card).not.toContain("photocount");
      expect(card).not.toContain('href="#tab-photos"');
      expect(card).toContain('<img class="photo catmain"');
    });

    it("puts the label on the placeholder when there is no main photo but photos on file", () => {
      const card = cardOf(page(withPhotos(fivePhotos().slice(1), null)));
      expect(card).toMatch(/<a class="photo" href="#tab-photos"><div class="nophoto">No photo<\/div><span class="photocount">4 photos<\/span><\/a>/);
    });

    it("dims a hidden main photo", () => {
      const photos = [photo("p1", "main", { by: "Maria", at: "2026-10-01T09:00:00Z" }), photo("p2", "sighting")];
      const card = cardOf(page(withPhotos(photos)));
      expect(card).toMatch(/<img class="photo catmain ishidden"/);
      const clear = cardOf(page(withPhotos()));
      expect(clear).not.toMatch(/<img class="photo catmain ishidden"/);
    });
  });

  describe("the facts grid", () => {
    it("is dl.kf; Health note and Owner span the row", () => {
      const v = catView({
        owner: { has: true, orphanedHome: false, homeDescription: "Blue door", homePin: null },
        history: [statement(7, { kind: "team_note", noteText: "Limping on the left leg" })],
      } as never);
      const card = cardOf(page(v, { may }));
      expect(card).toContain('<dl class="catfacts kf">');
      expect(card).toMatch(/<div class="fact wide"><dt>Health note<\/dt>/);
      expect(card).toMatch(/<div class="fact wide"><dt>Owner<\/dt>/);
      expect(card).toMatch(/<div class="fact"><dt>Coat<\/dt>/);
      expect(card).not.toMatch(/<div class="fact wide"><dt>Coat<\/dt>/);
    });

    it("links the Last seen place to the Map tab when there are sightings", () => {
      const card = cardOf(page(richCatView()));
      expect(card).toMatch(/<dt>Last seen<\/dt><dd><time[^>]*>4 days ago<\/time> · <a href="#tab-map">[^<]+<\/a>/);
    });

    it("leaves the place as plain text when there are no sightings", () => {
      const card = cardOf(page(bareCatView()));
      expect(card).not.toContain('href="#tab-map"');
    });
  });

  describe("notices stay above the card", () => {
    const before = (html: string, needle: string) => {
      const n = html.indexOf(needle);
      expect(n, needle).toBeGreaterThan(-1);
      expect(n, needle).toBeLessThan(html.indexOf('<div class="catcard'));
    };

    it("the death notice, the guardian mark and the hidden-main-photo note", () => {
      const died = catView({
        records: { lifeStatus: { value: "deceased", confidence: "confirmed", supportingStatementIds: [9] } },
        history: [statement(9, { kind: "life_status", said: "Died" })],
      } as never);
      before(page(died), "has died");
      const guardian = catView({
        recentGuardianMark: { statementId: 5, status: "homed", at: "2026-10-10T09:00:00Z" },
        history: [statement(5)],
      });
      before(page(guardian), "Recently marked");
      const hidden = withPhotos([photo("p1", "main", { by: "Maria", at: "2026-10-01T09:00:00Z" }), photo("p2", "sighting")]);
      before(page(hidden), "The main photo is hidden");
    });

    it("the photo notice when the photo is no longer on the page (A7)", () => {
      const html = page(withPhotos(), { done: "hidden", photo: "gone" });
      before(html, "Hidden. The public no longer sees this photo");
      expect(html.match(/Hidden\. The public no longer sees this photo/g)).toHaveLength(1);
    });

    it("keeps the photo notice beside its photo when the photo is on the page", () => {
      const html = page(withPhotos(), { may, done: "hidden", photo: "p2" });
      expect(html.match(/Hidden\. The public no longer sees this photo/g)).toHaveLength(1);
      expect(html.indexOf("Hidden. The public no longer sees this photo")).toBeGreaterThan(html.indexOf('<div class="catcard'));
    });
  });

  it("draws a bare cat with No photo, no label and no reports box", () => {
    const html = page(bareCatView());
    const card = cardOf(html);
    expect(card).toContain('<div class="nophoto">No photo</div>');
    expect(card).not.toContain("photocount");
    expect(card).not.toContain("openreports");
    expect(card).toContain("<h1>Tiger</h1>");
  });

  it("returns the heading and the whole card from renderCatCard", () => {
    const v = richCatView();
    const out = renderCatCard(v, may, {
      now: NOW,
      byId: new Map(v.history.map((s) => [s.id, s])),
      shown: null,
      island: false,
      actions: '<div class="fixes" id="corrections"></div>',
    });
    expect(out.heading).toMatch(/^<div class="nameline"><h1>Tiger<\/h1>/);
    expect(out.card.startsWith('<div class="catcard')).toBe(true);
    expect(out.card).toContain(out.heading);
    expect(out.card).toContain('<div class="catactions"><div class="fixes" id="corrections">');
  });
});
