/**
 * The words of every push, in the phone's language (SYC-221,
 * news-in-your-language.md §3.1, §3.4). One table for all of them, Monday's
 * weekly result included.
 *
 * The language is `push_tokens.language`, which the app sends when it
 * registers and whenever the person changes language; a phone that never sent
 * one (an old build) is sent English, as is anything we don't know.
 *
 * Greek and French often change with a cat's sex, which we usually don't
 * know, so every line uses the generic "η γάτα" or a colon and never guesses.
 * French "vu" and "revus" are the generic masculine, as for "le chat"; French
 * puts a no-break space before ":" and a narrow one before "!", so the mark
 * never wraps onto its own line on a lock screen. Greek
 * and French are drafts for native review (SYC-4).
 *
 * Never a place on the island, never a time: a lock screen is public.
 */

export type NewsLanguage = "en" | "el" | "fr";

/** The stored push language, or English for null, an old build or anything unknown. */
export function languageOf(raw: string | null | undefined): NewsLanguage {
  return raw === "el" || raw === "fr" ? raw : "en";
}

/** What a piece of cat news is, so it can be worded per phone (and, from PR 2, stored). */
export type NewsWording = "sterilised" | "spotted_again" | "seen_weekday" | "seen_date" | "new_cat";

/** Every push the app sends about a cat, with the names it needs. `day` is a Syros calendar day, YYYY-MM-DD. */
export type NewsPush =
  | { kind: "sterilised"; name: string }
  | { kind: "spotted_again"; name: string }
  | { kind: "seen_weekday"; name: string; day: string }
  | { kind: "seen_date"; name: string; day: string }
  | { kind: "new_cat"; name: string }
  | { kind: "home"; name: string }
  | { kind: "rename"; oldName: string; newName: string }
  | { kind: "home_details"; name: string };

type Words = { title: string; body: string };

// Weekdays by getUTCDay() (0 = Sunday). Greek carries its article in the
// accusative ("την Τρίτη"), as "on Tuesday" needs; French has none.
const WEEKDAY: Record<NewsLanguage, readonly string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  el: ["την Κυριακή", "τη Δευτέρα", "την Τρίτη", "την Τετάρτη", "την Πέμπτη", "την Παρασκευή", "το Σάββατο"],
  fr: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
};

// Greek months in the genitive ("3 Οκτωβρίου"), as a date needs.
const MONTH: Record<NewsLanguage, readonly string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  el: ["Ιανουαρίου", "Φεβρουαρίου", "Μαρτίου", "Απριλίου", "Μαΐου", "Ιουνίου", "Ιουλίου", "Αυγούστου", "Σεπτεμβρίου", "Οκτωβρίου", "Νοεμβρίου", "Δεκεμβρίου"],
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
};

function ymdParts(day: string): { y: number; m: number; d: number } {
  const [y, m, d] = day.split("-").map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 };
}

