import {
  appSettingsTable,
  db,
  SIGN_OFF_FACT_IDS,
  STARTER_FACT_IDS,
  settingShapeProblem,
  type SettingKey,
} from "@workspace/db";
import { sanitizeDonateUrl } from "./campaign";
import { logger, safeError } from "./logger";

export { SIGN_OFF_FACT_IDS, STARTER_FACT_IDS, settingShapeProblem };

/**
 * The match-wait switches (SYC-36 / SYC-48, match-wait plan PR 1, Samuel's
 * Decision 1): rows in `app_settings`, changed with `db-ops set-setting` until
 * the team dashboard has a page for them (SYC-383).
 *
 * Four keys, each with a fixed shape. A missing row, or a value of the wrong
 * shape, falls back to the key's default; it is logged, never an error to the
 * phone. The defaults are the safe side of each switch:
 *  - no donation link (the nudge's words-only form, `feeding-nudge.md` §5.2);
 *  - the nine facts that need Syros Cats' yes hidden (plan small call 3);
 *  - taps counted;
 *  - the extra-photo boxes hidden (SYC-415 plan Decision P1);
 *  - a standard sterilisation price of €60 (SYC-396 PR 2.3; Syros Cats' €50–60).
 */

export interface AppSettings {
  /** The donation page, https only, or null: the link and figures are off. */
  donateUrl: string | null;
  /** Fact ids the app must not show. Only known ids. */
  hiddenFacts: string[];
  /** Whether a tap on "Help feed a cat" is counted. */
  countTaps: boolean;
  /** SYC-415: whether the app shows the extra-photo boxes. The upload takes
   * extra photos either way; this only hides the boxes. */
  extraPhotosOn: boolean;
  /** SYC-396 PR 2.3: the standard sterilisation price, in whole euros, for the
   * trapping planner's estimate and the vet-visit form. Team-only: never sent
   * to the app. */
  sterilisationPriceEur: number;
}

const KNOWN_FACTS = new Set<string>(STARTER_FACT_IDS);

/** The standard price until the team sets one (SYC-396 plan Task 2.3.1). */
export const DEFAULT_STERILISATION_PRICE_EUR = 60;

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

  const extraPhotosOn = read<boolean>("extra_photos_on", false, (v) => v as boolean);

  const sterilisationPriceEur = read<number>(
    "standard_sterilisation_price_eur",
    DEFAULT_STERILISATION_PRICE_EUR,
    (v) => v as number,
  );

  return { donateUrl, hiddenFacts, countTaps, extraPhotosOn, sterilisationPriceEur };
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

/**
 * Forget the cached answer, so the next read goes to the database. Called
 * after a change made on this server (the Vet settings page, SYC-396 PR 3.1b),
 * so this server uses it at once; other servers pick it up within
 * SETTINGS_CACHE_MS.
 */
export function clearAppSettingsCache(): void {
  cached = null;
}

/** Tests only: forget the cached answer. */
export function _resetAppSettingsCacheForTests(): void {
  clearAppSettingsCache();
}
