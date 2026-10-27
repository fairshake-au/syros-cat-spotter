import { appSettingsTable, db, STARTER_FACT_IDS } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { clearAppSettingsCache, settingsFromRows } from "./appSettings";

// The App switches page (SYC-383; match-wait Decision 1 = B): the donation
// button's address, the extra photo boxes' On / Off (SYC-415's switch) and the
// starter facts' Shown / Hidden, changed by the team
// instead of with `db-ops set-setting`. Reads and writes the same
// `app_settings` rows the app's reader uses, so a value written here is read
// by lib/appSettings.ts exactly as one written by db-ops. Samuel chose no
// history (24 Oct 2026): nothing is recorded but the current value.
//
// Each write runs in one transaction and then clears this server's settings
// cache, so this server uses it at once; others within SETTINGS_CACHE_MS.

const URL_KEY = "feed_nudge_donate_url";
const FACTS_KEY = "starter_facts_hidden";
const EXTRA_PHOTOS_KEY = "extra_photos_on";
const KNOWN = new Set<string>(STARTER_FACT_IDS);

/** The address the page offers when the button is off and none is stored. */
export const DEFAULT_DONATE_ADDRESS = "https://syroscats.com/donations";
/** The host the button is meant to open; any other host gets a warning on the page. */
export const EXPECTED_DONATE_HOST = "syroscats.com";

export class SwitchRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SwitchRefused";
  }
}

/**
 * The address as it will be stored, or why it can't be. Stricter than the
 * app's reader: https only, a real host (with a dot), no user name or
 * password in it, and no longer than a phone can sensibly open.
 */
export function donateAddressProblem(raw: string): { url: string } | { problem: string } {
  const typed = raw.trim();
  if (typed === "") return { problem: "Type the address of the donation page." };
  if (typed.length > 300) return { problem: "That address is too long. Use the donation page's main address." };
  let parsed: URL;
  try {
    parsed = new URL(typed);
  } catch {
    return { problem: "That doesn't look like a web address. It should look like https://syroscats.com/donations" };
  }
  if (parsed.protocol !== "https:") return { problem: "The address must start with https:// so the page is secure." };
  if (!parsed.hostname.includes(".") || !parsed.hostname.split(".").every(Boolean)) return { problem: "That address has no website name in it. Check it and try again." };
  if (parsed.username || parsed.password) return { problem: "Take the user name and password out of the address." };
  return { url: parsed.toString() };
}

/** What the page shows, read past the cache; throws if the database can't be read. */
export async function switchesNow(): Promise<{ donateUrl: string | null; hidden: Set<string>; extraPhotosOn: boolean }> {
  const rows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, [URL_KEY, FACTS_KEY, EXTRA_PHOTOS_KEY]));
  const s = settingsFromRows(rows);
  return { donateUrl: s.donateUrl, hidden: new Set(s.hiddenFacts), extraPhotosOn: s.extraPhotosOn };
}

async function put(tx: Pick<typeof db, "insert">, key: string, value: unknown) {
  await tx
    .insert(appSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: sql`now()` } });
}

/** Turns the button on at this address (refusing a bad one). */
export async function setDonateAddress(raw: string): Promise<string> {
  const checked = donateAddressProblem(raw);
  if ("problem" in checked) throw new SwitchRefused(checked.problem);
  await db.transaction((tx) => put(tx, URL_KEY, checked.url));
  clearAppSettingsCache();
  return checked.url;
}

/** Turns the button and its figures off. The app's reader reads "" as off. */
export async function switchDonationOff(): Promise<void> {
  await db.transaction((tx) => put(tx, URL_KEY, ""));
  clearAppSettingsCache();
}

/** Shows or hides the extra photo boxes on the New spot screen. */
export async function setExtraPhotos(on: boolean): Promise<void> {
  await db.transaction((tx) => put(tx, EXTRA_PHOTOS_KEY, on));
  clearAppSettingsCache();
}

/** Shows or hides one starter fact, leaving every other fact as it is. */
export async function setFactShown(id: string, shown: boolean): Promise<void> {
  if (!KNOWN.has(id)) throw new SwitchRefused("That isn't one of the starter facts.");
  await db.transaction(async (tx) => {
    // One change at a time, so two people's taps don't overwrite each other's list.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('app_switches.starter_facts'))`);
    const rows = await tx
      .select({ key: appSettingsTable.key, value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(inArray(appSettingsTable.key, [FACTS_KEY]));
    // A missing row reads as the nine facts awaiting Syros Cats' yes, hidden.
    const hidden = new Set(settingsFromRows(rows).hiddenFacts);
    if (shown) hidden.delete(id);
    else hidden.add(id);
    await put(tx, FACTS_KEY, STARTER_FACT_IDS.filter((f) => hidden.has(f)));
  });
  clearAppSettingsCache();
}
