# CHECKPOINT (SYC-532 + SYC-531)
Decisions (Samuel, via AskUserQuestion): banner on Home + email to Samuel only (new env MATCHER_ALERT_TO); threshold 5 failed checks in 15 min.
Design: no migration. Failures = sighting_matches.matcher_failed within window. Alert open/closed state = latest mail_outbox row with purpose matcher_alert (payload.kind down|up).
Plan: A matcherHealth.ts -> B mail purpose matcher_alert -> C Home banner -> D "New cats to check" page + Home tile (14 days) -> tests -> PR draft.
Done: (nothing yet)
