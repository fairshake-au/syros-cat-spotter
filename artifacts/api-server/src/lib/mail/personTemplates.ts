import { pageLanguage, tr, type Language } from "../teamPages/strings";
import { mailSafe, roleSentence } from "../people/words";

// SYC-53 PR 1.1: the two closed templates for the people emails
// (roles-and-invites.md §4.1 step 2, §8.3, §8.5). Plain text, with an HTML
// part that is the same words, escaped, in plain paragraphs (HTML proper is
// SYC-278). Nothing in either comes from a form: the invitation's only
// varying words are the role and the colony names from the invitee's own
// record; the notice's are the names of the two people and the roles, from
// the records when it is sent. Every name goes through `mailSafe` (no line
// breaks, length-limited, links defanged) and then HTML escaping.

export type RenderedPersonMail = { subject: string; text: string; html: string };

/** What a notice is about. Role names and colony ids only: no free text. */
export type AccessChange =
  | { kind: "invited"; roles: string[]; colonyIds: number[] }
  | { kind: "rejoined"; roles: string[]; colonyIds: number[] }
  | { kind: "roles_changed"; before: string[]; after: string[] }
  | { kind: "left"; withdrawn: number }
  | { kind: "signed_out_everywhere" };

export const ACCESS_CHANGE_KINDS = [
  "invited",
  "rejoined",
  "roles_changed",
  "left",
  "signed_out_everywhere",
] as const;

const escape = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function paragraphs(lang: Language, parts: readonly string[]): RenderedPersonMail["html"] {
  return (
    `<!doctype html><html lang="${lang}"><body>` +
    parts.map((p) => `<p>${escape(p)}</p>`).join("") +
    "</body></html>"
  );
}

/** The invitation (§4.1 step 2), in her language if it is live. */
export function renderInvitation(
  input: { language: string; roles: readonly string[]; colonies: readonly string[] },
  live?: readonly Language[],
): RenderedPersonMail {
  const lang = pageLanguage(input.language, live);
  const role = roleSentence(lang, input.roles, input.colonies, (n) => mailSafe(n), live);
  const parts = [
    tr(lang, "mail.invite.body", { role }, live),
    tr(lang, "mail.invite.how", undefined, live),
    tr(lang, "mail.invite.expiry", undefined, live),
  ];
  return {
    subject: tr(lang, "mail.invite.subject", undefined, live),
    text: parts.join("\n\n") + "\n",
    html: paragraphs(lang, parts),
  };
}

/** `guardian:12` → role `guardian`, colony 12. */
function parseLabels(labels: readonly string[]): { roles: string[]; colonyIds: number[] } {
  const roles = new Set<string>();
  const colonyIds: number[] = [];
  for (const label of labels) {
    const [role, colony] = String(label).split(":");
    if (role) roles.add(role);
    if (colony && /^[1-9][0-9]*$/.test(colony)) colonyIds.push(Number(colony));
  }
  return { roles: [...roles], colonyIds };
}

/** Colony ids a change names, so their names can be looked up. */
export function colonyIdsOf(change: AccessChange): number[] {
  switch (change.kind) {
    case "invited":
    case "rejoined":
      return change.colonyIds;
    case "roles_changed":
      return [...parseLabels(change.before).colonyIds, ...parseLabels(change.after).colonyIds];
    default:
      return [];
  }
}

/** The notice to the other managers (§8.3): who made which change to whom. */
export function renderAccessNotice(
  input: {
    language: string;
    actorName: string;
    subjectName: string;
    change: AccessChange;
    colonyNames: ReadonlyMap<number, string>;
  },
  live?: readonly Language[],
): RenderedPersonMail {
  const lang = pageLanguage(input.language, live);
  const actor = mailSafe(input.actorName);
  const subject = mailSafe(input.subjectName);
  const names = (ids: readonly number[]) =>
    ids.map((id) => input.colonyNames.get(id) ?? `#${id}`);
  const say = (roles: readonly string[], colonyIds: readonly number[]) =>
    roleSentence(lang, roles, names(colonyIds), (n) => mailSafe(n), live);
  const c = input.change;
  const lines: string[] = [];
  switch (c.kind) {
    case "invited":
      lines.push(tr(lang, "mail.notice.invited", { actor, subject, role: say(c.roles, c.colonyIds) }, live));
      break;
    case "rejoined":
      lines.push(tr(lang, "mail.notice.rejoined", { actor, subject, role: say(c.roles, c.colonyIds) }, live));
      break;
    case "roles_changed": {
      const before = parseLabels(c.before);
      const after = parseLabels(c.after);
      lines.push(
        tr(lang, "mail.notice.rolesChanged", {
          actor,
          subject,
          before: say(before.roles, before.colonyIds),
          after: say(after.roles, after.colonyIds),
        }, live),
      );
      break;
    }
    case "left":
      lines.push(tr(lang, "mail.notice.left", { actor, subject }, live));
      if (c.withdrawn > 0) {
        lines.push(tr(lang, "mail.notice.withdrawn", { subject, count: String(c.withdrawn) }, live));
      }
      break;
    case "signed_out_everywhere":
      lines.push(tr(lang, "mail.notice.signedOut", { actor, subject }, live));
      break;
  }
  lines.push(tr(lang, "mail.notice.why", undefined, live));
  return {
    subject: tr(lang, "mail.notice.subject", undefined, live),
    text: lines.join("\n\n") + "\n",
    html: paragraphs(lang, lines),
  };
}

/** Is this a well-formed change, as stored in an outbox payload? */
export function isAccessChange(value: unknown): value is AccessChange {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === "string");
  const ints = (x: unknown) => Array.isArray(x) && x.every((n) => Number.isInteger(n));
  switch (v["kind"]) {
    case "invited":
    case "rejoined":
      return strings(v["roles"]) && ints(v["colonyIds"]);
    case "roles_changed":
      return strings(v["before"]) && strings(v["after"]);
    case "left":
      return Number.isInteger(v["withdrawn"]);
    case "signed_out_everywhere":
      return true;
    default:
      return false;
  }
}
