import { renderPage } from "./layout";
import { escapeHtml as esc } from "./escape";
import { LIVE_LANGUAGES } from "./strings";
import { RELATIONSHIP_LABELS, type PersonView } from "../people/screen";
import { SCOPE_RELATIONSHIPS } from "@workspace/db";

// SYC-53 PR 1.2: the People screen's pages (roles-and-invites.md §8.1, §8.2,
// §9). Server-drawn, no scripts, English only (Decision 10). Every value a
// person typed or that came from a record (names, addresses, colony names)
// goes through esc() where it is drawn; the rest is fixed text written here.
// Nothing on any form here is a free-text box that ends up in an email: the
// typed values are the address, the name, dates, and choices from fixed lists.

const PEOPLE = "/api/team/people";

const CSS = `<style>
.tabs{display:flex;gap:8px;margin:8px 0 12px;flex-wrap:wrap}
.tabs a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border:1px solid #0b5c6b;border-radius:8px;text-decoration:none;color:#0b4553;background:#fff}
.tabs a.on{background:#0b5c6b;color:#fff;font-weight:700}
.person{background:#fff;border:1px solid #d9d5ca;border-left:6px solid #0b5c6b;border-radius:8px;padding:12px;margin:10px 0;overflow-wrap:anywhere}
.person.left{border-left-color:#8a877e;background:#faf9f6}
.person .head strong{font-size:17px}
.chip{display:inline-block;font-size:13px;font-weight:700;border-radius:999px;padding:2px 10px;background:#eee9da;color:#3b3930}
.chip.joined{background:#d7efe0;color:#14532d}
.chip.invited{background:#d9ecf0;color:#0b4553}
.chip.expired{background:#fde2c8;color:#7a3b00}
.chip.not_sent{background:#fff3cd;color:#5c4800}
.chip.left{background:#e4e1d8;color:#3b3930}
.person p{margin:4px 0}
.person ul.pl{margin:4px 0;padding-left:20px}
.person ul.pl li{margin:2px 0}
.acts{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0;align-items:flex-start}
.acts form{margin:0}
.pbtn,a.pbtn{font:inherit;font-size:15px;min-height:44px;padding:8px 16px;border-radius:8px;border:1px solid #0b5c6b;background:#fff;color:#0b4553;cursor:pointer;display:inline-flex;align-items:center;text-decoration:none}
.pbtn.go{background:#0b5c6b;color:#fff}
.pbtn.danger{border-color:#b3261e;color:#8c1d18}
.pbtn.danger.go{background:#b3261e;color:#fff}
details.confirm{border:1px solid #d9d5ca;border-radius:8px;padding:0 12px;background:#fff}
details.confirm summary{cursor:pointer;min-height:44px;display:flex;align-items:center;color:#8c1d18;font-weight:700}
details.confirm[open]{padding-bottom:12px}
details.hist summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:700;color:#0b4553}
ol.hist{margin:0 0 4px;padding-left:20px}
ol.hist li{margin:4px 0;font-size:15px}
ol.hist .when{color:#55524a;font-size:13px;display:block}
.pform label.l{display:block;font-size:14px;font-weight:700;margin:8px 0 4px}
.pform input[type=email],.pform input[type=text],.pform select{display:block;width:100%;font:inherit;font-size:16px;min-height:44px;padding:8px 10px;border:1px solid #8a877e;border-radius:8px;background:#fff}
.pform .colrow{border:1px solid #e6e2d6;border-radius:8px;padding:4px 10px 8px;margin:6px 0;background:#faf9f6}
.pform .colrow input[type=date],.pform .colrow select{max-width:100%}
.pform .off{color:#6b685f}
.okbox{background:#e3f4ea;border:1px solid #2e7d4f;border-radius:8px;padding:10px 12px;margin:12px 0}
.okbox p{margin:4px 0}
.joined7 li{margin:2px 0}
</style>`;

const page = (viewer: string, title: string, body: string, beforeTitle?: string) =>
  renderPage({
    title,
    active: "people",
    personName: viewer,
    showPeople: true,
    beforeTitle,
    body: CSS + body,
  });

// ── What happened (shown after a change; built from ids looked up on the server) ──

export interface Done {
  kind: "invited" | "resent" | "withdrawn" | "roles" | "left" | "signedOut" | "broughtBack" | "nothing";
  /** The person it concerned, by name (from the record). */
  name?: string;
  /** Invitation will go in English although another language was chosen. */
  inEnglish?: boolean;
  /** Left: they held the workspace door. */
  workspace?: boolean;
  /** Left: pending invitations of theirs that were withdrawn. */
  withdrawn?: number;
  /** Colonies whose name may still carry the person's name. */
  rename?: { id: number; name: string }[];
}