/** "Tuesday" / "την Τρίτη" / "mardi" for a Syros day. Pure: the day is already a calendar day. */
export function weekdayWord(day: string, lang: NewsLanguage): string {
  const { y, m, d } = ymdParts(day);
  return WEEKDAY[lang][new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** "3 October" / "3 Οκτωβρίου" / "3 octobre" (French "1er" for the first). */
export function dateWord(day: string, lang: NewsLanguage): string {
  const { m, d } = ymdParts(day);
  const n = lang === "fr" && d === 1 ? "1er" : String(d);
  return `${n} ${MONTH[lang][m - 1]}`;
}

/**
 * The cat-news push. For the care and sighting kinds the title is the cat's
 * name and the body the news, as before; the English is word for word what
 * the app sent before SYC-221.
 */
const CAT_NEWS: Record<NewsLanguage, (n: NewsPush) => Words> = {
  en: (n) => {
    switch (n.kind) {
      case "sterilised": return { title: n.name, body: `${n.name} has been sterilised!` };
      case "spotted_again": return { title: n.name, body: `${n.name} was spotted again!` };
      case "seen_weekday": return { title: n.name, body: `${n.name} was seen on ${weekdayWord(n.day, "en")}` };
      case "seen_date": return { title: n.name, body: `${n.name} was seen on ${dateWord(n.day, "en")}` };
      case "new_cat": return { title: n.name, body: `${n.name} was just discovered on Syros!` };
      case "home": return { title: `${n.name} has a home!`, body: `${n.name} now has a home.` };
      case "rename": return { title: `${n.oldName} is now ${n.newName}!`, body: `${n.newName}'s owner renamed their cat.` };
      case "home_details": return { title: `${n.name} has an update`, body: `${n.name}'s home details were updated by their owner.` };
    }
  },
  el: (n) => {
    switch (n.kind) {
      case "sterilised": return { title: n.name, body: `Η γάτα ${n.name} στειρώθηκε!` };
      case "spotted_again": return { title: n.name, body: `Η γάτα ${n.name} εντοπίστηκε ξανά!` };
      case "seen_weekday": return { title: n.name, body: `Η γάτα ${n.name} εντοπίστηκε ${weekdayWord(n.day, "el")}` };
      case "seen_date": return { title: n.name, body: `Η γάτα ${n.name} εντοπίστηκε στις ${dateWord(n.day, "el")}` };
      case "new_cat": return { title: n.name, body: `Νέα γάτα στη Σύρο: ${n.name}!` };
      case "home": return { title: `Η γάτα ${n.name} βρήκε σπίτι!`, body: `Η γάτα ${n.name} έχει πλέον σπίτι.` };
      case "rename": return { title: `Η γάτα ${n.oldName} λέγεται πλέον ${n.newName}!`, body: `Ο ιδιοκτήτης της έδωσε στη γάτα ${n.newName} νέο όνομα.` };
      case "home_details": return { title: `Νέα για τη γάτα ${n.name}`, body: `Τα στοιχεία σπιτιού της γάτας ${n.name} ενημερώθηκαν.` };
    }
  },
  fr: (n) => {
    switch (n.kind) {
      case "sterilised": return { title: n.name, body: `${n.name} : stérilisation faite !` };
      case "spotted_again": return { title: n.name, body: `${n.name} : vu à nouveau !` };
      case "seen_weekday": return { title: n.name, body: `${n.name} : vu ${weekdayWord(n.day, "fr")}` };
      case "seen_date": return { title: n.name, body: `${n.name} : vu le ${dateWord(n.day, "fr")}` };
      case "new_cat": return { title: n.name, body: `Nouveau chat à Syros : ${n.name} !` };
      case "home": return { title: `${n.name} a trouvé un foyer !`, body: `${n.name} a maintenant un foyer.` };
      case "rename": return { title: `${n.oldName} s’appelle maintenant ${n.newName} !`, body: `Son propriétaire a rebaptisé ce chat ${n.newName}.` };
      case "home_details": return { title: `Du nouveau pour ${n.name}`, body: `Les infos du foyer de ${n.name} ont été mises à jour.` };
    }
  },
};

export function newsText(n: NewsPush, lang: NewsLanguage): Words {
  return CAT_NEWS[lang](n);
}

/**
 * The evening round-up (§6.4.4). Never a time, a clock reading, "x minutes
 * ago", or even "today", since a window can start the evening before or span
 * a missed evening (review of #89, finding 4).
 */
const ROUND_UP: Record<NewsLanguage, { title: string; one: (a: string) => string; two: (a: string, b: string) => string; many: (a: string, others: number) => string }> = {
  en: {
    title: "Cats you follow",
    one: (a) => `${a} was spotted again.`,
    two: (a, b) => `${a} and ${b} were spotted again.`,
    many: (a, n) => `${a} and ${n} other cats you follow were spotted again.`,
  },
  el: {
    title: "Γάτες που ακολουθείς",
    one: (a) => `Η γάτα ${a} εντοπίστηκε ξανά.`,
    two: (a, b) => `Οι γάτες ${a} και ${b} εντοπίστηκαν ξανά.`,
    many: (a, n) => `Η γάτα ${a} και ${n} ακόμα γάτες που ακολουθείς εντοπίστηκαν ξανά.`,
  },
  fr: {
    title: "Les chats que tu suis",
    one: (a) => `${a} : vu à nouveau.`,
    two: (a, b) => `${a} et ${b} ont été revus.`,
    many: (a, n) => `${a} et ${n} autres chats que tu suis ont été revus.`,
  },
};

export function roundUpWords(catNames: readonly string[], lang: NewsLanguage): Words {
  const copy = ROUND_UP[lang];
  const [first, second] = catNames;
  if (catNames.length <= 1) return { title: copy.title, body: copy.one(first!) };
  if (catNames.length === 2) return { title: copy.title, body: copy.two(first!, second!) };
  return { title: copy.title, body: copy.many(first!, catNames.length - 1) };
}

// ---- Monday's weekly result (SYC-706), moved here from weeklyClose.ts ----

const MEDAL: Record<number, string> = { 2: "🥈", 3: "🥉" };

// Mirrors the app's formatRank (artifacts/cat-spotter/lib/formatRank.ts): English
// 2nd/3rd, French 2e/3e, Greek the plain number. Only places 2 and 3 are worded.
function rankWord(language: NewsLanguage, place: number): string {
  if (language === "el") return String(place);
  if (language === "fr") return place === 1 ? "1er" : `${place}e`;
  return place === 2 ? "2nd" : place === 3 ? "3rd" : `${place}th`;
}

const WEEK_COPY: Record<
  NewsLanguage,
  { title: string; top: string; placed: (medal: string, rank: string) => string }
> = {
  en: {
    title: "Last week's top spotters",
    top: "🏆 You were the top spotter on Syros last week. You've earned Champion!",
    placed: (medal, rank) => `${medal} You came ${rank} on Syros last week. You've earned Podium!`,
  },
  el: {
    title: "Οι κορυφαίοι spotters της περασμένης εβδομάδας",
    top: "🏆 Ήσουν ο κορυφαίος spotter της Σύρου την περασμένη εβδομάδα. Κέρδισες το παράσημο Πρωταθλητής!",
    placed: (medal, rank) =>
      `${medal} Ήρθες στη θέση ${rank} στη Σύρο την περασμένη εβδομάδα. Κέρδισες το παράσημο Βάθρο!`,
  },
  fr: {
    title: "Les meilleurs spotters de la semaine dernière",
    top: "🏆 Tu as été le meilleur spotter de Syros la semaine dernière. Tu as gagné le badge Champion !",
    placed: (medal, rank) =>
      `${medal} Tu as terminé ${rank} à Syros la semaine dernière. Tu as gagné le badge Podium !`,
  },
};

/** The weekly push's words, which are also the bell entry's stored words (in English), for a place of 1–3. */
export function weekResultText(place: number, language: string | null = "en"): Words {
  const lang = languageOf(language);
  const copy = WEEK_COPY[lang];
  if (place === 1) return { title: copy.title, body: copy.top };
  return { title: copy.title, body: copy.placed(MEDAL[place] ?? "🥉", rankWord(lang, place)) };
}

/** Every word table, for the completeness test. */
export const NEWS_LANGUAGES: readonly NewsLanguage[] = ["en", "el", "fr"];
