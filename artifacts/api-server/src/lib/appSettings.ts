import { appSettingsTable, db } from "@workspace/db";
import { sanitizeDonateUrl } from "./campaign";
import { logger, safeError } from "./logger";

/**
 * The match-wait switches (SYC-36 / SYC-48, match-wait plan PR 1, Samuel's
 * Decision 1): rows in `app_settings`, changed with `db-ops set-setting` until
 * the team dashboard has a page for them (SYC-383).
 *
 * Three keys, each with a fixed shape. A missing row, or a value of the wrong
 * shape, falls back to the key's default; it is logged, never an error to the
 * phone. The defaults are the safe side of each switch:
 *  - no donation link (the nudge's words-only form, `feeding-nudge.md` §5.2);
 *  - the nine facts that need Syros Cats' yes hidden (plan small call 3);
 *  - taps counted.
 */

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
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export interface AppSettings {
  /** The donation page, https only, or null: the link and figures are off. */
  donateUrl: string | null;
  /** Fact ids the app must not show. Only known ids. */
  hiddenFacts: string[];
  /** Whether a tap on "Help feed a cat" is counted. */
  countTaps: boolean;
}

const KNOWN_FACTS = new Set<string>(STARTER_FACT_IDS);

/** Why a value was rejected, or null if it has the key's shape. Used by the
 * reader (to fall back) and by `db-ops set-setting` (to refuse). */
export function settingShapeProblem(key: SettingKey, value: unknown): string | null {
  switch (key) {
    case "feed_nudge_donate_url":
      if (typeof value !== "string") return "must be a string";
      if (value !== "" && sanitizeDonateUrl(value) === "") {
        return "must be an absolute https address, or empty to switch the link off";
      }
      return null;
    case "starter_facts_hidden":
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        return "must be a list of fact ids";
      }
      return null;
    case "feed_tap_count":
      return typeof value === "boolean" ? null : "must be true or false";
  }
}

/** Turn the stored rows into settings. Pure, so it is tested without a
 * database. */
export function settingsFromRows(
  rows: readonly { key: string; value: unknown }[],
): AppSettings {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const read = <T>(key: SettingKey, fallback: T, use: (v: unknown) => T): T => {
    if (!byKey.has(key)) return fallback;
    const value = byKey.get(key);
    const problem = settingShapeProblem(key, value);
    if (problem) {
      logger.warn({ key, problem }, "app setting has the wrong shape; using its default");
      return fallback;
    }
    return use(value);
  };

  const donateUrl = read<string | null>("feed_nudge_donate_url", null, (v) => {
    const clean = sanitizeDonateUrl(v as string);
    return clean === "" ? null : clean;
  });

  const hiddenFacts = read<string[]>("starter_facts_hidden", [...SIGN_OFF_FACT_IDS], (v) => {
    const ids = v as string[];
    const unknown = ids.filter((id) => !KNOWN_FACTS.has(id));
    if (unknown.length) {
      logger.warn({ unknown }, "starter_facts_hidden names unknown fact ids; ignoring them");
    }
    return [...new Set(ids.filter((id) => KNOWN_FACTS.has(id)))];
  });

  const countTaps = read<boolean>("feed_tap_count", true, (v) => v as boolean);

  return { donateUrl, hiddenFacts, countTaps };
}

/** One answer per server for this long. A change reaches every server within
 * a minute; phones pick it up the next time they ask (plan PR 1). */
export const SETTINGS_CACHE_MS = 60_000;

let cached: { at: number; settings: AppSettings } | null = null;

/**
 * The current settings. A database failure serves the last answer if there is
 * one, else the defaults; it never throws, because a broken switch must not
 * take the spot flow or the donation link down with it.
 */
export async function getAppSettings(now: number = Date.now()): Promise<AppSettings> {
  if (cached && now - cached.at < SETTINGS_CACHE_MS) return cached.settings;
  try {
    const rows = await db
      .select({ key: appSettingsTable.key, value: appSettingsTable.value })
      .from(appSettingsTable);
    const settings = settingsFromRows(rows);
    cached = { at: now, settings };
    return settings;
  } catch (err) {
    logger.error({ err: safeError(err) }, "could not read app settings; using the last answer or defaults");
    return cached?.settings ?? settingsFromRows([]);
  }
}

/** Tests only: forget the cached answer. */
export function _resetAppSettingsCacheForTests(): void {
  cached = null;
}
