/**
 * Lightweight multilingual (English, Greek, French) offensive-word filter
 * for public-facing display names (nicknames).
 *
 * Strategy: normalize aggressively (lowercase, strip diacritics, map common
 * leetspeak digits, transliterate Greek to Latin), then
 *  - match short banned words only on whole tokens (avoids the classic
 *    "Scunthorpe problem"), and
 *  - match longer banned words (>= 5 chars) as substrings of the collapsed
 *    string, so separators/spacing can't be used to sneak them through.
 */

const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  $: "s",
  "!": "i",
  "€": "e",
};

// Greek -> Latin transliteration (applied after diacritics are stripped).
const GREEK_MAP: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th",
  ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p",
  ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "x", ψ: "ps", ω: "o",
};

/** Banned words, expressed in normalized (lowercase, unaccented) form. */
const BANNED: string[] = [
  // English
  "fuck", "shit", "bitch", "cunt", "asshole", "arsehole", "dickhead",
  "bastard", "whore", "slut", "nigger", "nigga", "faggot", "retard",
  "twat", "wanker", "prick", "pussy", "cock", "motherfucker", "douche",
  "dick", "cum", "jizz",
  // Greek (transliterated; Greek input is transliterated before matching)
  "malakas", "malaka", "gamo", "gamiesai", "gamisou", "poutana", "mouni",
  "arxidi", "arxidia", "arhidi", "archidi", "kariolis", "kariola",
  "poustis", "pousti", "skyla", "vlakas", "gamoto", "mounopano",
  // Greek transliteration variants (υ -> y, ου -> oy)
  "poytana", "moyni", "poystis", "poysti", "gamiesai", "moynopano",
  // French
  "merde", "putain", "pute", "salope", "connard", "connasse", "encule",
  "enculee", "salaud", "batard", "couille", "couilles", "nique", "niquer",
  "ntm", "fdp", "bite", "chatte", "pd", "petasse", "trouduc",
];

// Short words that are unambiguous enough to match as substrings too
// (no common innocent word contains them — note "cunt" is excluded because
// of e.g. "Scunthorpe").
const SHORT_SUBSTRING_SAFE = new Set(["fuck", "shit", "jizz"]);

const SHORT_BANNED = BANNED.filter(
  (w) => w.length < 5 && !SHORT_SUBSTRING_SAFE.has(w),
);
const LONG_BANNED = BANNED.filter(
  (w) => w.length >= 5 || SHORT_SUBSTRING_SAFE.has(w),
);

function normalize(input: string): string {
  let s = input.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s
    .split("")
    .map((ch) => LEET_MAP[ch] ?? GREEK_MAP[ch] ?? ch)
    .join("");
  return s;
}

/** True when the text contains an offensive word (en/el/fr). */
export function containsOffensiveLanguage(input: string): boolean {
  const normalized = normalize(input);
  const tokens = normalized.split(/[^a-z]+/).filter(Boolean);
  const collapsed = tokens.join("");

  for (const word of SHORT_BANNED) {
    if (tokens.includes(word)) return true;
  }
  for (const word of LONG_BANNED) {
    if (collapsed.includes(word)) return true;
  }
  return false;
}
