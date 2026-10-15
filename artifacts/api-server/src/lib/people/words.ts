import { tr, type Language } from "../teamPages/strings";

// SYC-53 PR 1.1: how a person's roles are said, in one sentence fragment
// (roles-and-invites.md §2.6): "a cat guardian for Vaporia — Eleni's and
// Kato Chora". Used by the accept page and by both emails. Never "role",
// "scope" or "capability". Names come from records; the caller escapes for
// HTML where it draws them, and the emails pass them through `mailSafe`.

/** The longest a name may be when it is drawn into a page or an email. */
export const DRAWN_NAME_MAX = 60;
/** At most this many colony names are spelled out; the rest are counted. */
export const COLONIES_SPELLED_OUT = 5;

/** Cut to `max` letters (by code point), with an ellipsis when cut. */
export function clip(text: string, max = DRAWN_NAME_MAX): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/**
 * A name made safe to put in a plain-text email (§8.5; T22): no control
 * characters or line breaks, length-limited, and anything that looks like a
 * link defanged so a mail program won't turn it into one ("evil.example"
 * becomes "evil[.]example", "https://" becomes "https[:]//"). A name typed
 * by an inviter, or by the invitee on the accept page, can't become a link
 * in a manager's inbox. HTML is escaped separately, after this.
 */
export function mailSafe(raw: string, max = DRAWN_NAME_MAX): string {
  const flat = String(raw)
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const defanged = flat
    .replace(/:\/\//g, "[:]//")
    .replace(/@/g, "[at]")
    .replace(/\.(?=[\p{L}\p{N}])/gu, "[.]");
  return clip(defanged, max);
}

/** "A", "A and B", "A, B and C", or "A, B, C, D, E and 2 more". */
export function joinList(lang: Language, items: readonly string[], live?: readonly Language[]): string {
  if (items.length === 0) return "";
  const shown = items.slice(0, COLONIES_SPELLED_OUT);
  const rest = items.length - shown.length;
  const parts = rest > 0 ? [...shown, tr(lang, "list.more", { count: String(rest) }, live)] : shown;
  if (parts.length === 1) return parts[0]!;
  return tr(lang, "list.and", { first: parts.slice(0, -1).join(", "), last: parts.at(-1)! }, live);
}

/**
 * The role sentence: management if held, else the team; a cat guardian for
 * her colonies; both joined when someone is both. "nothing" for no roles.
 * `format` is applied to each colony name (clip for a page, mailSafe for an
 * email).
 */
export function roleSentence(
  lang: Language,
  roles: readonly string[],
  colonies: readonly string[],
  format: (name: string) => string,
  live?: readonly Language[],
): string {
  const island = roles.includes("management")
    ? tr(lang, "role.management", undefined, live)
    : roles.includes("staff")
      ? tr(lang, "role.team", undefined, live)
      : null;
  const guardian =
    roles.includes("guardian") && colonies.length > 0
      ? tr(lang, "role.guardian", { colonies: joinList(lang, colonies.map(format), live) }, live)
      : null;
  if (island && guardian) return tr(lang, "role.both", { first: island, second: guardian }, live);
  return island ?? guardian ?? tr(lang, "role.none", undefined, live);
}
