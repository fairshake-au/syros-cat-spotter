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

The unique index on cat names folds Greek case under a UTF-8 ctype, so `ΜΙΜΉ` collides with `Μιμή`. It does **not** apply Unicode normalisation, so the NFD spelling of `Μιμή` is accepted as a different cat. The "unique by construction" argument in `records-import.md` §2.4 therefore holds only if every writer normalises to NFC first. Tests pin both behaviours.
