# Removing a photo by hand on a privacy request

**SYC-462.** Until the team has its own "Delete for good" button (SYC-246, November), this is how a photo is removed for good when someone asks.

The spec is `docs/superpowers/specs/syc-462-photo-removal-by-hand.md`, and its §1 has the plain-English version.

**Who:**
- Samuel or someone on the Syros Cats team approves each removal.
- Claude runs every step through the `db-ops` workflow.
- Nobody types database commands by hand.

**What "removed" means:**
- the picture is deleted from the database, along with its small and medium versions;
- it stops being the cat's main photo, which falls back to the photo the public already sees in its place;
- matching stops using it.

The photo's record stays, marked removed, with who approved it, when, and which request it answered. A removed photo can't be shown again or restored: the database refuses.

**Only for privacy** (DECISIONS.md Decision 3): a photo that shows a person or a private place. An offensive photo stays hidden. It isn't removed.

---

## Words used here

**Ask mode.** A setting Samuel switches on in Claude's session, so every change to the live database waits for his yes.

**The ledger.** One Linear ticket called **"Photo removals"**. It has one row per removed photo:

| Photo id | Removed on | Request ticket | Approved by (people id) | Run links | Run by (GitHub account) |
|---|---|---|---|---|---|

**No name, email or address of the person asking ever goes on the ledger, a ticket, or a workflow input.** The repository and its workflow runs are public. The request reference is always `SYC-<n>` or `hello YYYY-MM-DD #<n>`, and the command refuses anything else.

**One run at a time.** The workflow keeps a single waiting run, so wait for each run to finish (`gh run watch`) before starting the next.

---

## Once, at go-live

Do this once, before the first real removal.

1. **Migrate the databases.** Run migration `0034_photo_removal` on `development`, then on `production`, as for any migration (`docs/runbooks/neon-database.md`). For production, take a Neon snapshot first, and use ask mode.
   - Run it off-peak.
   - If it stops on the 5-second lock timeout, it changed nothing. Run it again.
2. **Publish the app.**
3. **Check the live build includes SYC-462:**
   ```
   curl -s https://<live host>/api/healthz
   git merge-base --is-ancestor <SYC-462 merge commit> <commit from healthz> && echo includes-SYC-462
   ```
   Paste the output on SYC-462.
4. **Switch removal on for production:**
   ```
   gh workflow run db-ops.yml --ref main -f target=production -f command=set-setting -f setting_key=photo_removal_on -f setting_value=true
   ```

Until step 4 is done, a request gets steps 1–5 below, plus the short reply in step 12. Hiding already takes the photo off every public page.

**Never roll the app back past SYC-462 once any photo is removed.** The old app crashes on a photo with no picture. Fix forward instead. The migration's rollback refuses on purpose once a photo is removed.

---

## For each request

The examples use `production`. Use `development` for the rehearsal (step 8).

1. **Log the request** as an SYC ticket:
   - the date;
   - how it arrived (hello@catspotters.com, or a "Report an issue" report);
   - the cat's number;
   - which photo.

   Nothing about the person asking goes on the ticket; that stays in the inbox.
2. **Find the photo.** This only reads:
   ```
   gh workflow run db-ops.yml --ref main -f target=production -f command=photo-list -f photo_cat=182
   ```
   Every photo of the cat is listed with its id, where it's used, the date, and "hidden", "hidden for privacy" and "removed".
3. **Get approval** from Samuel or someone on the Syros Cats team. Quote the photo's id and what it shows, and record the approval on the ticket. Get the approver's people id from `people-list`.

   **The approver confirms the photo shows a person or a private place.** A "shows a person or something private" report from the public only puts a photo forward. It makes the command accept the photo, but it never stands in for the approval.
4. **Warn Samuel** that a live database change comes next, and ask him to switch to ask mode.
5. **Hide it, for privacy.** First a dry run, which changes nothing:
   ```
   gh workflow run db-ops.yml --ref main -f target=production -f command=photo-hide -f photo_id=<id> -f photo_by=<people id>
   ```
   Then for real:
   ```
   gh workflow run db-ops.yml --ref main -f target=production -f command=photo-hide -f photo_id=<id> -f photo_by=<people id> -f confirm=HIDE
   ```
   The photo is now off every public page. If the team had already hidden it from the dashboard, this records "for privacy" and it stays hidden throughout.

   *To undo:* `photo-restore` with `confirm=RESTORE`. But after a restore, a later public report no longer hides that photo by itself, so only restore a hide that was a mistake.
