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
  // SYC-53 PR 1.1: how a person's roles are said (roles-and-invites.md §2.6),
  // used by the accept page and the two emails. Never "role" or "scope".
  "role.team": "a member of the Syros Cats team",
  "role.management": "a member of Syros Cats management",
  "role.guardian": "a cat guardian for {colonies}",
  "role.both": "{first}, and {second}",
  "role.none": "nothing",
  "list.and": "{first} and {last}",
  "list.more": "{count} more",

  // The accept page (§4.1 step 4; plan review M5). The three promises are
  // word for word as Samuel settled them (Q5). Everything else here is a
  // plain statement, never a promise, and none of it is about keeping
  // places private (§13.4, §14.1).
  "welcome.title": "Welcome to Syros Cats",
  "welcome.invitedBy": "{inviter} from Syros Cats invited you as {role}.",
  "welcome.invited": "Syros Cats invited you as {role}.",
  "welcome.seeDo.title": "What you'll be able to see and do",
  "welcome.seeDo.guardian": "For your own colonies only: exactly where each cat is, the colony's feeding sites, photos, and whether each cat is sterilised. You can say what you see happening to the cats there, check a cat's ear when you see one up close, decide which cats are in your colonies (adding them or taking them out), add feeding sites, and create a new colony. You can read the reports of cats in trouble about your colonies' cats, but not change them, and never the “Report an issue” reports.",
  "welcome.seeDo.team": "The whole island: the reports of cats in trouble, and every cat, colony and feeding site, with exact positions. You can record what you find, put records right, and look after the reports.",
  "welcome.seeDo.management": "As well as everything the team can do, you can invite people, change what they can do, take them off the list, sign anyone out everywhere, and act on requests to delete someone's data.",
  "welcome.ask.title": "What we ask of you",
  "welcome.promise1": "I will say what I actually saw, and say \"I'm not sure\" when I'm not.",
  "welcome.promise2": "If I stop helping, or lose my phone, I'll tell Syros Cats.",
  "welcome.promise3": "I understand Syros Cats keeps my name and email address to run this, and I can ask to leave at any time.",
  "welcome.lock": "Please keep a lock on your phone, such as a PIN, so nobody else can open it.",
  "welcome.neverReopened": "A phone that is never opened again keeps its saved list until the browser clears it. Syros Cats can't wipe it from a distance.",
  "welcome.name.label": "Check your name as you'd like Syros Cats to see it",
  "welcome.yes": "Yes, join",
  "welcome.no": "No, this isn't for me",
  "welcome.declined.title": "Thank you for letting us know",
  "welcome.declined.body": "You haven't been added, and nothing more will happen. If you change your mind, ask Syros Cats.",
  "welcome.closed.title": "This invitation is no longer open",
  "welcome.closed.body": "Nothing was changed. If you think that's a mistake, ask the person who invited you.",

  // The invitation email (§4.1 step 2, §8.5): no secret, no link, names no
  // other person. The only words that vary are the role and the colonies.
  "mail.invite.subject": "Syros Cats has invited you to help",
  "mail.invite.body": "Syros Cats has invited you to help as {role}.",
  "mail.invite.how": "To get started, go to admin.catspotters.com, type this address, and tap the link we send you.",
  "mail.invite.expiry": "This invitation stops working after 14 days. If you weren't expecting it, you can ignore this message.",

  // The access-change notice to the other managers (§8.3, §9.5): who made
  // which change to whom. Names come from the records when it is sent.
  "mail.notice.subject": "A change to who can use the Syros Cats dashboard",
  "mail.notice.invited": "{actor} invited {subject} as {role}.",
  "mail.notice.rolesChanged": "{actor} changed what {subject} can do. Before: {before}. Now: {after}.",
  "mail.notice.rejoined": "{actor} brought {subject} back as {role}. They will need to accept again.",
  "mail.notice.left": "{actor} marked {subject} as left.",
  "mail.notice.withdrawn": "Invitations {subject} had sent that were still open were withdrawn: {count}.",
  "mail.notice.signedOut": "{actor} signed {subject} out everywhere.",
  "mail.notice.why": "Every change to who can use the dashboard is emailed to the other managers. If this looks wrong, you can sign someone out everywhere on the People page.",
} as const;

export type StringKey = keyof typeof en;
