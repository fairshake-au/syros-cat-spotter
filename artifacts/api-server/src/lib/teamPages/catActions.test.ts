import { describe, expect, it } from "vitest";
import { renderCatActions, UPDATE_DONE } from "./catActions";
import { catView, richCatView } from "./__fixtures__/catView";
import type { Capability } from "../capabilities";

// SYC-602 Task 1.3: the buttons and "Update this cat".

const all = () => true;
const colonies = [
  { id: 4, name: "Vaporia steps" },
  { id: 5, name: "Harbour" },
];
const draw = (v = richCatView(), may: (c: Capability) => boolean = all, opts: Partial<Parameters<typeof renderCatActions>[2]> = {}) =>
  renderCatActions(v, may, { notice: "", colonies, ...opts });
const owned = () => catView({ owner: { has: true } });
const UPDATE = '<details class="update"><summary>Update this cat</summary>';

describe("renderCatActions", () => {
  it("draws the buttons in order", () => {
    const html = draw();
    const vet = html.indexOf("Log a vet visit");
    const update = html.indexOf(UPDATE);
    const note = html.indexOf("Add a note");
    const died = html.indexOf('class="diedform"');
    expect(vet).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(vet);
    expect(note).toBeGreaterThan(html.indexOf("</details>", update));
    expect(died).toBeGreaterThan(note);
  });

  it("Add a note is a team-only outlined button that opens a short form, drawn only with add_team_note", () => {
    const html = draw(catView({ cat: { id: 42 } }));
    expect(html).toContain('<details class="addnote"><summary>Add a note</summary><form method="post" action="/api/team/cats/42/note">');
    expect(html).toMatch(/<textarea[^>]*name="text"[^>]*maxlength="2000"[^>]*required|<textarea[^>]*required[^>]*maxlength="2000"/);
    expect(html).toContain("Save note");
    expect(draw(catView({ cat: { id: 42 } }), (c) => c !== "add_team_note")).not.toContain("Add a note");
    // Someone who may only add a note still gets the block.
    expect(draw(catView({ cat: { id: 42 } }), (c) => c === "add_team_note")).toContain("Add a note");
  });

  it("Add a note comes back open with the typed text, and the saved notice sits at the top of the block", () => {
    const v = catView({ cat: { id: 42 } });
    const kept = draw(v, all, { kept: { formKey: "note:42", fields: { text: "limping <b>left</b>" } } });
    expect(kept).toContain('<details class="addnote" open>');
    expect(kept).toContain(">limping &lt;b&gt;left&lt;/b&gt;</textarea>");
    expect(kept).not.toContain('<details class="update" open>');
    const done = draw(v, all, { done: "note", notice: '<p class="notice" role="status">Saved.</p>' });
    expect(done.indexOf('class="notice"')).toBeGreaterThan(-1);
    expect(done.indexOf('class="notice"')).toBeLessThan(done.indexOf("Log a vet visit"));
    expect(done).not.toContain('<details class="update" open>');
  });

  it("held typing longer than a note may be refills cut to 2000 characters, never half an emoji", () => {
    const v = catView({ cat: { id: 42 } });
    const long = draw(v, all, { kept: { formKey: "note:42", fields: { text: "a".repeat(3500) } } });
    expect(long).toContain(`>${"a".repeat(2000)}</textarea>`);
    expect(long).not.toContain("a".repeat(2001));
    const split = draw(v, all, { kept: { formKey: "note:42", fields: { text: "b".repeat(1999) + "\u{1F63A}" + "tail" } } });
    expect(split).toContain(`>${"b".repeat(1999)}</textarea>`);
  });

  it("lists the forms in the spec's order and words", () => {
    const html = draw(catView({ owner: { has: true }, colony: { id: 4, name: "Vaporia steps", wasName: null } }));
    const start = html.indexOf(UPDATE);
    const end = html.indexOf("</details>", html.indexOf("Remove owner</summary>"));
    const list = html.slice(start, end);
    const order = [
      "Where the cat lives",
      "Whether sterilised",
      'href="#appearance">Coat and markings',
      "Change the colony",
      "Take out of this colony",
      "Rename the cat",
      "Remove owner",
    ].map((w) => list.indexOf(w));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(list).toMatch(/<summary class="risky">Take out of this colony/);
    expect(list).toMatch(/<summary class="risky">Remove owner/);
  });

  it("leaves out Take out of this colony without a colony, and Remove owner without an owner", () => {
    const html = draw(catView({}));
    expect(html).not.toContain("Take out of this colony");
    expect(html).not.toContain("Remove owner");
    expect(html).toContain("Change the colony");
  });

  it("needs both remove_owner and set_life_status for Remove owner", () => {
    expect(draw(owned(), (c) => c !== "remove_owner")).not.toContain("Remove owner");
    expect(draw(owned(), (c) => c !== "set_life_status")).not.toContain("Remove owner");
    expect(draw(owned())).toContain("Remove owner");
  });

  it("draws nothing a person may not do", () => {
    const html = draw(richCatView(), () => false);
    expect(html).not.toContain('class="update"');
    expect(html).not.toContain("Log a vet visit");
    expect(html).not.toContain("This cat has died");
  });

  it("opens the list and the form when the page comes back to it", () => {
    const v = catView({ cat: { id: 42 } });
    const html = draw(v, all, { kept: { formKey: "life:42", fields: { reason: "seen today" } } });
    expect(html).toContain('<details class="update" open>');
    expect(html).toMatch(/<details open><summary>Where the cat lives<\/summary>/);
    expect(html).toMatch(/<details><summary>Whether sterilised<\/summary>/);
    expect(draw(v, all, { kept: { formKey: "life:41", fields: {} } })).toContain(UPDATE);
  });

  it("opens the list with the notice first when the page comes back from a saved form", () => {
    const notice = '<p class="notice" role="status">Saved.</p>';
    const html = draw(richCatView(), all, { notice, done: "colony" });
    expect(html).toContain(`<details class="update" open><summary>Update this cat</summary>${notice}`);
    expect(html.split(notice)).toHaveLength(2);
  });

  it("leaves the list closed after a vet visit", () => {
    const notice = '<p class="notice" role="status">Saved.</p>';
    const html = draw(richCatView(), all, { notice, done: "visit" });
    expect(html).toContain(UPDATE);
    expect(html).not.toContain('class="update" open');
  });

  it("keeps the died button apart and hides it for a dead cat", () => {
    const html = draw();
    expect(html).toContain('<form method="get" action="/api/team/cats/');
    expect(html.indexOf("diedform")).toBeGreaterThan(html.indexOf("Rename the cat"));
    const dead = richCatView();
    dead.records.lifeStatus.value = "deceased";
    expect(draw(dead)).not.toContain('class="diedform"');
  });

  it("names the done keys that open the list", () => {
    expect([...UPDATE_DONE].sort()).toEqual(
      ["colony", "colonyAlready", "colonyOut", "life", "lifeOwnerKept", "ownerGone", "ownerRemoved", "ownerRemovedKept", "renamed", "sterilised", "unchanged"].sort(),
    );
  });
});

describe("help under the buttons (SYC-739)", () => {
  it("says what a change does and where it can be undone, with How changes work", () => {
    const html = draw();
    expect(html).toContain("saved with your name and shows in the History tab");
    expect(html).toContain("<summary>How changes work</summary>");
    expect(html).toContain("use “This cat has died” instead");
  });
});
