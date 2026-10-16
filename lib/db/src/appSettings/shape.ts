// SYC-36 / SYC-48 (match-wait plan PR 1): the switches in `app_settings`, and
// what shape each value must have. Shared by the API server (which reads them
// and falls back to a default on a wrong shape) and by `db-ops set-setting`
// (which refuses a wrong shape before writing anything).

/** The twenty starter facts, in the spec's order (`starter-facts.md` §4).
 * Must match `artifacts/cat-spotter/lib/starterFacts.ts`; a test checks. */
export const STARTER_FACT_IDS = [
  "fact.earTip",
  "fact.litters",
  "fact.disease",
  "fact.backHome",
  "fact.vacuum",
  "fact.cost",
  "fact.milk",
  "fact.leftovers",
  "fact.water",
  "fact.hiss",
  "fact.dontPickUp",
  "fact.kittensAlone",
  "fact.tortie",
  "fact.whiteBlue",
  "fact.slowBlink",
  "fact.tailUp",
  "fact.purr",
  "fact.kittenEyes",
  "fact.colonyFemales",
  "fact.cantTell",
] as const;

/** The facts Syros Cats must specifically say yes to (`starter-facts.md` §7):
 * facts 1, 3, 4, 5, 6, 8, 9, 12 and 19. */
export const SIGN_OFF_FACT_IDS: readonly string[] = [
  "fact.earTip",
  "fact.disease",
  "fact.backHome",
  "fact.vacuum",
  "fact.cost",
  "fact.leftovers",
  "fact.water",
  "fact.kittensAlone",
  "fact.colonyFemales",
];

export const SETTING_KEYS = [
  "feed_nudge_donate_url",
  "starter_facts_hidden",
  "feed_tap_count",
  // SYC-415: shows the extra-photo boxes on the New spot screen. The server
  // takes extra photos whatever it says; it only hides the boxes.
  "extra_photos_on",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

/** An absolute https address with a host (the same rule as the campaign's
 * `sanitizeDonateUrl`). */
export function isHttpsAddress(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" && u.hostname !== "";
  } catch {
    return false;
  }
}

const KNOWN_FACTS = new Set<string>(STARTER_FACT_IDS);

/** Why a value can't be stored under a key, or null if it can. */
export function settingShapeProblem(key: SettingKey, value: unknown): string | null {
  switch (key) {
    case "feed_nudge_donate_url":
      if (typeof value !== "string") return "must be a string";
      if (value !== "" && !isHttpsAddress(value)) {
        return "must be an absolute https address, or empty to switch the link off";
      }
      return null;
    case "starter_facts_hidden":
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        return "must be a list of fact ids";
      }
      return null;
    case "feed_tap_count":
    case "extra_photos_on":
      return typeof value === "boolean" ? null : "must be true or false";
  }
}

/** db-ops is stricter than the reader: it also refuses fact ids it doesn't
 * know, because a typo there would silently show a fact. */
export function settingWriteProblem(key: SettingKey, value: unknown): string | null {
  const shape = settingShapeProblem(key, value);
  if (shape) return shape;
  if (key === "starter_facts_hidden") {
    const unknown = (value as string[]).filter((id) => !KNOWN_FACTS.has(id));
    if (unknown.length) return `names unknown fact ids: ${unknown.join(", ")}`;
  }
  return null;
}
