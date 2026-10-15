// Drafted by Claude; not live until Johnny signs off (SYC-283).
//
// "Vous" throughout on the dashboard (the public app uses "tu"; the dashboard
// is for adults doing a job). "Gardien de chats" for cat guardian, as in the
// app; "Syros Cats" kept as the charity's name.
import type { StringKey } from "./en";

export const fr: Record<StringKey, string> = {
  "shell.signedInAs": "Connecté(e) en tant que {name}",
  "shell.signOut": "Se déconnecter",

  "refused.title": "Cette partie est réservée à l'équipe",
  "refused.titleManagement": "Cette partie est réservée à la direction",
  "refused.forTeam": "Cette partie du tableau de bord est réservée à l'équipe de Syros Cats.",
  "refused.yourColonies": "Vos colonies sont ici",
  "refused.forManagement": "Cette partie du tableau de bord est réservée à la direction de Syros Cats.",
  "refused.backHome": "Retour au tableau de bord",
  "ended.title": "Votre accès a pris fin",
  "ended.body": "Votre accès a pris fin. Si vous pensez qu'il s'agit d'une erreur, contactez Syros Cats.",
};
