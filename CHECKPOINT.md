# CHECKPOINT (SYC-532 + SYC-531)
Decisions (Samuel, via AskUserQuestion): banner on Home + email to Samuel only (new env MATCHER_ALERT_TO); threshold 5 failed checks in 15 min.
Design: no migration. Failures = sighting_matches.matcher_failed within window. Alert open/closed state = latest mail_outbox row with purpose matcher_alert (payload.kind down|up).
Plan: A matcherHealth.ts -> B mail purpose matcher_alert -> C Home banner -> D "New cats to check" page + Home tile (14 days) -> tests -> PR draft.
Done: (nothing yet)
Done: A (matcherHealth.ts), B (matcher_alert mail purpose + MATCHER_ALERT_TO), C (Home banner), D (/api/team/new-cats-to-check + Home tile), tests (matcherHealth, sightings.matcherAlert, matcherBanner). All committed.
Next: full api-server suite, tsc, screenshots 390px+desktop, docs/env note, Linear, draft PR, git rm CHECKPOINT.md before PR.
