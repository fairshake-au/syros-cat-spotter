# Photo tips, and a face photo and a body photo in the same spot

**Status:** Draft for Samuel's approval, 15 October 2026. Samuel answered the five product decisions on 15 October 2026, all as recommended (§9). They are built into this version.
**Owner:** Samuel
**Covers:** SYC-415 (Urgent). Samuel, 15 October: some testers' photos are poorly composed, which hurts data quality and matching.
**Related:** SYC-163 (adding photos to a cat later, and by the team, guardians and vets: this spec is its urgent slice) · SYC-157 (a "Retake / Use this photo" step) · SYC-118 ("Retake photo") · SYC-61 (teaching delivered as moments) · SYC-161 (coat colour read from the main photo) · SYC-408 (which photos a match compared) · SYC-46 (photos out of the database) · [`photo-location-from-library.md`](./photo-location-from-library.md) (the photo's time and place, the 21-day rule) · [`offline-queue-on-web.md`](./offline-queue-on-web.md) (the queue and repeat protection) · [`hosting-and-photo-storage.md`](./hosting-and-photo-storage.md) (the single photo-saving step) · [`report-an-issue.md`](./report-an-issue.md) and [`cat-record-data-spine.md`](./cat-record-data-spine.md) §8.5 (hiding photos, deleting data) · [`feeding-nudge.md`](./feeding-nudge.md) (the "full once, then short" pattern this copies)

**What this document owns.** The photo tips a spotter sees before taking or picking a photo, and how a spot carries up to three photos: the first photo, a face photo and a body photo. It also owns which of those photos leads the spot, what matching does with them, and which one becomes a new cat's main photo. It does **not** own adding photos to a cat after the spot, team uploads, or changing a cat's main photo later. Those stay with SYC-163.

---

## 1. The short version

Two changes to spotting a cat.

**Photo tips.** The first time someone opens the camera to spot a cat, a card shows them what a good cat photo looks like: a cartoon of a good photo next to a poor one, and four short tips. One tap closes it. After that, a small **"Photo tips"** link sits on the camera screen for anyone who wants a reminder. The tips come back by themselves in one place: the screen that says a photo doesn't show a cat.

**A face photo and a body photo.** After the first photo, the New spot screen shows two small empty tiles next to it: **"Add the face"** and **"Add the whole body"**. Each tile has a cartoon showing the shot it wants. The spotter can fill one, both or neither, then carries on as now. Nothing is required, so a cat that walks off after one photo can still be spotted.

All of a spot's photos go to matching together, so the matcher sees the new cat from more than one angle. When the spot creates a new cat, the **face photo** becomes the cat's main photo if there is one. Every photo is kept and shows on the cat's page.

| | Tourists | Cat guardians and residents |
|---|---|---|
| **What they get from the tips** | Shown once, on their first spot. Most tourists only spot a few cats, so it has to land the first time. | Shown once. The "Photo tips" link is there if they want it, and it never gets in the way of regulars. |
| **What they get from extra photos** | A cat they photographed once on holiday has a better chance of being matched by the next visitor. | Their regular cats get a clear face and body on record, so the catalogue tells look-alike cats apart. |

Both audiences want the same thing: the right cat on the right record. Tourists supply many of the photos, and locals rely on the record being right.

---

## 2. Why this matters

Every spot is matched against the main photos of nearby cats (SPEC.md §4.3). A poor photo hurts twice:

1. **When it's sent.** A tiny, blurry or rear view gives the matcher little to go on, so the right cat may not be suggested and a duplicate cat gets made.
2. **For every later spot of that cat.** If the poor photo becomes a new cat's main photo, every future spot of that cat is matched against it, and colour reading (SYC-161) reads it too.

The best way to fix this is at the moment the photo is taken. Fixing records afterwards costs the team time and never fully catches up.

A cat's face is what people and the matcher recognise best. The body shows the coat pattern, which tells apart look-alike tabbies and black-and-whites. One photo rarely shows both clearly. So we ask for both, and accept whatever the spotter manages.

---

## 3. Photo tips

### 3.1 The tips card

![A good cat photo](./assets/photo-tips/good.svg) ![A poor cat photo](./assets/photo-tips/poor.svg)

The card shows the two cartoons side by side: a ✓ under the good photo and a ✗ under the poor one. Below them come four tips, each a few words:

| Tip | Line under it |
|---|---|
| **Get close** | Fill the frame with the cat. |
| **Show the face** | Wait for it to look your way. |
| **Show the whole body** | Nose to tail, so the coat pattern shows. |
| **Daylight, and hold still** | Step into the light; no zoom if you can help it. |

**Title:** "How to take a great cat photo". **Button:** "Got it" (closes the card and opens the camera).

On a small phone (390px wide) the two cartoons sit side by side at about 150px each, and the tips sit below them in a single column. The card scrolls if the screen is short. There is one button and no "don't show again" box: the card only shows once anyway.

### 3.2 When it shows

1. **The first time** the spotter reaches the camera on the Spot tab, before the viewfinder opens. Once "Got it" is tapped, it doesn't show again on that phone.
2. **From the "Photo tips" link** on the camera screen, with a small lightbulb icon, at any time. It sits near the shutter but away from it, so nobody hits it by mistake.
3. **On the "this doesn't look like a cat" screen.** That screen (review.tsx, when the server says no cat was found) shows the two cartoons and the four tips inline under its message, above "Try again". This is when someone most needs the tips, so they always show here, however many times the card has been seen.

The card has been "seen" once "Got it" is tapped. If the app is closed while the card is open, it shows again next time.

The "seen" flag is stored on the phone under the `cat-spotter/...` prefix, the same way as the other "seen once" flags. "Delete my data" clears it with the rest. A spotter who signs in on a new phone sees the card once on that phone; that's fine.

### 3.3 Words in every language

All of the card's text, the tiles' text (§4) and the new messages (§4.4, §6.2) go into the English, Greek and French dictionaries in `i18n.ts`. The Greek and French get a native-speaker check under SYC-4 before launch. The cartoons contain no words, so they work in every language.

### 3.4 With no signal

The cartoons are built into the app as images, not fetched from the web. So the card, the tiles and the "Photo tips" link all work with no signal, on the app and on the website once it has loaded.

---

## 4. A face photo and a body photo

### 4.1 What the spotter sees

After the first photo (camera or library), the New spot screen shows, in one row:

* **The first photo**, with "Retake photo" under it as now (SYC-118).
* **An "Add the face" tile**, with the face cartoon: ![Face](./assets/photo-tips/face.svg)
* **An "Add the whole body" tile**, with the body cartoon: ![Body](./assets/photo-tips/body.svg)

Above the row, one line: *"Got the face and the whole body? Add them so we can tell this cat apart."*

Tapping a tile asks **"Take a photo"** or **"Choose from your photos"**, the same two ways as the first photo. Once filled, a tile shows the photo, with a small ✕ to remove it and tap-to-replace.

The tiles look clearly different from "Retake photo". They are dashed-outline boxes with a ＋ and a cartoon, while Retake is a text button under the photo. Nobody should mistake adding a photo for replacing the first one, the confusion SYC-118 fixed.

If the spotter retakes the **first** photo, the face and body photos stay. They are still of the same cat at the same spot.

"Check for matches" works with one, two or three photos. Nothing is required.

### 4.2 What the spotter doesn't have to do

The spotter never labels the first photo. It is just "your photo". Only the tiles carry a label, because the spotter chose them for that purpose. That keeps the first step exactly as it is today.

### 4.3 Limits

* **Three photos per spot at most:** the first, one face, one body. That's enough for matching and keeps storage and sending time in check.
* **Camera photos** for the tiles are taken there and then, like the first photo.
* **Library photos** for the tiles follow the same rules as a first photo from the library: no more than 21 days old, and not already logged (`photo-location-from-library.md`). A photo already used in this spot can't be picked again for another tile.

### 4.4 The same cat, at the same time

The spot's time and place come from the **first photo**, as now. The extra photos don't change them.

When a library photo for a tile carries a taken-at time, and the first photo's time is known, the two must be within **two hours** of each other. If they aren't, the app says: *"This photo was taken at a different time (3 Oct, 18:42). Photos in one spot need to be from the same visit. Choose another photo."* That stops two different visits, or two different cats, being sent as one spot. If either time is missing, the app accepts the photo. The spotter has already seen the first photo's time on screen.

### 4.5 One spot, one sighting

However many photos it has, a spot is one sighting. It counts once for points, streaks and "last seen", and sends as one request, so it counts once against the matching limit. The extra photos never create extra sightings.

---

## 5. Matching and the main photo

### 5.1 What the matcher sees

The matcher receives **all of the spot's photos first**, told they are the same cat from different angles. Then it receives each nearby cat's **main photo**, as now: up to 10 cats within 500 m, nearest first. Two more images on top of the roughly eleven sent today is a modest cost per spot.

The matcher answers, for each of the spot's photos, whether it shows a cat, and ranks the nearby cats against the spot as a whole. Its confidence rules (shown at 0.1 or more, top 3, phone sees 0.4 or more) are unchanged.

Comparing the spot's photos against nearby cats' **extra** photos, not just their main photos, is a later step, once the catalogue has them and the cost is known. It belongs with SYC-163, where choosing a cat's best photos is decided.

### 5.2 Photos that don't show a cat

* **No photo shows a cat:** the spot gets the "this doesn't look like a cat" screen, as today (§3.2 point 3).
* **Some photos show a cat and others don't:** the photos with no cat are **not kept**. The spotter sees one line on the result: *"One of your photos didn't show a cat, so we left it out."* This stops a photo of a doorway, or of a person, landing on a cat's page.

### 5.3 The lead photo

Every spot has one **lead photo**: the photo that stands for the spot wherever only one is shown (the review screen, the spot's thumbnail, the team's queues). It is, in order:

1. the **face photo**, if there is one and it shows a cat;
2. otherwise the **first photo**, if it shows a cat;
3. otherwise the **body photo**.

### 5.4 A new cat's main photo

When the spot creates a new cat, the **lead photo** becomes the cat's main photo. So it's the face photo when there is one (Decision 4). Later spots of that cat never change its main photo, as now. Changing the main photo later belongs with SYC-163.

A face close-up may hide some of the coat pattern. The body photo is still kept and shows on the cat's page. Colour reading (SYC-161) keeps reading the main photo. Letting it also look at the body photo is filed as a follow-up (§10).

### 5.5 On the cat's page

Each sighting on a cat's page shows its lead photo, as now, with its other photos as small thumbnails beside it. Tapping opens them full size. **"Report an issue"** and the team's **hide / restore** work on each photo separately, because they already work per photo (`report-an-issue.md`). Hiding a lead photo hides only that photo. The sighting's other photos stay visible unless hidden too.

---

## 6. Sending, saving and the offline queue

### 6.1 One request per spot

The spot sends its photos together in one request: the first photo as now, plus up to two extra photos, each marked "face" or "body". Sending them together means:

* the sighting and all its photos are saved together or not at all. There's never a sighting with half its photos.
* the spot counts once against the matching limit (20 per 15 minutes per phone);
* the existing repeat protection still works: a repeat of the same spot returns the sighting already saved, with its photos, and saves nothing twice.

To keep the request small enough, the phone **always shrinks the extra photos** before sending, to at most 1600px on the long side. The first photo is sent as now. That keeps a three-photo spot well inside the server's size limit and quick to send on island mobile data.

### 6.2 Saving on the server

Every photo, extra or first, goes through the **single shared photo-saving step**. It checks the photo is a real image, turns it the right way up, resizes it and removes all hidden data, including where it was taken (`hosting-and-photo-storage.md`). No photo is stored any other way.

The database keeps one row per photo in the spot, saying which sighting it belongs to, its order, and whether it is the first, the face or the body photo. The sighting's existing single-photo field keeps pointing at the **lead photo**. Everything that already reads one photo per sighting therefore keeps working unchanged and shows the best photo. That covers new-cat creation, the review screen, the team's queues and the cat page. Older sightings, with one photo, have one row.

If a photo fails the saving step (not an image, too big, can't be read), the whole spot is refused with the same message as today for a bad photo. The spotter can remove that photo and send again. The server never quietly saves a spot without a photo the spotter thought they'd sent, except for photos the matcher says show no cat (§5.2), where the spotter is told.

### 6.3 With no signal

A spot saved with no signal keeps all its photos, queued together on the phone, and sends them together later. The queue already keeps photos as files on the phone (or in browser storage on the website), not inside the queue list, so three photos don't crowd it. Spots queued before this change, with one photo, send exactly as before.

"Delete my data", and clearing a queued spot after it sends or is thrown away, removes all of that spot's photo files, not just the first.

### 6.4 Deleting data

When a spotter deletes their data, their sightings are unlinked from them and the cat keeps its history (`cat-record-data-spine.md` §8.5). A sighting's extra photos follow exactly the same rule as its lead photo. Nothing new is kept about the spotter.

---

## 7. What we'll measure

The aim is better data, so we check it worked. Two weeks after release, the team view of match records (SYC-151) compares spots before and after:

* **How often spotters add extra photos:** the share of spots with a face photo, a body photo, or both.
* **Whether matching got better:** how often the spotter picks one of the suggested cats, compared with "none of these" and new-cat creation, for spots with one photo against spots with two or three.
* **Photos rejected as "no cat":** the share of spots sent back with the "this doesn't look like a cat" screen, before and after the tips card.

If extra photos are rare, the next step is to make the tiles more prominent. If they are common but matching doesn't improve, look at the matcher's instructions.

---

## 8. Testing

* **Tips card:** shows on the first camera visit; "Got it" stops it showing again; closing the app with the card open brings it back next time; "Photo tips" opens it at any time; the not-a-cat screen always shows the tips; "Delete my data" resets it. Works with no signal. Checked at 390px and desktop widths, in all three languages, in light and dark mode.
* **Tiles:** one, two and three photos each reach "Check for matches"; remove and replace work; retaking the first photo keeps the tiles; a photo can't fill two tiles; library photos over 21 days old, already logged, or more than two hours from the first photo are refused with the right message.
* **Server:** a three-photo spot saves one sighting and three photo rows in one go; a failure in any photo saves nothing; a repeat returns the same sighting and saves nothing new; the lead photo follows §5.3; a new cat's main photo is the lead photo; a no-cat extra photo isn't kept and the result says so; every photo comes out with no hidden location data; a three-photo spot counts once against the matching limit.
* **Matching:** the matcher receives the spot's photos first, then each nearby cat's main photo, and its answer is read per photo.
* **Offline:** a three-photo spot queues and sends intact; an old one-photo queued spot still sends; clearing a spot removes all its files.
* **Cat page:** extra photos show as thumbnails; reporting or hiding one photo affects only that photo.

---

## 9. Decisions (answered by Samuel, 15 October 2026)

| # | Question | Answer |
|---|---|---|
| 1 | When do the tips show? | **Once, then a "Photo tips" link**, and always on the not-a-cat screen. *(As recommended.)* |
| 2 | How are extra photos asked for? | **A nudge, never required:** "Add the face" and "Add the whole body" tiles. *(As recommended.)* |
| 3 | What does matching use? | **All of the new spot's photos**, against each nearby cat's main photo. Comparing against cats' extra photos comes later. *(As recommended.)* |
| 4 | A new cat's main photo? | **The face photo** if there is one, otherwise the first photo. *(As recommended.)* |
| 5 | Who makes the cartoons? | **Claude drafts, Samuel approves.** They're in §3.1 and §4.1. A designer can replace them later without changing anything else. *(As recommended.)* |

---

## 10. Follow-ups to file when this is approved

* **Colour reading from the body photo:** let SYC-161's coat reading use a cat's body photo, not only its main photo.
* **Polished cartoons before launch:** optional; a designer's version of the four drawings.
* **Comparing against cats' extra photos:** goes onto SYC-163, as part of choosing each cat's best photos.
* **Spotting an obviously poor photo on the phone:** a gentle "That's quite dark, try again?" before sending, if the measures in §7 show the tips aren't enough.
