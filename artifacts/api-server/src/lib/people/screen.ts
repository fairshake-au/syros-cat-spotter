import {
  ANONYMISED_NAME,
  isAnonymisedEmail,
  isPersonId,
  PeopleError,
  PERSON_ROLES,
  personState,
  placementEndsAt,
  SCOPE_RELATIONSHIPS,
  type PersonState,
  type PlacementInput,
  type ScreenPerson,
} from "@workspace/db";
import { CATALOGUE } from "../capabilities";
import { clip, roleSentence } from "./words";

// SYC-53 PR 1.2: what the People screen shows and what its forms send, as
// plain functions with no database and no HTML (the page module draws; the
// route fetches). Everything here is English: the team's screens are English
// (roles-and-invites.md Decision 10). Strings returned are plain text; the
// page escapes them where it draws them.

// ── The chips (spec §10.1) ────────────────────────────────────────────────

export const CHIP_LABELS: Record<PersonState, string> = {
  not_sent: "Not sent yet",
  invited: "Invited",
  joined: "Joined",
  expired: "Expired",
  left: "Left",
};

/** The three labels a cat guardian's placement can carry (Decision 9), in plain words. */
export const RELATIONSHIP_LABELS: Record<(typeof SCOPE_RELATIONSHIPS)[number], string> = {
  feeds: "Feeds there",
  owns_here: "Owns a cat here",
  covering: "Covering for a while",
};

// ── Athens dates ──────────────────────────────────────────────────────────

const ATHENS = "Europe/Athens";

const longDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: ATHENS,
  day: "numeric",
  month: "long",
  year: "numeric",
});
const longDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: ATHENS,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const isoDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: ATHENS,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const athensDate = (at: Date) => longDate.format(at);
export const athensDateTime = (at: Date) => longDateTime.format(at);
/** The instant as the form of words the tests and the team can compare: 2026-10-25T22:00:00Z. */
export const isoInstant = (at: Date) => at.toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * The date a placement's end falls on, as the manager typed it: ends are
 * midnight Athens at the END of that date, so the date is the day before the
 * instant (placementEndsAt). A minute back is safely inside that day.
 */
export const endDateOf = (endsAt: Date) => isoDay.format(new Date(endsAt.getTime() - 60_000));

/** "Ends at the end of 25 October 2026, Athens time (2026-10-25T22:00:00Z)". */
export function endsText(endsAt: Date): string {
  return `Ends at the end of ${longDate.format(new Date(endsAt.getTime() - 60_000))}, Athens time (${isoInstant(endsAt)})`;
}

// ── Who did it: ids turned into words ─────────────────────────────────────

export interface Lookups {
  /** Person id to the name on their row (an anonymised person's is the placeholder). */
  people: ReadonlyMap<string, string>;
  /** Colony id to its name. */
  colonies: ReadonlyMap<number, string>;
}

const colonyName = (lk: Lookups, id: number) => clip(lk.colonies.get(id) ?? "a colony that no longer exists");

/** A person by id, or a plain stand-in. */
function who(by: string, lk: Lookups): string {
  if (by === "self") return "They";
  if (by.startsWith("cli:")) return "An operator at the command line";
  if (by === "system:migration") return "The system, when this record began";
  if (isPersonId(by)) return clip(lk.people.get(by) ?? "Someone no longer on the list");
  return "Someone";
}

