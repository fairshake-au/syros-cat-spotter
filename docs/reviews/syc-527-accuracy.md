# SYC-527: the accuracy check (spec §8)

**Status, 22 Oct 2026:** the model and the shortlist length are chosen by spec §8's rule for when the larger set isn't available. The production smoke test **passes** (run 39735126442).

## The choice

- **Model: DINOv2 small, 8-bit** (`dinov2-small-q8/v1`). Spec §4's rule keeps it unless CLIP is more than 5 points better on the larger set. That set wasn't run, so there's nothing to beat it.
- **Shortlist: K = 20.** Spec §8 says K becomes 10 only on evidence from the larger set. Without that set, K stays 20.

## Check 2 (the larger set): skipped

The candidate was Kaggle's "Cat Individual Images" (`timost1234/cat-individuals`). Its page gives the licence as Attribution 4.0 International (CC BY 4.0). It has 518 cats, 13,536 images, and is about 11.2 GB. Samuel first chose to download it himself, then changed his answer on 22 Oct 2026: "oh 11.2GB! I'd rather not download the bigger set - change my choice to the altenrative pls".

So until SYC-56's launch-era set exists, **the only measure is the smoke test below**. The script can still run this check if a set arrives later: `fingerprintAccuracy.ts --dataset <folder> --clip-dir <CLIP folder>`, on the Mac only, never uploaded. If it's run on the Kaggle set, the results here must credit "Cat Individual Images" by timost1234 (CC BY 4.0).

## Check 1 (the production smoke test): passes

- **Run:** db-ops `fingerprint-accuracy`, run 39735126442 on `main`, 22 Oct 2026. It ran against the live build `57d05b5f`, which contains #280's `558b1057`, and completed with success.
- **Samuel's go:** "Go ahead (Recommended)", after a heads-up that it reads the live database, writes nothing and prints only ranks.
- **What it did:** the connection was read-only at the session level. Photos were re-encoded in memory (never through `variantFor`, which writes). The output was ranks and a pair index only.
- **Pairs:** 4 cats have a second confirmed, visible photo from a different Athens day.
- **CLIP was not run,** because the runner has no CLIP files. So this result covers DINOv2 only.

| Pair | DINOv2 rank | Top 10 |
|---|---|---|
| 1 | 5 | yes |
| 2 | 7 | yes |
| 3 | 1 | yes |
| 4 | 2 | yes |

- **Result:** 4 of 4 in the top 10, and so in the top 20. The smoke test passes.
- **What it shows:** by chance alone, a top 20 of 28 cats would include the right cat 71% of the time. So this shows the index isn't broken, not that it's good. SYC-56's launch-era set is the real measure.
- **Background:** in all 4 searches, the top 20 was mostly cats from one area. Photos taken at the same spot look alike to the model (spec §8). The page's "if you know where the photo was taken, choosing the area is surer" line covers this.
- **K stays 20.** The smoke test passes at 10, but spec §8 lowers K to 10 only on evidence from the larger set, and that set was skipped.
