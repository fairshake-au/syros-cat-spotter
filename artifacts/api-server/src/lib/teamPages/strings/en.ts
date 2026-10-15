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
  "mail.notice.leftSelf": "{subject} stopped helping Syros Cats.",
  "mail.notice.withdrawn": "Invitations {subject} had sent that were still open were withdrawn: {count}.",
  "mail.notice.signedOut": "{actor} signed {subject} out everywhere.",
  "mail.notice.signedOutSelf": "{subject} signed out of the dashboard on every device.",
  "mail.notice.why": "Every change to who can use the dashboard is emailed to the other managers. If this looks wrong, you can sign someone out everywhere on the People page.",

  // SYC-53 PR 1.3: My page and My colonies (roles-and-invites.md §2.6, §9.1, §9.5, §13.1).
  "nav.myPage": "My page",
  "nav.myColonies": "My colonies",
  "my.title": "My page",
  "my.is.guardian": "You’re a cat guardian for {colonies}.",
  "my.is.team": "You’re on the Syros Cats team.",
  "my.is.teamGuardian": "You’re on the Syros Cats team and a cat guardian for {colonies}.",
  "my.is.management": "You’re in Syros Cats management and on the team.",
  "my.is.managementGuardian": "You’re in Syros Cats management and on the team, and a cat guardian for {colonies}.",
  "my.is.none": "You aren’t helping with a colony or with the team right now.",
  "my.colonies.link": "See my colonies",
  "my.language.title": "Language",
  "my.language.label": "Choose the language you’d like to read the dashboard in",
  "my.language.save": "Save my language",
  "my.language.saved": "Saved.",
  "my.language.notLive": "{language} isn’t ready on the dashboard yet, so pages are in English for now. Your choice is saved, and they’ll switch over when it’s ready.",
  "my.language.bad": "That isn’t a language we have.",
  "lang.name.en": "English",
  "lang.name.el": "Greek",
  "lang.name.fr": "French",
  "my.signOut.title": "Signing out",
  "my.signOut.here": "Sign out of this device",
  "my.signOut.everywhere.body": "Or sign out of every phone and computer you’ve used, this one included. You’ll sign in again next time.",
  "my.signOut.everywhere.button": "Sign out everywhere",
  "my.signOut.lastManager": "You’re the last person in Syros Cats management, so you can’t be signed out everywhere: nobody else could invite or remove anyone.",
  "my.stop.title": "Stop helping",
  "my.stop.body": "If you don’t want to help Syros Cats any more, you can stop here. This is your own choice, and it’s not the same as being taken off the list by management.",
  "my.stop.link": "I want to stop helping",
  "my.stop.confirm.title": "Stop helping Syros Cats?",
  "my.stop.confirm.body": "This ends your access to the dashboard right away, on every phone and computer. Everything you’ve recorded stays, with your name on it. If you change your mind later, someone in Syros Cats management has to invite you again.",
  "my.stop.confirm.yes": "Yes, I want to stop helping",
  "my.stop.confirm.no": "No, keep me on",
  "my.stop.lastManager": "You’re the last person in Syros Cats management, so you can’t stop helping yet: nobody else could invite or remove anyone. Ask for another person to be made a manager first.",
  "my.stop.done.title": "Thank you for helping",
  "my.stop.done.body": "You’ve stopped helping Syros Cats and you’ve been signed out. Thank you for everything you did for the cats.",
  "my.problem.title": "That wasn’t changed",
  "my.problem.nothing": "Nothing was changed.",
  "my.problem.generic": "That couldn’t be done just now.",
  "my.back": "Back to my page",
  "mycol.title": "My colonies",
  "mycol.intro": "These are the colonies you look after.",
  "mycol.none": "You aren’t looking after a colony right now. If that seems wrong, ask Syros Cats.",
  "mycol.until": "Until {date}",
  "mycol.rel.feeds": "You feed here",
  "mycol.rel.owns_here": "You have a cat here",
  "mycol.rel.covering": "You’re covering for a while",
  "mycol.team": "You’re on the Syros Cats team, so you can see every colony on the island, not just a few.",
  "mycol.teamLink": "See all colonies",

  // The Appearance section and the Colour check list (SYC-2 PR 3.1;
  // coat-markings-and-health.md §5.3). Cat guardians read the same section
  // and list for their own colonies (spec §5.4, SYC-2 PR 5.1), so the words
  // live here. The colour and mark words are the spec's §3.1 and §3.2, as
  // the app shows them (artifacts/cat-spotter/lib/i18n.ts).
  "coat.black": "Black",
  "coat.white": "White",
  "coat.ginger": "Ginger",
  "coat.grey": "Grey",
  "coat.tabby": "Tabby",
  "coat.tortoiseshell_or_calico": "Tortoiseshell or calico",
  "coat.black_and_white": "Black and white",
  "mark.white_paws": "White paws",
  "mark.white_chest": "White chest or bib",
  "mark.white_face": "White patch on the face",
  "mark.colourpoint": "Dark face, ears and tail",
  "mark.long_fur": "Long fur",
  "mark.kinked_tail": "Kinked tail",
  "mark.torn_ear": "Torn or notched ear",
  "mark.short_tail": "Short or missing tail",
  "mark.missing_eye": "Missing an eye",
  "mark.three_legs": "Three legs",
  "mark.odd_eyes": "Eyes of different colours",
  // How the public line words "missing an eye" (spec §5.2): a plain
  // recognition feature. The other ten keep their chip words.
  "markShown.missing_eye": "One eye",

  "appearance.title": "Appearance",
  "appearance.publicSees": "What the public sees",
  "appearance.publicNothing": "Nothing yet: no colour or markings are known.",
  "appearance.colour": "Colour",
  "appearance.markings": "Markings",
  "appearance.notKnown": "Not known",
  "appearance.nothingSpecial": "Nothing special",
  "appearance.notSure": "Not sure",
  "appearance.cantTell": "Couldn't tell",
  "appearance.level.confirmed": "confirmed",
  "appearance.level.likely": "likely",
  "appearance.level.reported": "reported",
  "appearance.level.unknown": "not known",
  "appearance.statements": "What stands now, newest first",
  "appearance.noStatements": "Nobody has said anything about this yet.",
  "appearance.historyHint": "Statements that were marked wrong or replaced are in the history at the bottom of the page.",
  "appearance.bySpotter": "a spotter",
  "appearance.byMachine": "read automatically from the photo",
  "appearance.byGuardian": "{name}, cat guardian",
  "appearance.prompted": "tapped Yes on a suggestion",
  "appearance.agrees": "agrees with #{id}",
  "appearance.model": "model {version}",
  "appearance.photo": "The photo",
  "appearance.counts": "Counts now",
  "appearance.checkTitle": "Worth a second look",
  "appearance.guardianDisagrees": "A cat guardian's statement decides this, and the team said something different. To overrule it, use Correct.",
  "appearance.confirm": "That's right",
  "appearance.confirmHint": "Records the team's agreement.",
  "appearance.confirmHintGuardian": "A cat guardian's statement decides this, so it changes nothing the public sees.",
  "appearance.correctColour": "Correct the colour",
  "appearance.correctMarkings": "Correct the markings",
  "appearance.pickColours": "Pick one or two",
  "appearance.pickMarks": "Tick every mark the cat has. Tick none for “nothing special”.",
  "appearance.overruleHint": "A cat guardian's statement decides this now. Saving marks every standing cat guardian statement on it wrong, with your reason, and records yours.",
  "appearance.why": "Why",
  "appearance.save": "Save",
  "appearance.markWrong": "Mark wrong",
  "appearance.markWrongHint": "Removes this one statement from the count. Nothing is said in its place.",

  "reason.no_authority": "Not yet described by the team",
  "reason.spotters_over_machine": "Spotters disagree with the reading from the photo",
  "reason.tied_camps": "Spotters are split between two colours",
  "reason.markings_reopened": "Spotters added a mark after the team's list",
  "reason.markings_changed_recently": "Markings changed on spotters' agreement in the last 30 days",
  "reason.hand_pick": "Picked by hand, and the spotter said a different colour",

  "appearance.done.confirmed": "Saved. The team's agreement is added.",
  "appearance.done.corrected": "Saved. The team's statement is added.",
  "appearance.done.overruled": "Saved. The cat guardian's statements are marked wrong, and the team's statement is added.",
  "appearance.done.nothing": "There was nothing to confirm yet. Nothing was changed.",
  "appearance.done.changed": "This changed since you opened the page, so nothing was changed. Check it again.",
  "appearance.done.markedWrong": "Saved. That statement no longer counts. It stays in the history below.",
  "appearance.recordsSay": "Records say",
  "appearance.noPhoto": "No photo",

  "colourCheck.title": "Colour check",
  "colourCheck.intro": "Cats whose colour or markings are worth a second look. Low priority: a few minutes a week.",
  "colourCheck.empty": "Nothing to check.",
  "colourCheck.toCheck": "To check: {count}",
  "colourCheck.notDescribed": "Not yet described by the team: {count} cats",
  "colourCheck.notDescribedOne": "Not yet described by the team: 1 cat",
  "colourCheck.openCat": "Correct on the cat's page",
} as const;

export type StringKey = keyof typeof en;
