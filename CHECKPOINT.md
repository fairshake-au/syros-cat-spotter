# SYC-199 + SYC-307 checkpoint
Done: SYC-307 colony expression index (migration 0050_observations_colony_index), one-colony page uses catsInColony, pinning test, EXPLAIN captured (scratchpad before.txt/after.txt).
SYC-199 PARKED: unique supersedes_id index breaks 3 vetVisits tests - vet visits deliberately let 2+ rows supersede one guardian "no". Parked SQL is in side-session notes. Needs Samuel's call. 0030 already has a plain partial index on supersedes_id.
Next: full suites, prod dup query result (coordinator local_baf9188a), draft PR, rm CHECKPOINT.md before PR.