export function renderDone(d: Done | null): string {
  if (!d) return "";
  const who = esc(d.name ?? "They");
  const lines: string[] = [];
  switch (d.kind) {
    case "invited":
      lines.push(
        `Invitation saved for ${who}. The chip says Invited once the email has really gone out.` +
          (d.inEnglish ? " It will be sent in English." : ""),
      );
      break;
    case "broughtBack":
      lines.push(
        `${who} is on the list again, waiting to accept. The invitation email goes out now.` +
          (d.inEnglish ? " It will be sent in English." : ""),
      );
      break;
    case "resent":
      lines.push(`The invitation to ${who} is being sent again, with a fresh 14 days.`);
      break;
    case "withdrawn":
      lines.push(d.name ? `The invitation to ${who} was withdrawn.` : "The invitation was withdrawn.");
      break;
    case "roles":
      lines.push(`${who}'s roles and colonies were changed. The other managers have been told.`);
      break;
    case "signedOut":
      lines.push(`${who} was signed out everywhere.`);
      break;
    case "left":
      lines.push(`${who} is marked as left. The other managers have been told.`);
      break;
    case "nothing":
      lines.push("Nothing changed.");
      break;
  }
  if (d.kind === "left" && d.workspace) {
    lines.push(
      `<strong>Change the shared document password today.</strong> ${who} could open the team workspace, so they still know it.`,
    );
  }
  if (d.kind === "left" && d.withdrawn && d.withdrawn > 0) {
    lines.push(
      `${d.withdrawn} invitation${d.withdrawn === 1 ? "" : "s"} from ${who} ${d.withdrawn === 1 ? "was" : "were"} withdrawn when they left. Re-send any you still want.`,
    );
  }
  for (const c of d.rename ?? []) {
    lines.push(
      `${esc(c.name)} still has ${who} on it. <a href="/api/team/colonies/${c.id}">Rename it?</a>`,
    );
  }
  return `<div class="okbox" role="status">${lines.map((l) => `<p>${l}</p>`).join("")}</div>`;
}

// ── Pieces ────────────────────────────────────────────────────────────────

const post = (action: string, label: string, cls = "") =>
  `<form method="post" action="${action}"><button class="pbtn ${cls}" type="submit">${esc(label)}</button></form>`;

function placementList(p: PersonView): string {
  if (p.placements.length === 0) return "";
  return (
    `<ul class="pl">` +
    p.placements
      .map(
        (pl) =>
          `<li${pl.endIso ? ` data-ends="${esc(pl.endIso)}"` : ""}>${esc(pl.colony ?? "")}${pl.label ? ` · ${esc(pl.label)}` : ""}` +
          `${pl.endText ? ` · ${esc(pl.endText)}` : ""}${pl.ended ? " · ended" : ""}</li>`,
      )
      .join("") +
    `</ul>`
  );
}

function actions(p: PersonView): string {
  const id = encodeURIComponent(p.id);
  if (p.state === "left") {
    return p.anonymised
      ? `<p class="hint">This was a withdrawn invitation. Invite the person afresh if you still want them.</p>`
      : `<div class="acts"><a class="pbtn go" href="${PEOPLE}/${id}/bring-back">Bring back</a></div>`;
  }
  if (p.state !== "joined") {
    return `<div class="acts">${post(`${PEOPLE}/${id}/resend`, "Resend", "go")}${post(`${PEOPLE}/${id}/withdraw`, "Withdraw")}</div>`;
  }
  if (p.isSelf) {
    return `<p class="hint">This is you. To step back, use Stop helping on your own page.</p>`;
  }
  const warn = p.holdsWorkspace
    ? `<p><strong>They can open the team workspace, so the shared document password must be changed today.</strong></p>`
    : "";
  return (
    `<div class="acts">` +
    `<a class="pbtn" href="${PEOPLE}/${id}/roles">Change roles and colonies</a>` +
    post(`${PEOPLE}/${id}/sign-out`, "Sign out everywhere") +
    `<details class="confirm"><summary>Mark as left</summary>` +
    `<p>They are signed out at once, and any invitations they sent are withdrawn.</p>${warn}` +
    post(`${PEOPLE}/${id}/left`, "Yes, mark as left", "danger go") +
    `</details></div>`
  );
}

