/**
 * SYC-506: names suggested on the phone when it can't reach the server, and
 * the rules a name must meet. Mirrors artifacts/api-server/src/lib/usernames.ts
 * (word lists, 3–24 characters, letters in any script, digits, spaces and
 * `_ . ' -`). The server stays the judge: a name chosen offline is claimed
 * there later (lib/heldNameSave.ts), and the offensive-word check only runs
 * there.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;

const USERNAME_CHARSET = /^[\p{L}\p{N} _.'-]+$/u;

/** The name as the server would store it, or null if the server would refuse it. */
export function normalizeUsernameLocally(raw: string): string | null {
  const name = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) return null;
  if (!USERNAME_CHARSET.test(name)) return null;
  return name;
}

const ADJECTIVES = [
  'Whisker', 'Purring', 'Sneaky', 'Fluffy', 'Mighty', 'Salty', 'Sunny', 'Aegean',
  'Island', 'Velvet', 'Midnight', 'Marble', 'Curious', 'Dozy', 'Zoomy', 'Harbor',
];

const NOUNS = [
  'Mouser', 'Tomcat', 'Kitten', 'Feline', 'Paw', 'Tail', 'Meow', 'Purrer',
  'Tabby', 'Calico', 'Stray', 'Prowler', 'Napper', 'Spotter', 'Whiskers', 'Catnip',
];

type Random = () => number;

function pick<T>(items: readonly T[], random: Random): T {
  return items[Math.floor(random() * items.length)]!;
}

/** `count` different cat-themed names, made on the phone. */
export function suggestLocalUsernames(count: number, random: Random = Math.random): string[] {
  const names = new Set<string>();
  for (let tries = 0; names.size < count && tries < count * 20; tries++) {
    const withNumber = random() < 0.35;
    const name =
      pick(ADJECTIVES, random) +
      pick(NOUNS, random) +
      (withNumber ? String(Math.floor(random() * 90) + 10) : '');
    if (name.length <= USERNAME_MAX) names.add(name);
  }
  return [...names];
}

/**
 * The name with a two-digit number added, shortened first if needed so the
 * result still fits in 24 characters (SunnyTabby → SunnyTabby47).
 */
export function numberedUsername(name: string, random: Random = Math.random): string {
  const suffix = String(Math.floor(random() * 90) + 10);
  const base = name.trim().slice(0, USERNAME_MAX - suffix.length).trimEnd();
  return base + suffix;
}
