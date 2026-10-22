# SYC-396 PR 2.5 (#252): Opus adversarial review, 19 Oct 2026

Reviewer: an Opus subagent in its own worktree (`agent-a7f1f7973e0001ac7`), on head `1981c1bb`. The focus was the upload and the caps, then photo privacy. It wrote 12 adversarial tests: 5 went red and 7 held. Nothing was pushed or commented.

## Findings, ranked

1. **Should-fix: if the cap counter's database call fails, both find routes answer with the app's generic JSON 500.**
   - The search stays closed: no AI call, and the strict header is still set.
   - But the GET form can't load at all, and the POST shows raw JSON.
   - Red: `ADV-1 POST 500 application/json … {"error":"Something went wrong. Please try again."}`. The GET answers with `application/json`.
   - Fix: catch the failure on the route, and answer 503 with page words. On the GET, treat a failed peek as "no cap notice".
2. **Should-fix: a search is used up when no cat has a photo to compare, and the page doesn't say why.**
   - `referencePhotos` runs after the gate. With every main photo hidden and no stand-in, each try counts against both caps. The answer is a 400 with no message.
   - Red: team hits `expected 1 to be +0`.
   - Fix: check the reference photos before the gate, and give this case its own words.
3. **Should-fix, or a decision: the sliding window lets about double the cap through in any 24-hour stretch.**
   - Twenty searches at 23:59 UTC, then a burst at 23:00 the next day, lets 19 more through: 39 in 23 h 01 m.
   - What holds is at most 20 (or 100) per UTC calendar day.
   - The plan's line 819 ("can't be doubled across a fixed window's edge") overstates it.
   - Red: `ADV-4 searches allowed within 23h01m: 39`.
4. **Nit: while the team cap is reached, each retry still uses up the person's own allowance.**
   - Red: after the team is full, 5 refused tries leave the person's count at 5.
   - Fix: peek at the team's count before counting the person.
5. **Plausible nit, no red test:** `not_a_cat` comes back if any one group says "no cat". The model isn't consistent, so a real cat photo can fail after paid calls.

## Checked and fine

- **Upload shapes all answer 400 as HTML with the strict header, and no AI call:** no boundary, a truncated body, a file under another field name, two files, a field over 1 KB, 15 fields, and a form-encoded POST.
- **The largest real form fits the limits:** 9 fields and 10 parts.
- **Over 10 MB** is a 413 as HTML. Nothing is written to disk.
- **The file name** is in no page and no log line.
- **Caps under parallel requests:** each count is one atomic upsert. The caps are counted after the narrowing and the photo check, and before any AI call.
- **Privacy:**
  - only the re-encoded photo is sent;
  - each cat's reference is its display photo;
  - the final round carries no public id;
  - nothing is stored;
  - GET addresses carry only an area key, a colony number, colour codes and tie.
- **Routes and access:** the routes come before `/team/cats/:id`. The origin check runs before auth, and a guardian gets 403.
- **Against the plan:**
  - groups of 10, the best 3 of each, at most 4 calls;
  - bands at 0.8 and 0.5;
  - `matching_down` returns 503;
  - the tie fields match `TieBody`.

## How each was handled

See the PR description's "Review" section.

---

# Second pass at /ship: Sonnet critic, head 419b5b64, 19 Oct 2026

Run in its own worktree. **No blockers.** It found no way to get the wider header or the team's photo onto any answer but the results page, and no leak of raw upload bytes, EXIF or GPS. The caps hold under concurrency: 130 parallel calls let at most 100 through. Each of the four review fixes went red when undone.

1. **Should-fix: the strict-header test covered only 3 of the POST's error answers.** Mutation: adding the photo header to `matching_down`, `no_photos` or `too_many` was not caught. *Fixed: a table test covers every non-200 answer.*
2. **Should-fix: the source guard didn't stop another file from using `TEAM_CSP_WITH_UPLOADED_PHOTO` or writing a `data:` image rule.** *Fixed: `refuse.source.test.ts` bans both outside `refuse.ts`.*
3. **Nit: when the team's last search is raced, the people who lose the race still spend one of their own.** Red with 130 parallel calls: 30 people each lost one. The team's cap holds. *Accepted: rare, and the cost is one search for those people only.*
4. **Nit: a search with a `tie` for a report that doesn't exist still ran and spent.** *Fixed: refused before any work, with the "report couldn't be found" page.*
5. **Plausible nit: a person already over their cap still had their photo re-encoded and the reference photos read before being refused.** *Fixed: a free check of the counts first. The real count is still made in the gate.*