6. **Remove it.** First a dry run, then read the plan:
   ```
   gh workflow run db-ops.yml --ref main -f target=production -f command=photo-remove -f photo_id=<id> -f photo_by=<people id> -f photo_ref=SYC-<n>
   ```
   Then for real, with the id typed twice:
   ```
   gh workflow run db-ops.yml --ref main -f target=production -f command=photo-remove -f photo_id=<id> -f photo_id_confirm=<id> -f photo_by=<people id> -f photo_ref=SYC-<n> -f confirm=REMOVE
   ```
   **Before you dispatch, check `photo_ref` holds only `SYC-<n>` or `hello YYYY-MM-DD #<n>`.** Workflow inputs appear on the public run page before the command checks them.

   The run must end `GONE` (exit 0). Keep the link to this run on the ledger: it is **the only run that can check the picture's bytes**, because the fingerprint exists only while the picture does.

   **The other results:**
   - **Another photo row holds the same picture.** If the run names one, go back to step 3 for that photo; it's a request of its own.
   - **`NOT GONE`** (exit 3). The picture itself is already deleted, but a copy or a mention was found. Stop, and raise it on the ticket with the run link.
   - **`NOT VERIFIED`** (exit 4) on the first run. The search ran out of time, so **the whole removal was rolled back and nothing changed**. Raise it on the ticket. Don't run it again until the timeout has been looked at.
   - **Running `photo-remove` again for a removed photo** prints `ALREADY REMOVED` and exits 4. That's expected, not a failure: it re-checks everything except the bytes, which only the removal run could check. It never says `GONE`. The removal run's log has the byte result.
7. **Check from outside:**
   ```
   curl -sI https://<live host>/api/photos/<id>
   curl -s https://<live host>/api/cats/<cat> | grep -c <id>
   ```
   The first must answer `404` with `Cache-Control: no-store`. The second must print `0`.
8. **The development copy.** Development is a copy of real data, so the photo is there too. Either run steps 5 and 6 with `target=development`, or reset `development` from `production` after the removal. Step 6 on its own fails there if `development` was copied before the hide.
9. **The team inbox.** If a report hid the photo, the "Photo hidden" email carried it as an attachment. Ask whoever looks after the inbox to delete that email, and wait until they confirm.
10. **Other copies.**
    - With read-only calls, list the Neon branches and snapshots and the restore window on `production`. On the ticket, note any copy older than the removal and the date it will be deleted.
    - **The old Replit database.** It's kept until 30 days after the cutover (switchover plan G.1) and still holds the picture until it's deleted. Note its deletion date on the ticket. If that date is later than you'd want to put in the reply, ask Samuel to choose between two options:
      - wait for the deletion;
      - have the picture blanked there now. Carry-back does exactly that for a removed photo, but only as part of a full rollback, so it would be a one-off he approves.
    - Search the repository, pull request comments and Linear attachments for the photo id and for screenshots of that cat. A copy in the repository's history can only be removed by rewriting history, so raise any you find with Samuel.
    - Screenshots for the repo always use seeded test data.
11. **The ledger.** Add the row.
12. **Reply to the person**, only once steps 9 and 10 are done:
    > We've removed the photo from Cat Spotters. It no longer appears anywhere in the app or on the website, and we've deleted it from our live database [and from our team's inbox]. If your phone or browser had already shown it, a copy may stay there until its cache clears; that's on your device, and we can't reach it. Our backups still hold it for up to [N] days, after which it's gone from them too.

    - **N** is the longest-lived copy found in step 10. Never use a number you haven't checked. If any copy has no known deletion date, the reply waits for Samuel.
    - Where the photo may have been used for matching, add: "Copies held by services we use to run the app are outside our reach."

    **Before go-live step 4** (removal not switched on yet), send this short reply after step 5 instead. Send the full reply once step 6 has run.
    > We've taken the photo off Cat Spotters: it no longer appears anywhere in the app or on the website. We'll delete it from our database within a few days and write again when that's done.
13. **Close the ticket** with the run links.

**A photo sent with a cat-in-trouble report** (only the team ever sees these) isn't covered yet; that's SYC-478. Raise a request about one with Samuel.

---

## After any restore

A restore brings back the database as it was at that moment, including any photo removed since. That covers:
- a snapshot swap;
- a point-in-time restore that gets used;
- a carry-back;
- resetting `development` from `production`.

**Before visitors reach the restored database**, re-run **steps 5 and 6** (hide, then remove) for every ledger row dated after the restore point. The restore point may be older than the hide, so the photo may be public again until step 5 runs.

Carry-back to the old Replit database copies a removed photo as an empty picture (no picture), so the rollback still works and the picture doesn't come back.

## If a step fails

- **Before step 6:** restore the photo (`photo-restore`, `confirm=RESTORE`) and start again.
- **Step 6 ends `NOT GONE`:** the output names the check that failed. Stop, and raise it on the ticket.
- **Step 6 ends `NOT VERIFIED` on its first run:** the search timed out and nothing changed. Raise it on the ticket.
- **A refusal** names its reason. For example, "isn't hidden for privacy": run step 5 first. Or "--by isn't someone on the team now": use a current team member's people id. A refusal changes nothing.
