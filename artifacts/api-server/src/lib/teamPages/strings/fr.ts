// Drafted by Claude; not live until Johnny signs off (SYC-283).
//
// "Tu" throughout, as in the public app (claiming-a-cat.md and
// offline-queue-on-web.md settle French on "tu"). "Gardien de chats" for cat
// guardian, as in the app; "Syros Cats" kept as the charity's name.
import type { StringKey } from "./en";

export const fr: Record<StringKey, string> = {
  "shell.signedInAs": "Connecté(e) en tant que {name}",
  "shell.signOut": "Se déconnecter",

  "refused.title": "Cette partie est réservée à l’équipe",
  "refused.titleManagement": "Cette partie est réservée à la direction",
  "refused.forTeam": "Cette partie du tableau de bord est réservée à l’équipe de Syros Cats.",
  "refused.yourColonies": "Tes colonies sont ici",
  "refused.forManagement": "Cette partie du tableau de bord est réservée à la direction de Syros Cats.",
  "refused.backHome": "Retour au tableau de bord",
  "ended.title": "Ton accès a pris fin",
  "ended.body": "Ton accès a pris fin. Si tu penses qu’il s’agit d’une erreur, contacte Syros Cats.",
  "role.team": "membre de l’équipe de Syros Cats",
  "role.management": "membre de la direction de Syros Cats",
  "role.guardian": "gardien de chats pour {colonies}",
  "role.both": "{first} et {second}",
  "role.none": "rien",
  "list.and": "{first} et {last}",
  "list.more": "{count} autres",

  "welcome.title": "Bienvenue chez Syros Cats",
  "welcome.invitedBy": "{inviter}, de Syros Cats, t’a invité(e) en tant que {role}.",
  "welcome.invited": "Syros Cats t’a invité(e) en tant que {role}.",
  "welcome.seeDo.title": "Ce que tu pourras voir et faire",
  "welcome.seeDo.guardian": "Pour tes propres colonies uniquement : l’emplacement exact de chaque chat, les points de nourrissage de la colonie, les photos, et si chaque chat est stérilisé. Tu peux dire ce que tu vois arriver aux chats, vérifier l’oreille d’un chat quand tu le vois de près, décider quels chats font partie de tes colonies (en les ajoutant ou en les retirant), ajouter des points de nourrissage et créer une nouvelle colonie. Tu peux lire les signalements de chats en difficulté qui concernent les chats de tes colonies, sans pouvoir les modifier, et jamais les signalements d’un autre problème.",
  "welcome.seeDo.team": "Toute l’île : les signalements de chats en difficulté, et chaque chat, colonie et point de nourrissage, avec leur emplacement exact. Tu peux noter ce que tu trouves, corriger les fiches et t’occuper des signalements.",
  "welcome.seeDo.management": "En plus de tout ce que fait l’équipe, tu peux inviter des personnes, changer ce qu’elles peuvent faire, les retirer de la liste, déconnecter n’importe qui partout et traiter les demandes de suppression de données.",
  "welcome.ask.title": "Ce que nous te demandons",
  "welcome.promise1": "Je dirai ce que j’ai réellement vu, et je dirai « Je ne suis pas sûr(e) » quand je ne le suis pas.",
  "welcome.promise2": "Si j’arrête d’aider, ou si je perds mon téléphone, je le dirai à Syros Cats.",
  "welcome.promise3": "Je comprends que Syros Cats conserve mon nom et mon adresse e-mail pour faire fonctionner tout cela, et que je peux demander à partir à tout moment.",
  "welcome.lock": "Garde ton téléphone verrouillé, par exemple avec un code, pour que personne d’autre ne puisse l’ouvrir.",
  "welcome.neverReopened": "Un téléphone qui n’est plus jamais ouvert garde sa liste enregistrée jusqu’à ce que le navigateur l’efface. Syros Cats ne peut pas l’effacer à distance.",
  "welcome.name.label": "Vérifie ton nom tel que tu veux que Syros Cats le voie",
  "welcome.yes": "Oui, je rejoins",
  "welcome.no": "Non, ce n’est pas pour moi",
  "welcome.declined.title": "Merci de nous avoir prévenus",
  "welcome.declined.body": "Tu n’as pas été ajouté(e), et rien d’autre ne se passera. Si tu changes d’avis, demande à Syros Cats.",
  "welcome.closed.title": "Cette invitation n’est plus valable",
  "welcome.closed.body": "Rien n’a été modifié. Si tu penses que c’est une erreur, demande à la personne qui t’a invité(e).",

  "mail.invite.subject": "Syros Cats t’invite à aider",
  "mail.invite.body": "Syros Cats t’invite à aider en tant que {role}.",
  "mail.invite.how": "Pour commencer, va sur admin.catspotters.com, saisis cette adresse et appuie sur le lien que nous t’enverrons.",
  "mail.invite.expiry": "Cette invitation ne fonctionne plus au bout de 14 jours. Si tu ne l’attendais pas, tu peux ignorer ce message.",

  "mail.notice.subject": "Un changement dans qui peut utiliser le tableau de bord de Syros Cats",
  "mail.notice.invited": "{actor} a invité {subject} en tant que {role}.",
  "mail.notice.rolesChanged": "{actor} a changé ce que {subject} peut faire. Avant : {before}. Maintenant : {after}.",
  "mail.notice.rejoined": "{actor} a fait revenir {subject} en tant que {role}. Il ou elle devra accepter à nouveau.",
  "mail.notice.left": "{actor} a indiqué que {subject} est parti(e).",
  "mail.notice.withdrawn": "Invitations encore ouvertes envoyées par {subject} et retirées : {count}.",
  "mail.notice.signedOut": "{actor} a déconnecté {subject} partout.",
  "mail.notice.why": "Chaque changement dans qui peut utiliser le tableau de bord est envoyé par e-mail aux autres membres de la direction. Si quelque chose te semble anormal, tu peux déconnecter quelqu’un partout sur la page « Personnes ».",
};
