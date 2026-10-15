// English is the source of truth for the dashboard's three-language
// catalogue (SYC-53 PR 1.0; roles-and-invites.md §13). `el.ts` and `fr.ts`
// are typed against this file's keys, so a missing key fails the build.
//
// Only the pages a cat guardian reads are here (Decision 10). Team and
// management screens stay English and keep their words in ../words.ts.
//
// Fixed text written by us, never a person's input: a page may draw it as it
// is, but anything a person typed goes through escapeHtml where it is drawn.

export const en = {
  // Shared page shell (every translated page).
  "shell.signedInAs": "Signed in as {name}",
  "shell.signOut": "Sign out",

  // The dashboard's refusals for a signed-in person (roles-and-invites.md
  // §6.4; SYC-53 PR 0.5).
  "refused.title": "That part is for the team",
  "refused.titleManagement": "That part is for management",
  "refused.forTeam": "That part of the dashboard is for the Syros Cats team.",
  "refused.yourColonies": "Your colonies are here",
  "refused.forManagement": "That part of the dashboard is for Syros Cats management.",
  "refused.backHome": "Back to the dashboard",
  "ended.title": "Your access has ended",
  "ended.body": "Your access has ended. Ask Syros Cats if you think that's a mistake.",
} as const;

export type StringKey = keyof typeof en;
