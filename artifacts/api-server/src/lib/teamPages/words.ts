// The words on the Colonies pages (SYC-209 PR 2.1).
//
// The team dashboard is English only (spec Decision 9). But the roles plan
// gives cat guardians three-language dashboard pages, and they will read these
// same pages. So the words live in one map behind `t(key)`, and a later PR can
// move the keys into the roles plan's three-language catalogue without
// rewriting a single page. Only this PR's page words are here; the older
// pages keep their own words.
//
// Everything here is fixed text written by us, never a person's input, so a
// page may draw it as it is. Names and notes that people typed are not words:
// they go through escapeHtml where they are drawn.

const WORDS = {
  "colonies.title": "Colonies",
  "colonies.empty": "There are no colonies yet.",
  "colonies.noMatch": "No colony has ever had a name like that.",
  "colonies.searchLabel": "Find a colony by any name it has ever had",
  "colonies.searchButton": "Find",
  "colonies.showAll": "Show every colony",
  "colonies.noGuardian": "No cat guardian recorded",
  "colonies.guardian": "Cat guardian",
  "colonies.sites": "Feeding sites",
  "colonies.cats": "Cats",
  "colonies.formerly": "Used to be called",

  "create.open": "Create a colony",
  "create.name": "Colony name",
  "create.nameHint":
    "A place and the person who looks after it, like “Vaporia — Eleni's”.",
  "create.guardian": "Cat guardian's name (optional)",
  "create.notes": "Team-only notes (optional)",
  "create.button": "Create the colony",

  "notes.hint": "Don't write when people come and go.",

  "colony.back": "All colonies",
  "colony.notes": "Team-only notes",
  "colony.noNotes": "No notes.",
  "colony.centre": "Centre of the colony",
  "colony.noCentre": "Not set.",
  "colony.sitesTitle": "Feeding sites",
  "colony.noSites": "No feeding sites are recorded for this colony yet.",
  "colony.catsTitle": "Cats",
  "colony.noCats": "No cats are in this colony yet.",
  "colony.historyTitle": "History",
  "colony.noHistory": "Nothing has been recorded yet.",
  "colony.editTitle": "Change this colony",
  "colony.rename": "Name",
  "colony.centreLat": "Centre, latitude (optional)",
  "colony.centreLng": "Centre, longitude (optional)",
  "colony.centreHint": "Both numbers, or leave both empty.",
  "colony.save": "Save changes",
  "colony.noPhoto": "No photo",

  "done.created": "The colony was created.",
  "done.saved": "Saved.",
  "done.unchanged": "Nothing was different, so nothing was changed.",

  "problem.title": "That didn't save",
  "problem.nothingChanged": "Nothing was changed.",
  "problem.backToColonies": "Back to the colonies",
  "problem.backToColony": "Back to the colony",
  "problem.fields": "Something in the form wasn't right",
  "problem.nameEmpty": "A colony needs a name.",
  "problem.nameTooLong": "A colony's name can be up to 100 characters.",
  "problem.guardianTooLong": "The guardian's name can be up to 100 characters.",
  "problem.notesTooLong": "Notes can be up to 2000 characters.",
  "problem.centre": "The centre needs a latitude and a longitude, both real numbers, or both left empty.",

  "taken.title": "That name is taken",
  "taken.before": "Another colony is already called",
  "taken.after":
    "Names count as the same whatever the accents or capitals.",
  "taken.generic": "Another colony already has that name.",

  "none.title": "No such colony",
  "none.body": "There is no colony with that number.",

  "history.by": "by",
  "history.removed": "Details removed at someone's request.",
  "history.nobody": "nobody",
  "history.system": "the system",
  "history.created": "Colony created",
  "history.renamed": "Renamed",
  "history.guardian": "Cat guardian changed",
  "history.notes": "Team notes changed",
  "history.centre": "Centre changed",
} as const;

export type WordKey = keyof typeof WORDS;

/** The English words for a key. A key that does not exist is a type error. */
export function t(key: WordKey): string {
  return WORDS[key];
}
