# SYC-715 checkpoint
Decision (Samuel 26 Oct, on ticket): option 3 hold email on phone, save later with name. Confirmation mail verified: POST /keep-safe enqueues verify mail (routes/keepSafe.ts).
Plan: lib/heldEmail.ts (storage+hook), IDENTITY_KEYS/startAgain/restore clear it, useOnboardingEmail -> unreachable result (no HTTP status), NameStep holds email + goes on to claim, hooks/useHeldEmailSaver (read-first via getKeepSafe) mounted in _layout, Me line emailNotSavedYet en/el/fr, tests.
Done: nothing yet.
