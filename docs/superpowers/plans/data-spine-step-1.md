# Data spine, step 1: the tables

**Spec:** `docs/specs/cat-record-data-spine.md` §11.2 step 1, with the tables as §10.1, §10.3 and §10.5 define them and the redaction column from §8.5 (approved 28 Sep 2026, `DECISIONS.md` Part 2c). **Linear:** SYC-52 / SYC-40 (data spine). Also unblocks SYC-42 and SYC-43, which write `welfare_report`, `welfare_outcome` and `colony` observations and manage colonies and feeding sites.
**Depends on:** SYC-64 (generated migrations). This is the first migration after the baseline.

## What lands

One generated migration, `0001_data_spine_tables`, with its rollback:

- `observations`: the append-only record of every statement about a cat, with the attribution check (exactly one of device or account, until redaction).
- `cat_identity`: merges and unmerges as rows.
- `colonies` and `colony_name_history`: renamable, referenced by id.
- `feeding_sites`: private by default.
- `sightings.redacted_at` and `sightings.redaction_reason` (F3: "one column today").
- **Guards in the database, from the first migration** (§8.5). A trigger on `observations` refuses deletes, and refuses every update except a redaction: stamped once, with a reason, the author cleared, a note's text optionally emptied, and every other column unchanged. A trigger on `cat_identity` refuses any update or delete.

Nothing reads these tables yet. No existing column changes, and no spotter sees a difference.

## Not in this step

The resolver (§10.2), backfills (§11.2 steps 2–4), closing the location oracle, blurring, and the sighting questions (steps 5–7). Deletion itself is step 8 / SYC-63. Each is a separate change.

## A finding for §10.3, now written down

`cats_name_lower_unique` is **not** the uniqueness guarantee that `records-import.md` §2.4 relies on. `lower()` under a UTF-8 ctype folds case letter by letter, so `ΜΙΜΉ` collides with `Μιμή`. But it doesn't:

- **fold accents**: Greek capitals are normally written without them, so `ΜΙΜΗ` is accepted beside `Μιμή`;
- **produce final sigma**: `ΣΟΦΊΑΣ` is accepted beside `Σοφίας`;
- **normalise Unicode**: the NFD spelling of `Μιμή` is a second cat.

Real uniqueness needs an accent-, case- and sigma-folded normalised name, as `colonies` already has. That change belongs with §10.3's name work and the import, not this step. The tests pin today's behaviour, so the change will show up when it lands.

## Adversarial review

It found no blockers. These findings are fixed:

- A row could be inserted already redacted, with no author, so the attribution rule never applied. **Inserts now arrive attributed.**
- Once a note was redacted without emptying its text, the text could never be removed. **Deletion can now re-run on a redacted row** and still empty a note, but never restamp it or change the reason.
- **`TRUNCATE` is refused** on both append-only tables. Redaction also rejects an empty reason and compares values exactly, including their numeric representation.
- Added **indexes on `device_id` / `account_id`** so deletion's lookup doesn't scan the table, and **`feeding_sites.colony_id` references `colonies`**.
- **The rollback block warns** that it drops data.

## Deferred on purpose, and owned elsewhere

- **Deletion (SYC-63) still needs its own migration.** `sightings.device_id` and `cats.discoverer_device_id` are NOT NULL, so unlinking them means dropping NOT NULL or agreeing a sentinel. §11.2 step 8's "depends only on step 1's redaction column" is wrong on that point. Decided 29 Sep 2026 (Part 2g): nullable columns with a redaction check.
- **Sightings have no append-only guard yet.** The app updates `status` and `cat_id` today, so a guard needs designing with that work.
- **Author for machine-written rows.** The attribution check needs a device or an account on every observation. Step 3's legacy backfill, and `system` writes from SYC-42/43, use `account_id = 'system:<source>'`, decided 29 Sep 2026 (`DECISIONS.md` Part 2g).
- **`redacted_at` accepts any timestamp.** The guard doesn't force it to the current time, because an app clock that's slightly off would then refuse real deletions.
