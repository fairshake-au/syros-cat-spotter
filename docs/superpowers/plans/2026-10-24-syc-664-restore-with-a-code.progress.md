T1 done: restore-code columns (code_hash, code_attempts, handle_hash + unique index) in migration 0043, newCode/codeHash/isCodeShaped helpers, restore_code fingerprint label; next: T2 request/outbox/template
T2 done: request issues an 8-digit code, email carries it, outbox clears it; next: T3
T3 done: POST /api/restore/code (exchangeCode in lib/keepSafe/code.ts, per-phone cap after device auth, 800 ms pad, single refusal); next: T4
T4 done: peek, redeem and the 60 s replay accept a handle (rowIs at all four mail_tokens lookups in move.ts); next: T5
T5 done: exchangeRestoreCode + code guards in keepSafe.ts, restoreWaiting store (15 min, web localStorage); next: T6
T6 done: RestoreChooser extracted from app/restore.tsx (fromCode skips in-app advice, onMoved prop); next: T7
T7 done: code screen (address, code, chooser) with en/el/fr strings; next: T8
T7 fix 1 done: guard ref, 429 resend, restoreCodeFailed, el wording; next: T8
T8 done: reopen on the code box after a reload (onboarding, /get-spots-back, gate hook); waiting note cleared on startAgain/adopt/reset; next: T9
T9 done: link page gets a third answer (use-icon state, same-size pair), copy strings add the code option in en/el/fr; password page shows the restore code hint on /restore; next: T10
Final fix I1 done: pending move stored before redeem on the code path, resumed at start-up in DeviceContext within 60 s; next: I2-I4, minors
Final fix I2 done: chooser Back on the code path, dead handle dropped on not-valid/failed/already-here, ask again goes to the address box; next: I3, I4
