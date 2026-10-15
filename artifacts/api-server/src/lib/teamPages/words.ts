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
  // The dashboard's refusals for a signed-in person (roles-and-invites.md
  // §6.4; SYC-53 PR 0.5). English for now; PR 1.0 adds Greek and French.
  "refused.title": "That part is for the team",
  "refused.titleManagement": "That part is for management",
  "refused.forTeam": "That part of the dashboard is for the Syros Cats team.",
  "refused.yourColonies": "Your colonies are here",
  "refused.forManagement": "That part of the dashboard is for Syros Cats management.",
  "refused.backHome": "Back to the dashboard",
  "ended.title": "Your access has ended",
  "ended.body": "Your access has ended. Ask Syros Cats if you think that's a mistake.",

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
  "colony.addCats": "Add cats",
  "colony.takeOut": "Take out of this colony",
  "colony.takeOutNote": "The cat stays in the records; it just isn't in any colony.",

  "add.title": "Add cats to",
  "add.searchLabel": "Find a cat by name or SYR number",
  "add.searchButton": "Find",
  "add.prompt": "Type a name, or a number like SYR-0012.",
  "add.noMatch": "No cat matches that name or SYR number.",
  "add.more": "Showing the first 30. Type more of the name to narrow it.",
  "add.hint":
    "Tick the cats to add. A cat that is in another colony moves here; its history keeps the record of where it was.",
  "add.button": "Add the ticked cats",
  "add.noColony": "No colony",
  "add.in": "In",
  "add.already": "Already in this colony",
  "add.back": "Back to the colony",

  "done.created": "The colony was created.",
  "done.saved": "Saved.",
  "done.unchanged": "Nothing was different, so nothing was changed.",
  "done.added": "The ticked cats are now in this colony.",
  "done.nothingNew": "Those cats were already in this colony. Nothing was changed.",
  "done.takenOut": "The cat is out of this colony.",
  "done.notThere": "That cat isn't in this colony any more, so nothing was changed.",

  "problem.title": "That didn't save",
  "problem.nothingChanged": "Nothing was changed.",
  "problem.backToColonies": "Back to the colonies",
  "problem.backToColony": "Back to the colony",
  "problem.fields": "Something in the form wasn't right",
  "problem.nameEmpty": "A colony needs a name.",
  "problem.nameTooLong": "A colony's name can be up to 100 characters.",
  "problem.guardianTooLong": "The guardian's name can be up to 100 characters.",
  "problem.notesTooLong": "Notes can be up to 2000 characters.",
  "problem.pickCats": "Tick at least one cat, and no more than 100.",
  "problem.noSuchCat": "One of those cats doesn't exist.",
  "problem.backToAdd": "Back to adding cats",
  "problem.centre": "The centre needs a latitude and a longitude, both real numbers, or both left empty.",

  "taken.title": "That name is taken",
  "taken.before": "Another colony is already called",
  "taken.after":
    "Names count as the same whatever the accents or capitals.",
  "taken.generic": "Another colony already has that name.",

  "none.title": "No such colony",
  "none.body": "There is no colony with that number.",

  "sites.title": "Feeding sites",
  "sites.empty": "There are no feeding sites yet.",
  "sites.showRetired": "Show retired sites",
  "sites.update": "Update",
  "sites.recentTitle": "Recently changed",
  "sites.noRecent": "Nothing has been changed yet.",
  "sites.listTitle": "All sites",
  "sites.noColony": "no colony yet",
  "sites.private": "Private",
  "sites.public": "Public",
  "sites.retired": "Retired",
  "sites.changed": "Last changed",
  "sites.legend": "Filled marker: public. Outlined: private. Grey: retired. Tap a marker to open the site.",
  "sites.mapHint":
    "This map is only for the team. Our server fetches the map pictures, so your browser never tells a map company where you are looking.",
  "sites.moveNote": "That didn't work, so the map is back at the whole island.",

  // Adding, moving, retiring and changing the colony of a feeding site (SYC-209 PR 3.3).
  "sites.add": "Add a site",

  "sdone.created": "Site added. It is private: only people signed in here can see it.",
  "sdone.saved": "Saved.",
  "sdone.unchanged": "Nothing was different, so nothing was changed.",
  "sdone.moved": "Site moved.",
  "sdone.movedPrivate":
    "Site moved. It was public, so it is private again until the new position is confirmed.",
  "sdone.retired": "Site retired.",
  "sdone.restored": "Site brought back. It is private.",
  "sdone.colony": "Colony changed.",
  "sdone.colonyPrivate": "Colony changed. The site was public, so it is private again.",
  "sdone.stale":
    "Someone already changed this. What you see below is how it is now; look it over and try again if you still want to.",

  "sproblem.title": "That didn't work",
  "sproblem.fields": "Part of the form couldn't be read",
  "sproblem.name": "The site needs a name.",
  "sproblem.nameLong": "That name is too long.",
  "sproblem.notesLong": "The notes are too long.",
  "sproblem.directionsLong": "“How to find it” is too long.",
  "sproblem.reason": "Say why, in a few words.",
  "sproblem.position": "Type the position as plain numbers, like 37.44470 and 24.94170, somewhere on Syros.",
  "sproblem.outside": "That spot is outside Syros, so it can't be picked.",
  "sproblem.colony": "That colony doesn't exist.",
  "sproblem.stamp": "That page was out of date. Open the site again and try again.",
  "sproblem.tapUnreadable":
    "That tap couldn't be read (the page may have been open for more than a day), so the map is back at the whole island. Nothing was picked.",
  "sproblem.tapNoPoint":
    "That tap didn't say where on the map it was. This happens when the map picture hasn't loaded, or when it's chosen with the keyboard. Nothing was picked: tap the map itself.",
  "sproblem.nothingSaved": "Nothing was saved.",
  "sproblem.backToSites": "Back to the feeding sites",
  "sproblem.backToAdd": "Back to adding a site",
  "sproblem.backToSite": "Back to the site",
  "sproblem.backToMove": "Back to moving the site",

  "new.title": "Add a feeding site",
  "new.intro":
    "Tap the map where the feeding spot is. You'll check the spot on the next page, and nothing is saved until you press Save.",
  "new.private": "A new site is always private: only people signed in here can see it.",
  "new.typedTitle": "Or type the position",
  "new.typedWarning": "Don't copy these from a map company's site; ask a colleague who has been there.",
  "new.lat": "Latitude",
  "new.lng": "Longitude",
  "new.typedButton": "Use this position",
  "new.mapNote": "Our server fetches the map pictures, so your browser never tells a map company where you are looking.",

  "confirm.title": "Check the spot",
  "confirm.spot": "The spot",
  "confirm.legend": "The marker is the spot you picked.",
  "confirm.name": "Name of the site",
  "confirm.nameHint": "A place and the person who looks after it, like “Vaporia — Eleni's”.",
  "confirm.colony": "Colony (optional)",
  "confirm.noColony": "No colony yet",
  "confirm.directions": "How to find it (optional)",
  "confirm.directionsHint": "A short line in words, like “down the steps by the blue gate”.",
  "confirm.notes": "Team-only notes (optional)",
  "confirm.save": "Save the site",
  "confirm.again": "Start again on the full map",
  "confirm.nudge": "Not quite right? Tap the small map to move the pin. Place the pin first, then fill in the details.",
  "confirm.checkTap": "Details for checking the tap",

  "move.title": "Move",
  "move.intro":
    "Tap the map where the site really is. You'll check the new spot and say why on the next page, and nothing is saved until you press Save.",
  "move.now": "Where it is now",
  "move.new": "The new spot",
  "move.legend": "Grey marker: where the site is now. Outlined marker: the new spot.",
  "move.reason": "Why is it being moved?",
  "move.reasonHint": "For example “pin was on the wrong side of the road”.",
  "move.save": "Move the site",
  "move.publicWarning":
    "This site is public. Moving it makes it private again until someone confirms the new position.",

  "act.title": "Change this site",
  "act.edit": "Edit details",
  "act.save": "Save changes",
  "act.move": "Move on the map",
  "act.retire": "Retire this site",
  "act.retireHint":
    "A retired site comes off the map and out of every public view. It stays in the list under “Show retired sites”, with its history.",
  "act.retireButton": "Retire this site",
  "act.restore": "Bring back",
  "act.restoreHint": "It comes back private, never public.",
  "act.restoreButton": "Bring this site back",
  "act.reason": "Reason",
  "act.colony": "Change colony",
  "act.colonyButton": "Change the colony",
  "act.colonyPublic": "If this site is public, changing its colony makes it private again.",

  "site.back": "All feeding sites",
  "site.colony": "Colony",
  "site.noColony": "No colony yet.",
  "site.privateSentence":
    "Private. Only Syros Cats people signed in here can see this place.",
  "site.publicSince": "Public since",
  "site.by": "by",
  "site.retiredSince": "Retired since",
  "site.notes": "Notes",
  "site.directions": "How to find it",
  "site.none": "None",
  "site.historyTitle": "History",
  "site.noHistory": "Nothing has been recorded yet.",
  "site.actionsTitle": "Actions",
  "site.position": "Position",
  "site.mapAlt": "Where this site is",
  "site.noSuch": "No such feeding site",
  "site.noSuchBody": "There is no feeding site with that number.",
  "site.backToSites": "Back to the feeding sites",

  "sitehist.existing": "On the list before this history began",
  "sitehist.created": "Site created",
  "sitehist.seeded": "Site loaded from the first list",
  "sitehist.renamed": "Renamed",
  "sitehist.notes": "Notes changed",
  "sitehist.directions": "How to find it changed",
  "sitehist.colony": "Colony changed",
  "sitehist.moved": "Moved",
  "sitehist.madePublic": "Made public",
  "sitehist.madePrivate": "Made private",
  "sitehist.madePrivateMoved": "Made private because it was moved",
  "sitehist.madePrivateColony": "Made private because its colony changed",
  "sitehist.madePrivateGuardian": "Made private because the cat guardian changed",
  "sitehist.label": "Public label changed",
  "sitehist.retired": "Retired",
  "sitehist.restored": "Brought back",
  "sitehist.reason": "Reason",
  "sitehist.left": "(left)",

  "history.by": "by",
  "history.removed": "Details removed at someone's request.",
  "history.nobody": "nobody",
  "history.system": "the system",
  "history.created": "Colony created",
  "history.renamed": "Renamed",
  "history.guardian": "Cat guardian changed",
  "history.notes": "Team notes changed",
  "history.centre": "Centre changed",
  "history.catAdded": "Cat added",
  "history.catTakenOut": "Cat taken out",
  "history.catMovedOut": "Cat moved to another colony",
} as const;

export type WordKey = keyof typeof WORDS;

/** The English words for a key. A key that does not exist is a type error. */
export function t(key: WordKey): string {
  return WORDS[key];
}
