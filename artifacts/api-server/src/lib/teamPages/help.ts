import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";

export { HELP_CSS } from "./helpCss";

// In-page help for the dashboard (SYC-739; the 26 Oct help review). Three
// pieces, all plain HTML with no script:
// - pageIntro: one or two sentences under a page's title, saying what the page is for.
// - howFold: a closed "How this page works" fold, for anything longer.
// - whatHappens: one line beside a button that reaches the public or another
//   person, saying what will happen before it is pressed.
// And one page, "Words we use", that the folds and Home link to. Team pages
// are English (see methodFold.ts), so these take plain strings.

export const WORDS_PATH = "/api/team/words";

/** The line under a page's title. */
export const pageIntro = (text: string): string => `<p class="intro">${esc(text)}</p>`;

/**
 * A closed fold of short paragraphs. The last line links to Words we use
 * unless `words: false`.
 */
export function howFold(lines: readonly string[], o: { summary?: string; words?: boolean } = {}): string {
  if (lines.length === 0) return "";
  const words = o.words === false ? "" : `<p class="hint"><a href="${WORDS_PATH}">Words we use</a></p>`;
  return (
    `<details class="hownote howpage"><summary>${esc(o.summary ?? "How this page works")}</summary>` +
    lines.map((l) => `<p class="hint">${esc(l)}</p>`).join("") +
    words +
    "</details>"
  );
}

/** What a button will do, said before it is pressed. `warn` for anything every visitor sees. */
export const whatHappens = (text: string, o: { warn?: boolean } = {}): string =>
  `<p class="what${o.warn ? " warn" : ""}">${esc(text)}</p>`;

/** One entry on Words we use: the word, then what it means in a sentence or two. */
export interface WordEntry {
  id: string;
  word: string;
  meaning: string;
}

export interface WordGroup {
  heading: string;
  words: readonly WordEntry[];
}

/**
 * The words the dashboard uses, each defined once. Every meaning here was
 * checked against the code it describes (26 Oct 2026; who can confirm
 * sterilisation is authorityLevel in lib/resolve.ts); change it when the
 * rule changes.
 */
export const WORDS: readonly WordGroup[] = [
  {
    heading: "People",
    words: [
      { id: "spotter", word: "Spotter", meaning: "Someone using the public app who photographs cats and says where they saw them." },
      {
        id: "guardian",
        word: "Cat guardian",
        meaning: "Someone who looks after a colony, usually by feeding it. Cat guardians have their own pages, where they can keep their colony's cats up to date.",
      },
    ],
  },
  {
    heading: "Places",
    words: [
      {
        id: "colony",
        word: "Colony",
        meaning: "A group of street cats, usually fed in the same place and looked after by a cat guardian.",
      },
      {
        id: "site",
        word: "Feeding site",
        meaning: "A pin on the map where cats are fed. A colony can have several. Every new site starts private: only Syros Cats people signed in to the dashboard can see it.",
      },
      {
        id: "area",
        word: "Area",
        meaning: "A named part of the island, like Ermoupoli, used to label where a cat was seen and to filter the Cats list. A place takes the name of the area whose centre is nearest. More than 2 km from every centre is Off Syros.",
      },
    ],
  },
  {
    heading: "Cats",
    words: [
      { id: "syr", word: "SYR number", meaning: "Each cat's ID in the app, like SYR-0412. It never changes, even if the cat is renamed." },
      { id: "street", word: "Street cat", meaning: "A cat that lives on the street, rather than one that has a home or is in care." },
      { id: "sighting", word: "Sighting", meaning: "One photo of a cat from a spotter, with where and when it was taken." },
      {
        id: "gone",
        word: "No longer with us",
        meaning: "A cat recorded as having died, or not seen for so long that it is presumed gone. These cats are hidden from the Cats list unless you ask for them.",
      },
    ],
  },
  {
    heading: "Sterilisation",
    words: [
      { id: "sterilised", word: "Sterilised", meaning: "Confirmed by a vet, the Syros Cats team (including its older records), the cat's owner or its cat guardian." },
      {
        id: "probably",
        word: "Probably sterilised",
        meaning: "Someone has seen a clipped ear, but nobody who knows the cat has confirmed it. A clipped ear is never proof on its own.",
      },
      { id: "notknown", word: "Not known yet", meaning: "Nobody has been able to tell whether the cat is sterilised." },
      { id: "notsterilised", word: "Not sterilised", meaning: "A vet, the Syros Cats team, the cat's owner or its cat guardian has said the cat is not sterilised." },
      {
        id: "clip",
        word: "Clipped ear",
        meaning: "The tip of one ear cut flat. Vets do this to show that a street cat has been sterilised. A torn or bitten ear is not a clip.",
      },
      {
        id: "trapping",
        word: "Trapping",
        meaning: "Catching street cats, taking them to the vet to be sterilised, then returning them. It usually costs €50–60 per cat.",
      },
      { id: "batch", word: "Vet visit batch", meaning: "One trip to the vet with several cats, recorded together." },
    ],
  },
  {
    heading: "The Queue",
    words: [
      { id: "report", word: "Report", meaning: "A member of the public telling us about a cat that may need help." },
      { id: "issue", word: "Issue", meaning: "Someone telling us about a problem with a cat's photo, name or page." },
      { id: "teamnote", word: "Team note", meaning: "A note only the team can see. Reporters, cat guardians and the public never see it." },
    ],
  },
  {
    heading: "Changes",
    words: [
      {
        id: "markwrong",
        word: "Mark wrong",
        meaning: "How to undo a change on a cat's page. The change stays in the cat's History, crossed out, so nothing is lost.",
      },
    ],
  },
];

/** Words we use: every word defined once, grouped, each with an anchor to link to. */
export function renderWordsPage(o: { personName: string }): string {
  return renderPage({
    title: "Words we use",
    active: "home",
    personName: o.personName,
    body:
      pageIntro("The words the dashboard uses, and what each one means. Other pages link here.") +
      WORDS.map(
        (g) =>
          `<h2>${esc(g.heading)}</h2><dl class="words">` +
          g.words.map((w) => `<dt id="${esc(w.id)}">${esc(w.word)}</dt><dd>${esc(w.meaning)}</dd>`).join("") +
          "</dl>",
      ).join(""),
  });
}
