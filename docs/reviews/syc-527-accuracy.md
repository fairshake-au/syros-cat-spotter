# SYC-527: the accuracy check (spec §8)

**Status, 22 Oct 2026:** the model and the shortlist length are chosen by spec §8's rule for when the larger set isn't available. The production smoke test runs after this PR merges.

## The choice

- **Model: DINOv2 small, 8-bit** (`dinov2-small-q8/v1`). Spec §4's rule keeps it unless CLIP is more than 5 points better on the larger set. That set wasn't run, so there's nothing to beat it.
- **Shortlist: K = 20.** Spec §8 says K becomes 10 only on evidence from the larger set. Without that set, K stays 20.

## Check 2 (the larger set): skipped

The candidate was Kaggle's "Cat Individual Images" (`timost1234/cat-individuals`). Its page gives the licence as Attribution 4.0 International (CC BY 4.0). It has 518 cats, 13,536 images, and is about 11.2 GB. Samuel first chose to download it himself, then changed his answer on 22 Oct 2026: "oh 11.2GB! I'd rather not download the bigger set - change my choice to the altenrative pls".

So until SYC-56's launch-era set exists, **the only measure is the smoke test below**. The script can still run this check if a set arrives later: `fingerprintAccuracy.ts --dataset <folder> --clip-dir <CLIP folder>`, on the Mac only, never uploaded. If it's run on the Kaggle set, the results here must credit "Cat Individual Images" by timost1234 (CC BY 4.0).

## Check 1 (the production smoke test): after merge

- **Samuel's go:** "Go ahead (Recommended)", after a heads-up that it reads the live database, writes nothing and prints only ranks.
- **Why it waits:** `db-ops.yml` always checks out `main`, so the new command exists there only after this PR merges.
- **Command:** `gh workflow run db-ops.yml --ref main -f target=production -f command=fingerprint-accuracy`
- **What it does:** the connection is read-only at the session level. Photos are re-encoded in memory (never through `variantFor`, which writes). The output is ranks and a pair index only.
- **CLIP is not run** there, because the runner has no CLIP files. So this smoke result covers DINOv2 only.
- **Passes if** every pair ranks in the top 10. The result goes on SYC-527 and in this file.
- **If it fails,** the index stays unused (it only acts over 30 cats; the island has 28), and the options go back to Samuel.

| Pair | DINOv2 rank | Top 10 |
|---|---|---|
| _after merge_ | | |
