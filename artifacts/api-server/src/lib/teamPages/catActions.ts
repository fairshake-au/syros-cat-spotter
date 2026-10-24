import type { LifeStatusValue } from "../resolve";
import type { Capability } from "../capabilities";
import type { TeamCatView } from "../teamCatView";
import { escapeHtml as esc } from "./escape";
import type { KeptFields } from "./signedOutPage";

// The buttons on the team's cat page: "Log a vet visit", "Update this cat" and
// "This cat has died" (SYC-602 spec 3.2). Server-drawn, no scripts.

// The app's own English words (artifacts/cat-spotter/lib/i18n.ts), so the
// team reads the public line exactly as a spotter does.
export const LIFE: Record<LifeStatusValue, string> = {
  street: "Lives on the street",
  homed: "Has a home",
  in_care: "In Syros Cats' care",
  deceased: "No longer with us",
};


/** Today on Syros, for a date box's max. */
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Athens" });

export const LIFE_ORDER: LifeStatusValue[] = ["street", "homed", "in_care", "deceased"];

export const reasonInput = (id: string, label = "Why", value?: string) =>
  `<label class="label" for="${id}">${esc(label)}</label>` +
  `<input class="text" id="${id}" name="reason" required maxlength="500" autocomplete="off"${value !== undefined ? ` value="${esc(value)}"` : ""}>`;

/** A fold that starts open when its form was filled in again (SYC-516 C3). */
export const fold = (open: boolean) => `<details${open ? " open" : ""}>`;

export const dateInput = (id: string, label: string, hint: string) =>
  `<label class="label" for="${id}">${esc(label)} <span class="hint">${esc(hint)}</span></label>` +
  `<input id="${id}" name="date" type="date" max="${today()}">`;

export const lifeChoices = (
  name: string,
  idBase: string,
  skip: LifeStatusValue | null,
  allowed: readonly LifeStatusValue[] = LIFE_ORDER,
  checked: LifeStatusValue | null = null,
) =>
  LIFE_ORDER.filter((l) => l !== skip && allowed.includes(l))
    .map(
      (l) =>
        `<label class="choice" for="${idBase}-${l}"><input type="radio" id="${idBase}-${l}" name="${name}" value="${l}" required${l === checked ? " checked" : ""}> ${esc(LIFE[l])}</label>`,
    )
    .join("");


/**
 * The `done` keys whose notice goes at the top of the opened "Update this cat"
 * list. The others (a vet visit, a correction, a photo, a death) show beside
 * the thing they changed.
 */
export const UPDATE_DONE: ReadonlySet<string> = new Set([
  "life",
  "sterilised",
  "renamed",
  "unchanged",
  "ownerRemoved",
  "ownerRemovedKept",
  "ownerGone",
  "lifeOwnerKept",
  "colony",
  "colonyOut",
  "colonyAlready",
]);

/** "Change the colony": pick one from the list of all colonies. */
function colonyForm(v: TeamCatView, colonies: { id: number; name: string }[]): string {
  const base = `/api/team/cats/${v.cat.id}/colony`;
  if (colonies.length === 0) {
    return (
      "<details><summary>Change the colony</summary>" +
      '<p class="hint">There are no colonies yet. <a href="/api/team/colonies">Create one</a> first.</p></details>'
    );
  }
  const options = colonies
    .map(
      (c) =>
        `<option value="${c.id}"${c.id === v.colony?.id ? " selected" : ""}>${esc(c.name)}</option>`,
    )
    .join("");
  return (
    `<details><summary>Change the colony</summary><form method="post" action="${base}">` +
    '<label class="label" for="co-pick">Put the cat in</label>' +
    `<select class="text" id="co-pick" name="colonyId" required>${options}</select>` +
    '<p class="hint">If the cat is in another colony now, it moves. Both are kept in the history below.</p>' +
    '<button type="submit">Save</button></form></details>'
  );
}

/** "Take out of this colony": its own item, in red, only for a cat in a colony. */
function takeOutForm(v: TeamCatView): string {
  return (
    '<details><summary class="risky">Take out of this colony</summary>' +
    `<form method="post" action="/api/team/cats/${v.cat.id}/colony"><input type="hidden" name="colonyId" value="none">` +
    '<button type="submit" class="risky">Take out of this colony</button></form></details>'
  );
}

