# Review notes: `which-cat-is-which.md` (SYC-150)

## Where the ticket was out of date

Checked against `main` at `9af0532`, 26 October 2026.

| The ticket said | What the code and later specs show |
|---|---|
| "Sightings are rows that are added, never rewritten, apart from redaction." | A sighting's cat is filled in once, when it's matched, under a database guard that also allows status changes and an area stamp (`lib/db/migrations/0046`). The approved claiming and naming specs (`claiming-a-cat.md` §16, `syc-709-naming-limits.md` §1), `claiming.ts` `hasMetCat`, `claiming.test.ts` and `teamPages/catHistory.ts` all expect a move to change that field. |
| Restated observations are "attributed to the team member who moved it". | That would give a spotter's answer team authority. Changed: the spotter stays the author, and the move record names the team member (spec §4.1). |
| The observations from a sighting are ear tip, food and water and note. | Still true. The team's "agree with clip" (`teamCorrections.ts`) also carries the sighting's id. A spotter's name for a cat isn't an observation on the sighting; it updates the cat's name (SYC-709). |
| `cat_identity` merges whole cats. | True, but nothing writes to it: merging isn't built (SYC-59). Hence D1. |
| "Different cat…" and "It's a new cat" in "Matched by hand" depend on this. | The list isn't built (SYC-152), and nor are the match record's team columns from spine §10.9. This work adds the columns (§7.5); SYC-152 builds the list. |
| One photo per sighting. | Up to three since SYC-415 (`sighting_photos`). Hence §4.4 and D2. |
| (not mentioned) | Vet batches (SYC-677) make cats with no sighting. They can receive a moved photo, and vet-visit photos never move. Cats can wait for a spotter to name them (`name_pending`), hence D3. |
| (not mentioned) | Points are a running total plus a points record per sighting. The collection, stamps and cat counts are worked out from sightings, so they follow a move with no extra work. |
| (not mentioned) | The nightly news check only watches and sends nothing yet. A move's "silenced" rule still has to be there before it ever sends. |

## Adversarial review (Sonnet critic, 26 October 2026)

The full report is in the session notes folder (`syc-150-review.md`). It found 1 blocker, 12 major and 9 minor issues. All are folded in:

| # | Finding | Severity | Where it's fixed |
|---|---|---|---|
| 1 | A move racing a deletion could write a copy carrying the deleted device's id; the lock order was inverted against deletion | Blocker | §7.4 lock order, §7.8, test 6 |
| 2 | The trigger's "a move row exists" check is satisfied by an older row; the observation exemption could be forged | Major | §7.2 transaction-local setting plus `xmin`, test 1 |
| 3 | The move table can't share `cat_identity`'s guard, because redaction is an update; clearing a deleted team member's account id isn't built | Major | §7.2, §7.8 |
| 4 | The split insert's order was circular; the photo's role and position were unspecified | Major | §7.2 (`nextval`; `first` at position 1; columns copied) |
| 5 | The split sighting collides with the repeat-upload check | Major | §7.10, test 11 |
| 6 | `hasMetCat` counted split or unrecorded moved sightings; the naming exception also opened claiming | Major | §7.4 step 4, §7.6, test 14 |
| 7 | Widening the welfare query doesn't make the old cat stop counting, and would hide History's crossed-out row | Major | §7.3 (rows marked `elsewhere`, limited to moves) |
| 8 | Ear-tip state, `agreeWithClip` and `catsOfPhoto` bypass the loader (lock-out, resurrection, privacy leak) | Major | §7.3 readers table, tests 5 and 15 |
| 9 | A withdrawal row without the sighting's id would count as evidence of life; the retraction scope was misstated | Major | §7.3, test 4 |
| 10 | "As of" reads weren't specified | Major | §7.7, test 17 |
| 11 | The evening round-up would announce a moved-away photo | Major | §7.3 readers table, §4.3, test 16 |
| 12 | A late answer could land on the old cat in a race | Major | §7.4 locks and the answers route re-read, test 12 |
| 13 | Refusing every "only sighting" was too broad, and hiding left the clip | Major | §3.2 narrowed to "nothing left", with the existing Mark wrong; D1 reworded |
| 14 | Warnings were unconditional; the team-move exception to the deceased guard wasn't stated | Minor | §3.1 table |
| 15 | The "matched by hand" flag would mislabel the new cat | Minor | §7.3 readers table |
| 16 | The nightly check's sightings path and baselines weren't covered | Minor | §7.9 |
| 17 | New-cat creation mixed two paths; a removed photo and the name refusals weren't covered | Minor | §3.3, §7.4 step 2 |
| 18 | Discoverer, name and map spot left on the wrong cat weren't a decision | Minor | §3.2, new D6 |
| 19 | The automatic main photo conflicted with `choose-a-different-cat.md` §8.4; colour reading left behind | Minor | §3.1 (team chooses), §7.4 step 6 |
| 20 | `matcherHealth`, open `wrong_cat` reports, follow edge cases and merged targets | Minor | §7.3, §7.4 steps 1, 7 and 8, §4.7 |
| 21 | No `move_sighting` capability; the Amends list was incomplete; the cross-cat claim was wrong for ear tip | Minor | §2, §7.4, header, §7.3 |
| 22 | "Today…" phrasing in the product sections and jargon in §4 | Minor | Rewritten; the ticket comparison moved here |

Not checked by the reviewer: `photo_fingerprints` internals (they hold no cat id, so they follow the photo), the matching game's vote storage, and how `catHistory.ts` draws a row. The plan covers the last one.