function card(p: PersonView): string {
  return (
    `<article class="person${p.state === "left" ? " left" : ""}" id="p-${esc(p.id)}">` +
    `<div class="head"><strong>${esc(p.name)}</strong> <span class="chip ${p.state}">${esc(p.chip)}</span></div>` +
    (p.email ? `<p class="meta">${esc(p.email)}</p>` : "") +
    (p.state !== "left" || p.roles !== "Nothing" ? `<p>${esc(p.roles)}</p>` : "") +
    placementList(p) +
    (p.timing ? `<p class="meta">${esc(p.timing)}</p>` : "") +
    actions(p) +
    `<details class="hist"><summary>History</summary><ol class="hist">` +
    p.history.map((h) => `<li><span class="when">${esc(h.when)}</span>${esc(h.text)}</li>`).join("") +
    `</ol></details></article>`
  );
}

// ── The placement boxes shared by Invite, Change roles and Bring back ─────

export interface ColonyOption {
  id: number;
  name: string;
}

export interface Prefill {
  roles: string[];
  /** "No colony yet" is ticked (SYC-439), so saving unchanged keeps it. */
  starting?: boolean;
  /** colony id to its current end date (form format) and label. */
  colonies: Map<number, { endDate: string | null; relationship: string | null }>;
}

function placementFields(colonies: ColonyOption[], pre?: Prefill): string {
  const none = colonies.length === 0;
  const has = (r: string) => pre?.roles.includes(r) ?? false;
  const roleBox = (value: string, label: string, disabled = false, note = "") =>
    `<label class="choice${disabled ? " off" : ""}"><input type="checkbox" name="roles" value="${value}"${has(value) ? " checked" : ""}${disabled ? " disabled" : ""}> <span>${esc(label)}${note ? ` <em>${esc(note)}</em>` : ""}</span></label>`;
  const rows = colonies
    .map((c) => {
      const cur = pre?.colonies.get(c.id);
      return (
        `<div class="colrow"><label class="choice"><input type="checkbox" name="colony" value="${c.id}"${cur ? " checked" : ""}> <span>${esc(c.name)}</span></label>` +
        `<label class="l" for="end-${c.id}">Stops at the end of this date, Athens time (optional)</label>` +
        `<input type="date" id="end-${c.id}" name="end_${c.id}" value="${esc(cur?.endDate ?? "")}">` +
        `<label class="l" for="lab-${c.id}">Label (optional)</label>` +
        `<select id="lab-${c.id}" name="label_${c.id}"><option value="">No label</option>` +
        SCOPE_RELATIONSHIPS.map(
          (r) => `<option value="${r}"${cur?.relationship === r ? " selected" : ""}>${esc(RELATIONSHIP_LABELS[r])}</option>`,
        ).join("") +
        `</select></div>`
      );
    })
    .join("");
  // "No colony yet" (SYC-439): a cat guardian alone, who creates her first
  // colony herself. Either this or colonies, never both (lib/db refuses).
  const startBox =
    `<label class="choice"><input type="checkbox" name="no_colony" value="1"${pre?.starting ? " checked" : ""}> ` +
    `<span>No colony yet: creates the first one <em>(a cat guardian with no other role)</em></span></label>`;
  return (
    `<fieldset><legend class="label">What will they be?</legend>` +
    roleBox("staff", "A member of the Syros Cats team") +
    roleBox("management", "A member of Syros Cats management") +
    roleBox("guardian", "A cat guardian") +
    `</fieldset>` +
    `<fieldset><legend class="label">Colonies, for a cat guardian</legend>${startBox}${rows}</fieldset>` +
    (none
      ? `<p class="hint">No colonies exist yet. A cat guardian can still be invited with “No colony yet”, and creates the first one.</p>`
      : `<p class="hint">Tick their colonies, or “No colony yet” for a cat guardian who will create the first one. An end date switches that colony off by itself at midnight Athens time at the end of that date. A label is only a note for the team; it changes nothing they can do.</p>`)
  );
}

function inviteForm(colonies: ColonyOption[]): string {
  const langs: [string, string][] = [
    ["en", "English"],
    ["el", "Greek"],
    ["fr", "French"],
  ];
  const options = langs
    .map(([code, label]) => {
      const live = (LIVE_LANGUAGES as readonly string[]).includes(code);
      return `<option value="${code}">${esc(label)}${live ? "" : " (will be sent in English)"}</option>`;
    })
    .join("");
  return (
    `<section id="invite"><h2>Invite someone</h2>` +
    `<form class="pform" method="post" action="${PEOPLE}/invite">` +
    `<label class="l" for="inv-email">Their email address (type it carefully, once)</label>` +
    `<input id="inv-email" type="email" name="email" required autocomplete="off" maxlength="254">` +
    `<label class="l" for="inv-name">Their name</label>` +
    `<input id="inv-name" type="text" name="name" required maxlength="100" autocomplete="off">` +
    placementFields(colonies) +
    `<label class="l" for="inv-lang">Language of the invitation</label>` +
    `<select id="inv-lang" name="language">${options}</select>` +
    `<p class="hint">The email says which colonies and what they are being asked to do. You cannot add a message of your own.</p>` +
    `<button class="pbtn go" type="submit">Send the invitation</button></form></section>`
  );
}