/**
 * The buttons, each drawn only for someone who may: Log a vet visit, then the
 * "Update this cat" list, then "This cat has died" set apart. `done` and
 * `notice` say where the page has just come back from.
 */
export function renderCatActions(
  v: TeamCatView,
  may: (c: Capability) => boolean,
  opts: {
    notice: string;
    colonies: { id: number; name: string }[];
    kept?: { formKey: string; fields: KeptFields };
    done?: string;
  },
): string {
  const { notice, colonies, kept } = opts;
  const base = `/api/team/cats/${v.cat.id}`;
  const keptFor = (form: string) => (kept?.formKey === `${form}:${v.cat.id}` ? kept.fields : undefined);
  const life = keptFor("life");
  const ster = keptFor("sterilised");
  const rename = keptFor("name");
  const noteKept = keptFor("note");
  const items: string[] = [];
  // Recorded as died and nothing disagrees: no "This cat has died" button,
  // and Remove owner offers only "Still no longer with us" (SYC-513, spec §7).
  const dead =
    v.records.lifeStatus.value === "deceased" && v.records.lifeStatus.conflictingStatementIds.length === 0;
  if (may("set_life_status")) {
    items.push(
      `${fold(life !== undefined)}<summary>Where the cat lives</summary><form method="post" action="${base}/life-status">` +
        '<fieldset><legend class="label">The cat…</legend>' +
        lifeChoices("status", "ls", null, ["street", "homed", "in_care"]) +
        "</fieldset>" +
        // Owned cat (spec §7, SYC-362 D2): no box. Saving anything but "has a
        // home" asks first, on its own page, before the owner is removed.
        ((v.owner.has || v.owner.orphanedHome) && may("remove_owner")
          ? '<p class="hint">This cat has an owner. Saving anything but “Has a home” asks you first whether to remove the owner.</p>'
          : "") +
        dateInput("ls-date", "Date it happened", "(leave blank for today)") +
        reasonInput("ls-why", undefined, life?.["reason"]) +
        '<button type="submit">Save</button></form></details>',
    );
  }
  if (may("set_sterilisation")) {
    items.push(
      `${fold(ster !== undefined)}<summary>Whether sterilised</summary><form method="post" action="${base}/sterilisation">` +
        '<p class="warn">A clipped ear seen in a photo is never proof. Use this only when Syros Cats or a vet knows.</p>' +
        '<fieldset><legend class="label">The cat is…</legend>' +
        '<label class="choice" for="st-yes"><input type="radio" id="st-yes" name="sterilised" value="yes" required> Sterilised</label>' +
        '<label class="choice" for="st-no"><input type="radio" id="st-no" name="sterilised" value="no" required> Not sterilised</label>' +
        "</fieldset>" +
        dateInput("st-date", "When it was done", "(optional)") +
        '<label class="label" for="st-clinic">Clinic or vet <span class="hint">(optional)</span></label>' +
        '<input class="text" id="st-clinic" name="clinic" maxlength="100" autocomplete="off">' +
        reasonInput("st-why", "How we know", ster?.["reason"]) +
        '<button type="submit">Save</button></form></details>',
    );
  }
  // The coat form lives in the Coat and markings section (PR 3 opens it from here).
  if (may("set_appearance")) {
    items.push('<a class="tap coatlink" href="?open=coat#appearance">Coat and markings</a>');
  }
  if (may("assign_cat_to_colony")) {
    items.push(colonyForm(v, colonies));
    if (v.colony) items.push(takeOutForm(v));
  }
  if (may("rename_cat")) {
    items.push(
      `${fold(rename !== undefined)}<summary>Rename the cat</summary><form method="post" action="${base}/name">` +
        '<label class="label" for="rn-name">New name</label>' +
        `<input class="text" id="rn-name" name="name" required maxlength="60" value="${esc(rename?.["name"] ?? v.cat.name)}" autocomplete="off" spellcheck="false">` +
        reasonInput("rn-why", undefined, rename?.["reason"]) +
        '<button type="submit">Rename</button></form></details>',
    );
  }
  if ((v.owner.has || v.owner.orphanedHome) && may("remove_owner") && may("set_life_status")) {
    items.push(
      `<details><summary class="risky">Remove owner</summary><form method="post" action="${base}/remove-owner">` +
        '<p class="hint">Ends this claim. The owner stops seeing the exact spot and getting alerts. Nobody is told.</p>' +
        (dead
          ? '<fieldset><legend class="label">The cat now…</legend>' +
            '<label class="choice" for="ro-keep"><input type="radio" id="ro-keep" name="status" value="keep" required checked> Still no longer with us</label>' +
            "</fieldset>"
          : '<fieldset><legend class="label">The cat now…</legend>' +
            lifeChoices("status", "ro", null, ["street", "in_care"], "street") +
            "</fieldset>" +
            '<p class="hint">If the cat has died, use “This cat has died” instead.</p>' +
            dateInput("ro-date", "Date it happened", "(leave blank for today)")) +
        reasonInput("ro-why") +
        '<button type="submit" class="risky">Remove owner</button></form></details>',
    );
  }
  const died =
    may("set_life_status") && !dead
      ? `<form method="get" action="${base}/died" class="diedform"><button type="submit">This cat has died</button></form>`
      : "";
  // Log a vet visit (spec §7.2): the main action, full width, above the rest.
  const vet = may("log_vet_visit")
    ? `<form method="get" action="${base}/vet-visit" class="vetvisit"><button type="submit" class="primary wide">Log a vet visit</button></form>`
    : "";
  // Add a note (spec §3.2 item 3): the third button, an outlined one that
  // opens a short form. Team only; its notice (done=note) sits at the top of
  // the block, outside any closed fold, like the other notices not in the list.
  // Held typing keeps up to 4000 characters; a note takes 2000 (UTF-16 units,
  // as the textarea's maxlength counts), and a cut never splits an emoji.
  const noteText = cutToNote(noteKept?.["text"] ?? "");
  const note = may("add_team_note")
    ? `<details class="addnote"${noteKept !== undefined ? " open" : ""}><summary>Add a note</summary>` +
      `<form method="post" action="${base}/note">` +
      '<label class="label" for="nt-text">Note <span class="hint">(team only: guardians and the public never see it)</span></label>' +
      `<textarea class="text" id="nt-text" name="text" rows="4" required maxlength="${NOTE_CHARS}">${esc(noteText)}</textarea>` +
      '<button type="submit">Save note</button></form></details>'
    : "";
  if (items.length === 0 && !died && !note) return vet ? `<div class="fixes" id="corrections">${notice}${vet}</div>` : notice;
  // The list opens by itself when a form in it was filled in again, or when
  // the page comes back from one of its saves (spec 3.2, "After a save").
  const inList = opts.done !== undefined && UPDATE_DONE.has(opts.done) && items.length > 0;
  const open = inList || life !== undefined || ster !== undefined || rename !== undefined;
  const list =
    items.length === 0
      ? ""
      : `<details class="update"${open ? " open" : ""}><summary>Update this cat</summary>${inList ? notice : ""}${items.join("")}</details>`;
  return (
    `<div class="fixes" id="corrections">` +
    (inList ? "" : notice) +
    vet +
    list +
    note +
    died +
    // "How changes work" is at the foot of History now (spec §3.2, SYC-602 PR 2).
    "</div>"
  );
}

const NOTE_CHARS = 2000;

function cutToNote(text: string): string {
  if (text.length <= NOTE_CHARS) return text;
  const cut = text.slice(0, NOTE_CHARS);
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/**
 * The cat page's top block: photo, facts, the buttons and the small map.
 * One column on a phone, in this source order; on a big screen the photo and
 * map sit in the left column, the facts in the middle, the buttons on the
 * right (spec section 4). Without the buttons the facts take their place.
 */
export function summaryAndActions(parts: { photo: string; facts: string; map: string }, fixes: string): string {
  const actions = fixes.includes('class="fixes"');
  return (
    `<div class="catsummary${actions ? "" : " noactions"}">` +
    `<div class="col-photo">${parts.photo}</div>` +
    `<div class="col-facts">${parts.facts}</div>` +
    (actions ? `<div class="catactions">${fixes}</div>` : "") +
    (parts.map ? `<div class="col-map">${parts.map}</div>` : "") +
    "</div>" +
    (actions ? "" : fixes)
  );
}