/** `guardian:12`, `staff`, `management` to role names and colony names. */
function wordsForLabels(labels: readonly unknown[], lk: Lookups): string {
  const roles: string[] = [];
  const colonies: string[] = [];
  for (const l of labels) {
    if (typeof l !== "string") continue;
    const [role, colony] = l.split(":");
    if (role) roles.push(role);
    if (colony && /^\d+$/.test(colony)) colonies.push(colonyName(lk, Number(colony)));
  }
  return roleSentence("en", roles, colonies, (n) => clip(n));
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Every id a person's history mentions, so the route can fetch their names in
 * two queries: who made each change, and which colonies it concerned.
 */
export function idsMentioned(people: readonly ScreenPerson[]): { personIds: string[]; colonyIds: number[] } {
  const personIds = new Set<string>();
  const colonyIds = new Set<number>();
  for (const p of people) {
    if (p.addedBy && isPersonId(p.addedBy)) personIds.add(p.addedBy);
    for (const pl of p.placements) if (pl.colonyId !== null) colonyIds.add(pl.colonyId);
    for (const e of p.history) {
      if (isPersonId(e.by)) personIds.add(e.by);
      const d = e.detail ?? {};
      if (typeof d["sender"] === "string" && isPersonId(d["sender"])) personIds.add(d["sender"]);
      for (const c of asArray(d["colonyIds"])) if (typeof c === "number") colonyIds.add(c);
      for (const key of ["before", "after"]) {
        for (const l of asArray(d[key])) {
          if (typeof l === "string" && /^guardian:\d+$/.test(l)) colonyIds.add(Number(l.split(":")[1]));
        }
      }
    }
  }
  return { personIds: [...personIds], colonyIds: [...colonyIds] };
}

/** One history row in plain words, ids turned into names (spec §8.1 "See who did what"). */
export function describeEvent(e: ScreenPerson["history"][number], lk: Lookups): string {
  const d = e.detail ?? {};
  const actor = who(e.by, lk);
  const backfilled = d["backfilled"] === true;
  switch (e.kind) {
    case "invited": {
      const roles = asArray(d["roles"]).filter((r): r is string => typeof r === "string");
      const colonies = asArray(d["colonyIds"])
        .filter((c): c is number => typeof c === "number")
        .map((c) => colonyName(lk, c));
      return `${actor} invited them as ${roleSentence("en", roles, colonies, (n) => clip(n))}.`;
    }
    case "invite_sent":
      return "The invitation email was sent.";
    case "invite_resent":
      return "The invitation email was sent again.";
    case "invite_withdrawn": {
      if (d["reason"] === "declined") return "They said no to the invitation.";
      if (d["reason"] === "sender_left") {
        const sender = typeof d["sender"] === "string" ? who(d["sender"], lk) : "The person who sent it";
        return `The invitation was withdrawn because ${sender} left.`;
      }
      return `${actor} withdrew the invitation.`;
    }
    case "accepted":
      return "They joined.";
    case "added":
      return backfilled ? "They were already on the list when this record began." : `${actor} added them.`;
    case "roles_changed":
      return `${actor} changed what they can do. Now they are ${wordsForLabels(asArray(d["after"]), lk)}.`;
    case "left":
      if (backfilled) return "They had left before this record began.";
      return e.by === "self" ? "They stopped helping." : `${actor} marked them as left.`;
    case "rejoined":
      return `${actor} brought them back.`;
    case "signed_out_everywhere":
      return e.by === "self" ? "They signed themselves out everywhere." : `${actor} signed them out everywhere.`;
    case "anonymised":
      return "Their name and address were removed.";
    default:
      return "Something was recorded.";
  }
}

// ── One person, ready to draw ─────────────────────────────────────────────

export interface PlacementView {
  colonyId: number | null;
  /** The colony's name; null for the island-wide roles. */
  colony: string | null;
  role: string;
  /** "Feeds there", or null. */
  label: string | null;
  /** The end of an in-force placement in words, with the instant; or when an ended one ended. */
  endText: string | null;
  /** The date as the form takes it (2026-10-25), for pre-filling. */
  endDate: string | null;
  relationship: string | null;
  ended: boolean;
}

export interface PersonView {
  id: string;
  name: string;
  /** Null for a withdrawn invitation: the address is gone and is never shown. */
  email: string | null;
  anonymised: boolean;
  state: PersonState;
  chip: string;
  /** "A member of the Syros Cats team, and a cat guardian for Vaporia." */
  roles: string;
  placements: PlacementView[];
  /** One line about the invitation, or when they joined or left. */
  timing: string;
  holdsWorkspace: boolean;
  joinedAt: Date | null;
  history: { when: string; text: string }[];
  isSelf: boolean;
}

const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

const WORKSPACE_ROLES: readonly string[] = CATALOGUE.use_workspace.roles;

export function buildView(p: ScreenPerson, now: Date, lk: Lookups, selfId: string): PersonView {
  const state = personState(p, now);
  const inForce = p.placements.filter((s) => s.inForce);
  const roles = [...new Set(inForce.map((s) => s.role))];
  const guardianColonies = inForce
    .filter((s) => s.role === "guardian" && s.colonyId !== null)
    .map((s) => colonyName(lk, s.colonyId!));
  const placements: PlacementView[] = p.placements
    .filter((s) => s.role === "guardian")
    .map((s) => ({
      colonyId: s.colonyId,
      colony: s.colonyId === null ? null : colonyName(lk, s.colonyId),
      role: s.role,
      label:
        s.relationship && Object.hasOwn(RELATIONSHIP_LABELS, s.relationship)
          ? RELATIONSHIP_LABELS[s.relationship as keyof typeof RELATIONSHIP_LABELS]
          : null,
      endText: s.expiresAt
        ? s.inForce
          ? endsText(s.expiresAt)
          : `Ended at the end of ${longDate.format(new Date(s.expiresAt.getTime() - 60_000))}`
        : null,
      endDate: s.expiresAt && s.inForce ? endDateOf(s.expiresAt) : null,
      relationship: s.relationship,
      ended: !s.inForce,
    }));
  let timing = "";
  switch (state) {
    case "not_sent":
      timing = "Saved, but the invitation email hasn't gone out yet. It keeps trying.";
      break;
    case "invited":
      timing = `Invitation sent ${athensDate(p.inviteSentAt!)}. Open until ${athensDate(p.inviteExpiresAt!)}.`;
      break;
    case "expired":
      timing = `Invitation sent ${athensDate(p.inviteSentAt!)}. It ran out on ${athensDate(p.inviteExpiresAt!)}. Resend it to give a fresh 14 days.`;
      break;
    case "joined":
      timing = p.acceptedAt ? `Joined ${athensDate(p.acceptedAt)}.` : "";
      break;
    case "left":
      timing = p.leftAt ? `Left ${athensDate(p.leftAt)}.` : "";
      break;
  }
  const anonymised = isAnonymisedEmail(p.email);
  return {
    id: p.id,
    name: anonymised ? ANONYMISED_NAME : p.name,
    email: anonymised ? null : p.email,
    anonymised,
    state,
    chip: CHIP_LABELS[state],
    roles: capitalise(roleSentence("en", roles, guardianColonies, (n) => clip(n))),
    placements,
    timing,
    holdsWorkspace: roles.some((r) => WORKSPACE_ROLES.includes(r)),
    joinedAt: p.acceptedAt,
    history: p.history.map((e) => ({ when: athensDateTime(e.at), text: describeEvent(e, lk) })),
    isSelf: p.id === selfId,
  };
}

// ── The forms: what a person typed, turned into placements ────────────────

/** The roles the forms offer: all but the reserved `vet` (PERSON_ROLES is the one list). */
export const FORM_ROLES: readonly string[] = PERSON_ROLES.filter((r) => r !== "vet");

const many = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string");

export type PlacementsForm = { ok: true; placements: PlacementInput[] } | { ok: false; message: string };

/**
 * Turns the role / colony / end date / label boxes into placements. Ticked
 * colonies without a cat guardian role, a guardian with no colony, a colony
 * that isn't in `existing`, or a date that isn't a date are refused here in
 * plain English; everything else (an end date in the past, a label that
 * isn't one of the three) is lib/db's own refusal. The colony ids in the
 * form are checked against `existing` so a made-up id is a refusal, never a
 * database error.
 */
export function parsePlacements(body: Record<string, unknown>, existing: ReadonlySet<number>): PlacementsForm {
  const roles = many(body["roles"]);
  if (roles.some((r) => !FORM_ROLES.includes(r))) {
    return { ok: false, message: "Choose the team, management or a cat guardian." };
  }
  if (roles.length === 0) return { ok: false, message: "Choose at least one role." };
  const wantsGuardian = roles.includes("guardian");
  const ticked = many(body["colony"]);
  if (!wantsGuardian && ticked.length > 0) {
    return {
      ok: false,
      message: "Colonies can only be given to a cat guardian. Tick cat guardian, or untick the colonies.",
    };
  }
  const placements: PlacementInput[] = [...new Set(roles.filter((r) => r !== "guardian"))].map((role) => ({ role }));
  if (wantsGuardian) {
    if (existing.size === 0) {
      return { ok: false, message: "No colonies exist yet, so nobody can be made a cat guardian yet." };
    }
    if (ticked.length === 0) return { ok: false, message: "A cat guardian needs at least one colony. Tick one." };
    const seen = new Set<number>();
    for (const raw of ticked) {
      if (!/^[1-9]\d{0,8}$/.test(raw)) return { ok: false, message: "That colony isn't on the list." };
      const id = Number(raw);
      if (!existing.has(id)) return { ok: false, message: "That colony doesn't exist." };
      if (seen.has(id)) continue;
      seen.add(id);
      const rawEnd = body[`end_${id}`];
      const end = typeof rawEnd === "string" ? rawEnd.trim() : "";
      let endsAt: Date | null = null;
      if (end !== "") {
        try {
          endsAt = placementEndsAt(end);
        } catch (err) {
          if (err instanceof PeopleError) return { ok: false, message: err.message };
          throw err;
        }
      }
      const rawLabel = body[`label_${id}`];
      const label = typeof rawLabel === "string" && rawLabel !== "" ? rawLabel : null;
      if (label !== null && !(SCOPE_RELATIONSHIPS as readonly string[]).includes(label)) {
        return { ok: false, message: "That isn't one of the labels." };
      }
      placements.push({ role: "guardian", colonyId: id, endsAt, relationship: label });
    }
  }
  return { ok: true, placements };
}
