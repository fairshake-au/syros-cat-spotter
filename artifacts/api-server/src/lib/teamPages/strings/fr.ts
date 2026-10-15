// Drafted by Claude; not live until Johnny signs off (SYC-283).
//
// "Tu" throughout, as in the public app (claiming-a-cat.md and
// offline-queue-on-web.md settle French on "tu"). "Gardien de chats" for cat
// guardian, as in the app; "Syros Cats" kept as the charity's name.
import type { StringKey } from "./en";

export const fr: Record<StringKey, string> = {
  "shell.signedInAs": "Connecté(e) en tant que {name}",
  "shell.signOut": "Se déconnecter",

  "refused.title": "Cette partie est réservée à l'équipe",
  "refused.titleManagement": "Cette partie est réservée à la direction",
  "refused.forTeam": "Cette partie du tableau de bord est réservée à l'équipe de Syros Cats.",
  "refused.yourColonies": "Tes colonies sont ici",
  "refused.forManagement": "Cette partie du tableau de bord est réservée à la direction de Syros Cats.",
  "refused.backHome": "Retour au tableau de bord",
  "ended.title": "Ton accès a pris fin",
  "ended.body": "Ton accès a pris fin. Si tu penses qu'il s'agit d'une erreur, contacte Syros Cats.",
};
