import { db, profilesTable } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;

/** Letters (any script), digits, spaces, and _ . ' - */
const USERNAME_CHARSET = /^[\p{L}\p{N} _.'-]+$/u;

/**
 * Normalize a raw username: strip control chars, collapse whitespace, trim.
 * Returns null when the result is not a valid username.
 */
export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) return null;
  if (!USERNAME_CHARSET.test(name)) return null;
  return name;
}

const ADJECTIVES = [
  "Whisker",
  "Purring",
  "Sneaky",
  "Fluffy",
  "Mighty",
  "Salty",
  "Sunny",
  "Aegean",
  "Island",
  "Velvet",
  "Midnight",
  "Marble",
  "Curious",
  "Dozy",
  "Zoomy",
  "Harbor",
];

const NOUNS = [
  "Mouser",
  "Tomcat",
  "Kitten",
  "Feline",
  "Paw",
  "Tail",
  "Meow",
  "Purrer",
  "Tabby",
  "Calico",
  "Stray",
  "Prowler",
  "Napper",
  "Spotter",
  "Whiskers",
  "Catnip",
];

function randomOf<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Generate `count` fun cat-themed usernames that are not already taken. */
export async function suggestUsernames(count = 6): Promise<string[]> {
  const pool = new Set<string>();
  while (pool.size < count * 3) {
    const withNumber = Math.random() < 0.35;
    const name =
      randomOf(ADJECTIVES) +
      randomOf(NOUNS) +
      (withNumber ? String(Math.floor(Math.random() * 90) + 10) : "");
    if (name.length <= USERNAME_MAX) pool.add(name);
  }
  const candidates = [...pool];
  const taken = await db
    .select({ username: sql<string>`lower(${profilesTable.username})` })
    .from(profilesTable)
    .where(
      inArray(
        sql`lower(${profilesTable.username})`,
        candidates.map((c) => c.toLowerCase()),
      ),
    );
  const takenSet = new Set(taken.map((r) => r.username));
  return candidates.filter((c) => !takenSet.has(c.toLowerCase())).slice(0, count);
}
