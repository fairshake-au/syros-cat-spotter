// Drafted by Claude; not live until Johnny signs off (SYC-283).
//
// Words follow the app's settled Greek (artifacts/cat-spotter/lib/i18n.ts):
// "κηδεμόνας γατών" for cat guardian, "Syros Cats" kept as the charity's name.
// Capitals carry no accents (SYC-159); nothing here is set in capitals.
import type { StringKey } from "./en";

export const el: Record<StringKey, string> = {
  "shell.signedInAs": "Συνδεδεμένος/η ως {name}",
  "shell.signOut": "Αποσύνδεση",

  "refused.title": "Αυτή η ενότητα είναι για την ομάδα",
  "refused.titleManagement": "Αυτή η ενότητα είναι για τη διοίκηση",
  "refused.forTeam": "Αυτή η ενότητα του πίνακα ελέγχου είναι για την ομάδα των Syros Cats.",
  "refused.yourColonies": "Οι αποικίες σας είναι εδώ",
  "refused.forManagement": "Αυτή η ενότητα του πίνακα ελέγχου είναι για τη διοίκηση των Syros Cats.",
  "refused.backHome": "Πίσω στον πίνακα ελέγχου",
  "ended.title": "Η πρόσβασή σας έχει λήξει",
  "ended.body": "Η πρόσβασή σας έχει λήξει. Αν νομίζετε ότι είναι λάθος, επικοινωνήστε με τους Syros Cats.",
};