// ── The pages ─────────────────────────────────────────────────────────────

export function renderPeoplePage(o: {
  viewer: string;
  tab: "people" | "left";
  people: PersonView[];
  left: PersonView[];
  recent: PersonView[];
  colonies: ColonyOption[];
  done: Done | null;
}): string {
  const tabs =
    `<nav class="tabs" aria-label="People tabs">` +
    `<a href="${PEOPLE}"${o.tab === "people" ? ' class="on" aria-current="page"' : ""}>People (${o.people.length})</a>` +
    `<a href="${PEOPLE}?tab=left"${o.tab === "left" ? ' class="on" aria-current="page"' : ""}>Left (${o.left.length})</a></nav>`;
  let body = renderDone(o.done) + tabs;
  if (o.tab === "left") {
    body +=
      (o.left.length === 0
        ? `<p class="empty">Nobody has left.</p>`
        : `<p class="hint">Bringing someone back sends a fresh invitation. You choose their roles again; nothing is restored for them.</p>` +
          o.left.map(card).join(""));
  } else {
    body +=
      inviteForm(o.colonies) +
      `<h2>Joined in the last 7 days</h2>` +
      (o.recent.length === 0
        ? `<p class="empty">Nobody has joined in the last 7 days.</p>`
        : `<ul class="joined7">${o.recent.map((p) => `<li><a href="#p-${esc(p.id)}">${esc(p.name)}</a> · ${esc(p.roles)}</li>`).join("")}</ul>`) +
      `<h2>Everyone</h2>` +
      (o.people.length === 0 ? `<p class="empty">Nobody is on the list.</p>` : o.people.map(card).join(""));
  }
  return page(o.viewer, "People", body);
}

export function renderRolesPage(o: {
  viewer: string;
  person: PersonView;
  colonies: ColonyOption[];
  pre: Prefill;
}): string {
  return page(
    o.viewer,
    `Change ${o.person.name}'s roles`,
    `<p>Now: ${esc(o.person.roles)}.</p>` +
      `<p class="hint">Tick what they should be from now on. Anything you leave unticked is taken away. The other managers are emailed.</p>` +
      `<form class="pform" method="post" action="${PEOPLE}/${encodeURIComponent(o.person.id)}/roles">` +
      placementFields(o.colonies, o.pre) +
      `<button class="pbtn go" type="submit">Save</button></form>`,
    `<p class="back"><a href="${PEOPLE}">All people</a></p>`,
  );
}

export function renderBringBackPage(o: {
  viewer: string;
  person: PersonView;
  /** What they held when they left, in words, from the `left` event. */
  held: string | null;
  colonies: ColonyOption[];
}): string {
  const lang = (LIVE_LANGUAGES as readonly string[]);
  const langOptions = [
    ["en", "English"],
    ["el", "Greek"],
    ["fr", "French"],
  ]
    .map(([c, l]) => `<option value="${c}">${esc(l)}${lang.includes(c!) ? "" : " (will be sent in English)"}</option>`)
    .join("");
  return page(
    o.viewer,
    `Bring ${o.person.name} back`,
    `<p>${esc(o.person.timing)}${o.held ? ` When they left they were ${esc(o.held)}.` : ""}</p>` +
      `<p class="hint">Nothing is restored automatically. Choose what they should be now. They will get a new invitation and read the promises again.</p>` +
      `<form class="pform" method="post" action="${PEOPLE}/${encodeURIComponent(o.person.id)}/bring-back">` +
      placementFields(o.colonies) +
      `<label class="l" for="bb-lang">Language of the invitation</label><select id="bb-lang" name="language">${langOptions}</select>` +
      `<button class="pbtn go" type="submit">Bring them back</button></form>`,
    `<p class="back"><a href="${PEOPLE}?tab=left">Left</a></p>`,
  );
}

/** A refusal in plain English, with a way back. Never echoes anything typed. */
export function renderPeopleProblem(viewer: string, message: string, back = { href: PEOPLE, label: "Back to People" }): string {
  return page(
    viewer,
    "That wasn't changed",
    `<p>${esc(message)}</p><p>Nothing was changed.</p><p><a class="tap" href="${esc(back.href)}">${esc(back.label)}</a></p>`,
  );
}

export function renderNoSuchPerson(viewer: string): string {
  return page(viewer, "Not found", `<p>That person isn't on the list.</p><p><a class="tap" href="${PEOPLE}">Back to People</a></p>`);
}
